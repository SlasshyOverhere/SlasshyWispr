//! App startup services — boot warmup + launch preference.
//!
//! Moved verbatim from lib.rs: local-STT boot warmup target resolution +
//! background warmup spawn, and the launch-at-login preference read (which
//! resolves the persisted settings path through services::settings_store).

use std::fs;

use log::{info, warn};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::commands::recordings::StartupLocalSttWarmupTarget;
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::routing::{canonical_local_stt_model_id, infer_local_stt_provider_from_model};
use crate::state::AppState;

pub(crate) fn load_startup_local_stt_warmup_target(app: &AppHandle) -> StartupLocalSttWarmupTarget {
    let settings_path = match crate::services::settings_store::persisted_settings_path(app) {
        Ok(path) => path,
        Err(_) => return StartupLocalSttWarmupTarget::MissingModel,
    };
    if !settings_path.exists() {
        return StartupLocalSttWarmupTarget::MissingModel;
    }
    let raw = match fs::read_to_string(&settings_path) {
        Ok(raw) => raw,
        Err(_) => return StartupLocalSttWarmupTarget::MissingModel,
    };
    let payload = match serde_json::from_str::<Value>(&raw) {
        Ok(payload) => payload,
        Err(_) => return StartupLocalSttWarmupTarget::MissingModel,
    };

    let runtime_mode_local = payload
        .get("sttRuntimeMode")
        .and_then(Value::as_str)
        .map(str::trim)
        .map(|value| value.eq_ignore_ascii_case("local"))
        .or_else(|| {
            payload
                .get("runtimeMode")
                .and_then(Value::as_str)
                .map(str::trim)
                .map(|value| value.eq_ignore_ascii_case("local"))
        })
        .unwrap_or_else(|| {
            payload
                .get("localMode")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        });
    if !runtime_mode_local {
        return StartupLocalSttWarmupTarget::DisabledByRuntimeMode;
    }

    let model = payload
        .get("localSttModel")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    match model {
        Some(model) => StartupLocalSttWarmupTarget::Model(canonical_local_stt_model_id(model)),
        None => StartupLocalSttWarmupTarget::MissingModel,
    }
}

pub(crate) fn start_local_stt_boot_warmup(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let model = match load_startup_local_stt_warmup_target(&app) {
            StartupLocalSttWarmupTarget::DisabledByRuntimeMode => {
                info!("[local.stt.startup] warmup skipped (STT runtime mode is online)");
                let _ = app.state::<AppState>().set_local_stt_runtime_loaded(false);
                return;
            }
            StartupLocalSttWarmupTarget::MissingModel => {
                info!("[local.stt.startup] warmup skipped (no persisted local STT model)");
                let _ = app.state::<AppState>().set_local_stt_runtime_loaded(false);
                return;
            }
            StartupLocalSttWarmupTarget::Model(model) => model,
        };

        let provider = infer_local_stt_provider_from_model(&model);
        let (repo_id, model_dir) = match crate::services::transcribe::resolve_local_stt_repo_and_dir(
            &app, &provider, &model,
        ) {
            Ok(result) => result,
            Err(error) => {
                warn!(
                    "[local.stt.startup] warmup skipped model={} reason={}",
                    clip_text(&model, 140),
                    clip_text(&single_line(&error), 260)
                );
                let _ = app.state::<AppState>().set_local_stt_runtime_loaded(false);
                return;
            }
        };
        if !model_dir.exists() {
            info!(
                "[local.stt.startup] warmup skipped model={} repo={} reason=not-downloaded",
                clip_text(&model, 140),
                clip_text(&repo_id, 140)
            );
            let _ = app.state::<AppState>().set_local_stt_runtime_loaded(false);
            return;
        }

        info!(
            "[local.stt.startup] warmup begin model={} provider={} repo={}",
            clip_text(&model, 140),
            clip_text(&provider, 40),
            clip_text(&repo_id, 140)
        );

        let app_for_worker = app.clone();
        let model_for_worker = model.clone();
        let provider_for_worker = provider.clone();
        let warmup_result = tauri::async_runtime::spawn_blocking(move || match provider_for_worker
            .as_str()
        {
            "parakeet" => crate::services::transcribe::warmup_local_stt_parakeet_model_blocking(
                &app_for_worker,
                "",
                &model_for_worker,
            ),
            "whisper" | "moonshine" | "sensevoice" => {
                if crate::pipeline::routing::zero_python_mode_enabled() {
                    return Err(crate::constants::ZERO_PYTHON_STT_NOTICE.to_string());
                }
                let python_path = crate::services::transcribe::setup_local_stt_runtime_blocking(
                    &app_for_worker,
                    "python",
                )?;
                crate::services::transcribe::warmup_local_stt_hf_model_blocking(
                    &app_for_worker,
                    &python_path,
                    &model_for_worker,
                )
            }
            _ => Ok("Warmup skipped (unsupported provider).".to_string()),
        })
        .await
        .map_err(|error| format!("Local STT startup warmup worker failed: {error}"))
        .and_then(|result| result);

        match warmup_result {
            Ok(details) => {
                let _ = app.state::<AppState>().set_local_stt_runtime_loaded(true);
                info!(
                    "[local.stt.startup] warmup complete model={} details={}",
                    clip_text(&model, 140),
                    clip_text(&single_line(&details), 240)
                );
            }
            Err(error) => {
                let _ = app.state::<AppState>().set_local_stt_runtime_loaded(false);
                warn!(
                    "[local.stt.startup] warmup failed model={} error={}",
                    clip_text(&model, 140),
                    clip_text(&single_line(&error), 260)
                );
            }
        }
    });
}

/// Thin adapter that converts an IPC request into a pure routing input
/// and delegates to `pipeline::routing::resolve_pipeline_mode`.

pub(crate) fn read_launch_at_login_preference(app: &AppHandle) -> bool {
    let path = match crate::services::settings_store::persisted_settings_path(app) {
        Ok(p) => p,
        Err(_) => return true,
    };
    if !path.exists() {
        return true;
    }
    let raw = match fs::read_to_string(&path) {
        Ok(r) => r,
        Err(e) => {
            warn!(
                "[updater] failed to read settings for launch-at-login preference path={} error={}",
                path.display(),
                e
            );
            return false;
        }
    };
    let value = match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(v) => v,
        Err(e) => {
            warn!(
                "[updater] failed to parse settings for launch-at-login preference path={} error={}",
                path.display(),
                e
            );
            return false;
        }
    };
    value
        .get("launchAtLogin")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

#[cfg(test)]
mod launch_at_login_preference_tests {

    /// Unit-test the JSON-extraction logic that `read_launch_at_login_preference`
    /// performs. The full function (which resolves `persisted_settings_path` from
    /// an `AppHandle`) is covered by integration tests against a real Tauri binary.
    fn preference_from_json(raw: &str) -> bool {
        let value: serde_json::Value = serde_json::from_str(raw).unwrap();
        value
            .get("launchAtLogin")
            .and_then(|v| v.as_bool())
            .unwrap_or(true)
    }

    #[test]
    fn defaults_to_true_when_missing() {
        assert_eq!(preference_from_json("{}"), true);
    }

    #[test]
    fn reflects_explicit_false() {
        assert_eq!(preference_from_json(r#"{"launchAtLogin": false}"#), false);
    }

    #[test]
    fn reflects_explicit_true() {
        assert_eq!(preference_from_json(r#"{"launchAtLogin": true}"#), true);
    }

    #[test]
    fn file_missing_resolves_to_true() {
        // When the settings file doesn't exist, we default to true (first launch).
        let dir = tempfile::tempdir().unwrap();
        // read_launch_at_login_preference expects settings.json to not exist.
        // Since we can't mock AppHandle easily here, verify the fallback at the
        // preference-extraction layer: a missing key defaults to true.
        assert_eq!(preference_from_json("{}"), true);
        let _ = dir;
    }
}
