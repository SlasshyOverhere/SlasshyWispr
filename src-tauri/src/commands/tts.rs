//! TTS commands — Phase 6f thin-adapter extraction.
//!
//! Moved verbatim from lib.rs: Piper setup/validate/voice, Coqui
//! status/setup/validate/voices/models/clone/preview, staged TTS setup.
//! TtsSetupState + request/response structs move with their commands.
//! Business-logic thinning (services) happens in Phase 7.

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::constants::{
    COQUI_DEFAULT_LANGUAGE, COQUI_DEFAULT_MODEL, COQUI_MAX_REFERENCE_SECONDS,
    ZERO_PYTHON_COQUI_NOTICE,
};
use crate::pipeline::fs::file_exists_with_content;
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::process::{apply_no_window, validate_python_binary_path};
use crate::pipeline::routing::zero_python_mode_enabled;
use crate::pipeline::tts::{
    coqui_previews_dir, coqui_uploads_dir, coqui_voices_dir, ensure_piper_binary,
    ensure_voice_files, resolve_coqui_python_path, run_coqui_bridge, synthesize_with_coqui,
    CoquiPipelineRequest,
};

use crate::services::coqui_setup::{list_coqui_voice_ids, setup_coqui_runtime_blocking};
use crate::services::pipeline_service::resolve_piper_path;
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PiperValidationRequest {
    piper_path: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PiperValidationResponse {
    ok: bool,
    details: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RuntimeSetupResponse {
    piper_path: String,
    voice_model_path: String,
    voice_config_path: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiStatusRequest {
    python_path: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiStatusResponse {
    available: bool,
    python_path: String,
    tts_version: String,
    cuda_available: bool,
    voice_dir: String,
    voices: Vec<String>,
    default_model: &'static str,
    error: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiSetupRequest {
    python_path: Option<String>,
    use_gpu: Option<bool>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiSetupResponse {
    python_path: String,
    details: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiValidationRequest {
    python_path: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiValidationResponse {
    ok: bool,
    details: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiVoiceCloneRequest {
    python_path: Option<String>,
    model_name: Option<String>,
    language: Option<String>,
    speaker_id: String,
    audio_base64: String,
    file_name: Option<String>,
    use_gpu: Option<bool>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiVoiceCloneResponse {
    speaker_id: String,
    duration_seconds: f32,
    voice_dir: String,
    voices: Vec<String>,
    preview_audio_base64: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiVoicesRequest {
    python_path: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiVoicesResponse {
    voice_dir: String,
    voices: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiVoicePreviewRequest {
    python_path: Option<String>,
    model_name: Option<String>,
    language: Option<String>,
    speaker_id: Option<String>,
    text: Option<String>,
    speed: Option<f32>,
    quality: Option<String>,
    emotion: Option<String>,
    use_gpu: Option<bool>,
    split_sentences: Option<bool>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiVoicePreviewResponse {
    audio_base64: String,
    text: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiModelsRequest {
    python_path: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiModelsResponse {
    models: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtsSetupStartRequest {
    python_path: Option<String>,
    use_gpu: Option<bool>,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtsSetupStatusResponse {
    running: bool,
    completed: bool,
    success: bool,
    stage: String,
    logs: Vec<String>,
}
#[derive(Debug, Clone)]
pub(crate) struct TtsSetupProgress {
    running: bool,
    completed: bool,
    success: bool,
    stage: String,
    logs: Vec<String>,
}

impl Default for TtsSetupProgress {
    fn default() -> Self {
        Self {
            running: false,
            completed: false,
            success: false,
            stage: "Waiting for setup.".to_string(),
            logs: Vec::new(),
        }
    }
}
#[derive(Clone)]
pub(crate) struct TtsSetupState {
    inner: Arc<Mutex<TtsSetupProgress>>,
}

impl Default for TtsSetupState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(TtsSetupProgress::default())),
        }
    }
}

impl TtsSetupState {
    pub(crate) fn clone_handle(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }

    fn with_progress_mut<F>(&self, update: F)
    where
        F: FnOnce(&mut TtsSetupProgress),
    {
        let mut guard = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        update(&mut guard);
    }

    pub(crate) fn snapshot(&self) -> TtsSetupStatusResponse {
        let guard = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        TtsSetupStatusResponse {
            running: guard.running,
            completed: guard.completed,
            success: guard.success,
            stage: guard.stage.clone(),
            logs: guard.logs.clone(),
        }
    }

    pub(crate) fn reset_and_start(&self) {
        self.with_progress_mut(|progress| {
            progress.running = true;
            progress.completed = false;
            progress.success = false;
            progress.stage = "Preparing setup...".to_string();
            progress.logs.clear();
            progress.logs.push(if zero_python_mode_enabled() {
                "Starting TTS bootstrap for Piper runtime (zero-Python mode).".to_string()
            } else {
                "Starting TTS bootstrap for Piper + Coqui runtime.".to_string()
            });
        });
    }

    pub(crate) fn set_stage(&self, stage: impl Into<String>) {
        let stage_text = stage.into();
        self.with_progress_mut(|progress| {
            progress.stage = stage_text;
        });
    }

    pub(crate) fn append_log(&self, line: impl Into<String>) {
        let next_line = line.into();
        self.with_progress_mut(|progress| {
            progress.logs.push(next_line);
            if progress.logs.len() > 400 {
                let excess = progress.logs.len() - 400;
                progress.logs.drain(0..excess);
            }
        });
    }

    pub(crate) fn complete(&self, success: bool, final_stage: impl Into<String>) {
        let stage_text = final_stage.into();
        self.with_progress_mut(|progress| {
            progress.running = false;
            progress.completed = true;
            progress.success = success;
            progress.stage = stage_text;
        });
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceInstallResponse {
    model_path: String,
    config_path: String,
}

fn value_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn sanitize_coqui_speaker_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Speaker ID is required.".to_string());
    }

    let mut out = String::with_capacity(trimmed.len());
    for character in trimmed.chars() {
        if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
            out.push(character);
            continue;
        }
        if character.is_whitespace() && !out.ends_with('-') {
            out.push('-');
        }
    }

    let normalized = out.trim_matches('-').to_string();
    if normalized.is_empty() {
        return Err("Speaker ID must include letters or numbers.".to_string());
    }

    Ok(normalized.chars().take(64).collect())
}

fn extension_from_file_name(file_name: Option<&str>) -> Option<String> {
    let raw_name = file_name?.trim();
    if raw_name.is_empty() {
        return None;
    }

    let extension = Path::new(raw_name)
        .extension()
        .and_then(|value| value.to_str())?
        .to_ascii_lowercase();
    if extension.is_empty() || extension.len() > 8 {
        return None;
    }
    Some(extension)
}

#[tauri::command]
pub(crate) async fn setup_assistant_runtime(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RuntimeSetupResponse, String> {
    let piper_path = ensure_piper_binary(&app, &state.http).await?;
    let (voice_model_path, voice_config_path) = ensure_voice_files(&app, &state.http).await?;

    Ok(RuntimeSetupResponse {
        piper_path: piper_path.to_string_lossy().into_owned(),
        voice_model_path: voice_model_path.to_string_lossy().into_owned(),
        voice_config_path: voice_config_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub(crate) async fn ensure_voice_model(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VoiceInstallResponse, String> {
    let (model_path, config_path) = ensure_voice_files(&app, &state.http).await?;

    Ok(VoiceInstallResponse {
        model_path: model_path.to_string_lossy().into_owned(),
        config_path: config_path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub(crate) async fn validate_piper(
    app: AppHandle,
    request: PiperValidationRequest,
) -> Result<PiperValidationResponse, String> {
    let piper_path = resolve_piper_path(&app, request.piper_path.as_deref())?;

    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new(&piper_path);
        apply_no_window(&mut command);
        command
            .arg("--help")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
            .output()
            .map_err(|error| format!("Failed to execute Piper at '{piper_path}': {error}"))
    })
    .await
    .map_err(|error| format!("Piper validation task failed: {error}"))??;

    let status_ok = output.status.success();
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let merged = if stdout.trim().is_empty() {
        stderr.as_ref()
    } else {
        stdout.as_ref()
    };

    Ok(PiperValidationResponse {
        ok: status_ok,
        details: clip_text(merged.trim(), 400),
    })
}

/// Shared Coqui status fetcher behind both `get_coqui_status` and
/// `validate_coqui` (Phase 6: no command-to-command calls).
async fn fetch_coqui_status(
    app: AppHandle,
    python_path: Option<String>,
) -> Result<CoquiStatusResponse, String> {
    if zero_python_mode_enabled() {
        let voice_dir = coqui_voices_dir(&app)?;
        return Ok(CoquiStatusResponse {
            available: false,
            python_path: String::new(),
            tts_version: String::new(),
            cuda_available: false,
            voice_dir: voice_dir.to_string_lossy().into_owned(),
            voices: Vec::new(),
            default_model: COQUI_DEFAULT_MODEL,
            error: ZERO_PYTHON_COQUI_NOTICE.to_string(),
        });
    }

    let python_path = resolve_coqui_python_path(&app, python_path.as_deref())?;
    let voice_dir = coqui_voices_dir(&app)?;

    let python_for_worker = python_path.clone();
    let voice_dir_for_worker = voice_dir.clone();
    let payload = json!({
      "action": "status",
      "voiceDir": voice_dir_for_worker.to_string_lossy().to_string(),
    });

    let result =
        tauri::async_runtime::spawn_blocking(move || run_coqui_bridge(&python_for_worker, payload))
            .await
            .map_err(|error| format!("Coqui status worker failed: {error}"))??;

    let available = result
        .get("available")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let tts_version = result
        .get("ttsVersion")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let cuda_available = result
        .get("cudaAvailable")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let bridge_python = result
        .get("pythonPath")
        .and_then(Value::as_str)
        .unwrap_or(&python_path)
        .to_string();
    let bridge_voice_dir = result
        .get("voiceDir")
        .and_then(Value::as_str)
        .unwrap_or_else(|| voice_dir.to_str().unwrap_or_default())
        .to_string();
    let voices = value_string_array(result.get("voices"));
    let error = result
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if available {
        info!(
            "[coqui.status] ready version={} cuda={} voices={}",
            tts_version,
            cuda_available,
            voices.len()
        );
    } else if !error.trim().is_empty() {
        warn!(
            "[coqui.status] unavailable error={}",
            clip_text(&single_line(&error), 420)
        );
    } else {
        warn!("[coqui.status] unavailable without explicit error");
    }

    Ok(CoquiStatusResponse {
        available,
        python_path: bridge_python,
        tts_version,
        cuda_available,
        voice_dir: bridge_voice_dir,
        voices,
        default_model: COQUI_DEFAULT_MODEL,
        error,
    })
}

#[tauri::command]
pub(crate) async fn get_coqui_status(
    app: AppHandle,
    request: CoquiStatusRequest,
) -> Result<CoquiStatusResponse, String> {
    fetch_coqui_status(app, request.python_path).await
}

#[tauri::command]
pub(crate) async fn setup_coqui_runtime(
    app: AppHandle,
    request: CoquiSetupRequest,
) -> Result<CoquiSetupResponse, String> {
    if zero_python_mode_enabled() {
        let _ = app;
        let _ = request;
        return Err(ZERO_PYTHON_COQUI_NOTICE.to_string());
    }

    let bootstrap_python = request
        .python_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("python")
        .to_string();
    validate_python_binary_path(&bootstrap_python)?;
    let use_gpu = request.use_gpu.unwrap_or(false);

    let app_for_worker = app.clone();
    let setup_result = tauri::async_runtime::spawn_blocking(move || {
        setup_coqui_runtime_blocking(&app_for_worker, &bootstrap_python, use_gpu)
    })
    .await
    .map_err(|error| format!("Coqui setup worker failed: {error}"))??;

    Ok(CoquiSetupResponse {
        python_path: setup_result.0,
        details: setup_result.1,
    })
}

#[tauri::command]
pub(crate) async fn validate_coqui(
    app: AppHandle,
    request: CoquiValidationRequest,
) -> Result<CoquiValidationResponse, String> {
    if zero_python_mode_enabled() {
        let _ = app;
        let _ = request;
        return Ok(CoquiValidationResponse {
            ok: false,
            details: ZERO_PYTHON_COQUI_NOTICE.to_string(),
        });
    }

    let status = fetch_coqui_status(app, request.python_path).await?;

    if status.available {
        let version = if status.tts_version.trim().is_empty() {
            "unknown".to_string()
        } else {
            status.tts_version
        };
        let details = format!(
            "Coqui is ready (version {version}). CUDA available: {}.",
            if status.cuda_available { "yes" } else { "no" }
        );
        return Ok(CoquiValidationResponse { ok: true, details });
    }

    let details = if status.error.trim().is_empty() {
        "Coqui runtime is not ready.".to_string()
    } else {
        status.error
    };

    Ok(CoquiValidationResponse { ok: false, details })
}

#[tauri::command]
pub(crate) async fn list_coqui_voices(
    app: AppHandle,
    request: CoquiVoicesRequest,
) -> Result<CoquiVoicesResponse, String> {
    if zero_python_mode_enabled() {
        let _ = request;
        let voice_dir = coqui_voices_dir(&app)?;
        return Ok(CoquiVoicesResponse {
            voice_dir: voice_dir.to_string_lossy().into_owned(),
            voices: Vec::new(),
        });
    }

    let _python_hint = request.python_path;
    let voice_dir = coqui_voices_dir(&app)?;
    let voices = list_coqui_voice_ids(&voice_dir)?;

    Ok(CoquiVoicesResponse {
        voice_dir: voice_dir.to_string_lossy().into_owned(),
        voices,
    })
}

#[tauri::command]
pub(crate) async fn list_coqui_models(
    app: AppHandle,
    request: CoquiModelsRequest,
) -> Result<CoquiModelsResponse, String> {
    if zero_python_mode_enabled() {
        let _ = app;
        let _ = request;
        return Ok(CoquiModelsResponse {
            models: vec![COQUI_DEFAULT_MODEL.to_string()],
        });
    }

    let python_path = resolve_coqui_python_path(&app, request.python_path.as_deref())?;
    let voice_dir = coqui_voices_dir(&app)?;
    let python_for_worker = python_path.clone();
    let payload = json!({
      "action": "list_models",
      "voiceDir": voice_dir.to_string_lossy().to_string(),
      "defaultModel": COQUI_DEFAULT_MODEL,
    });

    let result =
        tauri::async_runtime::spawn_blocking(move || run_coqui_bridge(&python_for_worker, payload))
            .await
            .map_err(|error| format!("Coqui model listing worker failed: {error}"))??;

    let models = value_string_array(result.get("models"));
    info!("[coqui.models] loaded {} models", models.len());
    Ok(CoquiModelsResponse { models })
}

#[tauri::command]
pub(crate) async fn clone_coqui_voice(
    app: AppHandle,
    request: CoquiVoiceCloneRequest,
) -> Result<CoquiVoiceCloneResponse, String> {
    if zero_python_mode_enabled() {
        let _ = app;
        let _ = request;
        return Err(ZERO_PYTHON_COQUI_NOTICE.to_string());
    }

    let speaker_id = sanitize_coqui_speaker_id(&request.speaker_id)?;
    let requested_file = request.file_name.as_deref().unwrap_or_default().to_string();
    info!(
        "[coqui.clone] request speaker={} model_hint={} file={} gpu={}",
        speaker_id,
        request.model_name.as_deref().unwrap_or_default(),
        requested_file,
        request.use_gpu.unwrap_or(false)
    );
    let audio_bytes = BASE64_STANDARD
        .decode(request.audio_base64.as_bytes())
        .map_err(|error| format!("Failed to decode uploaded voice sample: {error}"))?;

    if audio_bytes.is_empty() {
        warn!(
            "[coqui.clone] rejected empty sample for speaker={}",
            speaker_id
        );
        return Err("Uploaded voice sample is empty".to_string());
    }

    let model_name = request
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_MODEL)
        .to_string();
    let language = request
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_LANGUAGE)
        .to_string();
    let python_path = resolve_coqui_python_path(&app, request.python_path.as_deref())?;
    let use_gpu = request.use_gpu.unwrap_or(false);

    let uploads_dir = coqui_uploads_dir(&app)?;
    let previews_dir = coqui_previews_dir(&app)?;
    let voice_dir = coqui_voices_dir(&app)?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to compute timestamp: {error}"))?
        .as_millis();
    let extension =
        extension_from_file_name(request.file_name.as_deref()).unwrap_or_else(|| "wav".to_string());
    let upload_path = uploads_dir.join(format!("sample-{stamp}.{extension}"));
    let preview_path = previews_dir.join(format!("preview-{speaker_id}-{stamp}.wav"));

    fs::write(&upload_path, &audio_bytes)
        .map_err(|error| format!("Failed to store uploaded voice sample: {error}"))?;
    info!(
        "[coqui.clone] stored sample speaker={} bytes={} upload={} preview={}",
        speaker_id,
        audio_bytes.len(),
        upload_path.to_string_lossy(),
        preview_path.to_string_lossy()
    );

    let python_for_worker = python_path.clone();
    let upload_path_for_worker = upload_path.clone();
    let preview_path_for_worker = preview_path.clone();
    let voice_dir_for_worker = voice_dir.clone();
    let payload = json!({
      "action": "clone_voice",
      "modelName": model_name,
      "language": language,
      "speakerId": speaker_id,
      "referenceAudioPath": upload_path_for_worker.to_string_lossy().to_string(),
      "voiceDir": voice_dir_for_worker.to_string_lossy().to_string(),
      "previewOutputPath": preview_path_for_worker.to_string_lossy().to_string(),
      "useGpu": use_gpu,
      "maxReferenceSeconds": COQUI_MAX_REFERENCE_SECONDS,
    });

    info!("[coqui.clone] invoking bridge");
    let result =
        tauri::async_runtime::spawn_blocking(move || run_coqui_bridge(&python_for_worker, payload))
            .await
            .map_err(|error| format!("Coqui clone worker failed: {error}"))??;

    let duration_seconds = result
        .get("durationSeconds")
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as f32;
    let device = result
        .get("device")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let model_cached = result
        .get("modelCached")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let speaker_id = result
        .get("speakerId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let voices = {
        let from_result = value_string_array(result.get("voices"));
        if from_result.is_empty() {
            list_coqui_voice_ids(&voice_dir)?
        } else {
            from_result
        }
    };
    let preview_audio_base64 = if file_exists_with_content(&preview_path) {
        let bytes = fs::read(&preview_path)
            .map_err(|error| format!("Failed to read generated voice preview: {error}"))?;
        BASE64_STANDARD.encode(bytes)
    } else {
        String::new()
    };

    let _ = fs::remove_file(&upload_path);
    info!(
        "[coqui.clone] success speaker={} duration={} device={} model_cached={} voices={} preview={}",
        speaker_id,
        duration_seconds,
        device,
        model_cached,
        voices.len(),
        if preview_audio_base64.is_empty() {
            "missing"
        } else {
            "present"
        }
    );

    Ok(CoquiVoiceCloneResponse {
        speaker_id,
        duration_seconds,
        voice_dir: voice_dir.to_string_lossy().into_owned(),
        voices,
        preview_audio_base64,
    })
}

#[tauri::command]
pub(crate) async fn preview_coqui_voice(
    app: AppHandle,
    request: CoquiVoicePreviewRequest,
) -> Result<CoquiVoicePreviewResponse, String> {
    if zero_python_mode_enabled() {
        let _ = app;
        let _ = request;
        return Err(ZERO_PYTHON_COQUI_NOTICE.to_string());
    }

    let speaker_id = request
        .speaker_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Select a Coqui voice profile before testing.".to_string())?
        .to_string();
    let text = request
        .text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("This is a preview of your selected cloned voice.")
        .to_string();

    let coqui = CoquiPipelineRequest {
        python_path: request.python_path,
        model_name: request.model_name,
        language: request.language,
        speaker_id: Some(speaker_id.clone()),
        speed: request.speed,
        quality: request.quality,
        emotion: request.emotion,
        use_gpu: request.use_gpu,
        split_sentences: request.split_sentences,
    };

    info!(
        "[coqui.preview] start speaker={} model={}",
        speaker_id,
        coqui.model_name.as_deref().unwrap_or(COQUI_DEFAULT_MODEL)
    );
    let wav_bytes = synthesize_with_coqui(&app, &coqui, text.clone()).await?;
    info!(
        "[coqui.preview] success speaker={} bytes={}",
        speaker_id,
        wav_bytes.len()
    );

    Ok(CoquiVoicePreviewResponse {
        audio_base64: BASE64_STANDARD.encode(wav_bytes),
        text,
    })
}

#[tauri::command]
pub(crate) async fn start_tts_runtime_setup(
    app: AppHandle,
    state: State<'_, AppState>,
    setup_state: State<'_, TtsSetupState>,
    request: TtsSetupStartRequest,
) -> Result<TtsSetupStatusResponse, String> {
    let setup = setup_state.clone_handle();
    let snapshot = setup.snapshot();
    if snapshot.running {
        return Ok(snapshot);
    }

    let http = state.http.clone();
    let app_for_task = app.clone();
    let setup_for_task = setup.clone_handle();
    let bootstrap_python = request
        .python_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("python")
        .to_string();
    if let Err(error) = validate_python_binary_path(&bootstrap_python) {
        return Err(error);
    }
    let use_gpu = request.use_gpu.unwrap_or(false);

    setup.reset_and_start();
    setup.append_log(format!(
        "Bootstrap config -> python: '{bootstrap_python}', gpu: {}",
        if use_gpu { "enabled" } else { "disabled" }
    ));

    tauri::async_runtime::spawn(async move {
        setup_for_task.set_stage("Setting up Piper runtime...");
        setup_for_task.append_log("Downloading/extracting Piper runtime if missing...");
        let piper_path = match ensure_piper_binary(&app_for_task, &http).await {
            Ok(path) => path,
            Err(error) => {
                setup_for_task.append_log(format!("Piper setup failed: {error}"));
                setup_for_task.complete(false, "Piper setup failed.");
                return;
            }
        };
        setup_for_task.append_log(format!(
            "Piper runtime ready at {}",
            piper_path.to_string_lossy()
        ));

        setup_for_task.set_stage("Downloading Piper voice model...");
        setup_for_task.append_log("Ensuring Piper voice files are installed...");
        let (voice_model_path, _) = match ensure_voice_files(&app_for_task, &http).await {
            Ok(paths) => paths,
            Err(error) => {
                setup_for_task.append_log(format!("Piper voice setup failed: {error}"));
                setup_for_task.complete(false, "Piper voice setup failed.");
                return;
            }
        };
        setup_for_task.append_log(format!(
            "Piper voice ready at {}",
            voice_model_path.to_string_lossy()
        ));

        if zero_python_mode_enabled() {
            setup_for_task.append_log("Skipping Coqui setup (zero-Python mode).".to_string());
            setup_for_task.complete(true, "TTS setup complete (Piper only).");
            return;
        }

        setup_for_task.set_stage("Setting up Coqui runtime...");
        setup_for_task.append_log("Creating Coqui environment and installing packages...");
        let coqui_setup = tauri::async_runtime::spawn_blocking({
            let app_for_blocking = app_for_task.clone();
            let python = bootstrap_python.clone();
            move || setup_coqui_runtime_blocking(&app_for_blocking, &python, use_gpu)
        })
        .await;

        let (coqui_python, coqui_details) = match coqui_setup {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => {
                setup_for_task.append_log(format!("Coqui setup failed: {error}"));
                setup_for_task.complete(false, "Coqui setup failed.");
                return;
            }
            Err(error) => {
                setup_for_task.append_log(format!("Coqui setup worker failed: {error}"));
                setup_for_task.complete(false, "Coqui setup worker failed.");
                return;
            }
        };
        setup_for_task.append_log(format!("Coqui runtime ready with python: {coqui_python}"));
        if !coqui_details.trim().is_empty() {
            setup_for_task.append_log(format!(
                "Coqui install log: {}",
                clip_text(&single_line(&coqui_details), 420)
            ));
        }

        setup_for_task.set_stage("Validating Coqui runtime...");
        let coqui_status = tauri::async_runtime::spawn_blocking({
            let app_for_blocking = app_for_task.clone();
            let python_for_blocking = coqui_python.clone();
            move || {
                let voice_dir = coqui_voices_dir(&app_for_blocking)?;
                let payload = json!({
                  "action": "status",
                  "voiceDir": voice_dir.to_string_lossy().to_string(),
                });
                run_coqui_bridge(&python_for_blocking, payload)
            }
        })
        .await;

        let (coqui_available, coqui_error) = match coqui_status {
            Ok(Ok(result)) => (
                result
                    .get("available")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                result
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            ),
            Ok(Err(error)) => {
                setup_for_task.append_log(format!("Coqui status check failed: {error}"));
                setup_for_task.complete(false, "Coqui validation failed.");
                return;
            }
            Err(error) => {
                setup_for_task.append_log(format!("Coqui status worker failed: {error}"));
                setup_for_task.complete(false, "Coqui validation worker failed.");
                return;
            }
        };

        if !coqui_available {
            let error_text = if coqui_error.trim().is_empty() {
                "unknown Coqui status error".to_string()
            } else {
                coqui_error
            };
            setup_for_task.append_log(format!(
                "Coqui reported unavailable after setup: {}",
                clip_text(&single_line(&error_text), 420)
            ));
            setup_for_task.complete(false, "Coqui unavailable after setup.");
            return;
        }

        setup_for_task.append_log("Coqui validation succeeded.".to_string());
        setup_for_task.complete(true, "TTS setup complete.");
    });

    Ok(setup.snapshot())
}

#[tauri::command]
pub(crate) async fn get_tts_runtime_setup_status(
    setup_state: State<'_, TtsSetupState>,
) -> Result<TtsSetupStatusResponse, String> {
    Ok(setup_state.snapshot())
}
