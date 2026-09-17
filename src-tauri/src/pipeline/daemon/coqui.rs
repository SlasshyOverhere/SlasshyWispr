//! Coqui TTS bridge daemon lifecycle (Phase 8).
//!
//! Stay-alive policy: daemons persist until explicit stop or request failure
//! (kill + restart + single retry). No idle sweeper — latency-sensitive TTS
//! keeps its worker warm. Transport primitives come from `super::transport`.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use log::{info, warn};
use serde_json::Value;

use super::transport::{
    daemon_key, parse_bridge_response, send_bridge_request, spawn_bridge_daemon, stop_all_daemons,
    BridgeDaemon,
};
use crate::pipeline::log::{clip_text, single_line};

static COQUI_DAEMONS: OnceLock<Mutex<HashMap<String, BridgeDaemon>>> = OnceLock::new();

fn coqui_daemons() -> &'static Mutex<HashMap<String, BridgeDaemon>> {
    COQUI_DAEMONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn coqui_daemon_key(python_path: &str, script_path: &Path) -> String {
    daemon_key(python_path, script_path)
}

fn spawn_coqui_bridge_daemon(
    python_path: &str,
    script_path: &Path,
    cache_dir: &Path,
) -> Result<BridgeDaemon, String> {
    spawn_bridge_daemon(
        "Coqui",
        "coqui",
        python_path,
        script_path,
        &[
            ("TTS_HOME", cache_dir.to_string_lossy().into_owned()),
            ("COQUI_TOS_AGREED", "1".to_string()),
        ],
    )
}

fn send_coqui_daemon_request(
    daemon: &mut BridgeDaemon,
    action: &str,
    payload: &Value,
) -> Result<Value, String> {
    send_bridge_request("Coqui", "Coqui", daemon, action, payload, "Coqui bridge failed")
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
    parse_bridge_response("Coqui", "coqui", action, status_ok, stdout_text, stderr_text)
}

pub fn stop_all_coqui_bridge_daemons() {
    stop_all_daemons(coqui_daemons());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coqui_daemon_key_is_case_insensitive_on_windows() {
        let key = coqui_daemon_key("Python", Path::new("/scripts/coqui.py"));
        assert!(key.contains('|'));
    }
}
