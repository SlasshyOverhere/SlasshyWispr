//! Provider/assistant IPC shapes (serde contracts).
//!
//! Moved verbatim from lib.rs: assistant-info, provider-models, and
//! Ollama request/response structs. Field types and rename rules are
//! unchanged (wire compatibility).

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AssistantInfoResponse {
    pub(crate) app_version: String,
    pub(crate) base_url: &'static str,
    pub(crate) stt_model: &'static str,
    pub(crate) ai_model: &'static str,
    pub(crate) piper_installed: bool,
    pub(crate) piper_path: String,
    pub(crate) voice_installed: bool,
    pub(crate) voice_model_path: String,
    pub(crate) voice_config_path: String,
    pub(crate) coqui_installed: bool,
    pub(crate) coqui_python_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderModelsRequest {
    pub(crate) api_key: String,
    pub(crate) api_base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OllamaModelsRequest {
    pub(crate) base_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OllamaPullRequest {
    pub(crate) base_url: Option<String>,
    pub(crate) model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OllamaPullResponse {
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) ok: bool,
    pub(crate) status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OllamaStatusRequest {
    pub(crate) base_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OllamaStatusResponse {
    pub(crate) installed: bool,
    pub(crate) running: bool,
    pub(crate) version: String,
    pub(crate) details: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderModelsResponse {
    pub(crate) base_url: String,
    pub(crate) models: Vec<String>,
}
