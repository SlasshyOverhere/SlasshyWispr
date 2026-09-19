//! TTS filesystem path resolution (Phase 7b).
//!
//! Resolves `app_data_dir()` once at the Tauri boundary (`AppHandle`) and
//! exposes the joined directory/file paths. Synthesizers take these paths
//! as `&Path` arguments instead of re-resolving through `AppHandle`.
//!
//! The dead Coqui bridge-script stub was deleted here (it always errored:
//! "Coqui TTS is disabled. The bridge script is no longer bundled.").

use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::constants::{VOICE_CONFIG_FILE, VOICE_MODEL_FILE};
use crate::pipeline::fs::file_exists_with_content;
use crate::pipeline::process::validate_python_binary_path;

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

pub fn coqui_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app_data_root(app)?.join("coqui");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create Coqui root directory: {error}"))?;
    Ok(root)
}

pub fn coqui_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = coqui_root_dir(app)?.join("runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("Failed to create Coqui runtime directory: {error}"))?;
    Ok(runtime_dir)
}

pub fn coqui_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cache_dir = coqui_root_dir(app)?.join("cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Failed to create Coqui cache directory: {error}"))?;
    Ok(cache_dir)
}

pub fn coqui_voices_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let voice_dir = coqui_root_dir(app)?.join("voices");
    fs::create_dir_all(&voice_dir)
        .map_err(|error| format!("Failed to create Coqui voices directory: {error}"))?;
    Ok(voice_dir)
}

pub fn coqui_uploads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let uploads_dir = coqui_root_dir(app)?.join("uploads");
    fs::create_dir_all(&uploads_dir)
        .map_err(|error| format!("Failed to create Coqui uploads directory: {error}"))?;
    Ok(uploads_dir)
}

pub fn coqui_previews_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let previews_dir = coqui_root_dir(app)?.join("previews");
    fs::create_dir_all(&previews_dir)
        .map_err(|error| format!("Failed to create Coqui previews directory: {error}"))?;
    Ok(previews_dir)
}

pub fn coqui_venv_python_path(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = coqui_runtime_dir(app)?;
    #[cfg(target_os = "windows")]
    {
        Ok(runtime_dir.join("venv").join("Scripts").join("python.exe"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(runtime_dir.join("venv").join("bin").join("python"))
    }
}

pub fn resolve_coqui_python_path(
    app: &AppHandle,
    requested_path: Option<&str>,
) -> Result<String, String> {
    if let Some(path) = requested_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        validate_python_binary_path(path)?;
        return Ok(path.to_string());
    }

    let venv_python = coqui_venv_python_path(app)?;
    if file_exists_with_content(&venv_python) {
        let resolved = venv_python.to_string_lossy().into_owned();
        validate_python_binary_path(&resolved)?;
        return Ok(resolved);
    }

    validate_python_binary_path("python")?;
    Ok("python".to_string())
}
