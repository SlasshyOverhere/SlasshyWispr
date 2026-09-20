//! Native audio capture commands.
//!
//! Thin adapters over `audio::capture`. The frontend picks this path when the
//! `captureBackend` setting is `native`; the webview `MediaRecorder` path stays
//! available as the fallback.

use crate::audio::capture::{self, CaptureInfo, CapturedAudio};

#[tauri::command]
pub(crate) async fn start_native_capture(device_id: Option<String>) -> Result<CaptureInfo, String> {
    capture::start(device_id)
}

#[tauri::command]
pub(crate) async fn stop_native_capture() -> Result<CapturedAudio, String> {
    capture::stop()
}

#[tauri::command]
pub(crate) async fn cancel_native_capture() -> Result<(), String> {
    capture::cancel()
}

#[tauri::command]
pub(crate) async fn native_capture_level() -> Result<f32, String> {
    Ok(capture::current_level())
}
