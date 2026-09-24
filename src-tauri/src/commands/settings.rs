//! Settings persistence commands — Phase 6c thin-adapter extraction.
//!
//! Moved verbatim from lib.rs: load/save commands. Keyring/crypto/path
//! helpers stay in lib.rs for now (shared with launch-at-login + STT
//! warmup paths); they move with services in Phase 7.

use std::fs;

use log::info;
use serde_json::Value;
use tauri::AppHandle;

use crate::commands::ipc_types::{
    MaxTokensBoundsResponse, SttTimeoutBoundsResponse, TemperatureBoundsResponse,
};
use crate::commands::pipeline::{
    MAX_TOKENS_DEFAULT, MAX_TOKENS_MAX, MAX_TOKENS_MIN, TEMPERATURE_DEFAULT, TEMPERATURE_MAX,
    TEMPERATURE_MIN,
};
use crate::pipeline::routing::{validate_api_base_url, validate_local_ollama_base_url};
use crate::security;
use crate::services::settings_store::{
    persisted_settings_path, restore_settings_payload, secure_settings_payload,
};
use crate::services::transcribe::{
    STT_TIMEOUT_DEFAULT, STT_TIMEOUT_MAX_SECS, STT_TIMEOUT_MIN_SECS,
};
#[tauri::command]
pub(crate) fn stt_timeout_bounds() -> SttTimeoutBoundsResponse {
    SttTimeoutBoundsResponse {
        default_seconds: STT_TIMEOUT_DEFAULT.as_secs(),
        min_seconds: STT_TIMEOUT_MIN_SECS,
        max_seconds: STT_TIMEOUT_MAX_SECS,
    }
}

#[tauri::command]
pub(crate) fn temperature_bounds() -> TemperatureBoundsResponse {
    TemperatureBoundsResponse {
        default_temperature: TEMPERATURE_DEFAULT,
        min_temperature: TEMPERATURE_MIN,
        max_temperature: TEMPERATURE_MAX,
    }
}

#[tauri::command]
pub(crate) fn max_tokens_bounds() -> MaxTokensBoundsResponse {
    MaxTokensBoundsResponse {
        default_tokens: MAX_TOKENS_DEFAULT,
        min_tokens: MAX_TOKENS_MIN,
        max_tokens: MAX_TOKENS_MAX,
    }
}

#[tauri::command]
pub(crate) async fn load_persisted_local_settings(app: AppHandle) -> Result<String, String> {
    let settings_path = persisted_settings_path(&app)?;
    if !settings_path.exists() {
        info!("[settings] load skipped because settings file is missing");
        return Ok(String::new());
    }

    let raw = fs::read_to_string(&settings_path).map_err(|error| {
        format!(
            "Failed to read persisted settings '{}': {error}",
            settings_path.display()
        )
    })?;
    info!(
        "[settings] load path='{}' bytes={}",
        settings_path.display(),
        raw.len()
    );

    restore_settings_payload(&raw)
}

#[tauri::command]
pub(crate) async fn save_persisted_local_settings(
    app: AppHandle,
    payload: String,
) -> Result<(), String> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return Err("Settings payload is empty.".to_string());
    }

    let parsed = serde_json::from_str::<Value>(trimmed)
        .map_err(|error| format!("Settings payload is not valid JSON: {error}"))?;
    if !parsed.is_object() {
        return Err("Settings payload must be a JSON object.".to_string());
    }

    validate_settings_payload(&parsed)?;

    info!("[settings] save requested bytes={}", trimmed.len());
    let secured_payload = secure_settings_payload(trimmed)?;

    let settings_path = persisted_settings_path(&app)?;
    fs::write(&settings_path, secured_payload.as_bytes()).map_err(|error| {
        format!(
            "Failed to write persisted settings '{}': {error}",
            settings_path.display()
        )
    })?;
    info!(
        "[settings] save path='{}' bytes={}",
        settings_path.display(),
        secured_payload.len()
    );
    Ok(())
}

/// Central backend settings validator (F-021). Agent 2 calls this on the
/// pipeline path too (see NEEDS). Length caps + enum allowlists + URL shape.
/// URL checks reuse the routing validators so messages match everywhere.
pub(crate) fn validate_settings_payload(parsed: &serde_json::Value) -> Result<(), String> {
    let Some(obj) = parsed.as_object() else {
        return Ok(());
    };
    let capped = |key: &str, max: usize| -> Result<(), String> {
        if let Some(value) = obj.get(key).and_then(|v| v.as_str()) {
            security::validate_text_input(value, max, key)
                .map(|_| ())
                .map_err(|error| format!("Invalid {key}: {error}"))?;
        }
        Ok(())
    };
    capped("apiKey", 4096)?;
    capped("apiBaseUrl", 2048)?;
    capped("sttModelName", 256)?;
    capped("aiModelName", 256)?;
    capped("localOllamaBaseUrl", 2048)?;
    capped("localOllamaModel", 256)?;
    capped("localSttModel", 256)?;
    capped("systemPrompt", 8000)?;
    capped("assistantName", 128)?;
    capped("piperPath", 1024)?;
    capped("microphoneDeviceId", 256)?;
    capped("pushToTalkHotkey", 128)?;
    capped("commandHotkey", 128)?;
    capped("dictationLanguage", 64)?;

    let allowed = |key: &str, values: &[&str]| -> Result<(), String> {
        if let Some(value) = obj.get(key).and_then(|v| v.as_str()) {
            if !value.trim().is_empty() && !values.contains(&value) {
                return Err(format!("Invalid {key}: '{value}'."));
            }
        }
        Ok(())
    };
    // Mirrors src/types.ts unions (Agent 3 owns the TS side; keep in sync).
    allowed("runtimeMode", &["online", "local"])?;
    allowed("sttRuntimeMode", &["online", "local"])?;
    allowed("aiRuntimeMode", &["online", "local"])?;
    allowed("captureMode", &["single-tap", "push-to-talk"])?;
    allowed("themeMode", &["system", "dark", "light", "mono"])?;
    allowed(
        "styleProfile",
        &["adaptive", "professional", "casual", "concise", "developer"],
    )?;
    allowed("ttsEngine", &["piper", "zipvoice"])?;
    allowed("dictationLanguageMode", &["single", "multiple"])?;
    allowed("piperQuality", &["fast", "balanced", "high"])?;
    allowed(
        "piperEmotion",
        &["neutral", "calm", "happy", "excited", "serious", "sad"],
    )?;

    if let Some(temperature) = obj.get("temperature").and_then(|v| v.as_f64()) {
        // The same range the request path clamps to, so a stored value cannot be
        // accepted here and quietly changed on the way to the model.
        if !(TEMPERATURE_MIN..=TEMPERATURE_MAX).contains(&temperature) {
            return Err(format!(
                "Invalid temperature: must be between {TEMPERATURE_MIN} and {TEMPERATURE_MAX}."
            ));
        }
    }
    if let Some(max_tokens) = obj.get("maxTokens").and_then(|v| v.as_u64()) {
        if max_tokens == 0 || max_tokens > 128_000 {
            return Err("Invalid maxTokens: must be between 1 and 128000.".to_string());
        }
    }
    if let Some(stt_timeout_secs) = obj.get("sttTimeoutSeconds").and_then(|v| v.as_u64()) {
        if stt_timeout_secs == 0 || stt_timeout_secs > 86_400 {
            return Err("Invalid sttTimeoutSeconds: must be between 1 and 86400.".to_string());
        }
    }

    if obj
        .get("apiBaseUrl")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_some()
    {
        validate_api_base_url(obj.get("apiBaseUrl").and_then(|v| v.as_str()))
            .map(|_| ())
            .map_err(|error| format!("Invalid apiBaseUrl: {error}"))?;
    }
    if obj
        .get("localOllamaBaseUrl")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .is_some()
    {
        validate_local_ollama_base_url(obj.get("localOllamaBaseUrl").and_then(|v| v.as_str()))
            .map(|_| ())
            .map_err(|error| format!("Invalid localOllamaBaseUrl: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        max_tokens_bounds, stt_timeout_bounds, temperature_bounds, validate_settings_payload,
    };
    use crate::commands::pipeline::{resolve_max_tokens, resolve_temperature};
    use crate::services::transcribe::resolve_stt_timeout;

    #[test]
    fn advertised_stt_timeout_bounds_match_the_clamp() {
        // The frontend renders these numbers and the backend enforces them, so
        // they have to come from the same constants or the UI lies.
        let bounds = stt_timeout_bounds();
        assert_eq!(
            resolve_stt_timeout(None).as_secs(),
            bounds.default_seconds,
            "the advertised default must be the one the clamp applies"
        );
        assert_eq!(
            resolve_stt_timeout(Some(bounds.min_seconds)).as_secs(),
            bounds.min_seconds
        );
        assert_eq!(
            resolve_stt_timeout(Some(bounds.max_seconds)).as_secs(),
            bounds.max_seconds
        );
        assert!(bounds.min_seconds < bounds.max_seconds);
    }

    #[test]
    fn advertised_temperature_bounds_match_the_clamp() {
        let bounds = temperature_bounds();
        assert_eq!(
            resolve_temperature(None),
            bounds.default_temperature as f32,
            "the advertised default must be the one the clamp applies"
        );
        assert_eq!(
            resolve_temperature(Some(-1.0)),
            bounds.min_temperature as f32
        );
        assert_eq!(
            resolve_temperature(Some(9.0)),
            bounds.max_temperature as f32
        );
        assert!(bounds.min_temperature < bounds.max_temperature);
    }

    #[test]
    fn advertised_max_tokens_bounds_match_the_clamp() {
        let bounds = max_tokens_bounds();
        assert_eq!(
            resolve_max_tokens(None),
            bounds.default_tokens,
            "the advertised default must be the one the clamp applies"
        );
        assert_eq!(
            resolve_max_tokens(Some(bounds.min_tokens)),
            bounds.min_tokens
        );
        assert_eq!(
            resolve_max_tokens(Some(bounds.max_tokens)),
            bounds.max_tokens
        );
        assert!(bounds.min_tokens < bounds.max_tokens);
    }

    fn payload(json: serde_json::Value) -> serde_json::Value {
        json
    }

    #[test]
    fn rejects_plain_http_api_base_url() {
        let err = validate_settings_payload(&payload(serde_json::json!({
            "apiBaseUrl": "http://api.example.com/v1"
        })))
        .expect_err("http cloud url must fail");
        assert!(err.contains("apiBaseUrl"), "{err}");
    }

    #[test]
    fn rejects_metadata_ip_api_base_url() {
        let err = validate_settings_payload(&payload(serde_json::json!({
            "apiBaseUrl": "https://169.254.169.254/latest/meta-data/"
        })))
        .expect_err("metadata IP must fail");
        assert!(err.contains("not allowed"), "{err}");
    }

    #[test]
    fn rejects_bad_enum_and_range() {
        let err = validate_settings_payload(&payload(serde_json::json!({
            "ttsEngine": "coqui"
        })))
        .expect_err("enum must fail");
        assert!(err.contains("ttsEngine"), "{err}");
        let err = validate_settings_payload(&payload(serde_json::json!({
            "temperature": 9.0
        })))
        .expect_err("range must fail");
        assert!(err.contains("temperature"), "{err}");
    }

    #[test]
    fn rejects_zero_stt_timeout() {
        let err = validate_settings_payload(&payload(serde_json::json!({
            "sttTimeoutSeconds": 0
        })))
        .expect_err("a zero stt timeout must fail");
        assert!(err.contains("sttTimeoutSeconds"), "{err}");
    }

    #[test]
    fn accepts_valid_payload() {
        validate_settings_payload(&payload(serde_json::json!({
            "apiBaseUrl": "https://api.example.com/v1",
            "localOllamaBaseUrl": "http://127.0.0.1:11434",
            "ttsEngine": "piper",
            "temperature": 0.7,
            "maxTokens": 800,
            "sttTimeoutSeconds": 120
        })))
        .expect("valid payload passes");
    }
}
