//! Application state container (Phase 6a extraction from lib.rs).
//!
//! Moved verbatim — struct fields NOT split. AppState stays the shared
//! owner until command/service boundaries are established (Phase 7+).

use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::window::WindowVisibilityState;
use crate::constants::{
    MAX_ARMED_TRANSCRIBE_PATHS, PENDING_SELECTION_REWRITE_TTL_SECS,
    RECENT_SELECTION_CONTEXT_TTL_SECS,
};
use crate::pipeline::stt_download::progress::{
    calculate_local_stt_progress_percent, now_unix_ms, LocalSttDownloadStatusResponse,
};
use reqwest::Client;

/// The two slots the tray's "copy last transcript" / "copy last assistant
/// response" read. Written and read together, so they belong in one lock.
#[derive(Default, Clone, Debug, PartialEq, Eq)]
pub(crate) struct LastPipelineOutput {
    pub(crate) transcript: String,
    pub(crate) assistant_response: String,
}

pub(crate) struct AppState {
    pub(crate) http: Client,
    pending_selection_rewrite: Mutex<Option<PendingSelectionRewrite>>,
    recent_selection_context: Mutex<Option<RecentSelectionContext>>,
    /// One lock for both slots: they are written as a pair and read as a pair,
    /// so two turns interleaving between two mutexes could leave the tray
    /// reporting a transcript and a response from different runs.
    last_pipeline_output: Mutex<LastPipelineOutput>,
    local_stt_download_status: Mutex<LocalSttDownloadStatusResponse>,
    local_stt_runtime_loaded: Mutex<bool>,
    /// File handed over by Explorer's "Transcribe with SlasshyWispr" verb.
    /// Held until the frontend is loaded enough to run a pipeline, because a
    /// cold launch has no listener registered yet.
    pending_transcribe_file: Mutex<Option<String>>,
    /// Transcription paths this app handed to the frontend, which is what
    /// authorizes reading them back. The webview holds no filesystem rights of
    /// its own, so an unarmed path is refused rather than read.
    armed_transcribe_paths: Mutex<Vec<String>>,
    pub(crate) window_visibility: Mutex<WindowVisibilityState>,
}

impl AppState {
    pub(crate) fn new() -> Result<Self, String> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(150))
            .pool_idle_timeout(Duration::from_secs(90))
            .pool_max_idle_per_host(8)
            .build()
            .map_err(|error| format!("Failed to create HTTP client: {error}"))?;

        Ok(Self {
            http,
            pending_selection_rewrite: Mutex::new(None),
            recent_selection_context: Mutex::new(None),
            last_pipeline_output: Mutex::new(LastPipelineOutput::default()),
            local_stt_download_status: Mutex::new(LocalSttDownloadStatusResponse::default()),
            local_stt_runtime_loaded: Mutex::new(false),
            pending_transcribe_file: Mutex::new(None),
            armed_transcribe_paths: Mutex::new(Vec::new()),
            window_visibility: Mutex::new(WindowVisibilityState::default()),
        })
    }

    pub(crate) fn set_pending_transcribe_file(&self, path: String) {
        match self.pending_transcribe_file.lock() {
            Ok(mut slot) => *slot = Some(path),
            Err(_) => log::warn!("[shell] pending transcribe file lock poisoned; dropping request"),
        }
    }

    /// Take the pending path, if any. Single-shot so a retry cannot loop.
    pub(crate) fn take_pending_transcribe_file(&self) -> Option<String> {
        self.pending_transcribe_file
            .lock()
            .ok()
            .and_then(|mut slot| slot.take())
    }

    /// Explorer hands the path over quoted; arming and reading must agree on
    /// the form, so both go through this.
    pub(crate) fn normalize_transcribe_path(path: &str) -> String {
        path.trim().trim_matches('"').trim().to_string()
    }

    /// Record a path as handed to the frontend, authorizing one read of it.
    pub(crate) fn arm_transcribe_file(&self, path: &str) {
        let normalized = Self::normalize_transcribe_path(path);
        if normalized.is_empty() {
            return;
        }
        match self.armed_transcribe_paths.lock() {
            Ok(mut armed) => {
                if armed.iter().any(|entry| entry == &normalized) {
                    return;
                }
                // Bounded: a hand-over nobody collects must not pile up.
                if armed.len() >= MAX_ARMED_TRANSCRIBE_PATHS {
                    armed.remove(0);
                }
                armed.push(normalized);
            }
            Err(_) => log::warn!("[shell] armed transcribe path lock poisoned; dropping request"),
        }
    }

    /// Consume the arming for `path`: one hand-over authorizes one read.
    pub(crate) fn take_armed_transcribe_file(&self, path: &str) -> bool {
        let normalized = Self::normalize_transcribe_path(path);
        self.armed_transcribe_paths
            .lock()
            .map(|mut armed| {
                match armed.iter().position(|entry| entry == &normalized) {
                    Some(index) => {
                        armed.remove(index);
                        true
                    }
                    None => false,
                }
            })
            .unwrap_or(false)
    }

    fn lock_pending_selection_rewrite(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<PendingSelectionRewrite>>, String> {
        self.pending_selection_rewrite
            .lock()
            .map_err(|_| "Pending rewrite context lock poisoned.".to_string())
    }

    fn lock_recent_selection_context(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Option<RecentSelectionContext>>, String> {
        self.recent_selection_context
            .lock()
            .map_err(|_| "Recent selection context lock poisoned.".to_string())
    }

    fn cleanup_expired_pending_selection_rewrite(
        slot: &mut Option<PendingSelectionRewrite>,
    ) -> bool {
        let expired = slot
            .as_ref()
            .map(|item| {
                item.created_at.elapsed() >= Duration::from_secs(PENDING_SELECTION_REWRITE_TTL_SECS)
            })
            .unwrap_or(false);
        if expired {
            *slot = None;
            return true;
        }
        false
    }

    pub(crate) fn set_pending_selection_rewrite(&self, rewrite_text: String) -> Result<(), String> {
        let mut slot = self.lock_pending_selection_rewrite()?;
        *slot = Some(PendingSelectionRewrite {
            rewrite_text,
            created_at: Instant::now(),
        });
        Ok(())
    }

    pub(crate) fn clear_pending_selection_rewrite(&self) -> Result<bool, String> {
        let mut slot = self.lock_pending_selection_rewrite()?;
        Self::cleanup_expired_pending_selection_rewrite(&mut slot);
        Ok(slot.take().is_some())
    }

    pub(crate) fn peek_pending_selection_rewrite(&self) -> Result<Option<String>, String> {
        let mut slot = self.lock_pending_selection_rewrite()?;
        Self::cleanup_expired_pending_selection_rewrite(&mut slot);
        Ok(slot.as_ref().map(|item| item.rewrite_text.clone()))
    }

    fn cleanup_expired_recent_selection_context(slot: &mut Option<RecentSelectionContext>) -> bool {
        let expired = slot
            .as_ref()
            .map(|item| {
                item.created_at.elapsed() >= Duration::from_secs(RECENT_SELECTION_CONTEXT_TTL_SECS)
            })
            .unwrap_or(false);
        if expired {
            *slot = None;
            return true;
        }
        false
    }

    pub(crate) fn set_recent_selection_context(&self, text: String) -> Result<(), String> {
        let mut slot = self.lock_recent_selection_context()?;
        *slot = Some(RecentSelectionContext {
            text,
            created_at: Instant::now(),
        });
        Ok(())
    }

    pub(crate) fn peek_recent_selection_context(&self) -> Result<Option<String>, String> {
        let mut slot = self.lock_recent_selection_context()?;
        Self::cleanup_expired_recent_selection_context(&mut slot);
        Ok(slot.as_ref().map(|item| item.text.clone()))
    }

    pub(crate) fn set_last_pipeline_output(
        &self,
        transcript: impl Into<String>,
        assistant_response: impl Into<String>,
    ) -> Result<(), String> {
        let mut slot = self
            .last_pipeline_output
            .lock()
            .map_err(|_| "Last pipeline output lock poisoned.".to_string())?;
        slot.transcript = transcript.into();
        slot.assistant_response = assistant_response.into();
        Ok(())
    }

    pub(crate) fn last_transcript_snapshot(&self) -> Result<String, String> {
        self.last_pipeline_output
            .lock()
            .map(|slot| slot.transcript.clone())
            .map_err(|_| "Last pipeline output lock poisoned.".to_string())
    }

    pub(crate) fn last_assistant_response_snapshot(&self) -> Result<String, String> {
        self.last_pipeline_output
            .lock()
            .map(|slot| slot.assistant_response.clone())
            .map_err(|_| "Last pipeline output lock poisoned.".to_string())
    }

    pub(crate) fn lock_local_stt_download_status(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, LocalSttDownloadStatusResponse>, String> {
        self.local_stt_download_status
            .lock()
            .map_err(|_| "Local STT download status lock poisoned.".to_string())
    }

    pub(crate) fn snapshot_local_stt_download_status(
        &self,
    ) -> Result<LocalSttDownloadStatusResponse, String> {
        self.local_stt_download_status
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Local STT download status lock poisoned.".to_string())
    }

    pub(crate) fn update_local_stt_download_status<F>(&self, mutator: F) -> Result<(), String>
    where
        F: FnOnce(&mut LocalSttDownloadStatusResponse),
    {
        let mut status = self.lock_local_stt_download_status()?;
        mutator(&mut status);
        status.progress_percent = calculate_local_stt_progress_percent(&status);
        status.updated_at_ms = now_unix_ms();
        Ok(())
    }

    /// Claim the download slot, or report who holds it.
    ///
    /// The check and the claim must be one critical section: read-then-write let
    /// two callers both see `active == false` and both start writing the same
    /// target directory.
    pub(crate) fn try_begin_local_stt_download(
        &self,
        starting: LocalSttDownloadStatusResponse,
    ) -> Result<(), String> {
        let mut status = self.lock_local_stt_download_status()?;
        if status.active {
            return Err(format!(
                "Local STT download already running for '{}'.",
                status.model
            ));
        }
        *status = starting;
        status.progress_percent = calculate_local_stt_progress_percent(&status);
        status.updated_at_ms = now_unix_ms();
        Ok(())
    }

    pub(crate) fn local_stt_runtime_loaded_snapshot(&self) -> Result<bool, String> {
        self.local_stt_runtime_loaded
            .lock()
            .map(|value| *value)
            .map_err(|_| "Local STT runtime state lock poisoned.".to_string())
    }

    pub(crate) fn set_local_stt_runtime_loaded(&self, loaded: bool) -> Result<(), String> {
        let mut slot = self
            .local_stt_runtime_loaded
            .lock()
            .map_err(|_| "Local STT runtime state lock poisoned.".to_string())?;
        *slot = loaded;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> AppState {
        AppState::new().expect("app state")
    }

    #[test]
    fn only_one_download_can_claim_the_slot() {
        let state = state();
        let claim = |model: &str| {
            state.try_begin_local_stt_download(LocalSttDownloadStatusResponse {
                active: true,
                completed: false,
                success: false,
                model: model.to_string(),
                repo_id: String::new(),
                stage: String::new(),
                message: String::new(),
                current_file: String::new(),
                downloaded_bytes: 0,
                total_bytes: 0,
                files_completed: 0,
                files_total: 0,
                progress_percent: 0.0,
                updated_at_ms: 0,
            })
        };

        assert!(claim("first").is_ok());
        // The second must be refused, or both would write the same target dir.
        assert!(claim("second").is_err());
        assert_eq!(
            state
                .snapshot_local_stt_download_status()
                .expect("status")
                .model,
            "first"
        );
    }

    #[test]
    fn the_slot_is_claimable_again_once_the_download_finishes() {
        let state = state();
        let claim = |model: &str| {
            state.try_begin_local_stt_download(LocalSttDownloadStatusResponse {
                active: true,
                completed: false,
                success: false,
                model: model.to_string(),
                repo_id: String::new(),
                stage: String::new(),
                message: String::new(),
                current_file: String::new(),
                downloaded_bytes: 0,
                total_bytes: 0,
                files_completed: 0,
                files_total: 0,
                progress_percent: 0.0,
                updated_at_ms: 0,
            })
        };

        assert!(claim("first").is_ok());
        // A completed download reports active = false, which frees the slot.
        state
            .update_local_stt_download_status(|status| {
                status.active = false;
                status.completed = true;
                status.success = true;
            })
            .expect("mark the download finished");
        assert!(claim("second").is_ok());
    }

    #[test]
    fn the_two_output_slots_always_come_from_the_same_turn() {
        let state = state();
        state.set_last_pipeline_output("t1", "r1").expect("first");
        state.set_last_pipeline_output("t2", "r2").expect("second");
        // Written as a pair under one lock, so the tray can never report a
        // transcript from one turn and a response from another.
        assert_eq!(state.last_transcript_snapshot().expect("t"), "t2");
        assert_eq!(state.last_assistant_response_snapshot().expect("r"), "r2");
    }

    #[test]
    fn arming_a_path_authorizes_exactly_one_read() {
        let state = state();
        assert!(!state.take_armed_transcribe_file("C:\\clips\\note.wav"));

        state.arm_transcribe_file("C:\\clips\\note.wav");
        assert!(state.take_armed_transcribe_file("C:\\clips\\note.wav"));
        assert!(!state.take_armed_transcribe_file("C:\\clips\\note.wav"));
    }

    #[test]
    fn arming_a_second_path_does_not_authorize_the_first() {
        let state = state();
        state.arm_transcribe_file("C:\\clips\\other.wav");
        assert!(!state.take_armed_transcribe_file("C:\\clips\\note.wav"));
        assert!(state.take_armed_transcribe_file("C:\\clips\\other.wav"));
    }

    #[test]
    fn quoted_hand_overs_match_the_plain_path_read_back() {
        let state = state();
        // Explorer passes %1 quoted; the frontend hands the path back bare.
        state.arm_transcribe_file("\"C:\\clips\\note.wav\"");
        assert!(state.take_armed_transcribe_file("C:\\clips\\note.wav"));
        assert_eq!(
            AppState::normalize_transcribe_path("  \"C:\\clips\\note.wav\" "),
            "C:\\clips\\note.wav"
        );
    }

    #[test]
    fn an_empty_path_is_never_armed() {
        let state = state();
        state.arm_transcribe_file("   \"\"  ");
        assert!(!state.take_armed_transcribe_file(""));
    }

    #[test]
    fn repeated_hand_overs_stay_bounded_and_keep_the_newest() {
        let state = state();
        state.arm_transcribe_file("C:\\clips\\note.wav");
        for extra in 0..(MAX_ARMED_TRANSCRIBE_PATHS * 2) {
            state.arm_transcribe_file(&format!("C:\\clips\\{extra}.wav"));
        }

        let armed = state
            .armed_transcribe_paths
            .lock()
            .expect("armed paths")
            .len();
        assert_eq!(armed, MAX_ARMED_TRANSCRIBE_PATHS);
        assert!(state.take_armed_transcribe_file(&format!(
            "C:\\clips\\{}.wav",
            MAX_ARMED_TRANSCRIBE_PATHS * 2 - 1
        )));
    }
}

#[derive(Debug)]
pub(crate) struct PendingSelectionRewrite {
    rewrite_text: String,
    created_at: Instant,
}

#[derive(Debug)]
pub(crate) struct RecentSelectionContext {
    text: String,
    created_at: Instant,
}
