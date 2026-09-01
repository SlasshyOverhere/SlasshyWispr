//! Daemon process infrastructure for Coqui TTS and local STT bridges.
//!
//! This module owns the lifecycle of long-running Python bridge daemons,
//! including spawning, request dispatch, retry, idle cleanup, and the
//! periodic sweeper thread.
//!
//! It is **runtime-dependent** (spawns subprocesses, uses `OnceLock` global
//! state) but has **no Tauri or AppState dependencies**.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use log::{error, info, warn};
use serde_json::{json, Value};

use crate::constants::*;
use crate::pipeline::ai::{clip_text, single_line};
use crate::pipeline::routing::{env_flag, non_empty_env_var};
use crate::pipeline::tts::{apply_no_window, validate_python_binary_path};
use transcribe_rs::TranscriptionEngine;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

struct CoquiBridgeDaemon {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

pub(crate) struct LocalSttBridgeDaemon {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    last_used: Instant,
    model_loaded: bool,
}

// ---------------------------------------------------------------------------
// Global state
// ---------------------------------------------------------------------------

static COQUI_DAEMONS: OnceLock<Mutex<HashMap<String, CoquiBridgeDaemon>>> = OnceLock::new();
static LOCAL_STT_DAEMONS: OnceLock<Mutex<HashMap<String, LocalSttBridgeDaemon>>> = OnceLock::new();
static LOCAL_STT_DAEMON_SWEEPER_STARTED: OnceLock<()> = OnceLock::new();

fn coqui_daemons() -> &'static Mutex<HashMap<String, CoquiBridgeDaemon>> {
    COQUI_DAEMONS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn local_stt_daemons() -> &'static Mutex<HashMap<String, LocalSttBridgeDaemon>> {
    LOCAL_STT_DAEMONS.get_or_init(|| Mutex::new(HashMap::new()))
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

fn coqui_daemon_key(python_path: &str, script_path: &Path) -> String {
    #[cfg(target_os = "windows")]
    let normalized_python = python_path.to_ascii_lowercase();
    #[cfg(not(target_os = "windows"))]
    let normalized_python = python_path.to_string();

    format!("{normalized_python}|{}", script_path.to_string_lossy())
}

fn local_stt_daemon_key(python_path: &str, script_path: &Path) -> String {
    #[cfg(target_os = "windows")]
    let normalized_python = python_path.to_ascii_lowercase();
    #[cfg(not(target_os = "windows"))]
    let normalized_python = python_path.to_string();

    format!("{normalized_python}|{}", script_path.to_string_lossy())
}

// ---------------------------------------------------------------------------
// Environment helpers (daemon-specific)
// ---------------------------------------------------------------------------

fn env_u64(name: &str, default: u64, min: u64, max: u64) -> u64 {
    non_empty_env_var(name)
        .and_then(|raw| raw.parse::<u64>().ok())
        .map(|value| value.clamp(min, max))
        .unwrap_or(default)
}

pub(crate) fn local_stt_model_unload_idle_timeout_secs() -> u64 {
    env_u64(
        LOCAL_STT_MODEL_UNLOAD_IDLE_TIMEOUT_ENV,
        LOCAL_STT_MODEL_UNLOAD_IDLE_TIMEOUT_SECS,
        5,
        3600,
    )
}

fn local_stt_daemon_idle_timeout_secs() -> u64 {
    env_u64(
        LOCAL_STT_DAEMON_IDLE_TIMEOUT_ENV,
        LOCAL_STT_DAEMON_IDLE_TIMEOUT_SECS,
        30,
        12 * 3600,
    )
}

fn local_stt_daemon_sweep_interval_secs() -> u64 {
    env_u64(
        LOCAL_STT_DAEMON_SWEEP_INTERVAL_ENV,
        LOCAL_STT_DAEMON_SWEEP_INTERVAL_SECS,
        3,
        300,
    )
}

pub(crate) fn local_stt_parakeet_unload_after_transcribe() -> bool {
    env_flag(LOCAL_STT_PARAKEET_UNLOAD_AFTER_TRANSCRIBE_ENV, false)
}

// ---------------------------------------------------------------------------
// JSON recovery helper
// ---------------------------------------------------------------------------

fn extract_json_value_from_output(output: &str) -> Option<Value> {
    for line in output.lines().rev() {
        let candidate = line.trim();
        if candidate.is_empty() {
            continue;
        }

        if let Ok(value) = serde_json::from_str::<Value>(candidate) {
            return Some(value);
        }

        if let Some(index) = candidate.find('{') {
            let maybe_json = &candidate[index..];
            if let Ok(value) = serde_json::from_str::<Value>(maybe_json) {
                return Some(value);
            }
        }
    }

    None
}

// ---------------------------------------------------------------------------
// Coqui daemon
// ---------------------------------------------------------------------------

fn spawn_coqui_bridge_daemon(
    python_path: &str,
    script_path: &Path,
    cache_dir: &Path,
) -> Result<CoquiBridgeDaemon, String> {
    validate_python_binary_path(python_path)?;
    let mut command = Command::new(python_path);
    apply_no_window(&mut command);
    command
        .arg(script_path)
        .arg("--daemon")
        .env("TTS_HOME", cache_dir)
        .env("COQUI_TOS_AGREED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start Coqui bridge daemon: {error}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open stdin for Coqui daemon.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open stdout for Coqui daemon.".to_string())?;

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let compact = clip_text(&single_line(&text), 420);
                        if !compact.trim().is_empty() {
                            info!("[coqui.daemon][stderr] {}", compact);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    Ok(CoquiBridgeDaemon {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

fn send_coqui_daemon_request(
    daemon: &mut CoquiBridgeDaemon,
    action: &str,
    payload: &Value,
) -> Result<Value, String> {
    let request_json = serde_json::to_string(payload)
        .map_err(|error| format!("Failed to serialize Coqui daemon request: {error}"))?;
    daemon
        .stdin
        .write_all(request_json.as_bytes())
        .map_err(|error| format!("Failed to write Coqui daemon request body: {error}"))?;
    daemon
        .stdin
        .write_all(b"\n")
        .map_err(|error| format!("Failed to finalize Coqui daemon request line: {error}"))?;
    daemon
        .stdin
        .flush()
        .map_err(|error| format!("Failed to flush Coqui daemon stdin: {error}"))?;

    let mut noisy_output = String::new();
    loop {
        let mut line = String::new();
        let bytes = daemon
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("Failed to read Coqui daemon response: {error}"))?;
        if bytes == 0 {
            let status = daemon
                .child
                .try_wait()
                .ok()
                .flatten()
                .map(|exit| exit.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let details = if noisy_output.trim().is_empty() {
                status
            } else {
                format!(
                    "{status}; output={}",
                    clip_text(&single_line(&noisy_output), 420)
                )
            };
            return Err(format!(
                "Coqui daemon stream closed during action '{action}': {details}"
            ));
        }

        let candidate = line.trim();
        if candidate.is_empty() {
            continue;
        }

        let parsed = match serde_json::from_str::<Value>(candidate) {
            Ok(parsed) => Some(parsed),
            Err(_) => extract_json_value_from_output(candidate),
        };

        if let Some(parsed) = parsed {
            let ok = parsed.get("ok").and_then(Value::as_bool).unwrap_or(false);
            if !ok {
                let bridge_error = parsed
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let error_text = if bridge_error.trim().is_empty() {
                    candidate.to_string()
                } else {
                    bridge_error.to_string()
                };
                return Err(format!(
                    "Coqui bridge failed: {}",
                    clip_text(error_text.trim(), 420)
                ));
            }
            return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
        }

        if !noisy_output.is_empty() {
            noisy_output.push(' ');
        }
        noisy_output.push_str(candidate);
        if noisy_output.chars().count() > 1600 {
            noisy_output = clip_text(&noisy_output, 1600);
        }
    }
}

pub fn run_coqui_bridge_via_daemon(
    python_path: &str,
    script_path: &Path,
    cache_dir: &Path,
    action: &str,
    payload: &Value,
) -> Result<Value, String> {
    let key = coqui_daemon_key(python_path, script_path);
    let registry = coqui_daemons();
    let mut guard = registry
        .lock()
        .map_err(|_| "Failed to lock Coqui daemon registry.".to_string())?;

    if !guard.contains_key(&key) {
        info!(
            "[coqui.daemon] starting python={} script={}",
            python_path,
            script_path.to_string_lossy()
        );
        let daemon = spawn_coqui_bridge_daemon(python_path, script_path, cache_dir)?;
        guard.insert(key.clone(), daemon);
    }

    let first_attempt = {
        let daemon = guard
            .get_mut(&key)
            .ok_or_else(|| "Coqui daemon instance is unavailable.".to_string())?;
        send_coqui_daemon_request(daemon, action, payload)
    };

    match first_attempt {
        Ok(result) => {
            info!("[coqui.daemon] success action={}", action);
            Ok(result)
        }
        Err(first_error) => {
            warn!(
                "[coqui.daemon] request failed action={} error={}",
                action,
                clip_text(&single_line(&first_error), 420)
            );
            if let Some(mut stale) = guard.remove(&key) {
                let _ = stale.child.kill();
                let _ = stale.child.wait();
            }

            info!("[coqui.daemon] restarting after failure action={}", action);
            let mut daemon = spawn_coqui_bridge_daemon(python_path, script_path, cache_dir)?;
            let retry = send_coqui_daemon_request(&mut daemon, action, payload);
            match retry {
                Ok(result) => {
                    guard.insert(key, daemon);
                    info!("[coqui.daemon] success action={} retry=true", action);
                    Ok(result)
                }
                Err(retry_error) => Err(format!(
                    "Coqui daemon request failed: {} | retry: {}",
                    clip_text(&single_line(&first_error), 420),
                    clip_text(&single_line(&retry_error), 420)
                )),
            }
        }
    }
}

pub fn parse_coqui_bridge_response(
    action: &str,
    status_ok: bool,
    stdout_text: &str,
    stderr_text: &str,
) -> Result<Value, String> {
    let parsed: Value = match serde_json::from_str(stdout_text) {
        Ok(parsed) => parsed,
        Err(error) => {
            if let Some(recovered) = extract_json_value_from_output(stdout_text) {
                warn!(
                    "[coqui.bridge] recovered json after noisy stdout action={} output={}",
                    action,
                    clip_text(&single_line(stdout_text), 420)
                );
                recovered
            } else {
                let merged = if stderr_text.is_empty() {
                    stdout_text.to_string()
                } else {
                    format!("{stdout_text} {stderr_text}")
                };
                error!(
                    "[coqui.bridge] invalid json action={} error={} output={}",
                    action,
                    error,
                    clip_text(&single_line(&merged), 420)
                );
                return Err(format!(
                    "Invalid Coqui bridge response: {error}. Output: {}",
                    clip_text(merged.trim(), 420)
                ));
            }
        }
    };

    let ok = parsed.get("ok").and_then(Value::as_bool).unwrap_or(false);
    if !status_ok || !ok {
        let bridge_error = parsed
            .get("error")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let merged = if bridge_error.trim().is_empty() {
            if stderr_text.is_empty() {
                stdout_text.to_string()
            } else {
                stderr_text.to_string()
            }
        } else {
            bridge_error.to_string()
        };
        error!(
            "[coqui.bridge] failed action={} error={}",
            action,
            clip_text(&single_line(&merged), 420)
        );
        return Err(format!(
            "Coqui bridge failed: {}",
            clip_text(merged.trim(), 420)
        ));
    }

    Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
}

// ---------------------------------------------------------------------------
// Coqui daemon lifecycle
// ---------------------------------------------------------------------------

pub fn stop_all_coqui_bridge_daemons() {
    let registry = coqui_daemons();
    let mut guard = match registry.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    for (_, mut daemon) in guard.drain() {
        let _ = daemon.child.kill();
        let _ = daemon.child.wait();
    }
}

// ---------------------------------------------------------------------------
// Local STT daemon
// ---------------------------------------------------------------------------

fn spawn_local_stt_bridge_daemon(
    python_path: &str,
    script_path: &Path,
    cache_dir: &Path,
) -> Result<LocalSttBridgeDaemon, String> {
    validate_python_binary_path(python_path)?;
    let parakeet_cpu_int8 = if env_flag(LOCAL_STT_PARAKEET_CPU_INT8_ENV, true) {
        "1"
    } else {
        "0"
    };
    let parakeet_force_cpu = if env_flag(LOCAL_STT_PARAKEET_FORCE_CPU_ENV, false) {
        "1"
    } else {
        "0"
    };

    let mut command = Command::new(python_path);
    apply_no_window(&mut command);
    command
        .arg(script_path)
        .arg("--daemon")
        .env("HF_HOME", cache_dir)
        .env("TRANSFORMERS_CACHE", cache_dir)
        .env("NEMO_CACHE_DIR", cache_dir)
        .env("SLASSHY_STT_PARAKEET_CPU_INT8", parakeet_cpu_int8)
        .env("SLASSHY_STT_PARAKEET_FORCE_CPU", parakeet_force_cpu)
        .env("PYTHONUNBUFFERED", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start local STT bridge daemon: {error}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open stdin for local STT daemon.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open stdout for local STT daemon.".to_string())?;

    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let compact = clip_text(&single_line(&text), 420);
                        if !compact.trim().is_empty() {
                            info!("[local.stt.daemon][stderr] {}", compact);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    Ok(LocalSttBridgeDaemon {
        child,
        stdin,
        stdout: BufReader::new(stdout),
        last_used: Instant::now(),
        model_loaded: false,
    })
}

fn send_local_stt_daemon_request(
    daemon: &mut LocalSttBridgeDaemon,
    action: &str,
    payload: &Value,
) -> Result<Value, String> {
    let request_json = serde_json::to_string(payload)
        .map_err(|error| format!("Failed to serialize local STT daemon request: {error}"))?;
    daemon
        .stdin
        .write_all(request_json.as_bytes())
        .map_err(|error| format!("Failed to write local STT daemon request body: {error}"))?;
    daemon
        .stdin
        .write_all(b"\n")
        .map_err(|error| format!("Failed to finalize local STT daemon request line: {error}"))?;
    daemon
        .stdin
        .flush()
        .map_err(|error| format!("Failed to flush local STT daemon stdin: {error}"))?;

    let mut noisy_output = String::new();
    loop {
        let mut line = String::new();
        let bytes = daemon
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("Failed to read local STT daemon response: {error}"))?;
        if bytes == 0 {
            let status = daemon
                .child
                .try_wait()
                .ok()
                .flatten()
                .map(|exit| exit.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let details = if noisy_output.trim().is_empty() {
                status
            } else {
                format!(
                    "{status}; output={}",
                    clip_text(&single_line(&noisy_output), 420)
                )
            };
            return Err(format!(
                "Local STT daemon stream closed during action '{action}': {details}"
            ));
        }

        let candidate = line.trim();
        if candidate.is_empty() {
            continue;
        }

        let parsed = match serde_json::from_str::<Value>(candidate) {
            Ok(parsed) => Some(parsed),
            Err(_) => extract_json_value_from_output(candidate),
        };

        if let Some(parsed) = parsed {
            let ok = parsed.get("ok").and_then(Value::as_bool).unwrap_or(false);
            if !ok {
                let bridge_error = parsed
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let error_text = if bridge_error.trim().is_empty() {
                    candidate.to_string()
                } else {
                    bridge_error.to_string()
                };
                return Err(format!(
                    "Local STT bridge failed: {}",
                    clip_text(error_text.trim(), 420)
                ));
            }
            return Ok(parsed.get("result").cloned().unwrap_or(Value::Null));
        }

        if !noisy_output.is_empty() {
            noisy_output.push(' ');
        }
        noisy_output.push_str(candidate);
        if noisy_output.chars().count() > 1600 {
            noisy_output = clip_text(&noisy_output, 1600);
        }
    }
}

fn local_stt_daemon_action_loads_model(action: &str) -> bool {
    matches!(
        action,
        "warmup_parakeet" | "transcribe_parakeet" | "warmup_hf_asr" | "transcribe_hf_asr"
    )
}

fn local_stt_daemon_action_trims_model(action: &str) -> bool {
    action == "trim_cache"
}

pub fn run_local_stt_bridge_via_daemon(
    python_path: &str,
    script_path: &Path,
    cache_dir: &Path,
    action: &str,
    payload: &Value,
) -> Result<Value, String> {
    let key = local_stt_daemon_key(python_path, script_path);
    let registry = local_stt_daemons();
    let mut guard = registry
        .lock()
        .map_err(|_| "Failed to lock local STT daemon registry.".to_string())?;

    if !guard.contains_key(&key) {
        info!(
            "[local.stt.daemon] starting python={} script={}",
            python_path,
            script_path.to_string_lossy()
        );
        let daemon = spawn_local_stt_bridge_daemon(python_path, script_path, cache_dir)?;
        guard.insert(key.clone(), daemon);
    }

    let first_attempt = {
        let daemon = guard
            .get_mut(&key)
            .ok_or_else(|| "Local STT daemon instance is unavailable.".to_string())?;
        daemon.last_used = Instant::now();
        send_local_stt_daemon_request(daemon, action, payload)
    };

    match first_attempt {
        Ok(result) => {
            if let Some(daemon) = guard.get_mut(&key) {
                daemon.last_used = Instant::now();
                let unloaded_after_transcribe = action == "transcribe_parakeet"
                    && result
                        .get("unloadedAfterTranscribe")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                if local_stt_daemon_action_loads_model(action) {
                    daemon.model_loaded = !unloaded_after_transcribe;
                }
                if local_stt_daemon_action_trims_model(action) {
                    daemon.model_loaded = false;
                }
            }
            info!("[local.stt.daemon] success action={}", action);
            Ok(result)
        }
        Err(first_error) => {
            warn!(
                "[local.stt.daemon] request failed action={} error={}",
                action,
                clip_text(&single_line(&first_error), 420)
            );
            if let Some(mut stale) = guard.remove(&key) {
                let _ = stale.child.kill();
                let _ = stale.child.wait();
            }

            info!(
                "[local.stt.daemon] restarting after failure action={}",
                action
            );
            let mut daemon = spawn_local_stt_bridge_daemon(python_path, script_path, cache_dir)?;
            let retry = send_local_stt_daemon_request(&mut daemon, action, payload);
            match retry {
                Ok(result) => {
                    daemon.last_used = Instant::now();
                    let unloaded_after_transcribe = action == "transcribe_parakeet"
                        && result
                            .get("unloadedAfterTranscribe")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                    if local_stt_daemon_action_loads_model(action) {
                        daemon.model_loaded = !unloaded_after_transcribe;
                    }
                    if local_stt_daemon_action_trims_model(action) {
                        daemon.model_loaded = false;
                    }
                    guard.insert(key, daemon);
                    info!("[local.stt.daemon] success action={} retry=true", action);
                    Ok(result)
                }
                Err(retry_error) => Err(format!(
                    "Local STT daemon request failed: {} | retry: {}",
                    clip_text(&single_line(&first_error), 420),
                    clip_text(&single_line(&retry_error), 420)
                )),
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Local STT daemon lifecycle management
// ---------------------------------------------------------------------------

pub fn stop_all_local_stt_bridge_daemons_with_count() -> usize {
    let registry = local_stt_daemons();
    let mut guard = match registry.lock() {
        Ok(guard) => guard,
        Err(_) => return 0,
    };

    let count = guard.len();
    for (_, mut daemon) in guard.drain() {
        let _ = daemon.child.kill();
        let _ = daemon.child.wait();
    }
    count
}

pub fn stop_all_local_stt_bridge_daemons() {
    let _ = stop_all_local_stt_bridge_daemons_with_count();
}

pub fn trim_all_local_stt_bridge_daemon_model_caches() -> Result<(usize, usize), String> {
    let registry = local_stt_daemons();
    let mut guard = registry
        .lock()
        .map_err(|_| "Failed to lock local STT daemon registry.".to_string())?;

    if guard.is_empty() {
        return Ok((0, 0));
    }

    let trim_payload = json!({ "action": "trim_cache" });
    let keys = guard.keys().cloned().collect::<Vec<_>>();
    let mut trimmed = 0usize;
    let mut failed_keys: Vec<String> = Vec::new();

    for key in keys {
        let Some(daemon) = guard.get_mut(&key) else {
            continue;
        };
        daemon.last_used = Instant::now();
        match send_local_stt_daemon_request(daemon, "trim_cache", &trim_payload) {
            Ok(_) => {
                daemon.model_loaded = false;
                trimmed += 1;
                info!(
                    "[local.stt.daemon] model cache trimmed key={}",
                    clip_text(&key, 180)
                );
            }
            Err(error) => {
                warn!(
                    "[local.stt.daemon] trim_cache failed key={} error={}",
                    clip_text(&key, 180),
                    clip_text(&single_line(&error), 320)
                );
                failed_keys.push(key);
            }
        }
    }

    let mut stopped = 0usize;
    for key in failed_keys {
        if let Some(mut daemon) = guard.remove(&key) {
            let _ = daemon.child.kill();
            let _ = daemon.child.wait();
            stopped += 1;
            info!(
                "[local.stt.daemon] stopped daemon after trim failure key={}",
                clip_text(&key, 180)
            );
        }
    }

    Ok((trimmed, stopped))
}

fn stop_idle_local_stt_bridge_daemons() {
    let registry = local_stt_daemons();
    let mut guard = match registry.try_lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    let now = Instant::now();
    let unload_timeout_secs = local_stt_model_unload_idle_timeout_secs();
    let idle_timeout_secs = local_stt_daemon_idle_timeout_secs();
    let unload_timeout = Duration::from_secs(unload_timeout_secs);
    let idle_timeout = Duration::from_secs(idle_timeout_secs);
    let mut stale_keys: Vec<String> = Vec::new();
    for (key, daemon) in guard.iter_mut() {
        let idle_for = now.duration_since(daemon.last_used);
        if idle_for >= idle_timeout {
            stale_keys.push(key.clone());
            continue;
        }
        if idle_for >= unload_timeout && daemon.model_loaded {
            let trim_payload = json!({ "action": "trim_cache" });
            match send_local_stt_daemon_request(daemon, "trim_cache", &trim_payload) {
                Ok(_) => {
                    daemon.model_loaded = false;
                    info!(
                        "[local.stt.daemon] trimmed idle model cache key={} idle_secs={} unload_after_secs={}",
                        clip_text(key, 180),
                        idle_for.as_secs(),
                        unload_timeout_secs
                    );
                }
                Err(error) => {
                    warn!(
                        "[local.stt.daemon] trim_cache failed key={} error={}",
                        clip_text(key, 180),
                        clip_text(&single_line(&error), 320)
                    );
                    stale_keys.push(key.clone());
                }
            }
        }
    }

    for key in stale_keys {
        if let Some(mut daemon) = guard.remove(&key) {
            let _ = daemon.child.kill();
            let _ = daemon.child.wait();
            info!(
                "[local.stt.daemon] stopped idle daemon key={} timeout_secs={}",
                clip_text(&key, 180),
                idle_timeout_secs
            );
        }
    }
}

fn stop_idle_local_stt_native_parakeet_runtime() {
    let unload_timeout_secs = local_stt_model_unload_idle_timeout_secs();
    let unload_timeout = Duration::from_secs(unload_timeout_secs);
    let runtime = crate::local_stt_native_parakeet_runtime();
    let mut guard = match runtime.try_lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    let should_unload = guard
        .as_ref()
        .map(|active| active.last_used.elapsed() >= unload_timeout)
        .unwrap_or(false);
    if !should_unload {
        return;
    }

    if let Some(mut active) = guard.take() {
        let _ = active.engine.unload_model();
        info!(
            "[local.stt.parakeet.native] trimmed idle model cache key={} unload_after_secs={}",
            clip_text(&active.model_key, 220),
            unload_timeout_secs
        );
    }
}

/// Returns (total_daemon_count, loaded_daemon_count) for the local STT daemon pool.
pub(crate) fn local_stt_daemon_stats() -> (usize, usize) {
    let registry = local_stt_daemons();
    let guard = match registry.lock() {
        Ok(guard) => guard,
        Err(_) => return (0, 0),
    };
    let daemon_count = guard.len();
    let loaded_daemon_count = guard.values().filter(|d| d.model_loaded).count();
    (daemon_count, loaded_daemon_count)
}

pub fn ensure_local_stt_daemon_idle_sweeper() {
    if LOCAL_STT_DAEMON_SWEEPER_STARTED.set(()).is_err() {
        return;
    }

    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(local_stt_daemon_sweep_interval_secs()));
        stop_idle_local_stt_bridge_daemons();
        stop_idle_local_stt_native_parakeet_runtime();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coqui_daemon_key_is_case_insensitive_on_windows() {
        let key = coqui_daemon_key("Python", Path::new("/scripts/coqui.py"));
        assert!(key.contains('|'));
    }

    #[test]
    fn local_stt_daemon_key_is_case_insensitive_on_windows() {
        let key = local_stt_daemon_key("python3", Path::new("/scripts/stt.py"));
        assert!(key.contains('|'));
    }

    #[test]
    fn extract_json_value_from_output_recovers_json_from_noisy_stdout() {
        let noisy = "INFO: loading model\n{\"ok\":true,\"result\":{\"text\":\"hello\"}}";
        let result = extract_json_value_from_output(noisy);
        assert!(result.is_some());
        let value = result.unwrap();
        assert_eq!(value.get("ok").and_then(Value::as_bool), Some(true));
    }

    #[test]
    fn extract_json_value_from_output_returns_none_for_garbage() {
        let garbage = "just some random log output with no json";
        assert!(extract_json_value_from_output(garbage).is_none());
    }

    #[test]
    fn extract_json_value_from_output_handles_partial_json_prefix() {
        let noisy = "some log line {\"ok\":true,\"result\":null}";
        let result = extract_json_value_from_output(noisy);
        assert!(result.is_some());
    }

    #[test]
    fn local_stt_daemon_action_loads_model_detects_correct_actions() {
        assert!(local_stt_daemon_action_loads_model("warmup_parakeet"));
        assert!(local_stt_daemon_action_loads_model("transcribe_parakeet"));
        assert!(local_stt_daemon_action_loads_model("warmup_hf_asr"));
        assert!(local_stt_daemon_action_loads_model("transcribe_hf_asr"));
        assert!(!local_stt_daemon_action_loads_model("trim_cache"));
        assert!(!local_stt_daemon_action_loads_model("other"));
    }

    #[test]
    fn local_stt_daemon_action_trims_model_detects_trim_action() {
        assert!(local_stt_daemon_action_trims_model("trim_cache"));
        assert!(!local_stt_daemon_action_trims_model("transcribe_hf_asr"));
        assert!(!local_stt_daemon_action_trims_model("other"));
    }
}
