//! AppState progress-sink adapter.
//!
//! The download pipeline talks to a `DownloadSink`; this adapter implements
//! that boundary against the application's `AppState` slot. The download
//! subsystem itself never references `AppState`.

use super::progress::{DownloadSink, LocalSttDownloadStatusResponse, SharedStatus};
use crate::AppState;

/// Sink implementation that persists snapshots into `AppState`'s download
/// status slot (re-deriving progress percent and timestamp, as before).
struct AppStateSink<'a> {
    state: &'a AppState,
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

/// Create a `SharedStatus` seeded from the `AppState` slot and the sink that
/// persists its publications. The caller must keep the sink and the returned
/// `SharedStatus` alive together for the duration of the download.
pub(crate) fn seeded_status<'a>(
    state: &'a AppState,
) -> Result<(SharedStatus<'a>, AppStateSink<'a>), String> {
    let sink = AppStateSink { state };
    let status = SharedStatus::seeded_from(&sink)?;
    Ok((status, sink))
}