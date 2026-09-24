//! Dictation recording commands — Phase 6b thin-adapter extraction.
//!
//! Moved verbatim from lib.rs: helpers + RecordingsStats + 5 commands.
//! No signature or logic changes.

use std::fs;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use log::{info, warn};
use tauri::{AppHandle, Manager};

use crate::security;
use crate::security::validate_base64_input;

fn recordings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
        .join("recordings");
    fs::create_dir_all(&dir).map_err(|error| {
        format!(
            "Failed to create recordings directory '{}': {error}",
            dir.display()
        )
    })?;
    Ok(dir)
}

fn recording_extension_for_mime(mime_type: &str) -> &'static str {
    let normalized = mime_type.trim().to_ascii_lowercase();
    if normalized.starts_with("audio/webm") {
        "webm"
    } else if normalized.starts_with("audio/wav") || normalized.starts_with("audio/x-wav") {
        "wav"
    } else if normalized.starts_with("audio/ogg") {
        "ogg"
    } else if normalized.starts_with("audio/mp4") {
        "mp4"
    } else {
        "webm"
    }
}

fn mime_for_extension(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "mp4" => "audio/mp4",
        _ => "audio/webm",
    }
}

pub(crate) enum StartupLocalSttWarmupTarget {
    DisabledByRuntimeMode,
    MissingModel,
    Model(String),
}

fn validate_recording_id(id: &str) -> Result<(), String> {
    security::validate_text_input(id, 128, "recordingId")?;
    if id.is_empty() {
        return Err("recordingId must not be empty".to_string());
    }
    if id
        .chars()
        .any(|c| c.is_whitespace() || c == '.' || c == '/' || c == '\\' || c == ':')
    {
        return Err("recordingId contains forbidden characters".to_string());
    }
    Ok(())
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecordingsStats {
    file_count: u32,
    total_bytes: u64,
}

#[tauri::command]
pub(crate) async fn save_dictation_recording(
    app: AppHandle,
    recording_id: String,
    mime_type: String,
    audio_base64: String,
) -> Result<u64, String> {
    validate_recording_id(&recording_id)?;
    let audio_bytes = validate_base64_input(&audio_base64, 64 * 1024 * 1024)?;
    let extension = recording_extension_for_mime(&mime_type);
    let dir = recordings_dir(&app)?;
    let path = dir.join(format!("{recording_id}.{extension}"));
    fs::write(&path, &audio_bytes).map_err(|error| {
        format!(
            "Failed to write dictation recording '{}': {error}",
            path.display()
        )
    })?;
    let size = audio_bytes.len() as u64;
    info!(
        "[recordings] saved id={} bytes={} path='{}'",
        recording_id,
        size,
        path.display()
    );
    Ok(size)
}

#[tauri::command]
pub(crate) async fn list_dictation_recordings_stats(
    app: AppHandle,
) -> Result<RecordingsStats, String> {
    let dir = recordings_dir(&app)?;
    let mut total_bytes: u64 = 0;
    let mut file_count: u32 = 0;
    let entries = fs::read_dir(&dir).map_err(|error| {
        format!(
            "Failed to read recordings directory '{}': {error}",
            dir.display()
        )
    })?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            total_bytes = total_bytes.saturating_add(meta.len());
            file_count = file_count.saturating_add(1);
        }
    }
    Ok(RecordingsStats {
        file_count,
        total_bytes,
    })
}

#[tauri::command]
pub(crate) async fn list_dictation_recording_ids(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = recordings_dir(&app)?;
    let mut ids: Vec<String> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|error| {
        format!(
            "Failed to read recordings directory '{}': {error}",
            dir.display()
        )
    })?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            ids.push(stem.to_string());
        }
    }
    Ok(ids)
}

#[tauri::command]
pub(crate) async fn clear_dictation_recordings(app: AppHandle) -> Result<u64, String> {
    let dir = recordings_dir(&app)?;
    let mut freed: u64 = 0;
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(error) => {
            return Err(format!(
                "Failed to read recordings directory '{}': {error}",
                dir.display()
            ));
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if let Err(error) = fs::remove_file(&path) {
            warn!(
                "[recordings] failed to remove '{}': {error}",
                path.display()
            );
            continue;
        }
        freed = freed.saturating_add(size);
    }
    info!(
        "[recordings] cleared freedBytes={} dir='{}'",
        freed,
        dir.display()
    );
    Ok(freed)
}

#[tauri::command]
pub(crate) async fn get_dictation_recording(
    app: AppHandle,
    recording_id: String,
) -> Result<String, String> {
    validate_recording_id(&recording_id)?;
    let dir = recordings_dir(&app)?;
    let mut matched: Option<PathBuf> = None;
    let entries = fs::read_dir(&dir).map_err(|error| {
        format!(
            "Failed to read recordings directory '{}': {error}",
            dir.display()
        )
    })?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let stem_matches = path
            .file_stem()
            .and_then(|s| s.to_str())
            .map(|s| s == recording_id)
            .unwrap_or(false);
        if stem_matches {
            matched = Some(path);
            break;
        }
    }
    let path =
        matched.ok_or_else(|| format!("Dictation recording not found for id '{recording_id}'"))?;
    let bytes = fs::read(&path).map_err(|error| {
        format!(
            "Failed to read dictation recording '{}': {error}",
            path.display()
        )
    })?;
    let extension = path.extension().and_then(|s| s.to_str()).unwrap_or("webm");
    let mime = mime_for_extension(extension);
    let encoded = BASE64_STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, encoded))
}
