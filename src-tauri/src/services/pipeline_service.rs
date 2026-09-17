//! Assistant-pipeline service helpers — Phase 7c extraction.
//!
//! Owns the two bodies the goal assigns to `pipeline_service`: Piper asset
//! resolution + repair (binary + voice auto-repair, moved from `lib.rs`) and
//! the AppState selection-TTL sync (recent-context reads/writes +
//! pending-rewrite peek). The command adapter in `commands::pipeline` keeps
//! orchestration; these helpers own the stateful side effects so the adapter
//! stays thin.

use std::path::{Path, PathBuf};

use log::warn;
use reqwest::Client;
use tauri::AppHandle;

use crate::constants::PIPER_BINARY_NAME;
use crate::pipeline::fs::{file_exists_with_content, find_file_by_name};
use crate::pipeline::tts::{
    ensure_piper_binary, ensure_voice_files, validate_piper_binary_path, voice_paths,
};
use crate::state::AppState;

pub(crate) fn discover_installed_piper_path(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let runtime_dir = crate::pipeline::tts::piper_runtime_dir(app)?;
    find_file_by_name(&runtime_dir, PIPER_BINARY_NAME)
}

pub(crate) fn resolve_piper_path(
    app: &AppHandle,
    requested_path: Option<&str>,
) -> Result<String, String> {
    if let Some(path) = requested_path
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        validate_piper_binary_path(path)?;
        if file_exists_with_content(Path::new(path)) {
            return Ok(path.to_string());
        }
    }

    if let Some(installed_path) = discover_installed_piper_path(app)? {
        let installed = installed_path.to_string_lossy().into_owned();
        validate_piper_binary_path(&installed)?;
        return Ok(installed);
    }

    Err(
        "Piper is not configured or the saved Piper path is stale. Click 'Auto Setup Runtime' inside the app first."
            .to_string(),
    )
}

pub(crate) struct PiperAssets {
    pub(crate) piper_path: Option<String>,
    pub(crate) piper_model_path: Option<PathBuf>,
}

/// Resolve Piper binary + voice paths, attempting runtime auto-repair when
/// either is missing or stale. Skipped entirely for Coqui requests.
pub(crate) async fn resolve_piper_assets(
    app: &AppHandle,
    http: &Client,
    requested_piper_path: Option<&str>,
    use_coqui: bool,
) -> PiperAssets {
    let mut piper_path = if use_coqui {
        None
    } else {
        match resolve_piper_path(app, requested_piper_path) {
            Ok(path) => Some(path),
            Err(error) => {
                warn!(
                    "[pipeline] piper path resolution deferred/skipped: {}",
                    error
                );
                None
            }
        }
    };

    let mut piper_model_path = if use_coqui {
        None
    } else {
        match voice_paths(app) {
            Ok((model_path, config_path)) => {
                if file_exists_with_content(&model_path) && file_exists_with_content(&config_path) {
                    Some(model_path)
                } else {
                    warn!("[pipeline] piper voice model files missing; deferred/skipped");
                    None
                }
            }
            Err(error) => {
                warn!("[pipeline] piper voice paths resolution failed: {}", error);
                None
            }
        }
    };

    if !use_coqui {
        let piper_binary_missing = piper_path
            .as_deref()
            .map(|path| !file_exists_with_content(Path::new(path)))
            .unwrap_or(true);
        let piper_voice_missing = piper_model_path
            .as_ref()
            .map(|path| !file_exists_with_content(path))
            .unwrap_or(true);

        if piper_binary_missing || piper_voice_missing {
            warn!(
                "[pipeline] piper assets missing/stale; attempting runtime auto-repair binary_missing={} voice_missing={}",
                piper_binary_missing,
                piper_voice_missing
            );

            match ensure_piper_binary(app, http).await {
                Ok(path) => {
                    piper_path = Some(path.to_string_lossy().into_owned());
                }
                Err(error) => {
                    warn!("[pipeline] piper auto-repair failed for binary: {}", error);
                }
            }

            match ensure_voice_files(app, http).await {
                Ok((model_path, _config_path)) => {
                    piper_model_path = Some(model_path);
                }
                Err(error) => {
                    warn!(
                        "[pipeline] piper auto-repair failed for voice files: {}",
                        error
                    );
                }
            }
        }
    }

    PiperAssets {
        piper_path,
        piper_model_path,
    }
}

pub(crate) struct SelectionSync {
    pub(crate) pending_rewrite_present: bool,
    pub(crate) selected_text: Option<String>,
    pub(crate) selected_text_source: &'static str,
}

/// Surface the selection-context state the orchestrator needs: pending-rewrite
/// peek, recent-context recovery, and recent-context write-back (the
/// selection-TTL sync with AppState). Backend clipboard capture stays in the
/// command adapter (Windows-only `cfg` block); pass its result in.
pub(crate) fn sync_selection_context(
    state: &AppState,
    command_mode: bool,
    selection_intent_active: bool,
    frontend_selected_text: Option<String>,
    backend_selected_text: Option<String>,
) -> Result<SelectionSync, String> {
    let pending_rewrite_present = state.peek_pending_selection_rewrite()?.is_some();
    let mut selected_text = frontend_selected_text;
    let mut selected_text_source = if selected_text.is_some() {
        "frontend"
    } else {
        "none"
    };
    if selected_text.is_none() {
        if let Some(captured) = backend_selected_text {
            selected_text = Some(captured);
            selected_text_source = "backend-fallback";
        }
    }
    if command_mode && selected_text.is_none() && selection_intent_active {
        if let Some(recent) = state.peek_recent_selection_context()? {
            selected_text = Some(recent);
            selected_text_source = "recent-context";
        }
    }
    if let Some(selected) = selected_text.as_ref() {
        state.set_recent_selection_context(selected.clone())?;
    }
    Ok(SelectionSync {
        pending_rewrite_present,
        selected_text,
        selected_text_source,
    })
}

pub(crate) fn sync_orchestrator_pending_rewrite_to_app_state(
    state: &AppState,
    orch_state: &crate::pipeline::orchestration::PipelineState,
) -> Result<(), String> {
    if orch_state.peek_pending_rewrite().is_none() {
        state.clear_pending_selection_rewrite()?;
    } else if let Some(pending) = orch_state.peek_pending_rewrite() {
        state.set_pending_selection_rewrite(pending)?;
    }
    Ok(())
}
