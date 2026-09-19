//! Tauri command adapters, one module per domain (Phase 6b+).
//!
//! Each module starts as a verbatim move from lib.rs; thinning into
//! services happens in Phase 7. Re-exports keep generate_handler! paths short.

pub mod input;
pub mod ipc_types;
pub mod local_stt;
pub mod pipeline;
pub mod providers;
pub mod windows;
pub mod recordings;
pub mod settings;
pub mod tts;
pub mod updater;

pub(crate) use recordings::{
    clear_dictation_recordings, get_dictation_recording, list_dictation_recording_ids,
    list_dictation_recordings_stats, save_dictation_recording,
};
pub(crate) use providers::{
    fetch_ollama_models, fetch_provider_models, get_assistant_info, get_ollama_status,
    install_ollama, pull_ollama_model,
};
pub(crate) use input::{
    capture_selected_text, configure_launch_at_login, control_media_playback,
    get_foreground_input_block_status, launch_at_login_status, mute_system_audio,
    paste_clipboard_text, paste_text_via_clipboard, set_clipboard_text,
};
pub(crate) use local_stt::{
    deactivate_local_stt_model, delete_local_stt_model, download_local_stt_model,
    fetch_local_stt_models, get_local_stt_download_status, get_local_stt_hardware_advice,
    get_local_stt_model_status, get_local_stt_runtime_state, open_local_stt_model_path,
    warmup_local_stt_model,
};
pub(crate) use settings::{load_persisted_local_settings, save_persisted_local_settings};
pub(crate) use updater::{
    check_for_app_update, download_and_install_app_update, log_client_event,
    set_tray_update_available, show_update_settings,
};
pub(crate) use tts::{
    clone_coqui_voice, ensure_voice_model, get_coqui_status, get_tts_runtime_setup_status,
    list_coqui_models, list_coqui_voices, preview_coqui_voice, setup_assistant_runtime,
    setup_coqui_runtime, start_tts_runtime_setup, validate_coqui, validate_piper, TtsSetupState,
};
pub(crate) use pipeline::run_assistant_pipeline;
pub(crate) use windows::toggle_main_window_visibility;
