//! AppState progress-sink adapter.
//!
//! The download pipeline talks to a `DownloadSink`; this adapter implements
//! that boundary against the application's `AppState` slot. The download
//! subsystem itself never references `AppState`.

use super::progress::{DownloadSink, LocalSttDownloadStatusResponse};
use crate::AppState;

/// Sink implementation that persists snapshots into `AppState`'s download
/// status slot (re-deriving progress percent and timestamp, as before).
pub(crate) struct AppStateSink<'a> {
    state: &'a AppState,
}

impl<'a> AppStateSink<'a> {
    pub(crate) fn new(state: &'a AppState) -> Self {
        Self { state }
    }
}

impl DownloadSink for AppStateSink<'_> {
    fn snapshot(&self) -> Result<LocalSttDownloadStatusResponse, String> {
        self.state.snapshot_local_stt_download_status()
    }

    fn submit(&self, status: &LocalSttDownloadStatusResponse) -> Result<(), String> {
        self.state.update_local_stt_download_status(|slot| {
            *slot = status.clone();
        })
    }
}