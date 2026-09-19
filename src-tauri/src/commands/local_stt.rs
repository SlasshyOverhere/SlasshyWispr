//! Local STT commands — Phase 6e thin-adapter extraction.
//!
//! Moved verbatim from lib.rs: fetch/download/status/delete/open/warmup/
//! deactivate/runtime-state/hardware-advice. No signature or logic changes.

use std::fs;
use std::path::PathBuf;

use log::info;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::audio;

use super::ipc_types::ProviderModelsResponse;
use crate::constants::ZERO_PYTHON_STT_NOTICE;
use crate::pipeline::daemon::{
    local_stt_daemon_stats, stop_all_local_stt_bridge_daemons,
    stop_all_local_stt_bridge_daemons_with_count, trim_all_local_stt_bridge_daemon_model_caches,
};
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::routing::{
    built_in_local_stt_model_catalog, canonical_local_stt_model_id,
    infer_local_stt_provider_from_model, local_stt_provider_requires_python,
    local_stt_provider_supported_in_zero_python_mode, normalize_model_name,
    zero_python_mode_enabled,
};
use crate::pipeline::stt_download::progress::{now_unix_ms, LocalSttDownloadStatusResponse};
use crate::pipeline::stt_download::resolve::{
    legacy_huggingface_repo_id_for_model, resolve_huggingface_repo_id,
    sanitize_model_cache_dir_name,
};
use crate::services::hardware::build_local_stt_hardware_advice;
use crate::services::transcribe::{resolve_local_stt_repo_and_dir, stt_models_dir};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttDownloadRequest {
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttDeleteRequest {
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttWarmupRequest {
    model: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttDeactivateRequest {
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttHardwareAdviceRequest {
    selected_model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttDownloadResponse {
    model: String,
    provider: String,
    method: String,
    local_path: String,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttDeleteResponse {
    model: String,
    repo_id: String,
    removed: bool,
    local_path: String,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttOpenPathResponse {
    model: String,
    repo_id: String,
    local_path: String,
    opened: bool,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttModelStatusResponse {
    model: String,
    provider: String,
    repo_id: String,
    local_path: String,
    exists: bool,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttWarmupResponse {
    model: String,
    provider: String,
    warmed: bool,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttDeactivateResponse {
    model: String,
    provider: String,
    deactivated: bool,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttRuntimeStateResponse {
    loaded: bool,
    daemon_count: usize,
    loaded_daemon_count: usize,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttHardwareAdviceResponse {
    pub cpu_name: String,
    pub logical_cores: usize,
    pub total_ram_gb: f64,
    pub nvidia_gpu_detected: bool,
    pub gpu_name: String,
    pub gpu_vram_gb: f64,
    pub performance_tier: String,
    pub slasshywispr_suggestion_model: String,
    pub suggested_models: Vec<String>,
    pub caution_models: Vec<String>,
    pub selected_model_warning: String,
    pub details: String,
}

#[tauri::command]
pub(crate) async fn fetch_local_stt_models() -> Result<ProviderModelsResponse, String> {
    let models = built_in_local_stt_model_catalog();
    info!("[local.stt.models] source=builtin count={}", models.len());

    Ok(ProviderModelsResponse {
        base_url: "builtin://local-stt-model-catalog".to_string(),
        models,
    })
}

#[tauri::command]
pub(crate) async fn download_local_stt_model(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LocalSttDownloadRequest,
) -> Result<LocalSttDownloadResponse, String> {
    let model = canonical_local_stt_model_id(&normalize_model_name(Some(&request.model)));
    if model.is_empty() {
        return Err("STT model name is required.".to_string());
    }
    let allowed_models = built_in_local_stt_model_catalog();
    if !allowed_models.iter().any(|item| item == &model) {
        return Err(
            "Unsupported local STT model. Select one from the built-in catalog.".to_string(),
        );
    }
    let status_snapshot = state.snapshot_local_stt_download_status()?;
    if status_snapshot.active {
        return Err(format!(
            "Local STT download already running for '{}'.",
            status_snapshot.model
        ));
    }

    let provider = infer_local_stt_provider_from_model(&model);
    if zero_python_mode_enabled() && !local_stt_provider_supported_in_zero_python_mode(&provider) {
        return Err(ZERO_PYTHON_STT_NOTICE.to_string());
    }
    let repo_id = resolve_huggingface_repo_id(&provider, &model);
    let repo_id_for_status = repo_id.clone();
    state.update_local_stt_download_status(|status| {
        *status = LocalSttDownloadStatusResponse {
            active: true,
            completed: false,
            success: false,
            model: model.clone(),
            repo_id: repo_id_for_status,
            stage: "Preparing download...".to_string(),
            message: "Starting local STT model download.".to_string(),
            current_file: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
            files_completed: 0,
            files_total: 0,
            progress_percent: 0.0,
            updated_at_ms: now_unix_ms(),
        };
    })?;

    let target_dir = stt_models_dir(&app)?.join(sanitize_model_cache_dir_name(&repo_id));
    let app_for_task = app.clone();
    let model_for_task = model.clone();
    let provider_for_task = provider.clone();
    let repo_id_for_task = repo_id.clone();
    let target_dir_for_task = target_dir.clone();
    tauri::async_runtime::spawn(async move {
        let state_for_task = app_for_task.state::<AppState>();
        let status_sink = crate::pipeline::stt_download::AppStateSink::new(&state_for_task);
        let shared_status =
            match crate::pipeline::stt_download::SharedStatus::seeded_from(&status_sink) {
                Ok(shared_status) => shared_status,
                Err(error) => {
                    let _ = state_for_task.update_local_stt_download_status(|status| {
                        status.active = false;
                        status.completed = true;
                        status.success = false;
                        status.stage = "Download failed.".to_string();
                        status.message = format!("Local STT download failed to start: {error}");
                        status.current_file.clear();
                    });
                    return;
                }
            };
        let download_result = crate::pipeline::stt_download::download_huggingface_stt_model(
            &state_for_task.http,
            &repo_id_for_task,
            &target_dir_for_task,
            None,
            &shared_status,
        )
        .await;

        match download_result {
            Ok(download_summary) => {
                let download_details = download_summary.details;
                let runtime_setup_required = matches!(
                    provider_for_task.as_str(),
                    "whisper" | "moonshine" | "sensevoice"
                );
                if runtime_setup_required {
                    let _ = state_for_task.update_local_stt_download_status(|status| {
                        status.model = model_for_task.clone();
                        status.repo_id = repo_id_for_task.clone();
                        status.stage = "Preparing local STT runtime...".to_string();
                        status.message = "Installing local STT runtime dependencies. This can take several minutes."
                            .to_string();
                        status.current_file.clear();
                    });

                    let app_for_runtime = app_for_task.clone();
                    let runtime_setup_result = tauri::async_runtime::spawn_blocking(move || {
                        crate::services::transcribe::setup_local_stt_runtime_blocking(
                            &app_for_runtime,
                            "python",
                        )
                    })
                    .await
                    .map_err(|error| format!("Local STT runtime worker failed: {error}"))
                    .and_then(|result| result);

                    match runtime_setup_result {
                        Ok(python_path) => {
                            let warmup_required = matches!(
                                provider_for_task.as_str(),
                                "parakeet" | "whisper" | "moonshine" | "sensevoice"
                            );
                            let warmup_result = if warmup_required {
                                let warmup_message = if provider_for_task == "parakeet" {
                                    "Loading Parakeet model once so first dictation is fast."
                                } else {
                                    "Loading local STT model once so first dictation is fast."
                                };
                                let _ = state_for_task.update_local_stt_download_status(|status| {
                                    status.model = model_for_task.clone();
                                    status.repo_id = repo_id_for_task.clone();
                                    status.stage = "Warming up local STT model...".to_string();
                                    status.message = warmup_message.to_string();
                                    status.current_file.clear();
                                    if status.total_bytes > 0 {
                                        status.downloaded_bytes = status.total_bytes;
                                    }
                                    if status.files_total > 0 {
                                        status.files_completed = status.files_total;
                                    }
                                });

                                let app_for_warmup = app_for_task.clone();
                                let model_for_warmup = model_for_task.clone();
                                let provider_for_warmup = provider_for_task.clone();
                                let python_for_warmup = python_path.clone();
                                tauri::async_runtime::spawn_blocking(move || {
                                    if provider_for_warmup == "parakeet" {
                                        crate::services::transcribe::warmup_local_stt_parakeet_model_blocking(
                                            &app_for_warmup,
                                            &python_for_warmup,
                                            &model_for_warmup,
                                        )
                                    } else {
                                        crate::services::transcribe::warmup_local_stt_hf_model_blocking(
                                            &app_for_warmup,
                                            &python_for_warmup,
                                            &model_for_warmup,
                                        )
                                    }
                                })
                                .await
                                .map_err(|error| format!("Local STT warmup worker failed: {error}"))
                                .and_then(|result| result)
                            } else {
                                Ok("Warmup skipped.".to_string())
                            };

                            match warmup_result {
                                Ok(warmup_details) => {
                                    let _ = state_for_task.update_local_stt_download_status(
                                        |status| {
                                            status.active = false;
                                            status.completed = true;
                                            status.success = true;
                                            status.model = model_for_task.clone();
                                            status.repo_id = repo_id_for_task.clone();
                                            status.stage = "Download complete.".to_string();
                            status.message = format!(
                                "{download_details} Local STT runtime ready ({python_path}). {warmup_details}"
                            );
                                            status.current_file.clear();
                                            if status.total_bytes > 0 {
                                                status.downloaded_bytes = status.total_bytes;
                                            }
                                            if status.files_total > 0 {
                                                status.files_completed = status.files_total;
                                            }
                                        },
                                    );
                                }
                                Err(warmup_error) => {
                                    let _ = state_for_task.update_local_stt_download_status(
                                        |status| {
                                            status.active = false;
                                            status.completed = true;
                                            status.success = true;
                                            status.model = model_for_task.clone();
                                            status.repo_id = repo_id_for_task.clone();
                                            status.stage = "Download complete (warmup warning)."
                                                .to_string();
                                            status.message = format!(
                                                "{download_details} Local STT runtime ready ({python_path}). Warmup skipped: {}",
                                                clip_text(&single_line(&warmup_error), 360)
                                            );
                                            status.current_file.clear();
                                            if status.total_bytes > 0 {
                                                status.downloaded_bytes = status.total_bytes;
                                            }
                                            if status.files_total > 0 {
                                                status.files_completed = status.files_total;
                                            }
                                        },
                                    );
                                }
                            }
                        }
                        Err(runtime_error) => {
                            let _ = state_for_task.update_local_stt_download_status(|status| {
                                status.active = false;
                                status.completed = true;
                                status.success = false;
                                status.model = model_for_task.clone();
                                status.repo_id = repo_id_for_task.clone();
                                status.stage = "Runtime setup failed.".to_string();
                                status.message = format!(
                                    "{download_details} Runtime setup failed: {}",
                                    clip_text(&single_line(&runtime_error), 420)
                                );
                                status.current_file.clear();
                            });
                        }
                    }
                } else {
                    let native_parakeet_warmup_required = provider_for_task == "parakeet";
                    if native_parakeet_warmup_required {
                        let _ = state_for_task.update_local_stt_download_status(|status| {
                            status.model = model_for_task.clone();
                            status.repo_id = repo_id_for_task.clone();
                            status.stage = "Warming up local STT model...".to_string();
                            status.message =
                                "Loading native Parakeet int8 model so first dictation is fast."
                                    .to_string();
                            status.current_file.clear();
                            if status.total_bytes > 0 {
                                status.downloaded_bytes = status.total_bytes;
                            }
                            if status.files_total > 0 {
                                status.files_completed = status.files_total;
                            }
                        });

                        let app_for_warmup = app_for_task.clone();
                        let model_for_warmup = model_for_task.clone();
                        let warmup_result = tauri::async_runtime::spawn_blocking(move || {
                            crate::services::transcribe::warmup_local_stt_parakeet_model_blocking(
                                &app_for_warmup,
                                "",
                                &model_for_warmup,
                            )
                        })
                        .await
                        .map_err(|error| format!("Local STT warmup worker failed: {error}"))
                        .and_then(|result| result);

                        match warmup_result {
                            Ok(warmup_details) => {
                                let _ = state_for_task.update_local_stt_download_status(
                                    |status| {
                                        status.active = false;
                                        status.completed = true;
                                        status.success = true;
                                        status.model = model_for_task.clone();
                                        status.repo_id = repo_id_for_task.clone();
                                        status.stage = "Download complete.".to_string();
                                        status.message = format!(
                                            "{download_details} Native Parakeet runtime ready. {warmup_details}"
                                        );
                                        status.current_file.clear();
                                        if status.total_bytes > 0 {
                                            status.downloaded_bytes = status.total_bytes;
                                        }
                                        if status.files_total > 0 {
                                            status.files_completed = status.files_total;
                                        }
                                    },
                                );
                            }
                            Err(warmup_error) => {
                                let _ = state_for_task.update_local_stt_download_status(|status| {
                                    status.active = false;
                                    status.completed = true;
                                    status.success = true;
                                    status.model = model_for_task.clone();
                                    status.repo_id = repo_id_for_task.clone();
                                    status.stage =
                                        "Download complete (warmup warning).".to_string();
                                    status.message = format!(
                                        "{download_details} Native Parakeet warmup skipped: {}",
                                        clip_text(&single_line(&warmup_error), 360)
                                    );
                                    status.current_file.clear();
                                    if status.total_bytes > 0 {
                                        status.downloaded_bytes = status.total_bytes;
                                    }
                                    if status.files_total > 0 {
                                        status.files_completed = status.files_total;
                                    }
                                });
                            }
                        }
                    } else {
                        let _ = state_for_task.update_local_stt_download_status(|status| {
                            status.active = false;
                            status.completed = true;
                            status.success = true;
                            status.model = model_for_task.clone();
                            status.repo_id = repo_id_for_task.clone();
                            status.stage = "Download complete.".to_string();
                            status.message = download_details;
                            status.current_file.clear();
                            if status.total_bytes > 0 {
                                status.downloaded_bytes = status.total_bytes;
                            }
                            if status.files_total > 0 {
                                status.files_completed = status.files_total;
                            }
                        });
                    }
                }
            }
            Err(download_error) => {
                let error_text = format!(
                    "Unable to download local STT model '{}' from configured source: {}",
                    clip_text(&repo_id_for_task, 180),
                    clip_text(&single_line(&download_error), 320)
                );
                let _ = state_for_task.update_local_stt_download_status(|status| {
                    status.active = false;
                    status.completed = true;
                    status.success = false;
                    status.model = model_for_task;
                    status.repo_id = repo_id_for_task;
                    status.stage = "Download failed.".to_string();
                    status.message = error_text;
                    status.current_file.clear();
                });
            }
        }
    });

    let provider_runs_runtime_setup = local_stt_provider_requires_python(&provider);
    let provider_runs_native_warmup = provider == "parakeet";
    Ok(LocalSttDownloadResponse {
        model,
        provider,
        method: "background_huggingface_snapshot".to_string(),
        local_path: target_dir.to_string_lossy().into_owned(),
        details: if provider_runs_runtime_setup {
            format!(
                "Started local STT model download for '{repo_id}'. Runtime setup and model warmup will run automatically after download."
            )
        } else if provider_runs_native_warmup {
            format!(
                "Started local STT model download for '{repo_id}'. Native Parakeet int8 warmup will run automatically after download."
            )
        } else {
            format!("Started local STT model download for '{repo_id}'.")
        },
    })
}

#[tauri::command]
pub(crate) async fn get_local_stt_download_status(
    state: State<'_, AppState>,
) -> Result<LocalSttDownloadStatusResponse, String> {
    state.snapshot_local_stt_download_status()
}

#[tauri::command]
pub(crate) async fn delete_local_stt_model(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LocalSttDeleteRequest,
) -> Result<LocalSttDeleteResponse, String> {
    let model = canonical_local_stt_model_id(&normalize_model_name(Some(&request.model)));
    if model.is_empty() {
        return Err("STT model name is required.".to_string());
    }
    let allowed_models = built_in_local_stt_model_catalog();
    if !allowed_models.iter().any(|item| item == &model) {
        return Err(
            "Unsupported local STT model. Select one from the built-in catalog.".to_string(),
        );
    }
    let active_status = state.snapshot_local_stt_download_status()?;
    if active_status.active && active_status.model == model {
        return Err(
            "This model is currently downloading. Wait for it to finish before deleting."
                .to_string(),
        );
    }

    let provider = infer_local_stt_provider_from_model(&model);
    let repo_id = resolve_huggingface_repo_id(&provider, &model);
    if provider.eq_ignore_ascii_case("parakeet") {
        let _ = audio::parakeet::unload_native_parakeet_runtime("delete-model");
        stop_all_local_stt_bridge_daemons();
        let _ = state.set_local_stt_runtime_loaded(false);
    }
    let models_dir = stt_models_dir(&app)?;
    let target_dir = models_dir.join(sanitize_model_cache_dir_name(&repo_id));
    let mut paths_to_remove: Vec<PathBuf> = vec![target_dir.clone()];
    if let Some(legacy_repo_id) = legacy_huggingface_repo_id_for_model(&provider, &model) {
        let legacy_dir = models_dir.join(sanitize_model_cache_dir_name(&legacy_repo_id));
        if legacy_dir != target_dir {
            paths_to_remove.push(legacy_dir);
        }
    }
    if model.eq_ignore_ascii_case("nvidia/parakeet-tdt_ctc-110m") {
        let legacy_repo_id = "nvidia/parakeet-tdt-0.6b-v2";
        let legacy_dir = models_dir.join(sanitize_model_cache_dir_name(legacy_repo_id));
        if legacy_dir != target_dir {
            paths_to_remove.push(legacy_dir);
        }
    }
    let mut removed_any = false;
    let mut removed_legacy = false;
    for remove_path in paths_to_remove {
        if !remove_path.exists() {
            continue;
        }
        if remove_path.is_dir() {
            fs::remove_dir_all(&remove_path).map_err(|error| {
                format!(
                    "Failed to delete local STT model directory '{}': {error}",
                    remove_path.display()
                )
            })?;
        } else {
            fs::remove_file(&remove_path).map_err(|error| {
                format!(
                    "Failed to delete local STT model file '{}': {error}",
                    remove_path.display()
                )
            })?;
        }
        removed_any = true;
        if remove_path != target_dir {
            removed_legacy = true;
        }
    }

    if !removed_any {
        return Ok(LocalSttDeleteResponse {
            model,
            repo_id,
            removed: false,
            local_path: target_dir.to_string_lossy().into_owned(),
            details: "Model files were not found in local cache.".to_string(),
        });
    }

    let details = if removed_legacy {
        "Local STT model files deleted (including legacy Parakeet v2 cache).".to_string()
    } else {
        "Local STT model files deleted.".to_string()
    };

    Ok(LocalSttDeleteResponse {
        model,
        repo_id,
        removed: true,
        local_path: target_dir.to_string_lossy().into_owned(),
        details,
    })
}

#[tauri::command]
pub(crate) async fn open_local_stt_model_path(
    app: AppHandle,
    request: LocalSttDeleteRequest,
) -> Result<LocalSttOpenPathResponse, String> {
    let model = canonical_local_stt_model_id(&normalize_model_name(Some(&request.model)));
    if model.is_empty() {
        return Err("STT model name is required.".to_string());
    }
    let allowed_models = built_in_local_stt_model_catalog();
    if !allowed_models.iter().any(|item| item == &model) {
        return Err(
            "Unsupported local STT model. Select one from the built-in catalog.".to_string(),
        );
    }

    let provider = infer_local_stt_provider_from_model(&model);
    let (repo_id, target_dir) = resolve_local_stt_repo_and_dir(&app, &provider, &model)?;
    if !target_dir.exists() {
        return Ok(LocalSttOpenPathResponse {
            model,
            repo_id,
            local_path: target_dir.to_string_lossy().into_owned(),
            opened: false,
            details: "Model files are not downloaded yet.".to_string(),
        });
    }

    crate::services::transcribe::open_path_in_file_explorer(&target_dir)?;
    Ok(LocalSttOpenPathResponse {
        model,
        repo_id,
        local_path: target_dir.to_string_lossy().into_owned(),
        opened: true,
        details: "Opened local model directory in file explorer.".to_string(),
    })
}

#[tauri::command]
pub(crate) async fn get_local_stt_model_status(
    app: AppHandle,
    request: LocalSttDeleteRequest,
) -> Result<LocalSttModelStatusResponse, String> {
    let model = canonical_local_stt_model_id(&normalize_model_name(Some(&request.model)));
    if model.is_empty() {
        return Err("STT model name is required.".to_string());
    }
    let allowed_models = built_in_local_stt_model_catalog();
    if !allowed_models.iter().any(|item| item == &model) {
        return Err(
            "Unsupported local STT model. Select one from the built-in catalog.".to_string(),
        );
    }

    let provider = infer_local_stt_provider_from_model(&model);
    let (repo_id, target_dir) = resolve_local_stt_repo_and_dir(&app, &provider, &model)?;
    let exists = target_dir.exists();
    let details = if exists {
        "Model files are available in local cache.".to_string()
    } else {
        "Model files are not downloaded yet.".to_string()
    };

    Ok(LocalSttModelStatusResponse {
        model,
        provider,
        repo_id,
        local_path: target_dir.to_string_lossy().into_owned(),
        exists,
        details,
    })
}

#[tauri::command]
pub(crate) async fn warmup_local_stt_model(
    app: AppHandle,
    state: State<'_, AppState>,
    request: LocalSttWarmupRequest,
) -> Result<LocalSttWarmupResponse, String> {
    let model = canonical_local_stt_model_id(&normalize_model_name(Some(&request.model)));
    if model.is_empty() {
        return Err("STT model name is required.".to_string());
    }
    let allowed_models = built_in_local_stt_model_catalog();
    if !allowed_models.iter().any(|item| item == &model) {
        return Err(
            "Unsupported local STT model. Select one from the built-in catalog.".to_string(),
        );
    }

    let provider = infer_local_stt_provider_from_model(&model);
    let (_repo_id, model_dir) = resolve_local_stt_repo_and_dir(&app, &provider, &model)?;
    if !model_dir.exists() {
        return Ok(LocalSttWarmupResponse {
            model,
            provider,
            warmed: false,
            details: "Model files are not downloaded yet.".to_string(),
        });
    }

    let app_for_worker = app.clone();
    let model_for_worker = model.clone();
    let provider_for_worker = provider.clone();
    let warmup_result =
        tauri::async_runtime::spawn_blocking(move || match provider_for_worker.as_str() {
            "parakeet" => crate::services::transcribe::warmup_local_stt_parakeet_model_blocking(
                &app_for_worker,
                "",
                &model_for_worker,
            ),
            "whisper" | "moonshine" | "sensevoice" => {
                if zero_python_mode_enabled() {
                    return Err(ZERO_PYTHON_STT_NOTICE.to_string());
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
        .map_err(|error| format!("Local STT warmup task failed: {error}"));

    match warmup_result {
        Ok(Ok(details)) => {
            let _ = state.set_local_stt_runtime_loaded(true);
            Ok(LocalSttWarmupResponse {
                model,
                provider,
                warmed: true,
                details,
            })
        }
        Ok(Err(error)) => Ok(LocalSttWarmupResponse {
            model,
            provider,
            warmed: false,
            details: format!("Warmup failed: {}", clip_text(&single_line(&error), 360)),
        }),
        Err(worker_error) => Ok(LocalSttWarmupResponse {
            model,
            provider,
            warmed: false,
            details: format!(
                "Warmup failed: {}",
                clip_text(&single_line(&worker_error), 360)
            ),
        }),
    }
}

#[tauri::command]
pub(crate) async fn deactivate_local_stt_model(
    state: State<'_, AppState>,
    request: LocalSttDeactivateRequest,
) -> Result<LocalSttDeactivateResponse, String> {
    let model = canonical_local_stt_model_id(&normalize_model_name(request.model.as_deref()));
    let (model_for_response, provider_for_response) = if model.is_empty() {
        (String::new(), "unknown".to_string())
    } else {
        let allowed_models = built_in_local_stt_model_catalog();
        if !allowed_models.iter().any(|item| item == &model) {
            return Err(
                "Unsupported local STT model. Select one from the built-in catalog.".to_string(),
            );
        }
        let provider = infer_local_stt_provider_from_model(&model);
        (model, provider)
    };

    let worker_result = tauri::async_runtime::spawn_blocking(move || {
        let (trimmed_count, stopped_during_trim) = trim_all_local_stt_bridge_daemon_model_caches()?;
        let fully_stopped = stop_all_local_stt_bridge_daemons_with_count();
        let native_unloaded =
            audio::parakeet::unload_native_parakeet_runtime("manual-deactivate").unwrap_or(false);
        Ok::<(usize, usize, usize, bool), String>((
            trimmed_count,
            stopped_during_trim,
            fully_stopped,
            native_unloaded,
        ))
    })
    .await
    .map_err(|error| format!("Local STT deactivate task failed: {error}"))??;
    let (trimmed_count, stopped_during_trim, fully_stopped, native_unloaded) = worker_result;
    let deactivated =
        trimmed_count > 0 || stopped_during_trim > 0 || fully_stopped > 0 || native_unloaded;

    let details = if deactivated {
        if model_for_response.is_empty() {
            format!(
                "Deactivated local STT runtime (native_unloaded={}, trimmed {} cache daemon(s), restarted {}, fully stopped {}).",
                native_unloaded, trimmed_count, stopped_during_trim, fully_stopped
            )
        } else {
            format!(
                "Deactivated local STT runtime for '{}' (native_unloaded={}, trimmed {} cache daemon(s), restarted {}, fully stopped {}).",
                model_for_response, native_unloaded, trimmed_count, stopped_during_trim, fully_stopped
            )
        }
    } else {
        if model_for_response.is_empty() {
            "Local STT runtime was already inactive in memory.".to_string()
        } else {
            format!(
                "Local STT model '{}' was already inactive in memory.",
                model_for_response
            )
        }
    };
    let _ = state.set_local_stt_runtime_loaded(false);

    Ok(LocalSttDeactivateResponse {
        model: model_for_response,
        provider: provider_for_response,
        deactivated,
        details,
    })
}

#[tauri::command]
pub(crate) async fn get_local_stt_runtime_state(
    state: State<'_, AppState>,
) -> Result<LocalSttRuntimeStateResponse, String> {
    let (daemon_count, loaded_daemon_count) = local_stt_daemon_stats();

    // F-017: None = lock held (inference in flight), so the state is unknown
    // rather than a guessed "loaded".
    let native_loaded = match audio::parakeet::native_parakeet_runtime_loaded() {
        Some(loaded) => loaded.to_string(),
        None => "busy".to_string(),
    };
    let loaded = state.local_stt_runtime_loaded_snapshot()?;
    let details = if loaded {
        format!(
            "Local STT is loaded (native_parakeet_loaded={}, {} active model cache daemon(s), {} daemon(s) total).",
            native_loaded,
            loaded_daemon_count,
            daemon_count
        )
    } else if daemon_count > 0 || native_loaded == "true" {
        format!(
            "Local STT is unloaded (native_parakeet_loaded={}, {} warm daemon(s) remain ready).",
            native_loaded, daemon_count
        )
    } else {
        "Local STT is unloaded.".to_string()
    };

    Ok(LocalSttRuntimeStateResponse {
        loaded,
        daemon_count,
        loaded_daemon_count,
        details,
    })
}

#[tauri::command]
pub(crate) async fn get_local_stt_hardware_advice(
    request: LocalSttHardwareAdviceRequest,
) -> Result<LocalSttHardwareAdviceResponse, String> {
    let selected_model = request.selected_model;
    let advice = tauri::async_runtime::spawn_blocking(move || {
        build_local_stt_hardware_advice(selected_model)
    })
    .await
    .map_err(|error| format!("Local STT hardware probe task failed: {error}"))?;

    info!(
        "[local.stt.hardware] tier={} ram_gb={:.1} logical_cores={} nvidia_gpu={} gpu={} gpu_vram_gb={:.1} suggestion={}",
        advice.performance_tier,
        advice.total_ram_gb,
        advice.logical_cores,
        advice.nvidia_gpu_detected,
        if advice.gpu_name.trim().is_empty() {
            "none"
        } else {
            advice.gpu_name.as_str()
        },
        advice.gpu_vram_gb,
        advice.slasshywispr_suggestion_model
    );

    Ok(advice)
}
