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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderModelsRequest {
    pub(crate) api_key: String,
    pub(crate) api_base_url: Option<String>,
}

// ponytail: manual redacting Debug; upgrade to a secrets wrapper type if more
// key-holding structs appear.
impl std::fmt::Debug for ProviderModelsRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProviderModelsRequest")
            .field("api_key", &"[REDACTED]")
            .field("api_base_url", &self.api_base_url)
            .finish()
    }
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

/// Bounds the frontend renders and clamps with, so its limits come from the
/// same constants the backend enforces instead of being restated in TypeScript.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SttTimeoutBoundsResponse {
    pub(crate) default_seconds: u64,
    pub(crate) min_seconds: u64,
    pub(crate) max_seconds: u64,
}

/// Same contract for the assistant's token ceiling.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MaxTokensBoundsResponse {
    pub(crate) default_tokens: u32,
    pub(crate) min_tokens: u32,
    pub(crate) max_tokens: u32,
}

// ===== DAY-1 pipeline run contract (shared with commands::pipeline + TS) =====
// Flatten these into the pipeline request/response so the JSON shape has one
// source of truth. All fields defaulted: old frontends that omit them keep
// working (incognito=false, backend mints pipeline_run_id when empty).

/// Request-side run identity. Agent 2: flatten into AssistantPipelineRequest.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PipelineRunIdentity {
    #[serde(default)]
    pub(crate) incognito: bool,
    #[serde(default)]
    pub(crate) pipeline_run_id: String,
}

/// Response-side run outcome. Agent 2: flatten into AssistantPipelineResponse.
/// `tts_status` values owned by Agent 2; initial set:
/// "disabled" | "skipped" | "synthesized" | "failed".
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PipelineRunOutcome {
    /// Echoed run identity; backend mints one when the request omits it.
    #[serde(default)]
    pub(crate) pipeline_run_id: String,
    /// Never silent on TTS: "disabled"|"skipped"|"synthesized"|"failed".
    #[serde(default)]
    pub(crate) tts_status: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pipeline_run_contract_json_shape() {
        let identity: PipelineRunIdentity =
            serde_json::from_value(serde_json::json!({})).expect("identity defaults");
        assert!(!identity.incognito);
        assert!(identity.pipeline_run_id.is_empty());

        let wire = serde_json::to_value(&PipelineRunIdentity {
            incognito: true,
            pipeline_run_id: "run-1".to_string(),
        })
        .expect("identity serializes");
        assert_eq!(wire["incognito"], true);
        assert_eq!(wire["pipelineRunId"], "run-1");

        let outcome = PipelineRunOutcome {
            pipeline_run_id: "run-1".to_string(),
            tts_status: "synthesized".to_string(),
        };
        let wire = serde_json::to_value(&outcome).expect("outcome serializes");
        assert_eq!(wire["pipelineRunId"], "run-1");
        assert_eq!(wire["ttsStatus"], "synthesized");
        assert!(wire.get("tts_status").is_none());
        assert!(wire.get("pipeline_run_id").is_none());
    }

    #[test]
    fn provider_models_request_debug_redacts_api_key() {
        let request = ProviderModelsRequest {
            api_key: "sk-secret-123".to_string(),
            api_base_url: None,
        };
        let shown = format!("{request:?}");
        assert!(!shown.contains("sk-secret-123"), "api key leaked in Debug");
        assert!(shown.contains("[REDACTED]"));
    }
}
