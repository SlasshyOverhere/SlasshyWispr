//! TTS filesystem path resolution (Phase 7b).
//!
//! Resolves `app_data_dir()` once at the Tauri boundary (`AppHandle`) and
//! exposes the joined directory/file paths. Synthesizers take these paths
//! as `&Path` arguments instead of re-resolving through `AppHandle`.

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::constants::{VOICE_CONFIG_FILE, VOICE_MODEL_FILE};

fn app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}

pub fn piper_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = app_data_root(app)?.join("piper").join("runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("Failed to create Piper runtime directory: {error}"))?;

    Ok(runtime_dir)
}

pub fn voice_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let voice_dir = app_data_root(app)?
        .join("piper")
        .join("en_US_hfc_female_medium");
    fs::create_dir_all(&voice_dir)
        .map_err(|error| format!("Failed to create voice directory: {error}"))?;

    Ok((
        voice_dir.join(VOICE_MODEL_FILE),
        voice_dir.join(VOICE_CONFIG_FILE),
    ))
}

fn voice_clone_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app_data_root(app)?.join("voice-clone");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create voice-clone directory: {error}"))?;
    Ok(root)
}

/// Where the ZipVoice archive is unpacked (encoder, decoder, tokens, espeak-ng-data, vocoder).
pub fn voice_clone_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let models_dir = voice_clone_root_dir(app)?.join("models");
    fs::create_dir_all(&models_dir)
        .map_err(|error| format!("Failed to create voice-clone model directory: {error}"))?;
    Ok(models_dir)
}

/// One directory per cloned voice: the reference clip and the transcript it was read from.
pub fn voice_clone_voices_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let voices_dir = voice_clone_root_dir(app)?.join("voices");
    fs::create_dir_all(&voices_dir)
        .map_err(|error| format!("Failed to create voice-clone voices directory: {error}"))?;
    Ok(voices_dir)
}

/// `voice_id` must already be sanitized by the command layer.
pub fn voice_clone_voice_dir(app: &AppHandle, voice_id: &str) -> Result<PathBuf, String> {
    Ok(voice_clone_voices_dir(app)?.join(voice_id))
}

/// Where the last preview was written, so the settings pane can play it back.
pub fn voice_clone_previews_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let previews_dir = voice_clone_root_dir(app)?.join("previews");
    fs::create_dir_all(&previews_dir)
        .map_err(|error| format!("Failed to create voice-clone previews directory: {error}"))?;
    Ok(previews_dir)
}
