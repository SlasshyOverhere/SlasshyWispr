//! Provider + Ollama commands — Phase 6d thin-adapter extraction.
//!
//! Moved verbatim from lib.rs: get_assistant_info, model-id helpers,
//! fetch/pull/status/install commands. No signature or logic changes.

use std::collections::BTreeSet;

use log::info;
use serde_json::{Value, json};
use tauri::{AppHandle, State};

use crate::constants::{
    DEFAULT_AI_MODEL, DEFAULT_BASE_URL, DEFAULT_STT_MODEL, OLLAMA_WINDOWS_INSTALLER_URL,
};
use crate::pipeline::fs::{download_file, file_exists_with_content};
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::tts::{coqui_venv_python_path, voice_paths};
use crate::pipeline::routing::{
    normalize_api_base_url, normalize_api_key_secret, normalize_local_ollama_base_url,
    normalize_model_name, zero_python_mode_enabled,
};
use crate::services::transcribe::apply_optional_bearer_auth;
use crate::services::pipeline_service::discover_installed_piper_path;
use crate::{
    is_ollama_service_running, ollama_installer_path,
    query_ollama_version, run_ollama_installer_windows,
};
use crate::state::AppState;
use crate::{
    AssistantInfoResponse, OllamaModelsRequest, OllamaPullRequest, OllamaPullResponse,
    OllamaStatusRequest, OllamaStatusResponse, ProviderModelsRequest, ProviderModelsResponse,
};

#[tauri::command]
pub(crate) async fn get_assistant_info(app: AppHandle) -> Result<AssistantInfoResponse, String> {
    let (model_path, config_path) = voice_paths(&app)?;
    let piper_path = discover_installed_piper_path(&app)?;
    let (coqui_installed, coqui_python_path) = if zero_python_mode_enabled() {
        (false, String::new())
    } else {
        let path = coqui_venv_python_path(&app)?;
        (
            file_exists_with_content(&path),
            path.to_string_lossy().into_owned(),
        )
    };

    Ok(AssistantInfoResponse {
        app_version: app.package_info().version.to_string(),
        base_url: DEFAULT_BASE_URL,
        stt_model: DEFAULT_STT_MODEL,
        ai_model: DEFAULT_AI_MODEL,
        piper_installed: piper_path.is_some(),
        piper_path: piper_path
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default(),
        voice_installed: file_exists_with_content(&model_path)
            && file_exists_with_content(&config_path),
        voice_model_path: model_path.to_string_lossy().into_owned(),
        voice_config_path: config_path.to_string_lossy().into_owned(),
        coqui_installed,
        coqui_python_path,
    })
}

// ⚡ Bolt Optimization: Use string slices (&str) inside the BTreeSet
// instead of owned Strings to avoid unnecessary heap allocations
// during the duplicate filtering phase.
fn collect_model_ids_from_array<'a>(items: &'a [Value], output: &mut BTreeSet<&'a str>) {
    for item in items {
        if let Some(text) = item.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                output.insert(trimmed);
            }
            continue;
        }

        if let Some(model) = item
            .get("id")
            .and_then(Value::as_str)
            .or_else(|| item.get("model").and_then(Value::as_str))
            .or_else(|| item.get("name").and_then(Value::as_str))
        {
            let trimmed = model.trim();
            if !trimmed.is_empty() {
                output.insert(trimmed);
            }
        }
    }
}

fn extract_model_ids_from_payload(payload: &Value) -> Vec<String> {
    let mut models = BTreeSet::new();

    if let Some(items) = payload.get("data").and_then(Value::as_array) {
        collect_model_ids_from_array(items, &mut models);
    }
    if let Some(items) = payload.get("models").and_then(Value::as_array) {
        collect_model_ids_from_array(items, &mut models);
    }
    if models.is_empty() {
        if let Some(items) = payload.as_array() {
            collect_model_ids_from_array(items, &mut models);
        }
    }

    // ⚡ Bolt Optimization: Convert unique references to owned Strings
    // only after duplicates have been eliminated.
    models.into_iter().map(String::from).collect()
}

#[tauri::command]
pub(crate) async fn fetch_provider_models(
    state: State<'_, AppState>,
    request: ProviderModelsRequest,
) -> Result<ProviderModelsResponse, String> {
    let api_key = normalize_api_key_secret(&request.api_key);
    if api_key.is_empty() {
        return Err("API key is required to fetch models.".to_string());
    }

    let base_url = normalize_api_base_url(request.api_base_url.as_deref());
    if base_url.is_empty() {
        return Err("API base URL is required to fetch models.".to_string());
    }
    let request_builder = state.http.get(format!("{base_url}/models"));
    let response = apply_optional_bearer_auth(request_builder, Some(api_key.as_str()))
        .send()
        .await
        .map_err(|error| format!("Failed to call models endpoint: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to parse models response body: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Model fetch failed ({status}): {}",
            clip_text(&single_line(&body), 420)
        ));
    }

    let payload: Value = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid model catalog JSON response: {error}"))?;
    let models = extract_model_ids_from_payload(&payload);

    info!(
        "[provider.models] fetched count={} base_url={}",
        models.len(),
        clip_text(&base_url, 180)
    );

    Ok(ProviderModelsResponse { base_url, models })
}

#[tauri::command]
pub(crate) async fn fetch_ollama_models(
    state: State<'_, AppState>,
    request: OllamaModelsRequest,
) -> Result<ProviderModelsResponse, String> {
    let base_url = normalize_local_ollama_base_url(request.base_url.as_deref());
    let response = state
        .http
        .get(format!("{base_url}/api/tags"))
        .send()
        .await
        .map_err(|error| format!("Failed to call Ollama tags endpoint: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to parse Ollama tags response body: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Ollama model fetch failed ({status}): {}",
            clip_text(&single_line(&body), 420)
        ));
    }

    let payload: Value = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid Ollama model catalog JSON response: {error}"))?;
    let models = extract_model_ids_from_payload(&payload);

    info!(
        "[ollama.models] fetched count={} base_url={}",
        models.len(),
        clip_text(&base_url, 180)
    );

    Ok(ProviderModelsResponse { base_url, models })
}

#[tauri::command]
pub(crate) async fn pull_ollama_model(
    state: State<'_, AppState>,
    request: OllamaPullRequest,
) -> Result<OllamaPullResponse, String> {
    let model = normalize_model_name(Some(&request.model));
    if model.is_empty() {
        return Err("Model name is required to pull from Ollama.".to_string());
    }

    let base_url = normalize_local_ollama_base_url(request.base_url.as_deref());
    let response = state
        .http
        .post(format!("{base_url}/api/pull"))
        .json(&json!({
            "name": model,
            "stream": false,
        }))
        .send()
        .await
        .map_err(|error| format!("Failed to call Ollama pull endpoint: {error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to parse Ollama pull response body: {error}"))?;
    if !status.is_success() {
        return Err(format!(
            "Ollama pull failed ({status}): {}",
            clip_text(&single_line(&body), 420)
        ));
    }

    let payload = serde_json::from_str::<Value>(&body).unwrap_or_else(|_| {
        json!({
            "status": body.trim(),
        })
    });
    let status_text = payload
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("completed")
        .to_string();

    info!(
        "[ollama.pull] model={} status={} base_url={}",
        clip_text(&model, 120),
        clip_text(&status_text, 120),
        clip_text(&base_url, 180)
    );

    Ok(OllamaPullResponse {
        base_url,
        model,
        ok: true,
        status: status_text,
    })
}

#[tauri::command]
pub(crate) async fn get_ollama_status(
    state: State<'_, AppState>,
    request: OllamaStatusRequest,
) -> Result<OllamaStatusResponse, String> {
    let base_url = normalize_local_ollama_base_url(request.base_url.as_deref());
    let version = match query_ollama_version().await {
        Ok(value) => value,
        Err(error) => {
            return Ok(OllamaStatusResponse {
                installed: false,
                running: false,
                version: String::new(),
                details: error,
            });
        }
    };

    let running = is_ollama_service_running(&state.http, &base_url).await;
    let details = if running {
        "Ollama CLI and local service are ready.".to_string()
    } else {
        format!("Ollama CLI is installed ({version}), but service at {base_url} is not responding.")
    };

    Ok(OllamaStatusResponse {
        installed: true,
        running,
        version,
        details,
    })
}

#[tauri::command]
pub(crate) async fn install_ollama(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<OllamaStatusResponse, String> {
    #[cfg(target_os = "windows")]
    {
        let installer_path = ollama_installer_path(&app)?;
        if !file_exists_with_content(&installer_path) {
            download_file(&state.http, OLLAMA_WINDOWS_INSTALLER_URL, &installer_path).await?;
        }

        let installer_for_worker = installer_path.clone();
        tauri::async_runtime::spawn_blocking(move || {
            run_ollama_installer_windows(&installer_for_worker)
        })
        .await
        .map_err(|error| format!("Ollama installer task failed: {error}"))??;

        let base_url = normalize_local_ollama_base_url(None);
        let version = query_ollama_version().await.unwrap_or_default();
        let running = is_ollama_service_running(&state.http, &base_url).await;
        let details = if running {
            "Ollama installation finished and service is reachable.".to_string()
        } else {
            "Ollama installer finished. Start Ollama once so the local service becomes reachable."
                .to_string()
        };

        return Ok(OllamaStatusResponse {
            installed: !version.trim().is_empty(),
            running,
            version,
            details,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        let _ = state;
        Err("In-app Ollama installer is currently implemented for Windows only.".to_string())
    }
}

