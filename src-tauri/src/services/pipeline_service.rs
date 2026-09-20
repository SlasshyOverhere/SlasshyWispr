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

use crate::commands::pipeline::AssistantPipelineRequest;
use crate::pipeline::routing::{PipelineModeConfig, PipelineRoutingInput};

/// Thin adapter that converts an IPC request into a pure routing input
/// and delegates to `pipeline::routing::resolve_pipeline_mode`.
pub(crate) fn resolve_pipeline_mode(
    request: &AssistantPipelineRequest,
) -> Result<PipelineModeConfig, String> {
    let routing_input = PipelineRoutingInput {
        api_key: request.api_key.clone(),
        api_base_url: request.api_base_url.clone(),
        stt_model: request.stt_model.clone(),
        ai_model: request.ai_model.clone(),
        stt_local_mode: request.stt_local_mode,
        ai_local_mode: request.ai_local_mode,
        local_ollama_base_url: request.local_ollama_base_url.clone(),
        local_ollama_model: request.local_ollama_model.clone(),
        local_stt_model: request.local_stt_model.clone(),
    };
    crate::pipeline::routing::resolve_pipeline_mode(&routing_input)
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::routing::AiModeConfig;

    fn pipeline_mode_request_template() -> crate::commands::pipeline::AssistantPipelineRequest {
        crate::commands::pipeline::AssistantPipelineRequest {
            api_key: "test-key".to_string(),
            api_base_url: Some("https://api.example.com/v1".to_string()),
            stt_model: Some("gpt-4o-mini-transcribe".to_string()),
            ai_model: Some("gpt-4o-mini".to_string()),
            stt_local_mode: None,
            ai_local_mode: None,
            local_ollama_base_url: Some("http://127.0.0.1:11434".to_string()),
            local_ollama_model: Some("llama3.2:3b".to_string()),
            local_stt_model: Some("nvidia/parakeet-tdt-0.6b-v3".to_string()),
            piper_path: None,
            audio_base64: String::new(),
            audio_mime_type: "audio/wav".to_string(),
            language: None,
            allowed_languages: None,
            system_prompt: None,
            temperature: None,
            max_tokens: None,
            dictionary_entries: None,
            snippet_entries: None,
            raw_mode: None,
            apply_backtrack: None,
            remove_fillers: None,
            auto_punctuation: None,
            auto_numbered_lists: None,
            command_mode: None,
            wake_word_enabled: None,
            assistant_name: None,
            selected_text: None,
            tts_engine: None,
            piper: None,
            coqui: None,
            noise_suppression: None,
            raw_pcm_base64: None,
            ..Default::default()
        }
    }

    // ===== PIPELINE STAGE SEQUENCING =====

    /// Helper: build a fully-online pipeline request
    fn online_pipeline_request() -> crate::commands::pipeline::AssistantPipelineRequest {
        crate::commands::pipeline::AssistantPipelineRequest {
            api_key: "sk-test-key".to_string(),
            api_base_url: Some("https://api.example.com/v1".to_string()),
            stt_model: Some("gpt-4o-mini-transcribe".to_string()),
            ai_model: Some("gpt-4o-mini".to_string()),
            stt_local_mode: Some(false),
            ai_local_mode: Some(false),
            local_ollama_base_url: Some("http://127.0.0.1:11434".to_string()),
            local_ollama_model: Some("llama3.2:3b".to_string()),
            local_stt_model: Some("nvidia/parakeet-tdt-0.6b-v3".to_string()),
            piper_path: None,
            audio_base64: String::new(),
            audio_mime_type: "audio/wav".to_string(),
            language: None,
            allowed_languages: None,
            system_prompt: None,
            temperature: None,
            max_tokens: None,
            dictionary_entries: None,
            snippet_entries: None,
            raw_mode: None,
            apply_backtrack: None,
            remove_fillers: None,
            auto_punctuation: None,
            auto_numbered_lists: None,
            command_mode: None,
            wake_word_enabled: None,
            assistant_name: None,
            selected_text: None,
            tts_engine: None,
            piper: None,
            coqui: None,
            noise_suppression: None,
            raw_pcm_base64: None,
            ..Default::default()
        }
    }

    #[test]
    fn fully_online_pipeline_resolves_both_stages_to_online() {
        let request = online_pipeline_request();
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        assert!(matches!(
            mode.stt,
            crate::pipeline::routing::SttModeConfig::Online { .. }
        ));
        assert!(matches!(
            mode.ai,
            crate::pipeline::routing::AiModeConfig::Online { .. }
        ));
    }

    #[test]
    fn fully_local_pipeline_resolves_both_stages_to_local() {
        let mut request = online_pipeline_request();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(true);
        request.api_key = String::new();
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        assert!(matches!(
            mode.stt,
            crate::pipeline::routing::SttModeConfig::Local(_)
        ));
        assert!(matches!(
            mode.ai,
            crate::pipeline::routing::AiModeConfig::Local(_)
        ));
    }

    #[test]
    fn hybrid_online_stt_local_ai_resolves_correctly() {
        let mut request = online_pipeline_request();
        request.stt_local_mode = Some(false);
        request.ai_local_mode = Some(true);
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        assert!(matches!(
            mode.stt,
            crate::pipeline::routing::SttModeConfig::Online { .. }
        ));
        assert!(matches!(
            mode.ai,
            crate::pipeline::routing::AiModeConfig::Local(_)
        ));
    }

    #[test]
    fn hybrid_local_stt_online_ai_resolves_correctly() {
        let mut request = online_pipeline_request();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(false);
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        assert!(matches!(
            mode.stt,
            crate::pipeline::routing::SttModeConfig::Local(_)
        ));
        assert!(matches!(
            mode.ai,
            crate::pipeline::routing::AiModeConfig::Online { .. }
        ));
    }

    #[test]
    fn fully_online_pipeline_stt_model_is_preserved() {
        let mut request = online_pipeline_request();
        request.stt_model = Some("whisper-large-v3".to_string());
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        match &mode.stt {
            crate::pipeline::routing::SttModeConfig::Online { stt_model, .. } => {
                assert_eq!(stt_model, "whisper-large-v3");
            }
            _ => panic!("expected online STT"),
        }
    }

    #[test]
    fn fully_online_pipeline_ai_model_is_preserved() {
        let mut request = online_pipeline_request();
        request.ai_model = Some("claude-3-opus".to_string());
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        match &mode.ai {
            AiModeConfig::Online { ai_model, .. } => {
                assert_eq!(ai_model, "claude-3-opus");
            }
            _ => panic!("expected online AI"),
        }
    }

    #[test]
    fn fully_local_pipeline_ollama_config_is_preserved() {
        let mut request = online_pipeline_request();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(true);
        request.api_key = String::new();
        request.local_ollama_model = Some("mistral:latest".to_string());
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        match &mode.ai {
            crate::pipeline::routing::AiModeConfig::Local(config) => {
                assert_eq!(config.ollama_model.as_deref(), Some("mistral:latest"));
                assert_eq!(config.ollama_base_url, "http://127.0.0.1:11434");
            }
            _ => panic!("expected local AI"),
        }
    }

    #[test]
    fn fully_local_pipeline_stt_model_is_canonicalized() {
        let mut request = online_pipeline_request();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(true);
        request.api_key = String::new();
        request.local_stt_model = Some("nvidia/parakeet-tdt-0.6b-v2".to_string());
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        match &mode.stt {
            crate::pipeline::routing::SttModeConfig::Local(config) => {
                // v2 alias → canonical v2 id
                assert_eq!(config.stt_model, "nvidia/parakeet-tdt_ctc-110m");
            }
            _ => panic!("expected local STT"),
        }
    }

    #[test]
    fn pipeline_error_messages_are_user_friendly() {
        // Missing API key
        let mut req = online_pipeline_request();
        req.api_key = String::new();
        let err = resolve_pipeline_mode(&req).unwrap_err();
        assert!(err.contains("API key is required"));

        // Missing API base URL
        let mut req = online_pipeline_request();
        req.api_base_url = None;
        let err = resolve_pipeline_mode(&req).unwrap_err();
        assert!(err.contains("API base URL is required"));

        // Missing online STT model
        let mut req = online_pipeline_request();
        req.stt_model = None;
        let err = resolve_pipeline_mode(&req).unwrap_err();
        assert!(err.contains("Online STT model is required"));

        // Missing online AI model
        let mut req = online_pipeline_request();
        req.ai_model = None;
        let err = resolve_pipeline_mode(&req).unwrap_err();
        assert!(err.contains("Online AI model is required"));

        // Missing local STT model
        let mut req = online_pipeline_request();
        req.stt_local_mode = Some(true);
        req.local_stt_model = None;
        let err = resolve_pipeline_mode(&req).unwrap_err();
        assert!(err.contains("Local STT model is required"));
    }

    #[test]
    fn resolve_pipeline_mode_supports_local_stt_online_ai() {
        let mut request = pipeline_mode_request_template();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(false);

        let mode = resolve_pipeline_mode(&request).expect("pipeline mode should resolve");
        assert!(matches!(
            mode.stt,
            crate::pipeline::routing::SttModeConfig::Local(_)
        ));
        assert!(matches!(
            mode.ai,
            crate::pipeline::routing::AiModeConfig::Online { .. }
        ));
    }

    #[test]
    fn resolve_pipeline_mode_supports_online_stt_local_ai() {
        let mut request = pipeline_mode_request_template();
        request.stt_local_mode = Some(false);
        request.ai_local_mode = Some(true);

        let mode = resolve_pipeline_mode(&request).expect("pipeline mode should resolve");
        assert!(matches!(
            mode.stt,
            crate::pipeline::routing::SttModeConfig::Online { .. }
        ));
        assert!(matches!(
            mode.ai,
            crate::pipeline::routing::AiModeConfig::Local(_)
        ));
    }

    #[test]
    fn resolve_pipeline_mode_requires_api_key_if_any_online_mode_enabled() {
        let mut request = pipeline_mode_request_template();
        request.api_key = String::new();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(false);

        let error =
            resolve_pipeline_mode(&request).expect_err("expected missing api key validation");
        assert!(error.contains("API key is required"));
    }

    // Updater tests moved to updater::tests

    #[test]
    fn resolve_installer_file_name_keeps_supported_extension() {
        let from_asset = crate::updater::resolve_installer_file_name(
            Some("SlasshyWispr_0.1.2_x64.msi"),
            "https://example.com/download",
            "0.1.1",
        );
        assert_eq!(from_asset, "SlasshyWispr_0.1.2_x64.msi");

        let from_url = crate::updater::resolve_installer_file_name(
            None,
            "https://example.com/SlasshyWispr_0.1.2_x64-setup.exe",
            "0.1.1",
        );
        assert_eq!(from_url, "SlasshyWispr_0.1.2_x64-setup.exe");
    }

    // TTS binary-path validation tests live in pipeline::tts::normalize::tests.
    // Updater tests moved to updater::tests

    // ===== PIPELINE MODE ROUTING — FULL COVERAGE =====

    #[test]
    fn resolve_pipeline_mode_supports_fully_local() {
        let mut request = pipeline_mode_request_template();
        request.stt_local_mode = Some(true);
        request.ai_local_mode = Some(true);
        request.api_key = String::new();
        request.api_base_url = None;

        let mode =
            resolve_pipeline_mode(&request).expect("fully local should resolve without api key");
        assert!(matches!(
            mode.stt,
            crate::pipeline::routing::SttModeConfig::Local(_)
        ));
        assert!(matches!(
            mode.ai,
            crate::pipeline::routing::AiModeConfig::Local(_)
        ));
    }

    #[test]
    fn resolve_pipeline_mode_supports_fully_online() {
        let request = pipeline_mode_request_template();
        let mode = resolve_pipeline_mode(&request).expect("fully online should resolve");
        assert!(matches!(
            mode.stt,
            crate::pipeline::routing::SttModeConfig::Online { .. }
        ));
        assert!(matches!(
            mode.ai,
            crate::pipeline::routing::AiModeConfig::Online { .. }
        ));
    }

    #[test]
    fn resolve_pipeline_mode_fails_when_api_base_url_missing_for_online() {
        let mut request = pipeline_mode_request_template();
        request.api_base_url = None;
        let error =
            resolve_pipeline_mode(&request).expect_err("should fail when api base url missing");
        assert!(error.contains("API base URL is required"));
    }

    #[test]
    fn resolve_pipeline_mode_fails_when_api_key_empty_for_online() {
        let mut request = pipeline_mode_request_template();
        request.api_key = String::new();
        let error = resolve_pipeline_mode(&request).expect_err("should fail when api key empty");
        assert!(error.contains("API key is required"));
    }

    #[test]
    fn resolve_pipeline_mode_fails_when_online_stt_model_missing() {
        let mut request = pipeline_mode_request_template();
        request.stt_model = None;
        let error =
            resolve_pipeline_mode(&request).expect_err("should fail when online stt model missing");
        assert!(error.contains("Online STT model is required"));
    }

    #[test]
    fn resolve_pipeline_mode_fails_when_online_ai_model_missing() {
        let mut request = pipeline_mode_request_template();
        request.ai_model = None;
        let error =
            resolve_pipeline_mode(&request).expect_err("should fail when online ai model missing");
        assert!(error.contains("Online AI model is required"));
    }

    #[test]
    fn resolve_pipeline_mode_fails_when_local_stt_model_missing() {
        let mut request = pipeline_mode_request_template();
        request.stt_local_mode = Some(true);
        request.local_stt_model = None;
        let error =
            resolve_pipeline_mode(&request).expect_err("should fail when local stt model missing");
        assert!(error.contains("Local STT model is required"));
    }

    #[test]
    fn resolve_pipeline_mode_local_ai_allows_empty_ollama_model() {
        let mut request = pipeline_mode_request_template();
        request.ai_local_mode = Some(true);
        request.local_ollama_model = None;
        let mode =
            resolve_pipeline_mode(&request).expect("local ai should resolve without ollama model");
        match &mode.ai {
            crate::pipeline::routing::AiModeConfig::Local(config) => {
                assert!(config.ollama_model.is_none());
            }
            _ => panic!("expected local AI config"),
        }
    }

    #[test]
    fn resolve_pipeline_mode_online_stt_carries_correct_credentials() {
        let request = pipeline_mode_request_template();
        let mode = resolve_pipeline_mode(&request).expect("online should resolve");
        match &mode.stt {
            crate::pipeline::routing::SttModeConfig::Online {
                api_key,
                api_base_url,
                stt_model,
            } => {
                assert_eq!(api_key, "test-key");
                assert_eq!(api_base_url, "https://api.example.com/v1");
                assert_eq!(stt_model, "gpt-4o-mini-transcribe");
            }
            _ => panic!("expected online STT config"),
        }
    }

    #[test]
    fn resolve_pipeline_mode_local_stt_uses_canonical_model_id() {
        let mut request = pipeline_mode_request_template();
        request.stt_local_mode = Some(true);
        request.local_stt_model = Some("nvidia/parakeet-tdt-0.6b-v2".to_string());
        let mode = resolve_pipeline_mode(&request).expect("should resolve");
        match &mode.stt {
            crate::pipeline::routing::SttModeConfig::Local(config) => {
                // v2 alias should be canonicalized to v2 legacy id
                assert_eq!(config.stt_model, "nvidia/parakeet-tdt_ctc-110m");
            }
            _ => panic!("expected local STT config"),
        }
    }
}
