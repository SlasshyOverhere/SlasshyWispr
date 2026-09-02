//! STT download progress/status model.
//!
//! Owns the download status wire type, the progress calculation, and the
//! progress sink boundary through which the download infrastructure reports
//! progress. The application layer implements the sink, so the downloader
//! never touches `AppState` (or Tauri) directly.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Current local STT model download status, exposed over IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalSttDownloadStatusResponse {
    pub(crate) active: bool,
    pub(crate) completed: bool,
    pub(crate) success: bool,
    pub(crate) model: String,
    pub(crate) repo_id: String,
    pub(crate) stage: String,
    pub(crate) message: String,
    pub(crate) current_file: String,
    pub(crate) downloaded_bytes: u64,
    pub(crate) total_bytes: u64,
    pub(crate) files_completed: usize,
    pub(crate) files_total: usize,
    pub(crate) progress_percent: f64,
    pub(crate) updated_at_ms: u64,
}

impl Default for LocalSttDownloadStatusResponse {
    fn default() -> Self {
        Self {
            active: false,
            completed: false,
            success: false,
            model: String::new(),
            repo_id: String::new(),
            stage: "Idle".to_string(),
            message: "No local STT download in progress.".to_string(),
            current_file: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
            files_completed: 0,
            files_total: 0,
            progress_percent: 0.0,
            updated_at_ms: now_unix_ms(),
        }
    }
}

/// Report a complete, current download status snapshot to the sink.
///
/// The sink is responsible for re-deriving derived fields (`progress_percent`,
/// `updated_at_ms`) and persisting the snapshot. Receiving the complete status
/// (not deltas) lets the downloader thread the same status object through every
/// layered write point, preserving the previous "mutate the shared status in
/// place" behavior exactly.
pub(crate) trait DownloadSink: Send + Sync {
    fn snapshot(&self) -> Result<LocalSttDownloadStatusResponse, String>;
    fn submit(&self, status: &LocalSttDownloadStatusResponse) -> Result<(), String>;
}

/// Shared mutable status holder used by the download pipeline.
///
/// Carries the "current" status object between the app-layer sink and the
/// layered downloader/transport functions so each write point keeps seeing
/// the status produced by the previous write point (same as before the
/// extraction, when every site mutated the single `AppState` slot).
pub(crate) struct SharedStatus<'a> {
    current: Mutex<LocalSttDownloadStatusResponse>,
    sink: &'a (dyn DownloadSink + Send + Sync),
}

impl<'a> SharedStatus<'a> {
    /// Seed from the sink's current snapshot. The app layer publishes the
    /// initial "Preparing download..." state to `AppState` before handing off,
    /// so this seed is that exact status, preserving the pre-extraction lineage.
    pub(crate) fn seeded_from(sink: &'a (dyn DownloadSink + Send + Sync)) -> Result<Self, String> {
        let current = sink.snapshot()?;
        Ok(Self {
            current: Mutex::new(current),
            sink,
        })
    }

    /// Current known status snapshot.
    pub(crate) fn snapshot(&self) -> LocalSttDownloadStatusResponse {
        self.current
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|poisoned| poisoned.into_inner().clone())
    }

    /// Mutate the shared status and publish it through the sink.
    pub(crate) fn update(
        &self,
        mutator: impl FnOnce(&mut LocalSttDownloadStatusResponse),
    ) -> Result<(), String> {
        let mut updated = self
            .current
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|poisoned| poisoned.into_inner().clone());
        mutator(&mut updated);
        self.sink.submit(&updated)?;
        let mut guard = self
            .current
            .lock()
            .map_err(|_| "Local STT download status lock poisoned.".to_string())?;
        *guard = updated;
        Ok(())
    }
}

/// Milliseconds since the Unix epoch (wall clock, for status timestamps).
pub(crate) fn now_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| {
            let millis = duration.as_millis();
            if millis > u128::from(u64::MAX) {
                u64::MAX
            } else {
                millis as u64
            }
        })
        .unwrap_or(0)
}

/// Compute the IPC progress percentage from a status snapshot.
pub(crate) fn calculate_local_stt_progress_percent(
    status: &LocalSttDownloadStatusResponse,
) -> f64 {
    if status.total_bytes > 0 {
        return ((status.downloaded_bytes as f64 / status.total_bytes as f64) * 100.0)
            .clamp(0.0, 100.0);
    }

    if status.files_total > 0 {
        return ((status.files_completed as f64 / status.files_total as f64) * 100.0)
            .clamp(0.0, 100.0);
    }

    if status.completed && status.success {
        100.0
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct RecordingSink {
        status: Mutex<LocalSttDownloadStatusResponse>,
    }

    impl RecordingSink {
        fn new() -> Self {
            Self {
                status: Mutex::new(LocalSttDownloadStatusResponse::default()),
            }
        }
    }

    impl DownloadSink for RecordingSink {
        fn snapshot(&self) -> Result<LocalSttDownloadStatusResponse, String> {
            Ok(self
                .status
                .lock()
                .map(|guard| guard.clone())
                .unwrap_or_else(|poisoned| poisoned.into_inner().clone()))
        }
        fn submit(&self, status: &LocalSttDownloadStatusResponse) -> Result<(), String> {
            *self
                .status
                .lock()
                .map_err(|_| "Recording sink lock poisoned.".to_string())? = status.clone();
            Ok(())
        }
    }

    #[test]
    fn calculate_progress_uses_bytes_when_available() {
        let status = LocalSttDownloadStatusResponse {
            downloaded_bytes: 500,
            total_bytes: 1000,
            ..Default::default()
        };
        assert_eq!(calculate_local_stt_progress_percent(&status), 50.0);
    }

    #[test]
    fn calculate_progress_falls_back_to_file_count() {
        let status = LocalSttDownloadStatusResponse {
            files_completed: 3,
            files_total: 6,
            ..Default::default()
        };
        assert_eq!(calculate_local_stt_progress_percent(&status), 50.0);
    }

    #[test]
    fn calculate_progress_returns_100_for_completed_success() {
        let status = LocalSttDownloadStatusResponse {
            completed: true,
            success: true,
            ..Default::default()
        };
        assert_eq!(calculate_local_stt_progress_percent(&status), 100.0);
    }

    #[test]
    fn calculate_progress_returns_0_for_idle() {
        let status = LocalSttDownloadStatusResponse::default();
        assert_eq!(calculate_local_stt_progress_percent(&status), 0.0);
    }

    #[test]
    fn shared_status_publishes_mutated_snapshots_in_order() {
        let sink = RecordingSink::new();
        let shared = SharedStatus::seeded_from(&sink).unwrap();

        shared
            .update(|status| {
                status.active = true;
                status.total_bytes = 1000;
            })
            .unwrap();
        shared
            .update(|status| {
                status.downloaded_bytes = 500;
            })
            .unwrap();

        let committed = sink.status.lock().unwrap();
        assert!(committed.active);
        assert_eq!(committed.total_bytes, 1000);
        assert_eq!(committed.downloaded_bytes, 500);
        // Reads reflect the last committed status.
        let current = shared.snapshot();
        assert_eq!(current.downloaded_bytes, 500);
    }

    #[test]
    fn shared_status_seeds_from_sink_snapshot() {
        let sink = RecordingSink::new();
        sink.submit(&LocalSttDownloadStatusResponse {
            stage: "Preparing download...".to_string(),
            ..Default::default()
        })
        .unwrap();
        let shared = SharedStatus::seeded_from(&sink).unwrap();
        assert_eq!(shared.snapshot().stage, "Preparing download...");
    }
}