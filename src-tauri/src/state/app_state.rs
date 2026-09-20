//! Application state container (Phase 6a extraction from lib.rs).
//!
//! Moved verbatim — struct fields NOT split. AppState stays the shared
//! owner until command/service boundaries are established (Phase 7+).

use std::sync::Mutex;
use std::time::{Duration, Instant};

use super::window::WindowVisibilityState;
use crate::constants::{PENDING_SELECTION_REWRITE_TTL_SECS, RECENT_SELECTION_CONTEXT_TTL_SECS};
use crate::pipeline::stt_download::progress::{
    calculate_local_stt_progress_percent, now_unix_ms, LocalSttDownloadStatusResponse,
};
use reqwest::Client;

pub(crate) struct AppState {
    pub(crate) http: Client,
    pending_selection_rewrite: Mutex<Option<PendingSelectionRewrite>>,
    recent_selection_context: Mutex<Option<RecentSelectionContext>>,
    last_transcript: Mutex<String>,
    last_assistant_response: Mutex<String>,
    local_stt_download_status: Mutex<LocalSttDownloadStatusResponse>,
    local_stt_runtime_loaded: Mutex<bool>,
    /// F-009: highest replace-selection token accepted so far. A run carrying
    /// an older token is a superseded rewrite and must not replace the
    /// selection. Zero means none seen yet, so the first token always passes.
    last_replace_token: Mutex<u64>,
    /// File handed over by Explorer's "Transcribe with SlasshyWispr" verb.
    /// Held until the frontend is loaded enough to run a pipeline, because a
    /// cold launch has no listener registered yet.
    pending_transcribe_file: Mutex<Option<String>>,
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
            last_transcript: Mutex::new(String::new()),
            last_assistant_response: Mutex::new(String::new()),
            local_stt_download_status: Mutex::new(LocalSttDownloadStatusResponse::default()),
            local_stt_runtime_loaded: Mutex::new(false),
            last_replace_token: Mutex::new(0),
            pending_transcribe_file: Mutex::new(None),
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
        self.set_last_transcript(transcript)?;
        self.set_last_assistant_response(assistant_response)?;
        Ok(())
    }

    pub(crate) fn set_last_transcript(&self, transcript: impl Into<String>) -> Result<(), String> {
        let transcript = transcript.into();
        let mut transcript_slot = self
            .last_transcript
            .lock()
            .map_err(|_| "Last transcript state lock poisoned.".to_string())?;
        *transcript_slot = transcript;
        Ok(())
    }

    pub(crate) fn set_last_assistant_response(
        &self,
        assistant_response: impl Into<String>,
    ) -> Result<(), String> {
        let assistant_response = assistant_response.into();
        let mut response_slot = self
            .last_assistant_response
            .lock()
            .map_err(|_| "Last assistant response state lock poisoned.".to_string())?;
        *response_slot = assistant_response;
        Ok(())
    }

    pub(crate) fn last_transcript_snapshot(&self) -> Result<String, String> {
        self.last_transcript
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Last transcript state lock poisoned.".to_string())
    }

    pub(crate) fn last_assistant_response_snapshot(&self) -> Result<String, String> {
        self.last_assistant_response
            .lock()
            .map(|value| value.clone())
            .map_err(|_| "Last assistant response state lock poisoned.".to_string())
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

    /// F-009: accept a replace-selection token only if it is at least as new
    /// as the last one seen. Returns false for a stale (superseded) run, and
    /// an empty token always passes (no token = not a selection replace).
    pub(crate) fn accept_replace_token(&self, token: &str) -> Result<bool, String> {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            return Ok(true);
        }
        let parsed: u64 = match trimmed.parse() {
            Ok(value) => value,
            // Non-numeric tokens cannot be ordered; accept rather than block
            // a legitimate run on a format we do not recognise.
            Err(_) => return Ok(true),
        };
        let mut slot = self
            .last_replace_token
            .lock()
            .map_err(|_| "Replace-token state lock poisoned.".to_string())?;
        if parsed < *slot {
            return Ok(false);
        }
        *slot = parsed;
        Ok(true)
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
