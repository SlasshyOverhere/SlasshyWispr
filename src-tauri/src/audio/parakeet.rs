//! Native Parakeet in-process STT runtime.
//!
//! Owns the `transcribe_rs::ParakeetEngine` lifecycle: in-memory model cache,
//! operation serialization lock, int8 model loading, idle unload, and the
//! CPU transcription path (with optional Silero VAD trimming).
//!
//! This is deliberately NOT merged with the Python STT runtime provisioning
//! (`setup_local_stt_runtime_blocking` in `lib.rs`) — that is a separate
//! subsystem with its own lifecycle.

use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use log::{info, warn};

use transcribe_rs::{
    engines::parakeet::{
        ParakeetEngine, ParakeetInferenceParams, ParakeetModelParams, TimestampGranularity,
    },
    TranscriptionEngine,
};

use crate::audio::processing::decode_local_stt_audio_to_mono_f32;
use crate::audio::vad;
use crate::constants::LOCAL_STT_PARAKEET_UNLOAD_AFTER_TRANSCRIBE_ENV;
use crate::pipeline::log::clip_text;

pub(crate) struct NativeParakeetRuntime {
    pub(crate) model_key: String,
    pub(crate) engine: ParakeetEngine,
    pub(crate) last_used: Instant,
}

static LOCAL_STT_NATIVE_PARAKEET_OP_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static LOCAL_STT_NATIVE_PARAKEET_RUNTIME: OnceLock<Mutex<Option<NativeParakeetRuntime>>> =
    OnceLock::new();

pub(crate) fn local_stt_native_parakeet_runtime() -> &'static Mutex<Option<NativeParakeetRuntime>> {
    LOCAL_STT_NATIVE_PARAKEET_RUNTIME.get_or_init(|| Mutex::new(None))
}

fn local_stt_native_parakeet_op_lock() -> &'static Mutex<()> {
    LOCAL_STT_NATIVE_PARAKEET_OP_LOCK.get_or_init(|| Mutex::new(()))
}

/// Whether the native Parakeet model should be unloaded after each
/// transcription.
///
/// Mirrors `pipeline::routing::env_flag` semantics inline so the audio layer
/// keeps no pipeline dependency.
fn parakeet_unload_after_transcribe() -> bool {
    match std::env::var(LOCAL_STT_PARAKEET_UNLOAD_AFTER_TRANSCRIBE_ENV)
        .ok()
        .map(|value| value.trim().to_ascii_lowercase())
        .unwrap_or_default()
        .as_str()
    {
        "1" | "true" | "yes" | "y" | "on" => true,
        "0" | "false" | "no" | "n" | "off" => false,
        _ => false,
    }
}

fn normalize_native_parakeet_model_key(model_root: &Path) -> String {
    #[cfg(target_os = "windows")]
    {
        model_root.to_string_lossy().to_ascii_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        model_root.to_string_lossy().to_string()
    }
}

pub(crate) fn get_or_load_native_parakeet_runtime(model_root: &Path) -> Result<bool, String> {
    let _op_guard = local_stt_native_parakeet_op_lock()
        .lock()
        .map_err(|_| "Native Parakeet operation lock poisoned.".to_string())?;
    let model_key = normalize_native_parakeet_model_key(model_root);
    let runtime = local_stt_native_parakeet_runtime();
    let mut guard = runtime
        .lock()
        .map_err(|_| "Native Parakeet runtime lock poisoned.".to_string())?;

    if let Some(current) = guard.as_mut() {
        if current.model_key == model_key {
            current.last_used = Instant::now();
            return Ok(true);
        }
        let _ = current.engine.unload_model();
        *guard = None;
    }
    drop(guard);

    let mut engine = ParakeetEngine::new();
    engine
        .load_model_with_params(model_root, ParakeetModelParams::int8())
        .map_err(|error| {
            format!(
                "Failed to load native Parakeet model '{}' with int8 params: {}",
                model_root.display(),
                error
            )
        })?;

    let mut guard = runtime
        .lock()
        .map_err(|_| "Native Parakeet runtime lock poisoned.".to_string())?;
    if let Some(current) = guard.as_mut() {
        if current.model_key == model_key {
            current.last_used = Instant::now();
            return Ok(true);
        }
        let _ = current.engine.unload_model();
        *guard = None;
    }
    *guard = Some(NativeParakeetRuntime {
        model_key,
        engine,
        last_used: Instant::now(),
    });
    Ok(false)
}

pub(crate) fn unload_native_parakeet_runtime(reason: &str) -> Result<bool, String> {
    let _op_guard = local_stt_native_parakeet_op_lock()
        .lock()
        .map_err(|_| "Native Parakeet operation lock poisoned.".to_string())?;
    let runtime = local_stt_native_parakeet_runtime();
    let mut guard = runtime
        .lock()
        .map_err(|_| "Native Parakeet runtime lock poisoned.".to_string())?;

    if let Some(mut active) = guard.take() {
        let _ = active.engine.unload_model();
        info!(
            "[local.stt.parakeet.native] runtime unloaded reason={} model_key={}",
            clip_text(reason, 80),
            clip_text(&active.model_key, 220)
        );
        return Ok(true);
    }
    Ok(false)
}

pub(crate) fn native_parakeet_runtime_loaded() -> bool {
    let runtime = local_stt_native_parakeet_runtime();
    let guard = match runtime.try_lock() {
        Ok(guard) => guard,
        Err(std::sync::TryLockError::WouldBlock) => return true,
        Err(std::sync::TryLockError::Poisoned(_)) => return false,
    };
    guard.is_some()
}

pub(crate) fn transcribe_local_stt_parakeet_native(
    model_root: &Path,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    vad_model_path: Option<String>,
) -> Result<(String, bool, bool), String> {
    let model_cached = get_or_load_native_parakeet_runtime(model_root)?;
    let mut audio_samples = decode_local_stt_audio_to_mono_f32(audio_bytes, audio_mime_type)?;

    if let Some(ref model_path) = vad_model_path {
        if !model_path.is_empty() {
            match vad::trim_speech(&audio_samples, std::path::Path::new(model_path)) {
                Ok(Some(trimmed)) => {
                    audio_samples = trimmed;
                }
                Ok(None) => {
                    return Err(
                        "No speech detected. Please speak into the microphone and try again."
                            .to_string(),
                    );
                }
                Err(error) => {
                    warn!("[vad] trim_speech failed, continuing without VAD: {}", error);
                }
            }
        }
    }

    let unload_after_transcribe = parakeet_unload_after_transcribe();

    let runtime = local_stt_native_parakeet_runtime();
    let mut guard = runtime
        .lock()
        .map_err(|_| "Native Parakeet runtime lock poisoned.".to_string())?;
    let active = guard
        .as_mut()
        .ok_or_else(|| "Native Parakeet runtime is not loaded.".to_string())?;
    active.last_used = Instant::now();

    let params = ParakeetInferenceParams {
        timestamp_granularity: TimestampGranularity::Segment,
        ..Default::default()
    };
    let result = active
        .engine
        .transcribe_samples(audio_samples, Some(params))
        .map_err(|error| format!("Native Parakeet transcription failed: {error}"))?;
    let transcript = result.text.trim().to_string();
    if transcript.is_empty() {
        return Err("Native Parakeet STT returned an empty transcript.".to_string());
    }

    if unload_after_transcribe {
        let _ = active.engine.unload_model();
        *guard = None;
    }
    Ok((transcript, model_cached, unload_after_transcribe))
}
