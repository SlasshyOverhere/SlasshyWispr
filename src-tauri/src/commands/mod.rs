//! Tauri command adapters, one module per domain (Phase 6b+).
//!
//! Each module starts as a verbatim move from lib.rs; thinning into
//! services happens in Phase 7. Re-exports keep generate_handler! paths short.

pub mod providers;
pub mod recordings;
pub mod settings;

pub(crate) use recordings::{
    clear_dictation_recordings, get_dictation_recording, list_dictation_recording_ids,
    list_dictation_recordings_stats, save_dictation_recording, StartupLocalSttWarmupTarget,
};
pub(crate) use providers::{
    fetch_ollama_models, fetch_provider_models, get_assistant_info, get_ollama_status,
    install_ollama, pull_ollama_model,
};
pub(crate) use settings::{load_persisted_local_settings, save_persisted_local_settings};
