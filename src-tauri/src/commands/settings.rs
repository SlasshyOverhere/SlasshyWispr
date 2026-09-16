//! Settings persistence commands — Phase 6c thin-adapter extraction.
//!
//! Moved verbatim from lib.rs: load/save commands. Keyring/crypto/path
//! helpers stay in lib.rs for now (shared with launch-at-login + STT
//! warmup paths); they move with services in Phase 7.

use std::fs;

use log::info;
use serde_json::Value;
use tauri::AppHandle;

use crate::security;
use crate::{persisted_settings_path, restore_settings_payload, secure_settings_payload};
#[tauri::command]
pub(crate) async fn load_persisted_local_settings(app: AppHandle) -> Result<String, String> {
    let settings_path = persisted_settings_path(&app)?;
    if !settings_path.exists() {
        info!("[settings] load skipped because settings file is missing");
        return Ok(String::new());
    }

    let raw = fs::read_to_string(&settings_path).map_err(|error| {
        format!(
            "Failed to read persisted settings '{}': {error}",
            settings_path.display()
        )
    })?;
    info!(
        "[settings] load path='{}' bytes={}",
        settings_path.display(),
        raw.len()
    );

    restore_settings_payload(&raw)
}

#[tauri::command]
pub(crate) async fn save_persisted_local_settings(app: AppHandle, payload: String) -> Result<(), String> {
    let trimmed = payload.trim();
    if trimmed.is_empty() {
        return Err("Settings payload is empty.".to_string());
    }

    let parsed = serde_json::from_str::<Value>(trimmed)
        .map_err(|error| format!("Settings payload is not valid JSON: {error}"))?;
    if !parsed.is_object() {
        return Err("Settings payload must be a JSON object.".to_string());
    }

    // Validate text fields before persisting
    if let Some(api_key) = parsed.get("apiKey").and_then(|v| v.as_str()) {
        security::validate_text_input(api_key, 4096, "apiKey").map_err(|e| format!("Invalid apiKey: {e}"))?;
    }

    info!("[settings] save requested bytes={}", trimmed.len());
    let secured_payload = secure_settings_payload(trimmed)?;

    let settings_path = persisted_settings_path(&app)?;
    fs::write(&settings_path, secured_payload.as_bytes()).map_err(|error| {
        format!(
            "Failed to write persisted settings '{}': {error}",
            settings_path.display()
        )
    })?;
    info!(
        "[settings] save path='{}' bytes={}",
        settings_path.display(),
        secured_payload.len()
    );
    Ok(())
}

