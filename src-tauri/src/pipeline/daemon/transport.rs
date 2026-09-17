//! Shared JSONL bridge-daemon transport (Phase 8).
//!
//! Spawn/send/read primitives shared by the Coqui and local-STT bridge
//! daemons: process spawn with stderr pump, JSONL request write, noisy-output
//! recovery read loop, response parsing, daemon key helpers, and registry
//! stop. Lifecycle policy (Coqui stay-alive vs local-STT two-tier reaper)
//! stays in `super::coqui` / `super::local_stt` — no generic supervisor.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use std::time::Instant;

use log::{error, info, warn};
use serde_json::Value;

use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::process::{apply_no_window, validate_python_binary_path};
use crate::pipeline::routing::non_empty_env_var;

pub(crate) struct BridgeDaemon {
    pub(crate) child: Child,
    pub(crate) stdin: ChildStdin,
    pub(crate) stdout: BufReader<ChildStdout>,
    pub(crate) last_used: Instant,
    pub(crate) model_loaded: bool,
}

impl BridgeDaemon {
    pub(crate) fn fresh(child: Child, stdin: ChildStdin, stdout: BufReader<ChildStdout>) -> Self {
        Self {
            child,
            stdin,
            stdout,
            last_used: Instant::now(),
            model_loaded: false,
        }
    }
}

pub(crate) fn daemon_key(python_path: &str, script_path: &Path) -> String {
    #[cfg(target_os = "windows")]
    let normalized_python = python_path.to_ascii_lowercase();
    #[cfg(not(target_os = "windows"))]
    let normalized_python = python_path.to_string();

    format!("{normalized_python}|{}", script_path.to_string_lossy())
}

pub(crate) fn env_u64(name: &str, default: u64, min: u64, max: u64) -> u64 {
    non_empty_env_var(name)
        .and_then(|raw| raw.parse::<u64>().ok())
        .map(|value| value.clamp(min, max))
        .unwrap_or(default)
}

pub(crate) fn extract_json_value_from_output(output: &str) -> Option<Value> {
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

pub(crate) fn spawn_bridge_daemon(
    label: &str,
    log_tag: &str,
    python_path: &str,
    script_path: &Path,
    envs: &[(&str, String)],
) -> Result<BridgeDaemon, String> {
    validate_python_binary_path(python_path)?;
    let mut command = Command::new(python_path);
    apply_no_window(&mut command);
    command
        .arg(script_path)
        .arg("--daemon")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in envs {
        command.env(key, value);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to start {label} bridge daemon: {error}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| format!("Failed to open stdin for {label} daemon."))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("Failed to open stdout for {label} daemon."))?;

    if let Some(stderr) = child.stderr.take() {
        let log_tag = log_tag.to_string();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let compact = clip_text(&single_line(&text), 420);
                        if !compact.trim().is_empty() {
                            info!("[{log_tag}.daemon][stderr] {}", compact);
                        }
                    }
                    Err(_) => break,
                }
            }
        });
    }

    Ok(BridgeDaemon::fresh(child, stdin, BufReader::new(stdout)))
}

pub(crate) fn send_bridge_request(
    label: &str,
    stream_label: &str,
    daemon: &mut BridgeDaemon,
    action: &str,
    payload: &Value,
    fail_prefix: &str,
) -> Result<Value, String> {
    let request_json = serde_json::to_string(payload)
        .map_err(|error| format!("Failed to serialize {label} daemon request: {error}"))?;
    daemon
        .stdin
        .write_all(request_json.as_bytes())
        .map_err(|error| format!("Failed to write {label} daemon request body: {error}"))?;
    daemon
        .stdin
        .write_all(b"\n")
        .map_err(|error| format!("Failed to finalize {label} daemon request line: {error}"))?;
    daemon
        .stdin
        .flush()
        .map_err(|error| format!("Failed to flush {label} daemon stdin: {error}"))?;

    let mut noisy_output = String::new();
    loop {
        let mut line = String::new();
        let bytes = daemon
            .stdout
            .read_line(&mut line)
            .map_err(|error| format!("Failed to read {label} daemon response: {error}"))?;
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
                "{stream_label} daemon stream closed during action '{action}': {details}"
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
                    "{fail_prefix}: {}",
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

pub(crate) fn parse_bridge_response(
    label: &str,
    log_tag: &str,
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
                    "[{log_tag}.bridge] recovered json after noisy stdout action={} output={}",
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
                    "[{log_tag}.bridge] invalid json action={} error={} output={}",
                    action,
                    error,
                    clip_text(&single_line(&merged), 420)
                );
                return Err(format!(
                    "Invalid {label} bridge response: {error}. Output: {}",
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
            "[{log_tag}.bridge] failed action={} error={}",
            action,
            clip_text(&single_line(&merged), 420)
        );
        return Err(format!(
            "{label} bridge failed: {}",
            clip_text(merged.trim(), 420)
        ));
    }

    Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
}

pub(crate) fn stop_all_daemons(registry: &Mutex<HashMap<String, BridgeDaemon>>) {
    let mut guard = match registry.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    for (_, mut daemon) in guard.drain() {
        let _ = daemon.child.kill();
        let _ = daemon.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
