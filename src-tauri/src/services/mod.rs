//! Backend services — Phase 7 domain logic extracted from commands.
//!
//! Services own business logic; commands stay thin adapters.

pub mod hardware;
pub mod pipeline_service;
pub mod transcribe;

pub(crate) use hardware::build_local_stt_hardware_advice;
pub(crate) use pipeline_service::{
    discover_installed_piper_path, resolve_piper_assets,
    sync_orchestrator_pending_rewrite_to_app_state, sync_selection_context,
};
pub(crate) use transcribe::{
    transcribe_audio, transcribe_audio_local,
};
