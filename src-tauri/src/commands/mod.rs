//! Tauri command adapters, one module per domain (Phase 6b+).
//!
//! Each module starts as a verbatim move from lib.rs; thinning into
//! services happens in Phase 7. Re-exports keep generate_handler! paths short.

pub mod local_stt;
pub mod providers;
pub mod recordings;
pub mod settings;
pub mod tts;

pub(crate) use recordings::{
    clear_dictation_recordings, get_dictation_recording, list_dictation_recording_ids,
    list_dictation_recordings_stats, save_dictation_recording, StartupLocalSttWarmupTarget,
};
pub(crate) use providers::{
    fetch_ollama_models, fetch_provider_models, get_assistant_info, get_ollama_status,
    install_ollama, pull_ollama_model,
};
pub(crate) use local_stt::{
    deactivate_local_stt_model, delete_local_stt_model, download_local_stt_model,
    fetch_local_stt_models, get_local_stt_download_status, get_local_stt_hardware_advice,
    get_local_stt_model_status, get_local_stt_runtime_state, open_local_stt_model_path,
    warmup_local_stt_model,
};
pub(crate) use settings::{load_persisted_local_settings, save_persisted_local_settings};
pub(crate) use tts::{
    clone_coqui_voice, ensure_voice_model, get_coqui_status, get_tts_runtime_setup_status,
    list_coqui_models, list_coqui_voices, preview_coqui_voice, setup_assistant_runtime,
    setup_coqui_runtime, start_tts_runtime_setup, validate_coqui, validate_piper, TtsSetupState,
    TtsSetupStatusResponse,
};
