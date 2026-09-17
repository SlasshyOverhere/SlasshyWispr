use log::{info, warn};
use reqwest::{multipart, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::{menu::MenuItem, AppHandle, Manager};

pub mod audio;
pub mod commands;
pub mod services;
pub mod constants;
pub mod pipeline;
pub mod platform;
pub mod security;
pub mod state;
pub mod updater;
use commands::{
    AssistantPipelineRequest, AssistantPipelineResponse, DictionaryEntryRequest,
    SnippetEntryRequest, StartupLocalSttWarmupTarget, TtsSetupState, capture_selected_text,
    check_for_app_update,
    clear_dictation_recordings, clone_coqui_voice, configure_launch_at_login,
    control_media_playback, deactivate_local_stt_model, delete_local_stt_model,
    download_and_install_app_update, download_local_stt_model, ensure_voice_model,
    fetch_local_stt_models, fetch_ollama_models, fetch_provider_models, get_assistant_info,
    get_coqui_status, get_dictation_recording, get_foreground_input_block_status,
    get_local_stt_download_status, get_local_stt_hardware_advice, get_local_stt_model_status,
    get_local_stt_runtime_state, get_tts_runtime_setup_status, get_ollama_status, install_ollama,
    launch_at_login_status, list_coqui_models, list_coqui_voices, list_dictation_recording_ids,
    list_dictation_recordings_stats, load_persisted_local_settings, log_client_event,
    mute_system_audio, open_local_stt_model_path, paste_clipboard_text, paste_text_via_clipboard,
    preview_coqui_voice, pull_ollama_model, save_dictation_recording, save_persisted_local_settings,
    set_clipboard_text, set_tray_update_available, setup_assistant_runtime, setup_coqui_runtime,
    run_assistant_pipeline, show_update_settings, start_tts_runtime_setup,
    toggle_main_window_visibility, validate_coqui, validate_piper, warmup_local_stt_model,
};
use state::AppState;
use audio::vad;

use pipeline::fs::*;
use pipeline::input::*;
use pipeline::log::*;
use pipeline::process::*;
use pipeline::refinement::{self, RefinementConfig, RefinementDictionaryEntry, RefinementSnippetEntry};
use pipeline::selection::*;
use pipeline::stt::*;
use pipeline::stt_download::*;
#[allow(unused_imports)]
use pipeline::response::normalize_assistant_response_text;
use constants::*;
use pipeline::routing::*;
use pipeline::tts::*;
use pipeline::daemon::*;
use pipeline::wake::*;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRect {
    pub position_x: i32,
    pub position_y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowVisibilityState {
    pub hidden: bool,
    pub last_rect: Option<WindowRect>,
    /// Tracks the minimize/restore transition. Set to true when the window
    /// enters the minimized state; cleared on the first Resized event after
    /// the user restores. Used to apply the saved rect on restore.
    pub was_minimized: bool,
}

impl WindowVisibilityState {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json(value: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(value)
    }
}

// Selection-edit types moved to pipeline::selection; native Parakeet runtime
// moved to audio::parakeet; Piper tuning cache moved to pipeline::tts.
static TRAY_UPDATE_ITEM: OnceLock<MenuItem<tauri::Wry>> = OnceLock::new();

#[cfg(target_os = "windows")]
pub(crate) mod win32_native {
    use windows_sys::Win32::Foundation::RECT;

    #[repr(C)]
    #[allow(non_snake_case)]
    pub struct MONITORINFO {
        pub cbSize: u32,
        pub rcMonitor: RECT,
        pub rcWork: RECT,
        pub dwFlags: u32,
    }

    extern "system" {
        pub fn GetMonitorInfoW(hMonitor: isize, lpmi: *mut MONITORINFO) -> i32;
        pub fn MonitorFromWindow(hwnd: isize, dwFlags: u32) -> isize;
    }
}









#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssistantInfoResponse {
    app_version: String,
    base_url: &'static str,
    stt_model: &'static str,
    ai_model: &'static str,
    piper_installed: bool,
    piper_path: String,
    voice_installed: bool,
    voice_model_path: String,
    voice_config_path: String,
    coqui_installed: bool,
    coqui_python_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderModelsRequest {
    api_key: String,
    api_base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaModelsRequest {
    base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaPullRequest {
    base_url: Option<String>,
    model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaPullResponse {
    base_url: String,
    model: String,
    ok: bool,
    status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OllamaStatusRequest {
    base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaStatusResponse {
    installed: bool,
    running: bool,
    version: String,
    details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderModelsResponse {
    base_url: String,
    models: Vec<String>,
}



























// normalize_api_key_secret has been moved to pipeline::routing.

#[cfg(test)]
mod tests {
    // validates_safe_update_urls moved to updater::tests
    use super::*;


    // TTS normalize tests live in pipeline::tts::normalize::tests.

    #[test]
    fn normalizes_latex_heavy_assistant_responses() {
        let input = r#"\(x = 37.5\)

Explanation:

\[
\left(\frac{x}{3}\right) \times 4 + 90 - 40 = 100
\]

\[
\frac{4x}{3} + 50 = 100 \;\Longrightarrow\; \frac{4x}{3} = 50 \;\Longrightarrow\; x = 37.5
\]"#;
        let normalized = normalize_assistant_response_text(input);

        assert!(normalized.contains("x = 37.5"));
        assert!(normalized.contains("((x) / (3)) x 4 + 90 - 40 = 100"));
        assert!(normalized.contains("(4x) / (3) + 50 = 100 => (4x) / (3) = 50 => x = 37.5"));
        assert!(!normalized.contains("\\["));
        assert!(!normalized.contains("\\frac"));
        assert!(!normalized.contains("\\Longrightarrow"));
    }

    #[test]
    fn detects_repetitive_transcript_noise() {
        let noisy = "ලලලලලලලලලලලලලලලලලලලලලලලලලලලල";
        assert!(looks_like_repetitive_transcript_noise(noisy, Some("en")));
    }

    #[test]
    fn rejects_script_mismatch_for_latin_language_hint() {
        let transcript = "සාරි සාරි සාරි සාරි සාරි";
        assert!(looks_like_repetitive_transcript_noise(
            transcript,
            Some("en")
        ));
    }

    #[test]
    fn accepts_normal_english_transcript() {
        let transcript = "Hey Lily what do you think about India today";
        assert!(!looks_like_repetitive_transcript_noise(
            transcript,
            Some("en")
        ));
    }

    #[test]
    fn parses_selection_edit_decision_json() {
        let raw =
            r#"{"action":"replace_now","rewrite":"Improved sentence.","message":"Applying edit."}"#;
        let decision = parse_selection_edit_decision(raw).expect("decision should parse");
        assert_eq!(decision.action, SelectionEditAction::ReplaceNow);
        assert_eq!(decision.rewrite_text, "Improved sentence.");
        assert_eq!(decision.message, "Applying edit.");
    }

    #[test]
    fn detects_selection_confirmation_intents() {
        assert!(is_affirmative_selection_confirmation("yes replace it"));
        assert!(is_affirmative_selection_confirmation("go ahead and apply"));
        assert!(is_negative_selection_confirmation("no cancel that"));
        assert!(is_negative_selection_confirmation("don't do that"));
        assert!(!is_affirmative_selection_confirmation("don't replace it"));
    }

    #[test]
    fn flags_suspicious_short_rewrite_for_confirmation() {
        let selected = "This is a fairly detailed paragraph that should not be replaced with a tiny generic output because it would lose meaning for the user.";
        let suspicious = "Looks good.";
        assert!(is_rewrite_suspicious(
            "make this better",
            selected,
            suspicious
        ));
        assert!(!is_rewrite_suspicious(
            "summarize this",
            selected,
            "A concise summary."
        ));
    }

    #[test]
    fn detects_edit_intent_for_selection_guard() {
        assert!(seems_like_selection_edit_instruction(
            "make this review better"
        ));
        assert!(seems_like_selection_edit_instruction("rewrite this"));
        assert!(!seems_like_selection_edit_instruction(
            "which laptop is better"
        ));
        assert!(!seems_like_selection_edit_instruction(
            "what is the weather"
        ));
    }

    #[test]
    fn detects_draft_generation_instruction_for_compose_guard() {
        assert!(seems_like_draft_generation_instruction(
            "create an email for sick leave"
        ));
        assert!(seems_like_draft_generation_instruction(
            "write a follow up letter"
        ));
        assert!(!seems_like_draft_generation_instruction(
            "what is email marketing"
        ));
    }

    #[test]
    fn flags_incomplete_draft_outputs() {
        let incomplete =
            "Subject: Sick Leave - Unable to Attend Work Tomorrow\n\nDear [Boss's Name],\n\nI am";
        assert!(looks_like_incomplete_draft_output(incomplete));

        let complete = "Subject: Sick Leave Request for Tomorrow\n\nDear Manager,\n\nI am feeling unwell and will not be able to attend work tomorrow. I will monitor urgent messages and hand over critical items before the day starts.\n\nBest regards,\nSuman";
        assert!(!looks_like_incomplete_draft_output(complete));
    }












    // ===== SINGLE_LINE AND CLIP_TEXT =====







    // ===== MIME EXTENSION MAPPING =====

    #[test]
    fn mime_to_extension_handles_common_types() {
        assert_eq!(services::transcribe::mime_to_extension("audio/webm"), "webm");
        assert_eq!(services::transcribe::mime_to_extension("audio/wav"), "wav");
        assert_eq!(services::transcribe::mime_to_extension("audio/ogg"), "ogg");
        assert_eq!(services::transcribe::mime_to_extension("audio/mp4"), "m4a");
        assert_eq!(services::transcribe::mime_to_extension("audio/mpeg"), "mp3");
        assert_eq!(services::transcribe::mime_to_extension("audio/mp3"), "mp3");
    }

    #[test]
    fn mime_to_extension_defaults_to_webm() {
        assert_eq!(services::transcribe::mime_to_extension("audio/unknown"), "webm");
        assert_eq!(services::transcribe::mime_to_extension("application/octet-stream"), "webm");
    }

    // ===== SELECTION EDIT DECISION =====

    #[test]
    fn parse_selection_edit_decision_rejects_invalid_json() {
        assert!(parse_selection_edit_decision("not json").is_err());
    }

    #[test]
    fn parse_selection_edit_decision_unknown_action_defaults_to_ask_confirm() {
        let raw = r#"{"action":"unknown","rewrite":"text","message":"msg"}"#;
        let decision = parse_selection_edit_decision(raw).unwrap();
        assert_eq!(decision.action, SelectionEditAction::AskConfirm);
    }

    // ===== INCOMPLETE DRAFT DETECTION =====

    #[test]
    fn looks_like_incomplete_draft_detects_bracket_placeholder() {
        let text = "Dear [Manager's Name], I am";
        assert!(looks_like_incomplete_draft_output(text));
    }

    #[test]
    fn looks_like_incomplete_draft_short_text_is_not_incomplete() {
        let text = "Yes.";
        assert!(!looks_like_incomplete_draft_output(text));
    }

    // ===== SELECTION EDIT / DRAFT INSTRUCTION DETECTION =====

    #[test]
    fn seems_like_draft_instruction_rejects_questions() {
        assert!(!seems_like_draft_generation_instruction("what is the capital of France"));
        assert!(!seems_like_draft_generation_instruction("who is the president"));
    }

    #[test]
    fn seems_like_selection_edit_rejects_factual_questions() {
        assert!(!seems_like_selection_edit_instruction("what time is it"));
        assert!(!seems_like_selection_edit_instruction("how does TCP work"));
    }

    // ===== REWRITE SUSPICION DETECTION =====

    #[test]
    fn is_rewrite_suspicious_detects_overshortening() {
        // "summarize this" is in instruction_allows_short_rewrite, so returns false
        let long_text = "This is a very detailed explanation of how the system works with many paragraphs and specifics and a lot of content to analyze.";
        let short_rewrite = "Ok.";
        // "make this better" is NOT in instruction_allows_short_rewrite
        assert!(is_rewrite_suspicious("make this better", long_text, short_rewrite));
    }

    #[test]
    fn is_rewrite_suspicious_allows_similar_length_output() {
        let text = "Please improve this text.";
        let rewrite = "Please improve this text now.";
        assert!(!is_rewrite_suspicious("improve", text, rewrite));
    }

    // ===== SELECTION CONFIRMATION DETECTION =====

    #[test]
    fn is_affirmative_detection_handles_various_intents() {
        assert!(is_affirmative_selection_confirmation("yes"));
        assert!(is_affirmative_selection_confirmation("apply it"));
        assert!(is_affirmative_selection_confirmation("do it"));
    }

    #[test]
    fn is_negative_detection_handles_various_intents() {
        assert!(is_negative_selection_confirmation("no"));
        assert!(is_negative_selection_confirmation("skip this"));
        assert!(is_negative_selection_confirmation("cancel"));
    }

    // ===== ONLINE AI REASONING DETECTION =====







    // ===== IPC SERIALIZATION CONTRACT =====
    // These tests verify that the Rust serde configuration matches
    // the TypeScript type definitions for the IPC request/response types.
    // If these tests fail, the Rust ↔ TypeScript contract has drifted.

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
            coqui: None,
        };

        let json = serde_json::to_value(&request).expect("should serialize");
        let obj = json.as_object().expect("should be object");

        // Verify camelCase field names match the TypeScript types
        assert!(obj.contains_key("apiKey"), "expected camelCase 'apiKey'");
        assert!(obj.contains_key("apiBaseUrl"), "expected camelCase 'apiBaseUrl'");
        assert!(obj.contains_key("sttModel"), "expected camelCase 'sttModel'");
        assert!(obj.contains_key("aiModel"), "expected camelCase 'aiModel'");
        assert!(obj.contains_key("sttLocalMode"), "expected camelCase 'sttLocalMode'");
        assert!(obj.contains_key("aiLocalMode"), "expected camelCase 'aiLocalMode'");
        assert!(obj.contains_key("localOllamaBaseUrl"), "expected camelCase 'localOllamaBaseUrl'");
        assert!(obj.contains_key("localOllamaModel"), "expected camelCase 'localOllamaModel'");
        assert!(obj.contains_key("localSttModel"), "expected camelCase 'localSttModel'");
        assert!(obj.contains_key("piperPath"), "expected camelCase 'piperPath'");
        assert!(obj.contains_key("audioBase64"), "expected camelCase 'audioBase64'");
        assert!(obj.contains_key("audioMimeType"), "expected camelCase 'audioMimeType'");
        assert!(obj.contains_key("allowedLanguages"), "expected camelCase 'allowedLanguages'");
        assert!(obj.contains_key("systemPrompt"), "expected camelCase 'systemPrompt'");
        assert!(obj.contains_key("maxTokens"), "expected camelCase 'maxTokens'");
        assert!(obj.contains_key("dictionaryEntries"), "expected camelCase 'dictionaryEntries'");
        assert!(obj.contains_key("snippetEntries"), "expected camelCase 'snippetEntries'");
        assert!(obj.contains_key("rawMode"), "expected camelCase 'rawMode'");
        assert!(obj.contains_key("applyBacktrack"), "expected camelCase 'applyBacktrack'");
        assert!(obj.contains_key("removeFillers"), "expected camelCase 'removeFillers'");
        assert!(obj.contains_key("autoPunctuation"), "expected camelCase 'autoPunctuation'");
        assert!(obj.contains_key("autoNumberedLists"), "expected camelCase 'autoNumberedLists'");
        assert!(obj.contains_key("noiseSuppression"), "expected camelCase 'noiseSuppression'");
        assert!(obj.contains_key("rawPcmBase64"), "expected camelCase 'rawPcmBase64'");
        assert!(obj.contains_key("commandMode"), "expected camelCase 'commandMode'");
        assert!(obj.contains_key("wakeWordEnabled"), "expected camelCase 'wakeWordEnabled'");
        assert!(obj.contains_key("assistantName"), "expected camelCase 'assistantName'");
        assert!(obj.contains_key("selectedText"), "expected camelCase 'selectedText'");
        assert!(obj.contains_key("ttsEngine"), "expected camelCase 'ttsEngine'");

        // Verify nested objects
        let piper = obj.get("piper").expect("piper should exist").as_object().unwrap();
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
            coqui: None,
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
        assert!(obj.get("coqui").unwrap().is_null());
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
        };

        let json = serde_json::to_value(&response).expect("should serialize");
        let obj = json.as_object().expect("should be object");

        // Verify camelCase field names match TypeScript AssistantPipelineResponse
        assert!(obj.contains_key("mode"));
        assert!(obj.contains_key("selectionRewrite"), "expected camelCase 'selectionRewrite'");
        assert!(obj.contains_key("selectionPending"), "expected camelCase 'selectionPending'");
        assert!(obj.contains_key("selectionContextCleared"), "expected camelCase 'selectionContextCleared'");
        assert!(obj.contains_key("selectionContextUsed"), "expected camelCase 'selectionContextUsed'");
        assert!(obj.contains_key("transcript"));
        assert!(obj.contains_key("assistantResponse"), "expected camelCase 'assistantResponse'");
        assert!(obj.contains_key("audioBase64"), "expected camelCase 'audioBase64'");
        assert!(obj.contains_key("sttLatencyMs"), "expected camelCase 'sttLatencyMs'");
        assert!(obj.contains_key("aiLatencyMs"), "expected camelCase 'aiLatencyMs'");
        assert!(obj.contains_key("ttsLatencyMs"), "expected camelCase 'ttsLatencyMs'");
        assert!(obj.contains_key("totalLatencyMs"), "expected camelCase 'totalLatencyMs'");

        // Verify values
        assert_eq!(obj.get("mode").unwrap(), "dictation");
        assert_eq!(obj.get("sttLatencyMs").unwrap(), 250);
        assert_eq!(obj.get("totalLatencyMs").unwrap(), 1200);
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
            coqui: None,
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
            "coqui": null
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
        assert!(request.system_prompt.is_none());
        assert!(request.dictionary_entries.is_none());
        assert!(request.piper.is_none());
    }

}

pub fn run() {
    let app_state = AppState::new().expect("failed to initialize app state");
    let tts_setup_state = TtsSetupState::default();
    let start_in_tray =
        std::env::args().any(|arg| arg.eq_ignore_ascii_case(STARTUP_ARG_START_IN_TRAY));

    let mut builder = tauri::Builder::default();
    // window-state plugin — needs to be added before .manage()
    builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            info!(
                "[app.single-instance] secondary launch blocked args={:?}",
                args
            );
            if args
                .iter()
                .any(|a| a.eq_ignore_ascii_case(STARTUP_ARG_START_IN_TRAY))
            {
                info!("[app.single-instance] --start-in-tray passed; respecting hidden state");
                return;
            }
            commands::windows::show_main_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(app_state)
        .manage(tts_setup_state)
        .setup(move |app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
            }

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            let app_handle = app.handle().clone();
            commands::windows::build_tray_icon(&app_handle)?;
            ensure_local_stt_daemon_idle_sweeper();
            services::startup::start_local_stt_boot_warmup(app_handle.clone());

            if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
                let app_handle_for_close = app_handle.clone();
                let app_handle_for_resize = app_handle.clone();
                let main_window_for_resize = main_window.clone();
                main_window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            commands::windows::hide_main_window_to_tray(&app_handle_for_close);
                        }
                        tauri::WindowEvent::Resized(_) => {
                            // Track minimize/restore transitions. On every
                            // resize while the window is NOT minimized, capture
                            // the current rect into WindowVisibilityState so we
                            // can restore to that exact size+position after the
                            // user restores from a taskbar click.
                            //
                            // When the transition is minimized -> not-minimized
                            // (i.e. user restored from taskbar), apply the saved
                            // pre-minimize rect via set_position + set_size.
                            let minimized_now = main_window_for_resize
                                .is_minimized()
                                .unwrap_or(false);

                            if let Some(state) =
                                app_handle_for_resize.try_state::<AppState>()
                            {
                                if let Ok(mut visibility) =
                                    state.window_visibility.lock()
                                {
                                    if minimized_now {
                                        // Mark that we just entered the
                                        // minimized state. The "last_rect"
                                        // already holds the pre-minimize rect
                                        // because the previous Resized events
                                        // kept updating it.
                                        visibility.was_minimized = true;
                                    } else if visibility.was_minimized {
                                        // Transition minimized -> restored.
                                        // Restore to the saved rect.
                                        visibility.was_minimized = false;
                                        let rect = visibility.last_rect;
                                        drop(visibility);
                                        if let Some(r) = rect {
                                            if let Err(error) = main_window_for_resize
                                                .set_position(
                                                    tauri::PhysicalPosition {
                                                        x: r.position_x,
                                                        y: r.position_y,
                                                    },
                                                )
                                            {
                                                warn!("[tray] failed to restore position on un-minimize: {error}");
                                            }
                                            if let Err(error) = main_window_for_resize
                                                .set_size(tauri::PhysicalSize {
                                                    width: r.width,
                                                    height: r.height,
                                                })
                                            {
                                                warn!("[tray] failed to restore size on un-minimize: {error}");
                                            }
                                        }
                                    } else {
                                        // Plain resize while visible. Update
                                        // the saved rect.
                                        visibility.last_rect =
                                            Some(commands::windows::capture_rect(&main_window_for_resize));
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                });
            } else {
                warn!("[tray] main window not found for close-to-tray hook");
            }

            // Clean up stale installer files from previous update attempts
            if let Ok(app_data) = app.path().app_data_dir() {
                let updates_dir = app_data.join("updates");
                if updates_dir.is_dir() {
                    if let Ok(entries) = fs::read_dir(&updates_dir) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if path.extension().is_some_and(|ext| ext == "exe" || ext == "msi") {
                                let _ = fs::remove_file(&path);
                                info!(
                                    "[updater] cleaned stale installer: {}",
                                    clip_text(&path.to_string_lossy(), 200)
                                );
                            }
                        }
                    }
                }
            }

            if start_in_tray {
                commands::windows::hide_main_window_to_tray(&app_handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_client_event,
            check_for_app_update,
            download_and_install_app_update,
            load_persisted_local_settings,
            save_persisted_local_settings,
            save_dictation_recording,
            list_dictation_recordings_stats,
            list_dictation_recording_ids,
            clear_dictation_recordings,
            get_dictation_recording,
            capture_selected_text,
            set_clipboard_text,
            configure_launch_at_login,
            launch_at_login_status,
            paste_clipboard_text,
            paste_text_via_clipboard,
            control_media_playback,
            mute_system_audio,
            get_foreground_input_block_status,
            get_assistant_info,
            fetch_provider_models,
            fetch_ollama_models,
            pull_ollama_model,
            get_ollama_status,
            install_ollama,
            fetch_local_stt_models,
            download_local_stt_model,
            get_local_stt_download_status,
            delete_local_stt_model,
            open_local_stt_model_path,
            get_local_stt_model_status,
            warmup_local_stt_model,
            deactivate_local_stt_model,
            get_local_stt_runtime_state,
            get_local_stt_hardware_advice,
            setup_assistant_runtime,
            ensure_voice_model,
            validate_piper,
            get_coqui_status,
            setup_coqui_runtime,
            validate_coqui,
            list_coqui_voices,
            list_coqui_models,
            clone_coqui_voice,
            preview_coqui_voice,
            start_tts_runtime_setup,
            get_tts_runtime_setup_status,
            run_assistant_pipeline,
            show_update_settings,
            set_tray_update_available,
            toggle_main_window_visibility,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
