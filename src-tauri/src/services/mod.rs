//! Backend services — Phase 7 domain logic extracted from commands.
//!
//! Services own business logic; commands stay thin adapters.

pub mod coqui_setup;
pub mod hardware;
pub mod pipeline_service;
pub mod providers;
pub mod settings_store;
pub mod startup;
pub mod transcribe;

pub(crate) use pipeline_service::{
    resolve_piper_assets, sync_orchestrator_pending_rewrite_to_app_state, sync_selection_context,
};
pub(crate) use transcribe::{
    resolve_stt_timeout, transcribe_audio, transcribe_audio_local, SttRequest,
};
