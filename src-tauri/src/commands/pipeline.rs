//! Assistant pipeline command — Phase 6j thin-adapter extraction.
//!
//! Moved verbatim from lib.rs: run_assistant_pipeline + request/response
//! structs. transcribe_* helpers stay in lib.rs for now (shared runtime
//! used by Phase 7 service split). Service thinning (repair/TTL sync
//! into services) is Phase 7.

use std::time::Instant;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::commands::ipc_types::{PipelineRunIdentity, PipelineRunOutcome};
use crate::constants::DEFAULT_SYSTEM_PROMPT;
use crate::pipeline::ai::{
    generate_assistant_response, generate_compose_draft_fallback, generate_direct_answer_fallback,
    generate_selection_edit_decision,
};
use crate::pipeline::input::{apply_noise_suppression, validate_audio_input};
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::process::elapsed_ms;
use crate::pipeline::refinement::{
    self, RefinementConfig, RefinementDictionaryEntry, RefinementSnippetEntry,
};
use crate::pipeline::routing::{infer_local_stt_provider_from_model, AiModeConfig, SttModeConfig};
use crate::pipeline::selection::{
    build_selected_context_answer_prompt, seems_like_selection_context_query,
    seems_like_selection_edit_instruction, selection_action_label,
};
use crate::pipeline::stt::{
    is_known_stt_hallucination, looks_like_repetitive_transcript_noise,
    normalize_stt_allowed_languages, normalize_stt_language_hint,
};
use crate::pipeline::tts::{
    load_clone_assets, synthesize_cloned, synthesize_with_piper, voice_clone_models_dir,
    voice_clone_voice_dir, PiperPipelineRequest, VoiceClonePipelineRequest,
};
use crate::pipeline::wake::extract_wake_command;
use crate::services::pipeline_service::resolve_pipeline_mode;
use crate::services::{
    resolve_piper_assets, resolve_stt_timeout, sync_orchestrator_pending_rewrite_to_app_state,
    sync_selection_context, transcribe_audio, transcribe_audio_local, SttRequest,
};
use crate::state::AppState;

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantPipelineRequest {
    pub(crate) api_key: String,
    pub(crate) api_base_url: Option<String>,
    pub(crate) stt_model: Option<String>,
    pub(crate) ai_model: Option<String>,
    pub(crate) stt_local_mode: Option<bool>,
    pub(crate) ai_local_mode: Option<bool>,
    pub(crate) local_ollama_base_url: Option<String>,
    pub(crate) local_ollama_model: Option<String>,
    pub(crate) local_stt_model: Option<String>,
    pub(crate) piper_path: Option<String>,
    pub(crate) audio_base64: String,
    pub(crate) audio_mime_type: String,
    /// Clamped by `resolve_stt_timeout`; the frontend's bound is a hint, not a
    /// guarantee, since this arrives over IPC.
    pub(crate) stt_timeout_seconds: Option<u64>,
    pub(crate) language: Option<String>,
    pub(crate) allowed_languages: Option<Vec<String>>,
    pub(crate) system_prompt: Option<String>,
    pub(crate) temperature: Option<f32>,
    pub(crate) max_tokens: Option<u32>,
    pub(crate) dictionary_entries: Option<Vec<DictionaryEntryRequest>>,
    pub(crate) snippet_entries: Option<Vec<SnippetEntryRequest>>,
    pub(crate) raw_mode: Option<bool>,
    pub(crate) apply_backtrack: Option<bool>,
    pub(crate) remove_fillers: Option<bool>,
    pub(crate) auto_punctuation: Option<bool>,
    pub(crate) auto_numbered_lists: Option<bool>,
    pub(crate) noise_suppression: Option<bool>,
    pub(crate) raw_pcm_base64: Option<String>,
    pub(crate) command_mode: Option<bool>,
    pub(crate) wake_word_enabled: Option<bool>,
    pub(crate) assistant_name: Option<String>,
    pub(crate) selected_text: Option<String>,
    pub(crate) tts_engine: Option<String>,
    pub(crate) piper: Option<PiperPipelineRequest>,
    pub(crate) voice_clone: Option<VoiceClonePipelineRequest>,
    #[serde(flatten, default)]
    pub(crate) run: PipelineRunIdentity,
    /// Stale replace-selection guard: frontend popup token; backend rejects
    /// when it does not match the latest issued token.
    #[serde(default)]
    pub(crate) replace_token: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DictionaryEntryRequest {
    pub(crate) source: String,
    pub(crate) target: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SnippetEntryRequest {
    pub(crate) trigger: String,
    pub(crate) expansion: String,
}
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantPipelineResponse {
    /// Which stage handled the turn: "assistant" or "dictation".
    pub(crate) mode: String,
    pub(crate) selection_rewrite: bool,
    pub(crate) selection_pending: bool,
    pub(crate) selection_context_cleared: bool,
    pub(crate) selection_context_used: bool,
    pub(crate) transcript: String,
    pub(crate) assistant_response: String,
    pub(crate) audio_base64: String,
    pub(crate) stt_latency_ms: u64,
    pub(crate) ai_latency_ms: u64,
    pub(crate) tts_latency_ms: u64,
    pub(crate) total_latency_ms: u64,
    /// Never silent on TTS: "disabled"|"skipped"|"synthesized"|"failed".
    #[serde(default)]
    pub(crate) tts_error: String,
    #[serde(flatten, default)]
    pub(crate) outcome: PipelineRunOutcome,
}
/// Bounds for the assistant's sampling temperature. The frontend renders these
/// and the backend enforces them, so they are stated once, here.
pub(crate) const TEMPERATURE_DEFAULT: f64 = 0.35;
pub(crate) const TEMPERATURE_MIN: f64 = 0.0;
pub(crate) const TEMPERATURE_MAX: f64 = 1.2;

/// Clamp a user-set temperature to the range the settings pane offers. Above
/// the maximum replies wander away from the dictation; at zero they stop
/// varying at all.
pub(crate) fn resolve_temperature(requested: Option<f32>) -> f32 {
    let value = requested.map_or(TEMPERATURE_DEFAULT, f64::from);
    value.clamp(TEMPERATURE_MIN, TEMPERATURE_MAX) as f32
}

/// Bounds for one assistant reply. The frontend renders these and the backend
/// enforces them, so they are stated once, here.
pub(crate) const MAX_TOKENS_DEFAULT: u32 = 320;
pub(crate) const MAX_TOKENS_MIN: u32 = 64;
pub(crate) const MAX_TOKENS_MAX: u32 = 1024;

/// Clamp a user-set token ceiling. Below the minimum a reply is cut off
/// mid-sentence; above the maximum one dictation can hold the pipeline open.
pub(crate) fn resolve_max_tokens(requested: Option<u32>) -> u32 {
    match requested {
        Some(tokens) => tokens.clamp(MAX_TOKENS_MIN, MAX_TOKENS_MAX),
        None => MAX_TOKENS_DEFAULT,
    }
}

/// The prompt the AI stages run with, given whatever the frontend sent.
///
/// An absent or empty setting means "use the built-in prompt". The frontend
/// ships no copy of it, so clearing the field cannot switch behaviour to some
/// second text — this is the only definition of the default, and the only
/// thing that changes if it is rewritten.
fn resolve_system_prompt(requested: Option<&str>) -> &str {
    match requested.map(str::trim).filter(|prompt| !prompt.is_empty()) {
        Some(prompt) => prompt,
        None => {
            info!("[pipeline] no system prompt set — using the built-in one");
            DEFAULT_SYSTEM_PROMPT
        }
    }
}

/// Whisper-era guards: seq2seq models invent text from silence. Transducers and CTC
/// emit nothing, so rejecting a real short phrase is the worse failure.
fn stt_hallucination_guards_apply(mode: &SttModeConfig) -> bool {
    match mode {
        SttModeConfig::Online { .. } => true,
        SttModeConfig::Local(local) => !matches!(
            infer_local_stt_provider_from_model(&local.stt_model).as_str(),
            "parakeet" | "sensevoice"
        ),
    }
}

/// Cloned-voice synthesis for the pipeline. The model must already be installed: a
/// dictation never triggers the ~156 MB download, which belongs to the settings pane.
async fn synthesize_with_cloned_voice(
    app: &AppHandle,
    clone: &VoiceClonePipelineRequest,
    text: String,
) -> Result<Vec<u8>, String> {
    let models_dir = voice_clone_models_dir(app)?;
    let assets = load_clone_assets(&models_dir)?.ok_or_else(|| {
        "The voice-clone model is not installed. Download it from Settings first.".to_string()
    })?;
    let voice_dir = voice_clone_voice_dir(app, &clone.speaker_id)?;
    let speed = clone.speed.unwrap_or(1.0);

    tauri::async_runtime::spawn_blocking(move || {
        synthesize_cloned(&assets, &voice_dir, &text, speed)
    })
    .await
    .map_err(|error| format!("Voice-clone synthesis worker failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn run_assistant_pipeline(
    app: AppHandle,
    state: State<'_, AppState>,
    request: AssistantPipelineRequest,
) -> Result<AssistantPipelineResponse, String> {
    // Agent1-contract: echo pipeline_run_id (mint when frontend omits it).
    let run_id = if request.run.pipeline_run_id.trim().is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        request.run.pipeline_run_id.clone()
    };
    let outcome_for = |tts_status: &str| PipelineRunOutcome {
        pipeline_run_id: run_id.clone(),
        tts_status: tts_status.to_string(),
    };
    // F-009: a superseded rewrite must not replace the selection. The frontend
    // stamps each popup with a monotonic token; an older one is rejected here.
    if !state.accept_replace_token(&request.replace_token)? {
        warn!(
            "[pipeline] rejected stale replace_token={} run_id={}",
            clip_text(&request.replace_token, 40),
            run_id
        );
        return Err("This rewrite was superseded by a newer request.".to_string());
    }
    let pipeline_mode = resolve_pipeline_mode(&request)?;

    let requested_engine = request
        .tts_engine
        .as_deref()
        .map(str::trim)
        .unwrap_or("piper")
        .to_ascii_lowercase();
    let use_cloned_voice = requested_engine == "zipvoice";

    let piper_assets = resolve_piper_assets(
        &app,
        &state.http,
        request.piper_path.as_deref(),
        use_cloned_voice,
    )
    .await;
    let piper_path = piper_assets.piper_path;
    let piper_model_path = piper_assets.piper_model_path;

    let audio_bytes = validate_audio_input(&request.audio_base64)?;
    let audio_bytes = apply_noise_suppression(
        &audio_bytes,
        request.noise_suppression.unwrap_or(false),
        request.raw_pcm_base64.as_deref(),
    )?;

    let stt_mode_label = match &pipeline_mode.stt {
        SttModeConfig::Online { .. } => "online",
        SttModeConfig::Local(_) => "local",
    };
    let ai_mode_label = match &pipeline_mode.ai {
        AiModeConfig::Online { .. } => "online",
        AiModeConfig::Local(_) => "local",
    };
    let pipeline_label = if stt_mode_label == ai_mode_label {
        stt_mode_label.to_string()
    } else {
        format!("hybrid(stt={},ai={})", stt_mode_label, ai_mode_label)
    };
    let stt_base_url_for_log = match &pipeline_mode.stt {
        SttModeConfig::Online { api_base_url, .. } => api_base_url.clone(),
        SttModeConfig::Local(local) => {
            let stt_provider = infer_local_stt_provider_from_model(&local.stt_model);
            format!("builtin://local-{}", stt_provider)
        }
    };
    let stt_model_for_log = match &pipeline_mode.stt {
        SttModeConfig::Online { stt_model, .. } => stt_model.clone(),
        SttModeConfig::Local(local) => local.stt_model.clone(),
    };
    let ai_model_for_log = match &pipeline_mode.ai {
        AiModeConfig::Online { ai_model, .. } => ai_model.clone(),
        AiModeConfig::Local(local) => local
            .ollama_model
            .clone()
            .unwrap_or_else(|| "<unset>".to_string()),
    };

    info!(
        "[pipeline] start mode={} engine={} audio_bytes={} mime={} stt_base_url={} stt_model={} ai_model={} stt_timeout_seconds={}",
        pipeline_label,
        if use_cloned_voice { "zipvoice" } else { "piper" },
        audio_bytes.len(),
        request.audio_mime_type,
        clip_text(&stt_base_url_for_log, 180),
        clip_text(&stt_model_for_log, 120),
        clip_text(&ai_model_for_log, 120),
        resolve_stt_timeout(request.stt_timeout_seconds).as_secs()
    );

    let overall_start = Instant::now();

    let stt_start = Instant::now();
    let effective_language_hint =
        normalize_stt_language_hint(request.language.as_deref()).or_else(|| {
            normalize_stt_allowed_languages(request.allowed_languages.as_deref())
                .first()
                .cloned()
        });
    let transcript_raw = match &pipeline_mode.stt {
        SttModeConfig::Online {
            api_key,
            api_base_url,
            stt_model,
        } => {
            transcribe_audio(
                &state.http,
                SttRequest::new(api_base_url, stt_model, &audio_bytes, "online")
                    .api_key(Some(api_key.as_str()))
                    .audio_mime_type(request.audio_mime_type.trim())
                    .language(request.language.as_deref())
                    .timeout(resolve_stt_timeout(request.stt_timeout_seconds)),
                request.allowed_languages.as_deref(),
            )
            .await?
        }
        SttModeConfig::Local(local) => {
            transcribe_audio_local(
                &app,
                &state.http,
                local,
                &audio_bytes,
                request.audio_mime_type.trim(),
                request.language.as_deref(),
                request.allowed_languages.as_deref(),
            )
            .await?
        }
    };
    if stt_hallucination_guards_apply(&pipeline_mode.stt)
        && is_known_stt_hallucination(&transcript_raw)
    {
        warn!(
            "[pipeline] rejected known hallucination transcript='{}' chars={}",
            clip_text(&transcript_raw, 120),
            transcript_raw.chars().count()
        );
        return Err(
            "Detected a known STT hallucination. Hold push-to-talk longer while speaking and try again."
                .to_string(),
        );
    }
    if stt_hallucination_guards_apply(&pipeline_mode.stt)
        && looks_like_repetitive_transcript_noise(
            &transcript_raw,
            effective_language_hint.as_deref(),
        )
    {
        warn!(
            "[pipeline] rejected noisy transcript chars={} language={}",
            transcript_raw.chars().count(),
            effective_language_hint.as_deref().unwrap_or("auto")
        );
        let message = match &pipeline_mode.stt {
            SttModeConfig::Local(local)
                if infer_local_stt_provider_from_model(&local.stt_model) == "moonshine"
                    && effective_language_hint.as_deref() == Some("en") =>
            {
                "Detected non-English/noisy Moonshine transcript while Dictation language is English. Switch Local STT model to Whisper Small/Medium in Settings > Models for reliable English wake phrase detection."
                    .to_string()
            }
            _ => {
                "Detected noisy transcript output. Hold push-to-talk longer while speaking and try again."
                    .to_string()
            }
        };
        return Err(message);
    }
    let refinement_config = RefinementConfig {
        raw_mode: request.raw_mode.unwrap_or(false),
        snippet_entries: request
            .snippet_entries
            .as_ref()
            .map(|entries| {
                entries
                    .iter()
                    .map(|e| RefinementSnippetEntry {
                        trigger: e.trigger.clone(),
                        expansion: e.expansion.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        dictionary_entries: request
            .dictionary_entries
            .as_ref()
            .map(|entries| {
                entries
                    .iter()
                    .map(|e| RefinementDictionaryEntry {
                        source: e.source.clone(),
                        target: e.target.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default(),
        apply_backtrack: request.apply_backtrack.unwrap_or(false),
        remove_fillers: request.remove_fillers.unwrap_or(false),
        auto_numbered_lists: request.auto_numbered_lists.unwrap_or(false),
        auto_punctuation: request.auto_punctuation.unwrap_or(false),
    };
    let transcript = refinement::refine_transcript(&transcript_raw, &refinement_config);
    let stt_latency_ms = elapsed_ms(stt_start);
    info!(
        "[pipeline] stt done latency_ms={} transcript_chars={}",
        stt_latency_ms,
        transcript.chars().count()
    );

    if transcript.trim().is_empty() {
        return Err("STT returned an empty transcript".to_string());
    }

    let wake_word_enabled = request.wake_word_enabled.unwrap_or(true);
    let assistant_name = request
        .assistant_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Lily");
    let wake_command = if wake_word_enabled {
        extract_wake_command(&transcript, assistant_name)
    } else {
        Some(transcript.clone())
    };
    if wake_word_enabled && wake_command.is_none() {
        let selection_context_cleared = state.clear_pending_selection_rewrite()?;
        info!(
            "[pipeline] dictation mode wake_phrase_missing name={} transcript_chars={} pending_context_cleared={}",
            assistant_name,
            transcript.chars().count(),
            selection_context_cleared
        );
        let total_latency_ms = elapsed_ms(overall_start);
        let assistant_response = transcript.clone();
        state.set_last_transcript(&transcript)?;
        return Ok(AssistantPipelineResponse {
            mode: "dictation".to_string(),
            selection_rewrite: false,
            selection_pending: false,
            selection_context_cleared,
            selection_context_used: false,
            transcript: transcript.clone(),
            assistant_response,
            audio_base64: String::new(),
            stt_latency_ms,
            ai_latency_ms: 0,
            tts_latency_ms: 0,
            total_latency_ms,
            tts_error: String::new(),
            outcome: outcome_for("skipped"),
        });
    }

    let wake_command = wake_command.unwrap_or_default();
    let command_for_ai = wake_command.trim().to_string();
    let wake_only = wake_word_enabled && command_for_ai.is_empty();
    let command_mode = request.command_mode.unwrap_or(false);
    let selection_edit_intent = seems_like_selection_edit_instruction(&command_for_ai);
    let selection_context_query_intent = seems_like_selection_context_query(&command_for_ai);
    let selection_intent_active = selection_edit_intent || selection_context_query_intent;
    let frontend_selected_text = request
        .selected_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let should_try_backend_selection_capture = !wake_only
        && frontend_selected_text.is_none()
        && (selection_intent_active
            || command_mode
            || state.peek_pending_selection_rewrite()?.is_some());
    let mut backend_selected_text: Option<String> = None;
    if should_try_backend_selection_capture {
        #[cfg(target_os = "windows")]
        {
            match crate::platform::windows_native::capture_selected_text_windows() {
                Ok(captured) => {
                    let trimmed = captured.trim();
                    if !trimmed.is_empty() {
                        backend_selected_text = Some(trimmed.to_string());
                    }
                }
                Err(error) => {
                    warn!(
                        "[pipeline] selection fallback capture failed: {}",
                        clip_text(&single_line(&error), 240)
                    );
                }
            }
        }
    }
    let selection_sync = sync_selection_context(
        &state,
        command_mode,
        selection_intent_active,
        frontend_selected_text,
        backend_selected_text,
    )?;
    let pending_rewrite_present = selection_sync.pending_rewrite_present;
    let selected_text = selection_sync.selected_text;
    let selected_text_source = selection_sync.selected_text_source;
    if selected_text_source == "recent-context" {
        info!(
            "[pipeline] selection context recovered from recent cache chars={}",
            selected_text
                .as_ref()
                .map(|text| text.chars().count())
                .unwrap_or(0)
        );
    }
    let selected_context_available = selected_text.is_some();
    let selection_control_mode = selected_context_available
        || command_mode
        || pending_rewrite_present
        || selection_intent_active;
    let selected_chars = selected_text
        .as_ref()
        .map(|value| value.chars().count())
        .unwrap_or(0);
    info!(
        "[pipeline] selection context command_mode={} edit_intent={} context_query_intent={} pending={} control_mode={} source={} selected_chars={}",
        command_mode,
        selection_edit_intent,
        selection_context_query_intent,
        pending_rewrite_present,
        selection_control_mode,
        selected_text_source,
        selected_chars
    );
    // --- Delegate decision logic to the orchestrator ---
    let system_prompt = resolve_system_prompt(request.system_prompt.as_deref());
    let temperature = resolve_temperature(request.temperature);
    let max_tokens = resolve_max_tokens(request.max_tokens);

    let orch_state = crate::pipeline::orchestration::PipelineState::new();
    // Seed orchestrator state with any existing pending rewrite
    if let Some(pending) = state.peek_pending_selection_rewrite()? {
        orch_state.set_pending_rewrite(&pending);
    }

    let orch_result = crate::pipeline::orchestration::orchestrate_post_stt(
        crate::pipeline::orchestration::OrchestratorInput {
            transcript: &transcript,
            wake_word_enabled,
            command_mode,
            selected_text: selected_text.as_deref(),
            config: crate::pipeline::orchestration::PipelineConfig {
                system_prompt: system_prompt.to_string(),
                temperature,
                max_tokens,
                assistant_name: assistant_name.to_string(),
            },
            state: &orch_state,
        },
    );

    // Sync orchestrator state transitions to AppState
    let mut selection_rewrite = orch_result.decision.selection_rewrite;
    let mut selection_pending = orch_result.decision.selection_pending;
    let mut selection_context_cleared = orch_result.decision.selection_context_cleared;
    let mut skip_tts = orch_result.decision.skip_tts;
    let selection_context_used = orch_result.decision.selection_context_used;

    // Sync pending rewrite state
    sync_orchestrator_pending_rewrite_to_app_state(&state, &orch_state)?;

    let mut ai_latency_ms = 0_u64;
    let mut assistant_response;

    match orch_result.ai_action {
        crate::pipeline::orchestration::AiAction::None => {
            assistant_response = orch_result.decision.assistant_response;
            if wake_only {
                info!("[pipeline] wake phrase detected without trailing command");
            }
        }
        crate::pipeline::orchestration::AiAction::GenerateResponse {
            prompt,
            system_prompt,
            temperature,
            max_tokens,
        } => {
            let ai_start = Instant::now();
            assistant_response = generate_assistant_response(
                &state.http,
                &pipeline_mode.ai,
                &prompt,
                &system_prompt,
                temperature,
                max_tokens,
            )
            .await?;
            ai_latency_ms = elapsed_ms(ai_start);
            info!(
                "[pipeline] ai done latency_ms={} response_chars={}",
                ai_latency_ms,
                assistant_response.chars().count()
            );

            // Post-AI processing: echo detection and draft fallback
            match crate::pipeline::orchestration::post_ai_processing(
                &assistant_response,
                &command_for_ai,
                wake_only,
                selection_context_used,
                selection_rewrite,
                selection_pending,
            ) {
                crate::pipeline::orchestration::PostAiAction::DirectAnswerFallback {
                    command,
                    temperature,
                    max_tokens,
                } => {
                    warn!(
                        "[pipeline] detected question echo; retrying with strict direct-answer fallback command={}",
                        clip_text(&command, 220)
                    );
                    match generate_direct_answer_fallback(
                        &state.http,
                        &pipeline_mode.ai,
                        &command,
                        temperature,
                        max_tokens,
                    )
                    .await
                    {
                        Ok(recovered) if !recovered.trim().is_empty() => {
                            assistant_response = recovered;
                            ai_latency_ms = elapsed_ms(ai_start);
                            info!(
                                "[pipeline] fallback answer success latency_ms={} response_chars={}",
                                ai_latency_ms,
                                assistant_response.chars().count()
                            );
                        }
                        Ok(_) => {
                            warn!("[pipeline] fallback answer returned empty response");
                        }
                        Err(error) => {
                            warn!(
                                "[pipeline] fallback answer failed: {}",
                                clip_text(&single_line(&error), 320)
                            );
                        }
                    }
                }
                crate::pipeline::orchestration::PostAiAction::ComposeDraftFallback {
                    command,
                    temperature,
                    max_tokens,
                } => {
                    warn!(
                        "[pipeline] detected incomplete draft output; retrying with strict compose fallback command={}",
                        clip_text(&command, 220)
                    );
                    match generate_compose_draft_fallback(
                        &state.http,
                        &pipeline_mode.ai,
                        &command,
                        temperature,
                        max_tokens,
                    )
                    .await
                    {
                        Ok(recovered) if !recovered.trim().is_empty() => {
                            assistant_response = recovered;
                            ai_latency_ms = elapsed_ms(ai_start);
                            info!(
                                "[pipeline] compose fallback success latency_ms={} response_chars={}",
                                ai_latency_ms,
                                assistant_response.chars().count()
                            );
                        }
                        Ok(_) => {
                            warn!("[pipeline] compose fallback returned empty response");
                        }
                        Err(error) => {
                            warn!(
                                "[pipeline] compose fallback failed: {}",
                                clip_text(&single_line(&error), 320)
                            );
                        }
                    }
                }
                _ => {}
            }
        }
        crate::pipeline::orchestration::AiAction::GenerateSelectionEditDecision {
            instruction,
            selected_text,
            temperature,
        } => {
            let ai_start = Instant::now();
            let decision = generate_selection_edit_decision(
                &state.http,
                &pipeline_mode.ai,
                &instruction,
                &selected_text,
                temperature,
            )
            .await?;
            ai_latency_ms = elapsed_ms(ai_start);
            info!(
                "[pipeline] ai edit decision latency_ms={} action={} rewrite_chars={} message_chars={}",
                ai_latency_ms,
                selection_action_label(decision.action),
                decision.rewrite_text.chars().count(),
                decision.message.chars().count()
            );

            let edit_result = crate::pipeline::orchestration::apply_selection_edit_result(
                decision,
                &instruction,
                &selected_text,
                &orch_state,
                assistant_name,
            );
            assistant_response = edit_result.assistant_response;
            selection_rewrite = edit_result.selection_rewrite;
            selection_pending = edit_result.selection_pending;
            selection_context_cleared = edit_result.selection_context_cleared;
            skip_tts = edit_result.skip_tts;

            // Sync orchestrator state to AppState after selection-edit apply
            sync_orchestrator_pending_rewrite_to_app_state(&state, &orch_state)?;

            // NoEdit with empty response → generate AI answer with selected context
            if assistant_response.is_empty() {
                let response = generate_assistant_response(
                    &state.http,
                    &pipeline_mode.ai,
                    &build_selected_context_answer_prompt(&instruction, &selected_text),
                    system_prompt,
                    temperature,
                    max_tokens,
                )
                .await?;
                ai_latency_ms = elapsed_ms(ai_start);
                info!(
                    "[pipeline] ai selected-context answer latency_ms={} response_chars={}",
                    ai_latency_ms,
                    response.chars().count()
                );
                assistant_response = response;
            }
        }
    }

    assistant_response =
        crate::pipeline::orchestration::normalize_and_validate_response(&assistant_response)?;

    if wake_only {
        let total_latency_ms = elapsed_ms(overall_start);
        info!(
            "[pipeline] wake acknowledgement complete total_latency_ms={}",
            total_latency_ms
        );
        state.set_last_pipeline_output(&transcript, &assistant_response)?;
        return Ok(AssistantPipelineResponse {
            mode: "assistant".to_string(),
            selection_rewrite: false,
            selection_pending: false,
            selection_context_cleared: false,
            selection_context_used: false,
            transcript,
            assistant_response,
            audio_base64: String::new(),
            stt_latency_ms,
            ai_latency_ms,
            tts_latency_ms: 0,
            total_latency_ms,
            tts_error: String::new(),
            outcome: outcome_for("skipped"),
        });
    }

    if skip_tts {
        let total_latency_ms = elapsed_ms(overall_start);
        info!(
            "[pipeline] complete (tts skipped) total_latency_ms={}",
            total_latency_ms
        );
        state.set_last_pipeline_output(&transcript, &assistant_response)?;
        return Ok(AssistantPipelineResponse {
            mode: "assistant".to_string(),
            selection_rewrite,
            selection_pending,
            selection_context_cleared,
            selection_context_used,
            transcript,
            assistant_response,
            audio_base64: String::new(),
            stt_latency_ms,
            ai_latency_ms,
            tts_latency_ms: 0,
            total_latency_ms,
            tts_error: String::new(),
            outcome: outcome_for("skipped"),
        });
    }

    let tts_start = Instant::now();
    let tts_result = if use_cloned_voice {
        match request.voice_clone.as_ref() {
            Some(clone) => {
                synthesize_with_cloned_voice(&app, clone, assistant_response.clone()).await
            }
            None => Err("Cloned-voice settings are missing.".to_string()),
        }
    } else {
        match (piper_path, piper_model_path) {
            (Some(rpp), Some(rmp)) => {
                synthesize_with_piper(rpp, rmp, assistant_response.clone(), request.piper.as_ref())
                    .await
            }
            _ => Err("Piper runtime or voice model files are missing.".to_string()),
        }
    };

    // F-011: never silent on TTS — explicit status + error string.
    let (tts_bytes, tts_status, tts_error) = match tts_result {
        Ok(bytes) if !bytes.is_empty() => (bytes, "synthesized", String::new()),
        Ok(_) => (
            Vec::new(),
            "failed",
            "TTS returned empty audio.".to_string(),
        ),
        Err(error) => {
            warn!("[pipeline] tts synthesis skipped/failed: {}", error);
            (Vec::new(), "failed", error)
        }
    };

    let tts_latency_ms = elapsed_ms(tts_start);
    info!(
        "[pipeline] tts done engine={} status={} latency_ms={} audio_bytes={}",
        if use_cloned_voice {
            "zipvoice"
        } else {
            "piper"
        },
        tts_status,
        tts_latency_ms,
        tts_bytes.len()
    );

    let total_latency_ms = elapsed_ms(overall_start);
    info!("[pipeline] complete total_latency_ms={}", total_latency_ms);
    state.set_last_pipeline_output(&transcript, &assistant_response)?;

    Ok(AssistantPipelineResponse {
        mode: "assistant".to_string(),
        selection_rewrite,
        selection_pending,
        selection_context_cleared,
        selection_context_used,
        transcript,
        assistant_response,
        audio_base64: BASE64_STANDARD.encode(tts_bytes),
        stt_latency_ms,
        ai_latency_ms,
        tts_latency_ms,
        total_latency_ms,
        tts_error,
        outcome: outcome_for(tts_status),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::routing::LocalSttConfig;
    use crate::pipeline::tts::PiperPipelineRequest;

    fn local_stt_mode(model: &str) -> SttModeConfig {
        SttModeConfig::Local(LocalSttConfig {
            stt_model: model.to_string(),
        })
    }

    #[test]
    fn hallucination_guards_skip_local_engines_that_cannot_invent_text() {
        assert!(!stt_hallucination_guards_apply(&local_stt_mode(
            "nvidia/parakeet-tdt-0.6b-v3"
        )));
        assert!(!stt_hallucination_guards_apply(&local_stt_mode(
            "iic/SenseVoiceSmall"
        )));
        assert!(stt_hallucination_guards_apply(&local_stt_mode(
            "whisper-large-v3-turbo"
        )));
        assert!(stt_hallucination_guards_apply(&local_stt_mode(
            "onnx-community/moonshine-base"
        )));
        assert!(stt_hallucination_guards_apply(&SttModeConfig::Online {
            api_key: "k".to_string(),
            api_base_url: "https://api.example.com".to_string(),
            stt_model: "whisper-1".to_string(),
        }));
    }

    #[test]
    fn an_absent_or_blank_system_prompt_falls_back_to_the_built_in_one() {
        assert_eq!(resolve_system_prompt(None), DEFAULT_SYSTEM_PROMPT);
        assert_eq!(resolve_system_prompt(Some("")), DEFAULT_SYSTEM_PROMPT);
        assert_eq!(
            resolve_system_prompt(Some("  \n\t ")),
            DEFAULT_SYSTEM_PROMPT
        );
    }

    #[test]
    fn a_custom_system_prompt_is_used_trimmed() {
        assert_eq!(resolve_system_prompt(Some("  Be terse.  ")), "Be terse.");
    }

    #[test]
    fn the_built_in_prompt_explains_what_the_ai_stage_should_do() {
        // Nothing on the frontend repeats these, so losing them would quietly
        // change how a transcript is refined rather than fail anything.
        assert!(DEFAULT_SYSTEM_PROMPT.contains("cleanup"));
        assert!(DEFAULT_SYSTEM_PROMPT.contains("Output only final content"));
    }

    #[test]
    fn ipc_request_serializes_with_camel_case() {
        let request = AssistantPipelineRequest {
            api_key: "sk-test".to_string(),
            api_base_url: Some("https://api.example.com".to_string()),
            stt_model: Some("gpt-4o-mini-transcribe".to_string()),
            ai_model: Some("gpt-4o-mini".to_string()),
            stt_local_mode: Some(false),
            ai_local_mode: Some(true),
            local_ollama_base_url: Some("http://127.0.0.1:11434".to_string()),
            local_ollama_model: Some("llama3".to_string()),
            local_stt_model: Some("nvidia/parakeet-tdt-0.6b-v3".to_string()),
            piper_path: Some("/path/to/piper".to_string()),
            audio_base64: "dGVzdA==".to_string(),
            audio_mime_type: "audio/wav".to_string(),
            stt_timeout_seconds: None,
            language: Some("en".to_string()),
            allowed_languages: Some(vec!["en".to_string(), "es".to_string()]),
            system_prompt: Some("You are helpful.".to_string()),
            temperature: Some(0.5),
            max_tokens: Some(256),
            dictionary_entries: Some(vec![DictionaryEntryRequest {
                source: "brb".to_string(),
                target: "be right back".to_string(),
            }]),
            snippet_entries: Some(vec![SnippetEntryRequest {
                trigger: "gj".to_string(),
                expansion: "good job".to_string(),
            }]),
            raw_mode: Some(false),
            apply_backtrack: Some(true),
            remove_fillers: Some(true),
            auto_punctuation: Some(true),
            auto_numbered_lists: Some(false),
            noise_suppression: Some(true),
            raw_pcm_base64: Some("cGNtZGF0YQ==".to_string()),
            command_mode: Some(true),
            wake_word_enabled: Some(true),
            assistant_name: Some("Lily".to_string()),
            selected_text: Some("selected text".to_string()),
            tts_engine: Some("piper".to_string()),
            piper: Some(PiperPipelineRequest {
                speed: Some(1.08),
                quality: Some("fast".to_string()),
                emotion: Some("neutral".to_string()),
            }),
            voice_clone: None,
            ..Default::default()
        };

        let json = serde_json::to_value(&request).expect("should serialize");
        let obj = json.as_object().expect("should be object");

        // Verify camelCase field names match the TypeScript types
        assert!(obj.contains_key("apiKey"), "expected camelCase 'apiKey'");
        assert!(
            obj.contains_key("apiBaseUrl"),
            "expected camelCase 'apiBaseUrl'"
        );
        assert!(
            obj.contains_key("sttModel"),
            "expected camelCase 'sttModel'"
        );
        assert!(obj.contains_key("aiModel"), "expected camelCase 'aiModel'");
        assert!(
            obj.contains_key("sttLocalMode"),
            "expected camelCase 'sttLocalMode'"
        );
        assert!(
            obj.contains_key("aiLocalMode"),
            "expected camelCase 'aiLocalMode'"
        );
        assert!(
            obj.contains_key("localOllamaBaseUrl"),
            "expected camelCase 'localOllamaBaseUrl'"
        );
        assert!(
            obj.contains_key("localOllamaModel"),
            "expected camelCase 'localOllamaModel'"
        );
        assert!(
            obj.contains_key("localSttModel"),
            "expected camelCase 'localSttModel'"
        );
        assert!(
            obj.contains_key("piperPath"),
            "expected camelCase 'piperPath'"
        );
        assert!(
            obj.contains_key("audioBase64"),
            "expected camelCase 'audioBase64'"
        );
        assert!(
            obj.contains_key("audioMimeType"),
            "expected camelCase 'audioMimeType'"
        );
        assert!(
            obj.contains_key("allowedLanguages"),
            "expected camelCase 'allowedLanguages'"
        );
        assert!(
            obj.contains_key("systemPrompt"),
            "expected camelCase 'systemPrompt'"
        );
        assert!(
            obj.contains_key("maxTokens"),
            "expected camelCase 'maxTokens'"
        );
        assert!(
            obj.contains_key("dictionaryEntries"),
            "expected camelCase 'dictionaryEntries'"
        );
        assert!(
            obj.contains_key("snippetEntries"),
            "expected camelCase 'snippetEntries'"
        );
        assert!(obj.contains_key("rawMode"), "expected camelCase 'rawMode'");
        assert!(
            obj.contains_key("applyBacktrack"),
            "expected camelCase 'applyBacktrack'"
        );
        assert!(
            obj.contains_key("removeFillers"),
            "expected camelCase 'removeFillers'"
        );
        assert!(
            obj.contains_key("autoPunctuation"),
            "expected camelCase 'autoPunctuation'"
        );
        assert!(
            obj.contains_key("autoNumberedLists"),
            "expected camelCase 'autoNumberedLists'"
        );
        assert!(
            obj.contains_key("noiseSuppression"),
            "expected camelCase 'noiseSuppression'"
        );
        assert!(
            obj.contains_key("rawPcmBase64"),
            "expected camelCase 'rawPcmBase64'"
        );
        assert!(
            obj.contains_key("commandMode"),
            "expected camelCase 'commandMode'"
        );
        assert!(
            obj.contains_key("wakeWordEnabled"),
            "expected camelCase 'wakeWordEnabled'"
        );
        assert!(
            obj.contains_key("assistantName"),
            "expected camelCase 'assistantName'"
        );
        assert!(
            obj.contains_key("selectedText"),
            "expected camelCase 'selectedText'"
        );
        assert!(
            obj.contains_key("ttsEngine"),
            "expected camelCase 'ttsEngine'"
        );

        // Verify nested objects
        let piper = obj
            .get("piper")
            .expect("piper should exist")
            .as_object()
            .unwrap();
        assert!(piper.contains_key("speed"));
        assert!(piper.contains_key("quality"));
        assert!(piper.contains_key("emotion"));

        // Verify values
        assert_eq!(obj.get("apiKey").unwrap(), "sk-test");
        assert_eq!(obj.get("sttLocalMode").unwrap(), false);
        assert_eq!(obj.get("aiLocalMode").unwrap(), true);
        assert_eq!(obj.get("temperature").unwrap(), 0.5);
        assert_eq!(obj.get("maxTokens").unwrap(), 256);
    }

    #[test]
    fn ipc_request_missing_optional_fields_serializes_as_null() {
        let request = AssistantPipelineRequest {
            api_key: String::new(),
            api_base_url: None,
            stt_model: None,
            ai_model: None,
            stt_local_mode: None,
            ai_local_mode: None,
            local_ollama_base_url: None,
            local_ollama_model: None,
            local_stt_model: None,
            piper_path: None,
            audio_base64: String::new(),
            audio_mime_type: String::new(),
            stt_timeout_seconds: None,
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
            noise_suppression: None,
            raw_pcm_base64: None,
            command_mode: None,
            wake_word_enabled: None,
            assistant_name: None,
            selected_text: None,
            tts_engine: None,
            piper: None,
            voice_clone: None,
            ..Default::default()
        };

        let json = serde_json::to_value(&request).expect("should serialize");
        let obj = json.as_object().unwrap();

        // All optional fields should be null when None
        assert!(obj.get("apiBaseUrl").unwrap().is_null());
        assert!(obj.get("sttModel").unwrap().is_null());
        assert!(obj.get("aiModel").unwrap().is_null());
        assert!(obj.get("sttLocalMode").unwrap().is_null());
        assert!(obj.get("aiLocalMode").unwrap().is_null());
        assert!(obj.get("language").unwrap().is_null());
        assert!(obj.get("systemPrompt").unwrap().is_null());
        assert!(obj.get("temperature").unwrap().is_null());
        assert!(obj.get("piper").unwrap().is_null());
        assert!(obj.get("voiceClone").unwrap().is_null());
    }

    #[test]
    fn ipc_response_has_expected_camel_case_fields() {
        let response = AssistantPipelineResponse {
            mode: "dictation".to_string(),
            selection_rewrite: false,
            selection_pending: false,
            selection_context_cleared: false,
            selection_context_used: false,
            transcript: "Hello world".to_string(),
            assistant_response: "Hello world.".to_string(),
            audio_base64: String::new(),
            stt_latency_ms: 250,
            ai_latency_ms: 800,
            tts_latency_ms: 150,
            total_latency_ms: 1200,
            ..Default::default()
        };

        let json = serde_json::to_value(&response).expect("should serialize");
        let obj = json.as_object().expect("should be object");

        // Verify camelCase field names match TypeScript AssistantPipelineResponse
        assert!(obj.contains_key("mode"));
        assert!(
            obj.contains_key("selectionRewrite"),
            "expected camelCase 'selectionRewrite'"
        );
        assert!(
            obj.contains_key("selectionPending"),
            "expected camelCase 'selectionPending'"
        );
        assert!(
            obj.contains_key("selectionContextCleared"),
            "expected camelCase 'selectionContextCleared'"
        );
        assert!(
            obj.contains_key("selectionContextUsed"),
            "expected camelCase 'selectionContextUsed'"
        );
        assert!(obj.contains_key("transcript"));
        assert!(
            obj.contains_key("assistantResponse"),
            "expected camelCase 'assistantResponse'"
        );
        assert!(
            obj.contains_key("audioBase64"),
            "expected camelCase 'audioBase64'"
        );
        assert!(
            obj.contains_key("sttLatencyMs"),
            "expected camelCase 'sttLatencyMs'"
        );
        assert!(
            obj.contains_key("aiLatencyMs"),
            "expected camelCase 'aiLatencyMs'"
        );
        assert!(
            obj.contains_key("ttsLatencyMs"),
            "expected camelCase 'ttsLatencyMs'"
        );
        assert!(
            obj.contains_key("totalLatencyMs"),
            "expected camelCase 'totalLatencyMs'"
        );

        // Verify values
        assert_eq!(obj.get("mode").unwrap(), "dictation");
        assert_eq!(obj.get("sttLatencyMs").unwrap(), 250);
        assert_eq!(obj.get("totalLatencyMs").unwrap(), 1200);
    }

    #[test]
    fn ipc_stt_timeout_deserializes_and_is_clamped_at_the_boundary() {
        let request: AssistantPipelineRequest = serde_json::from_str(
            r#"{"apiKey":"k","audioBase64":"","audioMimeType":"audio/wav","sttTimeoutSeconds":15}"#,
        )
        .expect("should deserialize a stt timeout");
        assert_eq!(request.stt_timeout_seconds, Some(15));
        assert_eq!(
            resolve_stt_timeout(request.stt_timeout_seconds),
            std::time::Duration::from_secs(15)
        );

        // The frontend's bound is a hint; this arrives over IPC, so an
        // out-of-range value is clamped rather than trusted.
        let hostile: AssistantPipelineRequest = serde_json::from_str(
            r#"{"apiKey":"k","audioBase64":"","audioMimeType":"audio/wav","sttTimeoutSeconds":999999}"#,
        )
        .expect("should deserialize an out-of-range stt timeout");
        assert_eq!(
            resolve_stt_timeout(hostile.stt_timeout_seconds),
            std::time::Duration::from_secs(600)
        );
    }

    #[test]
    fn ipc_nested_entry_requests_serialize_correctly() {
        let request = AssistantPipelineRequest {
            api_key: "key".to_string(),
            api_base_url: Some("https://api.example.com".to_string()),
            stt_model: Some("model".to_string()),
            ai_model: Some("model".to_string()),
            stt_local_mode: Some(false),
            ai_local_mode: Some(false),
            local_ollama_base_url: None,
            local_ollama_model: None,
            local_stt_model: None,
            piper_path: None,
            audio_base64: String::new(),
            audio_mime_type: "audio/wav".to_string(),
            stt_timeout_seconds: None,
            language: None,
            allowed_languages: None,
            system_prompt: None,
            temperature: None,
            max_tokens: None,
            dictionary_entries: Some(vec![
                DictionaryEntryRequest {
                    source: "brb".to_string(),
                    target: "be right back".to_string(),
                },
                DictionaryEntryRequest {
                    source: "idk".to_string(),
                    target: "I don't know".to_string(),
                },
            ]),
            snippet_entries: Some(vec![SnippetEntryRequest {
                trigger: "gj".to_string(),
                expansion: "good job".to_string(),
            }]),
            raw_mode: None,
            apply_backtrack: None,
            remove_fillers: None,
            auto_punctuation: None,
            auto_numbered_lists: None,
            noise_suppression: None,
            raw_pcm_base64: None,
            command_mode: None,
            wake_word_enabled: None,
            assistant_name: None,
            selected_text: None,
            tts_engine: None,
            piper: None,
            voice_clone: None,
            ..Default::default()
        };

        let json = serde_json::to_value(&request).expect("should serialize");
        let entries = json.get("dictionaryEntries").unwrap().as_array().unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].get("source").unwrap(), "brb");
        assert_eq!(entries[0].get("target").unwrap(), "be right back");

        let snippets = json.get("snippetEntries").unwrap().as_array().unwrap();
        assert_eq!(snippets.len(), 1);
        assert_eq!(snippets[0].get("trigger").unwrap(), "gj");
        assert_eq!(snippets[0].get("expansion").unwrap(), "good job");
    }

    #[test]
    fn ipc_round_trip_preserves_option_vs_null_distinction() {
        // When frontend sends null for optional fields, Rust should deserialize as None
        let json_str = r#"{
        "apiKey": "test",
        "apiBaseUrl": null,
        "sttModel": null,
        "aiModel": null,
        "sttLocalMode": true,
        "aiLocalMode": true,
        "localOllamaBaseUrl": null,
        "localOllamaModel": null,
        "localSttModel": null,
        "piperPath": null,
        "audioBase64": "",
        "audioMimeType": "audio/wav",
        "language": null,
        "allowedLanguages": null,
        "systemPrompt": null,
        "temperature": null,
        "maxTokens": null,
        "dictionaryEntries": null,
        "snippetEntries": null,
        "rawMode": null,
        "applyBacktrack": null,
        "removeFillers": null,
        "autoPunctuation": null,
        "autoNumberedLists": null,
        "noiseSuppression": null,
        "rawPcmBase64": null,
        "commandMode": null,
        "wakeWordEnabled": null,
        "assistantName": null,
        "selectedText": null,
        "ttsEngine": null,
        "piper": null,
        "voiceClone": null
    }"#;

        let request: AssistantPipelineRequest =
            serde_json::from_str(json_str).expect("should deserialize from null-heavy JSON");

        // Verify that null fields become None
        assert!(request.api_base_url.is_none());
        assert!(request.stt_model.is_none());
        assert!(request.ai_model.is_none());
        assert_eq!(request.stt_local_mode, Some(true));
        assert_eq!(request.ai_local_mode, Some(true));
        assert!(request.local_ollama_model.is_none());
        assert!(request.local_stt_model.is_none());
        assert!(request.temperature.is_none());
        assert!(request.max_tokens.is_none());
        assert!(request.stt_timeout_seconds.is_none());
        assert!(request.system_prompt.is_none());
        assert!(request.dictionary_entries.is_none());
        assert!(request.piper.is_none());
    }
}
