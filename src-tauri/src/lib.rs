use log::{info, warn};
use reqwest::{multipart, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::{menu::MenuItem, AppHandle, Manager};

pub mod audio;
pub mod commands;
pub mod services;
pub mod constants;
pub mod pipeline;
pub mod platform;
pub mod security;
pub mod state;
pub mod updater;
use commands::{
    TtsSetupState, capture_selected_text,
    check_for_app_update,
    clear_dictation_recordings, clone_coqui_voice, configure_launch_at_login,
    control_media_playback, deactivate_local_stt_model, delete_local_stt_model,
    download_and_install_app_update, download_local_stt_model, ensure_voice_model,
    fetch_local_stt_models, fetch_ollama_models, fetch_provider_models, get_assistant_info,
    get_coqui_status, get_dictation_recording, get_foreground_input_block_status,
    get_local_stt_download_status, get_local_stt_hardware_advice, get_local_stt_model_status,
    get_local_stt_runtime_state, get_tts_runtime_setup_status, get_ollama_status, install_ollama,
    launch_at_login_status, list_coqui_models, list_coqui_voices, list_dictation_recording_ids,
    list_dictation_recordings_stats, load_persisted_local_settings, log_client_event,
    mute_system_audio, open_local_stt_model_path, paste_clipboard_text, paste_text_via_clipboard,
    preview_coqui_voice, pull_ollama_model, save_dictation_recording, save_persisted_local_settings,
    set_clipboard_text, set_tray_update_available, setup_assistant_runtime, setup_coqui_runtime,
    run_assistant_pipeline, show_update_settings, start_tts_runtime_setup,
    toggle_main_window_visibility, validate_coqui, validate_piper, warmup_local_stt_model,
};
use state::AppState;

#[cfg(test)]
use pipeline::response::normalize_assistant_response_text;
#[cfg(test)]
use pipeline::selection::{
    is_affirmative_selection_confirmation, is_negative_selection_confirmation,
    is_rewrite_suspicious, parse_selection_edit_decision, SelectionEditAction,
};







































// normalize_api_key_secret has been moved to pipeline::routing.

pub fn run() {
    let app_state = AppState::new().expect("failed to initialize app state");
    let tts_setup_state = TtsSetupState::default();
    let start_in_tray =
        std::env::args().any(|arg| arg.eq_ignore_ascii_case(crate::constants::STARTUP_ARG_START_IN_TRAY));

    let mut builder = tauri::Builder::default();
    // window-state plugin — needs to be added before .manage()
    builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            info!(
                "[app.single-instance] secondary launch blocked args={:?}",
                args
            );
            if args
                .iter()
                .any(|a| a.eq_ignore_ascii_case(crate::constants::STARTUP_ARG_START_IN_TRAY))
            {
                info!("[app.single-instance] --start-in-tray passed; respecting hidden state");
                return;
            }
            commands::windows::show_main_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(app_state)
        .manage(tts_setup_state)
        .setup(move |app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
            }

            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            let app_handle = app.handle().clone();
            commands::windows::build_tray_icon(&app_handle)?;
            crate::pipeline::daemon::ensure_local_stt_daemon_idle_sweeper();
            services::startup::start_local_stt_boot_warmup(app_handle.clone());

            if let Some(main_window) = app.get_webview_window(crate::constants::MAIN_WINDOW_LABEL) {
                let app_handle_for_close = app_handle.clone();
                let app_handle_for_resize = app_handle.clone();
                let main_window_for_resize = main_window.clone();
                main_window.on_window_event(move |event| {
                    match event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            api.prevent_close();
                            commands::windows::hide_main_window_to_tray(&app_handle_for_close);
                        }
                        tauri::WindowEvent::Resized(_) => {
                            // Track minimize/restore transitions. On every
                            // resize while the window is NOT minimized, capture
                            // the current rect into WindowVisibilityState so we
                            // can restore to that exact size+position after the
                            // user restores from a taskbar click.
                            //
                            // When the transition is minimized -> not-minimized
                            // (i.e. user restored from taskbar), apply the saved
                            // pre-minimize rect via set_position + set_size.
                            let minimized_now = main_window_for_resize
                                .is_minimized()
                                .unwrap_or(false);

                            if let Some(state) =
                                app_handle_for_resize.try_state::<AppState>()
                            {
                                if let Ok(mut visibility) =
                                    state.window_visibility.lock()
                                {
                                    if minimized_now {
                                        // Mark that we just entered the
                                        // minimized state. The "last_rect"
                                        // already holds the pre-minimize rect
                                        // because the previous Resized events
                                        // kept updating it.
                                        visibility.was_minimized = true;
                                    } else if visibility.was_minimized {
                                        // Transition minimized -> restored.
                                        // Restore to the saved rect.
                                        visibility.was_minimized = false;
                                        let rect = visibility.last_rect;
                                        drop(visibility);
                                        if let Some(r) = rect {
                                            if let Err(error) = main_window_for_resize
                                                .set_position(
                                                    tauri::PhysicalPosition {
                                                        x: r.position_x,
                                                        y: r.position_y,
                                                    },
                                                )
                                            {
                                                warn!("[tray] failed to restore position on un-minimize: {error}");
                                            }
                                            if let Err(error) = main_window_for_resize
                                                .set_size(tauri::PhysicalSize {
                                                    width: r.width,
                                                    height: r.height,
                                                })
                                            {
                                                warn!("[tray] failed to restore size on un-minimize: {error}");
                                            }
                                        }
                                    } else {
                                        // Plain resize while visible. Update
                                        // the saved rect.
                                        visibility.last_rect =
                                            Some(commands::windows::capture_rect(&main_window_for_resize));
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                });
            } else {
                warn!("[tray] main window not found for close-to-tray hook");
            }

            // Clean up stale installer files from previous update attempts
            if let Ok(app_data) = app.path().app_data_dir() {
                let updates_dir = app_data.join("updates");
                if updates_dir.is_dir() {
                    if let Ok(entries) = fs::read_dir(&updates_dir) {
                        for entry in entries.flatten() {
                            let path = entry.path();
                            if path.extension().is_some_and(|ext| ext == "exe" || ext == "msi") {
                                let _ = fs::remove_file(&path);
                                info!(
                                    "[updater] cleaned stale installer: {}",
                                    crate::pipeline::log::clip_text(&path.to_string_lossy(), 200)
                                );
                            }
                        }
                    }
                }
            }

            if start_in_tray {
                commands::windows::hide_main_window_to_tray(&app_handle);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            log_client_event,
            check_for_app_update,
            download_and_install_app_update,
            load_persisted_local_settings,
            save_persisted_local_settings,
            save_dictation_recording,
            list_dictation_recordings_stats,
            list_dictation_recording_ids,
            clear_dictation_recordings,
            get_dictation_recording,
            capture_selected_text,
            set_clipboard_text,
            configure_launch_at_login,
            launch_at_login_status,
            paste_clipboard_text,
            paste_text_via_clipboard,
            control_media_playback,
            mute_system_audio,
            get_foreground_input_block_status,
            get_assistant_info,
            fetch_provider_models,
            fetch_ollama_models,
            pull_ollama_model,
            get_ollama_status,
            install_ollama,
            fetch_local_stt_models,
            download_local_stt_model,
            get_local_stt_download_status,
            delete_local_stt_model,
            open_local_stt_model_path,
            get_local_stt_model_status,
            warmup_local_stt_model,
            deactivate_local_stt_model,
            get_local_stt_runtime_state,
            get_local_stt_hardware_advice,
            setup_assistant_runtime,
            ensure_voice_model,
            validate_piper,
            get_coqui_status,
            setup_coqui_runtime,
            validate_coqui,
            list_coqui_voices,
            list_coqui_models,
            clone_coqui_voice,
            preview_coqui_voice,
            start_tts_runtime_setup,
            get_tts_runtime_setup_status,
            run_assistant_pipeline,
            show_update_settings,
            set_tray_update_available,
            toggle_main_window_visibility,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
