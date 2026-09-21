//! Local-STT bridge daemon lifecycle (Phase 8).
//!
//! Two-tier VRAM reaper policy: 90s trim (unload model, keep process) then
//! 15min kill, driven by the background sweeper below plus the native
//! Parakeet runtime trim. Transport primitives come from `super::transport`.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use log::{info, warn};
use serde_json::{json, Value};
use transcribe_rs::TranscriptionEngine;

use super::transport::{
    daemon_key, env_u64, send_bridge_request, spawn_bridge_daemon, BridgeDaemon,
};
use crate::audio::parakeet::local_stt_native_parakeet_runtime;
use crate::constants::*;
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::routing::env_flag;

pub(crate) struct LocalSttBridgeDaemon {
    inner: BridgeDaemon,
}

impl LocalSttBridgeDaemon {
    fn new(inner: BridgeDaemon) -> Self {
        Self { inner }
    }
}

impl std::ops::Deref for LocalSttBridgeDaemon {
    type Target = BridgeDaemon;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl std::ops::DerefMut for LocalSttBridgeDaemon {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

static LOCAL_STT_DAEMONS: OnceLock<Mutex<HashMap<String, LocalSttBridgeDaemon>>> = OnceLock::new();
static LOCAL_STT_DAEMON_SWEEPER_STARTED: OnceLock<()> = OnceLock::new();

pub(crate) fn local_stt_daemons() -> &'static Mutex<HashMap<String, LocalSttBridgeDaemon>> {
    LOCAL_STT_DAEMONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn local_stt_daemon_key(python_path: &str, script_path: &Path) -> String {
    daemon_key(python_path, script_path)
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

fn spawn_local_stt_bridge_daemon(
    python_path: &str,
    script_path: &Path,
    cache_dir: &Path,
) -> Result<LocalSttBridgeDaemon, String> {
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

    let inner = spawn_bridge_daemon(
        "local STT",
        "local.stt",
        python_path,
        script_path,
        &[
            ("HF_HOME", cache_dir.to_string_lossy().into_owned()),
            (
                "TRANSFORMERS_CACHE",
                cache_dir.to_string_lossy().into_owned(),
            ),
            ("NEMO_CACHE_DIR", cache_dir.to_string_lossy().into_owned()),
            (
                "SLASSHYWISPR_STT_PARAKEET_CPU_INT8",
                parakeet_cpu_int8.to_string(),
            ),
            (
                "SLASSHYWISPR_STT_PARAKEET_FORCE_CPU",
                parakeet_force_cpu.to_string(),
            ),
            ("PYTHONUNBUFFERED", "1".to_string()),
        ],
    )?;
    Ok(LocalSttBridgeDaemon::new(inner))
}

fn send_local_stt_daemon_request(
    daemon: &mut LocalSttBridgeDaemon,
    action: &str,
    payload: &Value,
) -> Result<Value, String> {
    send_bridge_request(
        "local STT",
        "Local STT",
        &mut daemon.inner,
        action,
        payload,
        "Local STT bridge failed",
    )
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

fn mark_model_state(daemon: &mut LocalSttBridgeDaemon, action: &str, result: &Value) {
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
                mark_model_state(daemon, action, &result);
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
                    mark_model_state(&mut daemon, action, &result);
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
    let runtime = local_stt_native_parakeet_runtime();
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
        active.engine.unload_model();
        info!(
            "[local.stt.parakeet.native] trimmed idle model cache key={} unload_after_secs={}",
            clip_text(&active.model_key, 220),
            unload_timeout_secs
        );
    }
}

/// Moonshine and SenseVoice share one idle sweep; Parakeet reports its own above.
fn stop_idle_local_stt_in_process_runtimes() {
    let max_idle = Duration::from_secs(local_stt_model_unload_idle_timeout_secs());
    let _ = crate::audio::runtimes::unload_idle(max_idle);
}

pub fn ensure_local_stt_daemon_idle_sweeper() {
    if LOCAL_STT_DAEMON_SWEEPER_STARTED.set(()).is_err() {
        return;
    }

    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(local_stt_daemon_sweep_interval_secs()));
        stop_idle_local_stt_bridge_daemons();
        stop_idle_local_stt_native_parakeet_runtime();
        stop_idle_local_stt_in_process_runtimes();
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_stt_daemon_key_is_case_insensitive_on_windows() {
        let key = local_stt_daemon_key("python3", Path::new("/scripts/stt.py"));
        assert!(key.contains('|'));
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
