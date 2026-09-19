//! Shared Windows-input types (platform boundary).

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForegroundInputBlockStatus {
    pub(crate) blocked: bool,
    pub(crate) process_name: String,
    pub(crate) reason: String,
    pub(crate) fullscreen: bool,
}
#[derive(Debug, Clone)]
pub(crate) struct ForegroundWindowProbeResult {
    pub(crate) process_name: String,
    pub(crate) window_title: String,
    pub(crate) fullscreen: bool,
}
