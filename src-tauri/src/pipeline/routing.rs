//! Pipeline routing and configuration.
//!
//! This module owns the logic for determining how a voice pipeline request
//! should be routed across online/offline STT, AI, and TTS backends.
//!
//! It is pure — no Tauri, no network, no filesystem, no runtime state.

use crate::constants::*;

// ===== Types =====

/// Routing-relevant subset of the pipeline request.
/// This avoids coupling the routing module to the full Tauri IPC type.
#[derive(Clone)]
pub struct PipelineRoutingInput {
    pub api_key: String,
    pub api_base_url: Option<String>,
    pub stt_model: Option<String>,
    pub ai_model: Option<String>,
    pub stt_local_mode: Option<bool>,
    pub ai_local_mode: Option<bool>,
    pub local_ollama_base_url: Option<String>,
    pub local_ollama_model: Option<String>,
    pub local_stt_model: Option<String>,
}

/// The resolved STT backend configuration.
#[derive(Clone)]
pub enum SttModeConfig {
    Online {
        api_key: String,
        api_base_url: String,
        stt_model: String,
    },
    Local(LocalSttConfig),
}

/// Configuration for local STT.
#[derive(Debug, Clone)]
pub struct LocalSttConfig {
    pub stt_model: String,
}

/// The resolved AI backend configuration.
#[derive(Clone)]
pub enum AiModeConfig {
    Online {
        api_key: String,
        api_base_url: String,
        ai_model: String,
    },
    Local(LocalAiConfig),
}

/// Configuration for local AI (Ollama).
#[derive(Debug, Clone)]
pub struct LocalAiConfig {
    pub ollama_base_url: String,
    pub ollama_model: Option<String>,
}

// ponytail: manual redacting Debugs; upgrade to a secrets wrapper type if
// key-holding structs multiply.
impl std::fmt::Debug for PipelineRoutingInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PipelineRoutingInput")
            .field("api_key", &"[REDACTED]")
            .field("api_base_url", &self.api_base_url)
            .field("stt_model", &self.stt_model)
            .field("ai_model", &self.ai_model)
            .field("stt_local_mode", &self.stt_local_mode)
            .field("ai_local_mode", &self.ai_local_mode)
            .field("local_ollama_base_url", &self.local_ollama_base_url)
            .field("local_ollama_model", &self.local_ollama_model)
            .field("local_stt_model", &self.local_stt_model)
            .finish()
    }
}

impl std::fmt::Debug for SttModeConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Online {
                api_key: _,
                api_base_url,
                stt_model,
            } => f
                .debug_struct("SttModeConfig::Online")
                .field("api_key", &"[REDACTED]")
                .field("api_base_url", api_base_url)
                .field("stt_model", stt_model)
                .finish(),
            Self::Local(config) => f.debug_tuple("SttModeConfig::Local").field(config).finish(),
        }
    }
}

impl std::fmt::Debug for AiModeConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Online {
                api_key: _,
                api_base_url,
                ai_model,
            } => f
                .debug_struct("AiModeConfig::Online")
                .field("api_key", &"[REDACTED]")
                .field("api_base_url", api_base_url)
                .field("ai_model", ai_model)
                .finish(),
            Self::Local(config) => f.debug_tuple("AiModeConfig::Local").field(config).finish(),
        }
    }
}

/// The fully resolved pipeline mode configuration.
#[derive(Debug, Clone)]
pub struct PipelineModeConfig {
    pub stt: SttModeConfig,
    pub ai: AiModeConfig,
}

// ===== Normalization helpers =====

/// Strip control characters and trim whitespace from an API key.
pub fn normalize_api_key_secret(raw: &str) -> String {
    raw.chars()
        .filter(|character| !character.is_control())
        .collect::<String>()
        .trim()
        .to_string()
}

/// Trim, filter empties, and return a clean model name.
pub fn normalize_model_name(raw: Option<&str>) -> String {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_default()
}

/// Hosts that never belong in an outbound API base URL.
fn is_blocked_url_host(host: &str) -> bool {
    let lower = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if lower.is_empty() {
        return true;
    }
    if lower == "169.254.169.254" || lower == "100.100.100.200" || lower == "fd00:ec2::254" {
        return true;
    }
    if let Some(v4) = lower.split('%').next() {
        let parts: Vec<&str> = v4.split('.').collect();
        if parts.len() == 4 && parts[0] == "169" && parts[1] == "254" {
            return true;
        }
    }
    if lower.contains(':') {
        let first = lower.split(['%', ':']).next().unwrap_or_default();
        if first.len() == 4
            && first.starts_with("fe")
            && matches!(first.as_bytes()[2], b'8' | b'9' | b'a' | b'b')
        {
            return true;
        }
    }
    false
}

/// Hosts allowed plain http for a cloud API base URL via explicit opt-in env
/// SLASSHYWISPR_ALLOW_INSECURE_HTTP_HOSTS (comma-separated). Loopback http
/// (localhost, 127.0.0.1, ::1) is allowed without opt-in so a local
/// OpenAI-compatible gateway (LiteLLM, LM Studio, local proxy) can serve as
/// the online provider. Loopback never leaves the machine; LAN/non-loopback
/// http still needs the explicit opt-in.
fn insecure_http_opt_in_hosts() -> Vec<String> {
    non_empty_env_var(INSECURE_HTTP_HOSTS_ENV)
        .unwrap_or_default()
        .split(',')
        .map(|entry| entry.trim().trim_end_matches('.').to_ascii_lowercase())
        .filter(|entry| !entry.is_empty())
        .collect()
}

fn validate_http_url(raw: &str, field: &str, allow_loopback_http: bool) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{field} is empty."));
    }
    if trimmed.len() > 2048 {
        return Err(format!("{field} exceeds 2048 characters."));
    }
    if trimmed
        .chars()
        .any(|c| c.is_control() || c == ' ' || c == '<' || c == '>')
    {
        return Err(format!("{field} contains invalid characters."));
    }
    let lower = trimmed.to_ascii_lowercase();
    let Some((scheme, rest)) = lower.split_once("://") else {
        return Err(format!("{field} must start with https://."));
    };
    if scheme != "http" && scheme != "https" {
        return Err(format!("{field} must use https:// (got '{scheme}://')."));
    }
    let authority = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default()
        .rsplit('@')
        .next()
        .unwrap_or_default();
    let raw_host = if let Some(bracketed) = authority.strip_prefix('[') {
        bracketed.split(']').next().unwrap_or_default()
    } else if authority.matches(':').count() > 1 {
        // Bare IPv6 literal (optional %zone); port form is ambiguous, take all.
        authority.split('%').next().unwrap_or_default()
    } else {
        authority.split(':').next().unwrap_or_default()
    };
    let host = raw_host.trim().trim_end_matches('.');
    if host.is_empty() {
        return Err(format!("{field} has no host."));
    }
    if is_blocked_url_host(host) {
        return Err(format!("{field} host '{host}' is not allowed."));
    }
    let is_loopback = host == "localhost" || host == "127.0.0.1" || host == "::1";
    if scheme == "http" {
        if allow_loopback_http && is_loopback {
            // Local Ollama over loopback only.
        } else if insecure_http_opt_in_hosts().iter().any(|h| h == host) {
            // Explicit per-host opt-in.
        } else {
            return Err(format!(
                "{field} must use https:// (plain http needs {INSECURE_HTTP_HOSTS_ENV} opt-in)."
            ));
        }
    }
    Ok(trimmed.trim_end_matches('/').to_string())
}

/// Normalize an API base URL: trim whitespace, strip trailing slashes.
/// Keeps the old signature; invalid input normalizes to "" (empty = missing).
/// Use `validate_api_base_url` for a field-level error instead.
/// Loopback http is valid (local gateway); LAN/non-loopback http is not.
pub fn normalize_api_base_url(raw: Option<&str>) -> String {
    let trimmed = raw.map(str::trim).filter(|value| !value.is_empty());
    match trimmed {
        None => String::new(),
        Some(value) => validate_http_url(value, "apiBaseUrl", true).unwrap_or_default(),
    }
}

/// Field-level cloud API base-URL validation. Empty input -> "required" error.
/// https anywhere is valid; plain http is valid only for loopback
/// (localhost, 127.0.0.1, ::1) or explicit SLASSHYWISPR_ALLOW_INSECURE_HTTP_HOSTS opt-in.
pub fn validate_api_base_url(raw: Option<&str>) -> Result<String, String> {
    let trimmed = raw.map(str::trim).filter(|value| !value.is_empty());
    match trimmed {
        None => Err(
            "API base URL is required for online STT/AI mode. Open Settings > Models.".to_string(),
        ),
        Some(value) => validate_http_url(value, "apiBaseUrl", true),
    }
}

/// Normalize the local Ollama base URL with a default fallback.
/// Keeps the old signature; invalid input falls back to the loopback default.
pub fn normalize_local_ollama_base_url(raw: Option<&str>) -> String {
    let trimmed = raw.map(str::trim).filter(|value| !value.is_empty());
    match trimmed {
        None => DEFAULT_LOCAL_OLLAMA_BASE_URL.to_string(),
        Some(value) => validate_http_url(value, "localOllamaBaseUrl", true)
            .unwrap_or_else(|_| DEFAULT_LOCAL_OLLAMA_BASE_URL.to_string()),
    }
}

/// Field-level Ollama base-URL validation. Empty input -> loopback default.
pub fn validate_local_ollama_base_url(raw: Option<&str>) -> Result<String, String> {
    let trimmed = raw.map(str::trim).filter(|value| !value.is_empty());
    match trimmed {
        None => Ok(DEFAULT_LOCAL_OLLAMA_BASE_URL.to_string()),
        Some(value) => validate_http_url(value, "localOllamaBaseUrl", true),
    }
}

/// Canonicalize a local STT model ID, applying known aliases.
pub fn canonical_local_stt_model_id(model: &str) -> String {
    let normalized = model.trim();
    if normalized.eq_ignore_ascii_case("nvidia/parakeet-tdt-0.6b-v2") {
        // Legacy alias used by earlier builds.
        return "nvidia/parakeet-tdt_ctc-110m".to_string();
    }
    normalized.to_string()
}

/// Return the built-in catalog of local STT models.
pub fn built_in_local_stt_model_catalog() -> Vec<String> {
    vec![
        "nvidia/parakeet-tdt-0.6b-v3".to_string(),
        "nvidia/parakeet-tdt_ctc-110m".to_string(),
    ]
}

/// Whether the given local STT provider requires a Python runtime.
pub fn local_stt_provider_requires_python(provider: &str) -> bool {
    matches!(provider, "whisper" | "moonshine" | "sensevoice")
}

/// Whether the provider is supported in zero-Python mode.
pub fn local_stt_provider_supported_in_zero_python_mode(provider: &str) -> bool {
    provider == "parakeet"
}

/// Infer the STT provider from a model identifier string.
/// Defaults to "whisper" for unrecognized models (preserving legacy behavior).
pub fn infer_local_stt_provider_from_model(model: &str) -> String {
    let normalized = model.trim().to_ascii_lowercase();
    if normalized.starts_with("nvidia/") || normalized.contains("parakeet") {
        return "parakeet".to_string();
    }
    if normalized.contains("sensevoice") {
        return "sensevoice".to_string();
    }
    if normalized.contains("moonshine") {
        return "moonshine".to_string();
    }
    "whisper".to_string()
}

/// Normalize the local STT provider name to a known identifier.
pub fn normalize_local_stt_provider(raw: Option<&str>) -> String {
    let normalized = raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase());

    match normalized.as_deref() {
        Some("parakeet") => "parakeet".to_string(),
        Some("whisper") => "whisper".to_string(),
        _ => DEFAULT_LOCAL_STT_PROVIDER.to_string(),
    }
}

/// Return a display label for a local STT model.
pub fn local_stt_model_display_label(model: &str) -> String {
    let canonical = canonical_local_stt_model_id(model);
    match canonical.as_str() {
        "nvidia/parakeet-tdt-0.6b-v3" => "Parakeet v3 (478 MB)".to_string(),
        "nvidia/parakeet-tdt_ctc-110m" => "Parakeet v2 (473 MB)".to_string(),
        "openai/whisper-large-v3" => "Whisper Large (1.1 GB)".to_string(),
        "openai/whisper-medium" => "Whisper Medium (492 MB)".to_string(),
        "openai/whisper-small" => "Whisper Small (487 MB)".to_string(),
        "UsefulSensors/moonshine-base" => "Moonshine Base (58 MB)".to_string(),
        "openai/whisper-large-v3-turbo" => "Whisper Turbo (1.6 GB)".to_string(),
        "FunAudioLLM/SenseVoiceSmall" => "SenseVoice (160 MB)".to_string(),
        _ => canonical,
    }
}

/// Return the size in GB for a local STT model.
pub fn local_stt_model_size_gb(model: &str) -> f64 {
    let canonical = canonical_local_stt_model_id(model);
    match canonical.as_str() {
        "nvidia/parakeet-tdt-0.6b-v3" => 0.478,
        "nvidia/parakeet-tdt_ctc-110m" => 0.473,
        "openai/whisper-large-v3" => 1.1,
        "openai/whisper-medium" => 0.492,
        "openai/whisper-small" => 0.487,
        "UsefulSensors/moonshine-base" => 0.058,
        "openai/whisper-large-v3-turbo" => 1.6,
        "FunAudioLLM/SenseVoiceSmall" => 0.160,
        _ => 0.0,
    }
}

// ===== Environment helpers =====

/// Read a non-empty environment variable.
pub fn non_empty_env_var(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Parse a boolean environment variable flag.
pub fn env_flag(name: &str, default: bool) -> bool {
    match non_empty_env_var(name)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "1" | "true" | "yes" | "y" | "on" => true,
        "0" | "false" | "no" | "n" | "off" => false,
        _ => default,
    }
}

/// Whether zero-Python mode is enabled (Coqui TTS disabled).
pub fn zero_python_mode_enabled() -> bool {
    env_flag(ZERO_PYTHON_MODE_ENV, true)
}

// ===== Pipeline mode resolution =====

/// Resolve the pipeline mode from a routing input.
///
/// This is the core routing function. It determines:
/// - Whether STT should be online or local
/// - Whether AI should be online or local
/// - What credentials and model names to use
///
/// # Errors
/// Returns a user-facing error string if required configuration is missing.
pub fn resolve_pipeline_mode(request: &PipelineRoutingInput) -> Result<PipelineModeConfig, String> {
    let stt_local_mode = request.stt_local_mode.unwrap_or(false);
    let ai_local_mode = request.ai_local_mode.unwrap_or(false);
    let requires_online_provider = !stt_local_mode || !ai_local_mode;

    let (api_key, api_base_url) = if requires_online_provider {
        let api_key = normalize_api_key_secret(&request.api_key);
        if api_key.is_empty() {
            return Err("API key is required for online STT/AI mode.".to_string());
        }
        let api_base_url = validate_api_base_url(request.api_base_url.as_deref())?;
        (api_key, api_base_url)
    } else {
        (String::new(), String::new())
    };

    let stt = if stt_local_mode {
        let stt_model =
            canonical_local_stt_model_id(&normalize_model_name(request.local_stt_model.as_deref()));
        if stt_model.is_empty() {
            return Err(
                "Local STT model is required when STT runtime is local. Open Settings > Models and select a model."
                    .to_string(),
            );
        }
        SttModeConfig::Local(LocalSttConfig { stt_model })
    } else {
        let stt_model = normalize_model_name(request.stt_model.as_deref());
        if stt_model.is_empty() {
            return Err(
                "Online STT model is required when STT runtime is online. Open Settings > Models."
                    .to_string(),
            );
        }
        SttModeConfig::Online {
            api_key: api_key.clone(),
            api_base_url: api_base_url.clone(),
            stt_model,
        }
    };

    let ai = if ai_local_mode {
        let ollama_base_url =
            validate_local_ollama_base_url(request.local_ollama_base_url.as_deref())?;
        let ollama_model = normalize_model_name(request.local_ollama_model.as_deref());
        let ollama_model = if ollama_model.is_empty() {
            None
        } else {
            Some(ollama_model)
        };
        AiModeConfig::Local(LocalAiConfig {
            ollama_base_url,
            ollama_model,
        })
    } else {
        let ai_model = normalize_model_name(request.ai_model.as_deref());
        if ai_model.is_empty() {
            return Err(
                "Online AI model is required when AI runtime is online. Open Settings > Models."
                    .to_string(),
            );
        }
        AiModeConfig::Online {
            api_key,
            api_base_url,
            ai_model,
        }
    };

    Ok(PipelineModeConfig { stt, ai })
}

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a fully-online pipeline routing input for testing.
    fn online_input() -> PipelineRoutingInput {
        PipelineRoutingInput {
            api_key: "test-key".to_string(),
            api_base_url: Some("https://api.example.com/v1".to_string()),
            stt_model: Some("gpt-4o-mini-transcribe".to_string()),
            ai_model: Some("gpt-4o-mini".to_string()),
            stt_local_mode: Some(false),
            ai_local_mode: Some(false),
            local_ollama_base_url: Some("http://127.0.0.1:11434".to_string()),
            local_ollama_model: Some("llama3.2:3b".to_string()),
            local_stt_model: Some("nvidia/parakeet-tdt-0.6b-v3".to_string()),
        }
    }

    // ===== Pipeline mode resolution — all mode combinations =====

    #[test]
    fn fully_online_resolves_both_stages_to_online() {
        let input = online_input();
        let mode = resolve_pipeline_mode(&input).expect("should resolve");
        assert!(matches!(mode.stt, SttModeConfig::Online { .. }));
        assert!(matches!(mode.ai, AiModeConfig::Online { .. }));
    }

    #[test]
    fn fully_local_resolves_both_stages_to_local() {
        let mut input = online_input();
        input.stt_local_mode = Some(true);
        input.ai_local_mode = Some(true);
        input.api_key = String::new();
        let mode = resolve_pipeline_mode(&input).expect("should resolve");
        assert!(matches!(mode.stt, SttModeConfig::Local(_)));
        assert!(matches!(mode.ai, AiModeConfig::Local(_)));
    }

    #[test]
    fn hybrid_online_stt_local_ai_resolves_correctly() {
        let mut input = online_input();
        input.stt_local_mode = Some(false);
        input.ai_local_mode = Some(true);
        let mode = resolve_pipeline_mode(&input).expect("should resolve");
        assert!(matches!(mode.stt, SttModeConfig::Online { .. }));
        assert!(matches!(mode.ai, AiModeConfig::Local(_)));
    }

    #[test]
    fn hybrid_local_stt_online_ai_resolves_correctly() {
        let mut input = online_input();
        input.stt_local_mode = Some(true);
        input.ai_local_mode = Some(false);
        let mode = resolve_pipeline_mode(&input).expect("should resolve");
        assert!(matches!(mode.stt, SttModeConfig::Local(_)));
        assert!(matches!(mode.ai, AiModeConfig::Online { .. }));
    }

    // ===== Error cases =====

    #[test]
    fn fails_when_api_key_empty_for_online() {
        let mut input = online_input();
        input.api_key = String::new();
        let err = resolve_pipeline_mode(&input).expect_err("should fail");
        assert!(err.contains("API key is required"));
    }

    #[test]
    fn fails_when_api_base_url_missing_for_online() {
        let mut input = online_input();
        input.api_base_url = None;
        let err = resolve_pipeline_mode(&input).expect_err("should fail");
        assert!(err.contains("API base URL is required"));
    }

    #[test]
    fn fails_when_online_stt_model_missing() {
        let mut input = online_input();
        input.stt_model = None;
        let err = resolve_pipeline_mode(&input).expect_err("should fail");
        assert!(err.contains("Online STT model is required"));
    }

    #[test]
    fn fails_when_online_ai_model_missing() {
        let mut input = online_input();
        input.ai_model = None;
        let err = resolve_pipeline_mode(&input).expect_err("should fail");
        assert!(err.contains("Online AI model is required"));
    }

    #[test]
    fn fails_when_local_stt_model_missing() {
        let mut input = online_input();
        input.stt_local_mode = Some(true);
        input.local_stt_model = None;
        let err = resolve_pipeline_mode(&input).expect_err("should fail");
        assert!(err.contains("Local STT model is required"));
    }

    // ===== Credential propagation =====

    #[test]
    fn online_stt_carries_correct_credentials() {
        let input = online_input();
        let mode = resolve_pipeline_mode(&input).expect("should resolve");
        match &mode.stt {
            SttModeConfig::Online {
                api_key,
                api_base_url,
                stt_model,
            } => {
                assert_eq!(api_key, "test-key");
                assert_eq!(api_base_url, "https://api.example.com/v1");
                assert_eq!(stt_model, "gpt-4o-mini-transcribe");
            }
            _ => panic!("expected online STT"),
        }
    }

    #[test]
    fn online_ai_carries_correct_credentials() {
        let input = online_input();
        let mode = resolve_pipeline_mode(&input).expect("should resolve");
        match &mode.ai {
            AiModeConfig::Online {
                api_key,
                api_base_url,
                ai_model,
            } => {
                assert_eq!(api_key, "test-key");
                assert_eq!(api_base_url, "https://api.example.com/v1");
                assert_eq!(ai_model, "gpt-4o-mini");
            }
            _ => panic!("expected online AI"),
        }
    }

    // ===== Local STT model canonicalization =====

    #[test]
    fn local_stt_uses_canonical_model_id() {
        let mut input = online_input();
        input.stt_local_mode = Some(true);
        input.local_stt_model = Some("nvidia/parakeet-tdt-0.6b-v2".to_string());
        let mode = resolve_pipeline_mode(&input).expect("should resolve");
        match &mode.stt {
            SttModeConfig::Local(config) => {
                assert_eq!(config.stt_model, "nvidia/parakeet-tdt_ctc-110m");
            }
            _ => panic!("expected local STT"),
        }
    }

    // ===== Local AI =====

    #[test]
    fn local_ai_allows_empty_ollama_model() {
        let mut input = online_input();
        input.ai_local_mode = Some(true);
        input.local_ollama_model = None;
        let mode = resolve_pipeline_mode(&input).expect("should resolve");
        match &mode.ai {
            AiModeConfig::Local(config) => {
                assert!(config.ollama_model.is_none());
            }
            _ => panic!("expected local AI"),
        }
    }

    #[test]
    fn local_ai_preserves_ollama_config() {
        let mut input = online_input();
        input.stt_local_mode = Some(true);
        input.ai_local_mode = Some(true);
        input.api_key = String::new();
        input.local_ollama_model = Some("mistral:latest".to_string());
        let mode = resolve_pipeline_mode(&input).expect("should resolve");
        match &mode.ai {
            AiModeConfig::Local(config) => {
                assert_eq!(config.ollama_model.as_deref(), Some("mistral:latest"));
                assert_eq!(config.ollama_base_url, "http://127.0.0.1:11434");
            }
            _ => panic!("expected local AI"),
        }
    }

    // ===== Normalization helpers =====

    #[test]
    fn normalize_model_name_trims_whitespace() {
        assert_eq!(normalize_model_name(Some("  gpt-4o  ")), "gpt-4o");
    }

    #[test]
    fn normalize_model_name_returns_empty_for_none() {
        assert_eq!(normalize_model_name(None), "");
    }

    #[test]
    fn normalize_model_name_returns_empty_for_empty_string() {
        assert_eq!(normalize_model_name(Some("")), "");
        assert_eq!(normalize_model_name(Some("   ")), "");
    }

    #[test]
    fn normalize_api_base_url_strips_trailing_slash() {
        assert_eq!(
            normalize_api_base_url(Some("https://api.example.com/v1/")),
            "https://api.example.com/v1"
        );
        assert_eq!(
            normalize_api_base_url(Some("  https://api.example.com  ")),
            "https://api.example.com"
        );
        // Policy: non-loopback plain http + metadata IPs normalize to "" (missing).
        assert_eq!(
            normalize_api_base_url(Some("http://api.example.com/v1")),
            ""
        );
        // Loopback http is valid (local gateway).
        assert_eq!(
            normalize_api_base_url(Some("http://localhost:20128/v1/")),
            "http://localhost:20128/v1"
        );
        assert_eq!(
            normalize_api_base_url(Some("https://169.254.169.254/latest/")),
            ""
        );
    }

    #[test]
    fn normalize_api_base_url_returns_empty_for_none() {
        assert_eq!(normalize_api_base_url(None), "");
        assert_eq!(normalize_api_base_url(Some("")), "");
    }

    #[test]
    fn normalize_local_ollama_base_url_defaults_correctly() {
        assert_eq!(
            normalize_local_ollama_base_url(None),
            DEFAULT_LOCAL_OLLAMA_BASE_URL
        );
        assert_eq!(
            normalize_local_ollama_base_url(Some("")),
            DEFAULT_LOCAL_OLLAMA_BASE_URL
        );
    }

    #[test]
    fn normalize_local_ollama_base_url_strips_trailing_slash() {
        assert_eq!(
            normalize_local_ollama_base_url(Some("http://127.0.0.1:11434/")),
            "http://127.0.0.1:11434"
        );
        // Loopback http stays valid for Ollama; non-loopback http falls back.
        assert_eq!(
            normalize_local_ollama_base_url(Some("http://localhost:11434")),
            "http://localhost:11434"
        );
        assert_eq!(
            normalize_local_ollama_base_url(Some("http://192.168.1.10:11434")),
            DEFAULT_LOCAL_OLLAMA_BASE_URL
        );
        assert_eq!(
            normalize_local_ollama_base_url(Some("https://169.254.169.254/")),
            DEFAULT_LOCAL_OLLAMA_BASE_URL
        );
    }

    #[test]
    fn canonical_local_stt_model_id_maps_v2_alias() {
        assert_eq!(
            canonical_local_stt_model_id("nvidia/parakeet-tdt-0.6b-v2"),
            "nvidia/parakeet-tdt_ctc-110m"
        );
    }

    #[test]
    fn canonical_local_stt_model_id_passes_through_v3() {
        assert_eq!(
            canonical_local_stt_model_id("nvidia/parakeet-tdt-0.6b-v3"),
            "nvidia/parakeet-tdt-0.6b-v3"
        );
    }

    #[test]
    fn canonical_local_stt_model_id_trims_whitespace() {
        assert_eq!(
            canonical_local_stt_model_id("  nvidia/parakeet-tdt-0.6b-v3  "),
            "nvidia/parakeet-tdt-0.6b-v3"
        );
    }

    #[test]
    fn built_in_local_stt_catalog_is_parakeet_only() {
        assert_eq!(
            built_in_local_stt_model_catalog(),
            vec![
                "nvidia/parakeet-tdt-0.6b-v3".to_string(),
                "nvidia/parakeet-tdt_ctc-110m".to_string()
            ]
        );
    }

    #[test]
    fn local_stt_provider_python_requirement_flags() {
        assert!(local_stt_provider_requires_python("whisper"));
        assert!(local_stt_provider_requires_python("moonshine"));
        assert!(local_stt_provider_requires_python("sensevoice"));
        assert!(!local_stt_provider_requires_python("parakeet"));
    }

    #[test]
    fn zero_python_supported_local_stt_provider_flags() {
        assert!(local_stt_provider_supported_in_zero_python_mode("parakeet"));
        assert!(!local_stt_provider_supported_in_zero_python_mode("whisper"));
        assert!(!local_stt_provider_supported_in_zero_python_mode(
            "moonshine"
        ));
        assert!(!local_stt_provider_supported_in_zero_python_mode(
            "sensevoice"
        ));
    }

    #[test]
    fn infer_provider_from_model_parakeet() {
        assert_eq!(
            infer_local_stt_provider_from_model("nvidia/parakeet-tdt-0.6b-v3"),
            "parakeet"
        );
        assert_eq!(
            infer_local_stt_provider_from_model("parakeet-small"),
            "parakeet"
        );
    }

    #[test]
    fn infer_provider_from_model_whisper() {
        assert_eq!(
            infer_local_stt_provider_from_model("whisper-large-v3"),
            "whisper"
        );
    }

    #[test]
    fn infer_provider_from_model_defaults_to_whisper() {
        // Unrecognized models default to "whisper" (legacy behavior)
        assert_eq!(
            infer_local_stt_provider_from_model("some-unknown-model"),
            "whisper"
        );
    }

    #[test]
    fn normalize_api_key_secret_strips_control_chars() {
        assert_eq!(normalize_api_key_secret("key\x00here"), "keyhere");
        assert_eq!(normalize_api_key_secret("key\x01\x02here"), "keyhere");
        assert_eq!(normalize_api_key_secret("  key  "), "key");
    }

    #[test]
    fn normalize_api_key_secret_preserves_normal_text() {
        assert_eq!(normalize_api_key_secret("sk-abc123"), "sk-abc123");
    }

    // ===== Error messages are user-friendly =====

    #[test]
    fn error_messages_are_user_friendly() {
        let mut input = online_input();
        input.api_key = String::new();
        let err = resolve_pipeline_mode(&input).unwrap_err();
        assert!(err.contains("API key is required"));

        let mut input = online_input();
        input.api_base_url = None;
        let err = resolve_pipeline_mode(&input).unwrap_err();
        assert!(err.contains("API base URL is required"));

        let mut input = online_input();
        input.stt_model = None;
        let err = resolve_pipeline_mode(&input).unwrap_err();
        assert!(err.contains("Online STT model is required"));

        let mut input = online_input();
        input.ai_model = None;
        let err = resolve_pipeline_mode(&input).unwrap_err();
        assert!(err.contains("Online AI model is required"));

        let mut input = online_input();
        input.stt_local_mode = Some(true);
        input.local_stt_model = None;
        let err = resolve_pipeline_mode(&input).unwrap_err();
        assert!(err.contains("Local STT model is required"));
    }

    // ===== F-004 URL policy =====

    #[test]
    fn downgrade_url_version_rejected_by_policy_shape() {
        // extract_version_from_download_url is updater-owned; here assert the
        // routing side rejects the http/metadata inputs a downgrade relay
        // would smuggle through apiBaseUrl.
        assert!(validate_api_base_url(Some("http://api.example.com/v1")).is_err());
        assert!(validate_api_base_url(Some("https://100.100.100.200/")).is_err());
        assert!(validate_api_base_url(Some("https://[fe80::1]/")).is_err());
        assert!(validate_api_base_url(Some("https://169.254.10.20/")).is_err());
        assert!(validate_api_base_url(Some("https://api.example.com/v1")).is_ok());
    }

    #[test]
    fn insecure_http_opt_in_allows_listed_host_only() {
        std::env::set_var(INSECURE_HTTP_HOSTS_ENV, "intranet.example.com, 10.0.0.5 ");
        assert!(validate_api_base_url(Some("http://intranet.example.com/v1")).is_ok());
        assert!(validate_api_base_url(Some("http://other.example.com/v1")).is_err());
        // Loopback http is allowed without opt-in (local gateway).
        assert!(validate_api_base_url(Some("http://localhost:11434")).is_ok());
        std::env::remove_var(INSECURE_HTTP_HOSTS_ENV);
        assert!(validate_api_base_url(Some("http://intranet.example.com/v1")).is_err());
    }

    #[test]
    fn loopback_http_api_base_url_is_allowed() {
        // Local OpenAI-compatible gateways (LiteLLM, LM Studio, local proxy).
        assert!(validate_api_base_url(Some("http://localhost:20128/v1")).is_ok());
        assert!(validate_api_base_url(Some("http://127.0.0.1:20128/v1")).is_ok());
        assert!(validate_api_base_url(Some("http://[::1]:20128/v1")).is_ok());
        // LAN / non-loopback http still needs the opt-in.
        assert!(validate_api_base_url(Some("http://192.168.1.10:11434")).is_err());
        assert!(validate_api_base_url(Some("http://api.example.com/v1")).is_err());
    }

    #[test]
    fn resolve_pipeline_mode_rejects_insecure_and_metadata_urls() {
        let mut input = online_input();
        input.api_base_url = Some("http://api.example.com/v1".to_string());
        let err = resolve_pipeline_mode(&input).expect_err("http must fail");
        assert!(err.contains("https://"), "{err}");

        let mut input = online_input();
        input.api_base_url = Some("https://169.254.169.254/latest/".to_string());
        let err = resolve_pipeline_mode(&input).expect_err("metadata IP must fail");
        assert!(err.contains("not allowed"), "{err}");
    }

    #[test]
    fn routing_debug_redacts_api_key() {
        let input = online_input();
        let shown = format!("{input:?}");
        assert!(!shown.contains("test-key"), "api key leaked in Debug");
        assert!(shown.contains("[REDACTED]"));
        let mode = resolve_pipeline_mode(&online_input()).expect("resolves");
        let stt_shown = format!("{:?}", mode.stt);
        let ai_shown = format!("{:?}", mode.ai);
        assert!(!stt_shown.contains("test-key"));
        assert!(!ai_shown.contains("test-key"));
    }
}
