//! Coqui TTS synthesis via bridge worker (Phase 7b).
//!
//! Payload construction + synthesis live here. Daemon transport (spawn/send,
//! response parsing) lives in `crate::pipeline::daemon`. Path resolution in
//! `super::paths`; length validation in `super::normalize`.
//!
//! Note: the Coqui bridge script is no longer bundled, so `run_coqui_bridge`
//! returns the pre-existing disabled error (same message as the deleted stub).

use std::fs;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use log::info;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::constants::*;
use crate::pipeline::process::{elapsed_ms, validate_python_binary_path};

use super::normalize::validate_tts_input_length;
use super::paths::{coqui_voices_dir, resolve_coqui_python_path};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CoquiPipelineRequest {
    pub(crate) python_path: Option<String>,
    pub(crate) model_name: Option<String>,
    pub(crate) language: Option<String>,
    pub(crate) speaker_id: Option<String>,
    pub(crate) speed: Option<f32>,
    pub(crate) quality: Option<String>,
    pub(crate) emotion: Option<String>,
    pub(crate) use_gpu: Option<bool>,
    pub(crate) split_sentences: Option<bool>,
}

pub fn run_coqui_bridge(app: &AppHandle, python_path: &str, payload: Value) -> Result<Value, String> {
    // The Coqui bridge script is no longer bundled (dead stub deleted in
    // Phase 7b); every bridge action short-circuits with the same error the
    // stub always returned. Python-path validation runs first to preserve the
    // original error ordering.
    validate_python_binary_path(python_path)?;
    let _ = (app, payload);
    Err("Coqui TTS is disabled. The bridge script is no longer bundled.".to_string())
}

pub async fn synthesize_with_coqui(
    app: &AppHandle,
    coqui: &CoquiPipelineRequest,
    text: String,
) -> Result<Vec<u8>, String> {
    if crate::pipeline::routing::zero_python_mode_enabled() {
        return Err(ZERO_PYTHON_COQUI_NOTICE.to_string());
    }
    let synth_start = Instant::now();
    let clean_text = text.replace('\r', " ").trim().to_string();
    if clean_text.is_empty() {
        return Err("No text provided for TTS".to_string());
    }
    validate_tts_input_length(&clean_text)?;

    let model_name = coqui
        .model_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_MODEL)
        .to_string();
    let language = coqui
        .language
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_LANGUAGE)
        .to_string();
    let speaker_id = coqui
        .speaker_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Select or clone a Coqui voice before using Coqui TTS.".to_string())?
        .to_string();
    let speed = coqui.speed.unwrap_or(1.0).clamp(0.5, 2.0);
    let quality = coqui
        .quality
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_QUALITY)
        .to_string();
    let emotion = coqui
        .emotion
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(COQUI_DEFAULT_EMOTION)
        .to_string();
    let use_gpu = coqui.use_gpu.unwrap_or(false);
    let split_sentences = coqui.split_sentences.unwrap_or(false);
    let python_path = resolve_coqui_python_path(app, coqui.python_path.as_deref())?;

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to compute timestamp: {error}"))?
        .as_millis();
    let output_path = std::env::temp_dir().join(format!("slasshy-coqui-tts-{stamp}.wav"));
    let voice_dir = coqui_voices_dir(app)?;

    let app_for_worker = app.clone();
    let python_for_worker = python_path;
    let output_path_for_worker = output_path.clone();
    let voice_dir_for_worker = voice_dir.clone();
    let payload = json!({
      "action": "synthesize",
      "text": clean_text,
      "modelName": model_name,
      "language": language,
      "speakerId": speaker_id,
      "speed": speed,
      "quality": quality,
      "emotion": emotion,
      "useGpu": use_gpu,
      "splitSentences": split_sentences,
      "outputPath": output_path_for_worker.to_string_lossy().to_string(),
      "voiceDir": voice_dir_for_worker.to_string_lossy().to_string(),
    });

    info!(
        "[coqui.synthesize] request speaker={} model={} language={} gpu={} quality={} emotion={} split={}",
        speaker_id,
        payload.get("modelName").and_then(Value::as_str).unwrap_or(COQUI_DEFAULT_MODEL),
        language,
        use_gpu,
        quality,
        emotion,
        split_sentences
    );
    tauri::async_runtime::spawn_blocking(move || {
        run_coqui_bridge(&app_for_worker, &python_for_worker, payload)
    })
    .await
    .map_err(|error| format!("Coqui synthesis worker failed: {error}"))?
    .map(|result| {
        let device = result
            .get("device")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let model_cached = result
            .get("modelCached")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        info!(
            "[coqui.synthesize] bridge done device={} model_cached={}",
            device, model_cached
        );
        result
    })?;

    let wav_bytes = fs::read(&output_path)
        .map_err(|error| format!("Failed to read Coqui output WAV: {error}"))?;
    let _ = fs::remove_file(&output_path);

    info!(
        "[coqui.synthesize] success bytes={} latency_ms={}",
        wav_bytes.len(),
        elapsed_ms(synth_start)
    );

    Ok(wav_bytes)
}

