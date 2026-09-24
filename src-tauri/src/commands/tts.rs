//! TTS commands — Piper setup plus native voice cloning.
//!
//! Voice cloning used to be a Python bridge (`setup_coqui_runtime`, `clone_coqui_voice`,
//! ...). It now runs in this process through sherpa-onnx, so the whole command surface
//! shrank to: status, ensure model, list voices, clone, preview, delete, unload.

use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::audio::processing::decode_local_stt_audio_to_mono_f32;
use crate::constants::{VOICE_CLONE_MAX_REFERENCE_SECONDS, VOICE_CLONE_NUM_STEPS};
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::process::apply_no_window;
use crate::pipeline::tts::{
    assets_present, delete_voice_profile, engine_loaded, ensure_clone_assets, ensure_piper_binary,
    ensure_voice_files, list_voice_profiles, save_voice_profile, synthesize_cloned, unload_engine,
    validate_reference_duration, voice_clone_models_dir, voice_clone_voice_dir,
    voice_clone_voices_dir,
};

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
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceCloneStatusResponse {
    /// Model files are on disk and a synthesis would not need a download.
    model_ready: bool,
    engine_loaded: bool,
    voices: Vec<String>,
    max_reference_seconds: f32,
    num_steps: i32,
    error: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceCloneModelResponse {
    model_dir: String,
    voices: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceCloneListResponse {
    voices: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceCloneRequest {
    speaker_id: String,
    audio_base64: String,
    file_name: Option<String>,
    /// The exact words spoken in the reference clip. ZipVoice degrades when this is
    /// approximate, so the enrolment flow reads a known sentence rather than transcribing.
    reference_text: Option<String>,
    preview_text: Option<String>,
    speed: Option<f32>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceCloneResponse {
    speaker_id: String,
    duration_seconds: f32,
    voices: Vec<String>,
    preview_audio_base64: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceClonePreviewRequest {
    speaker_id: String,
    text: Option<String>,
    speed: Option<f32>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceClonePreviewResponse {
    audio_base64: String,
    text: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceCloneDeleteRequest {
    speaker_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceCloneEngineResponse {
    engine_loaded: bool,
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
            progress
                .logs
                .push("Starting TTS bootstrap for the Piper runtime.".to_string());
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

/// Profile ids become directory names, so anything outside this set is dropped.
fn sanitize_voice_id(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Voice profile ID is required.".to_string());
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
        return Err("Voice profile ID must include letters or numbers.".to_string());
    }

    Ok(normalized.chars().take(64).collect())
}

fn voice_list(app: &AppHandle) -> Result<Vec<String>, String> {
    list_voice_profiles(&voice_clone_voices_dir(app)?)
}

/// Resolve the clone assets, loading the model if it is not on disk yet.
async fn resolve_clone_assets(
    app: &AppHandle,
    http: &reqwest::Client,
) -> Result<crate::pipeline::tts::CloneAssets, String> {
    let models_dir = voice_clone_models_dir(app)?;
    ensure_clone_assets(&models_dir, http).await
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

#[tauri::command]
pub(crate) async fn get_voice_clone_status(
    app: AppHandle,
) -> Result<VoiceCloneStatusResponse, String> {
    let models_dir = voice_clone_models_dir(&app)?;
    let voices = voice_list(&app)?;
    let model_ready = assets_present(&models_dir)?;

    Ok(VoiceCloneStatusResponse {
        model_ready,
        engine_loaded: engine_loaded(),
        voices,
        max_reference_seconds: VOICE_CLONE_MAX_REFERENCE_SECONDS,
        num_steps: VOICE_CLONE_NUM_STEPS,
        error: String::new(),
    })
}

#[tauri::command]
pub(crate) async fn ensure_voice_clone_model(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VoiceCloneModelResponse, String> {
    let models_dir = voice_clone_models_dir(&app)?;
    resolve_clone_assets(&app, &state.http).await?;

    Ok(VoiceCloneModelResponse {
        model_dir: models_dir.to_string_lossy().into_owned(),
        voices: voice_list(&app)?,
    })
}

#[tauri::command]
pub(crate) async fn list_voice_clones(app: AppHandle) -> Result<VoiceCloneListResponse, String> {
    Ok(VoiceCloneListResponse {
        voices: voice_list(&app)?,
    })
}

#[tauri::command]
pub(crate) async fn clone_voice(
    app: AppHandle,
    state: State<'_, AppState>,
    request: VoiceCloneRequest,
) -> Result<VoiceCloneResponse, String> {
    let speaker_id = sanitize_voice_id(&request.speaker_id)?;
    let reference_text = request
        .reference_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Provide the exact words spoken in the reference clip — voice cloning conditions on it."
                .to_string()
        })?
        .to_string();

    info!(
        "[voice-clone] clone request speaker={} file={} reference_chars={}",
        speaker_id,
        request.file_name.as_deref().unwrap_or_default(),
        reference_text.chars().count()
    );

    let audio_bytes = BASE64_STANDARD
        .decode(request.audio_base64.as_bytes())
        .map_err(|error| format!("Failed to decode the reference clip: {error}"))?;
    if audio_bytes.is_empty() {
        return Err("The uploaded reference clip is empty.".to_string());
    }

    // The decoder normalises to 16 kHz mono, which is also what the stored profile holds.
    let samples = decode_local_stt_audio_to_mono_f32(
        &audio_bytes,
        request.file_name.as_deref().unwrap_or("wav"),
    )?;
    let sample_rate: u32 = 16_000;
    validate_reference_duration(&samples, sample_rate)?;
    let duration_seconds = samples.len() as f32 / sample_rate as f32;

    let assets = resolve_clone_assets(&app, &state.http).await?;

    let voice_dir = voice_clone_voice_dir(&app, &speaker_id)?;
    save_voice_profile(&voice_dir, &samples, sample_rate, &reference_text)?;
    info!(
        "[voice-clone] stored profile speaker={} duration={:.2}s",
        speaker_id, duration_seconds
    );

    let preview_text = request
        .preview_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("This is a preview of your cloned voice.")
        .to_string();
    let speed = request.speed.unwrap_or(1.0);
    let voice_dir_for_worker = voice_dir.clone();
    let preview_audio_base64 = match tauri::async_runtime::spawn_blocking(move || {
        synthesize_cloned(&assets, &voice_dir_for_worker, &preview_text, speed)
    })
    .await
    {
        Ok(Ok(bytes)) => BASE64_STANDARD.encode(bytes),
        Ok(Err(error)) => {
            warn!(
                "[voice-clone] preview failed after clone: {}",
                clip_text(&single_line(&error), 300)
            );
            String::new()
        }
        Err(error) => {
            warn!("[voice-clone] preview worker failed: {error}");
            String::new()
        }
    };

    Ok(VoiceCloneResponse {
        speaker_id,
        duration_seconds,
        voices: voice_list(&app)?,
        preview_audio_base64,
    })
}

#[tauri::command]
pub(crate) async fn preview_cloned_voice(
    app: AppHandle,
    state: State<'_, AppState>,
    request: VoiceClonePreviewRequest,
) -> Result<VoiceClonePreviewResponse, String> {
    let speaker_id = sanitize_voice_id(&request.speaker_id)?;
    let text = request
        .text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("This is a preview of your cloned voice.")
        .to_string();
    let speed = request.speed.unwrap_or(1.0);

    let assets = resolve_clone_assets(&app, &state.http).await?;
    let voice_dir = voice_clone_voice_dir(&app, &speaker_id)?;

    let started = std::time::Instant::now();
    let text_for_worker = text.clone();
    let wav_bytes = tauri::async_runtime::spawn_blocking(move || {
        synthesize_cloned(&assets, &voice_dir, &text_for_worker, speed)
    })
    .await
    .map_err(|error| format!("Voice-clone preview worker failed: {error}"))??;

    info!(
        "[voice-clone] preview speaker={} bytes={} latency_ms={}",
        speaker_id,
        wav_bytes.len(),
        started.elapsed().as_millis()
    );

    Ok(VoiceClonePreviewResponse {
        audio_base64: BASE64_STANDARD.encode(wav_bytes),
        text,
    })
}

#[tauri::command]
pub(crate) async fn delete_voice_clone(
    app: AppHandle,
    request: VoiceCloneDeleteRequest,
) -> Result<VoiceCloneListResponse, String> {
    let speaker_id = sanitize_voice_id(&request.speaker_id)?;
    delete_voice_profile(&voice_clone_voice_dir(&app, &speaker_id)?)?;

    Ok(VoiceCloneListResponse {
        voices: voice_list(&app)?,
    })
}

#[tauri::command]
pub(crate) async fn unload_voice_clone_model(
    _app: AppHandle,
) -> Result<VoiceCloneEngineResponse, String> {
    unload_engine();

    Ok(VoiceCloneEngineResponse {
        engine_loaded: engine_loaded(),
    })
}

/// Piper only. The clone model is ~156 MB and downloads on demand from the voice-clone
/// panel instead, so "set up TTS" never silently pulls it.
#[tauri::command]
pub(crate) async fn start_tts_runtime_setup(
    app: AppHandle,
    state: State<'_, AppState>,
    setup_state: State<'_, TtsSetupState>,
) -> Result<TtsSetupStatusResponse, String> {
    let setup = setup_state.clone_handle();
    let snapshot = setup.snapshot();
    if snapshot.running {
        return Ok(snapshot);
    }

    let http = state.http.clone();
    let app_for_task = app.clone();
    let setup_for_task = setup.clone_handle();

    setup.reset_and_start();

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
