use log::{error, info, warn};
use std::fs;
use tauri::{Emitter, Manager};

pub mod audio;
pub mod commands;
pub mod constants;
pub mod pipeline;
pub mod platform;
pub mod security;
pub mod services;
pub mod state;
pub mod updater;
use commands::{
    cancel_native_capture, capture_selected_text, check_for_app_update, clear_dictation_recordings,
    clone_voice, configure_launch_at_login, configure_shell_integration, control_media_playback,
    deactivate_local_stt_model, delete_local_stt_model, delete_voice_clone,
    download_and_install_app_update, download_local_stt_model, ensure_voice_clone_model,
    ensure_voice_model, fetch_local_stt_models, fetch_ollama_models, fetch_provider_models,
    get_assistant_info, get_dictation_recording, get_foreground_input_block_status,
    get_local_stt_download_status, get_local_stt_hardware_advice, get_local_stt_model_status,
    get_local_stt_runtime_state, get_ollama_status, get_tts_runtime_setup_status,
    get_voice_clone_status, install_ollama, launch_at_login_status, list_dictation_recording_ids,
    list_dictation_recordings_stats, list_voice_clones, load_persisted_local_settings,
    log_client_event, max_tokens_bounds, mute_system_audio, native_capture_level,
    note_paste_target, open_local_stt_model_path, paste_clipboard_text, paste_text_via_clipboard,
    preview_cloned_voice, pull_ollama_model, read_audio_file_base64, run_assistant_pipeline,
    save_dictation_recording, save_persisted_local_settings, set_clipboard_text,
    set_tray_update_available, setup_assistant_runtime, shell_integration_status,
    show_update_settings, start_native_capture, start_tts_runtime_setup, stop_native_capture,
    stt_timeout_bounds, take_pending_transcribe_file, temperature_bounds,
    toggle_main_window_visibility, unload_voice_clone_model, validate_piper,
    warmup_local_stt_model, TtsSetupState,
};
use state::AppState;

// normalize_api_key_secret has been moved to pipeline::routing.

pub fn run() {
    let app_state = AppState::new().expect("failed to initialize app state");
    let tts_setup_state = TtsSetupState::default();
    let startup_args: Vec<String> = std::env::args().collect();
    let start_in_tray = startup_args
        .iter()
        .any(|arg| arg.eq_ignore_ascii_case(crate::constants::STARTUP_ARG_START_IN_TRAY));

    // Explorer's transcribe verb. A cold start has no frontend listener yet, so
    // the path waits in state for the frontend to collect it.
    if let Some(path) = platform::shell_integration::parse_transcribe_file_arg(&startup_args) {
        info!(
            "[shell] cold-start transcription request for {}",
            pipeline::log::clip_text(&path, 200)
        );
        app_state.set_pending_transcribe_file(path);
    }

    let bench_args = services::stt_bench::parse_bench_args(&startup_args);
    // A measurement run has no UI: building the window would flash one on screen.
    let mut context = tauri::generate_context!();
    if bench_args.is_some() {
        context.config_mut().app.windows.clear();
    }

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
            // The frontend is already loaded for a second launch, so hand the
            // request straight over rather than parking it in state.
            if let Some(path) = platform::shell_integration::parse_transcribe_file_arg(&args) {
                info!(
                    "[app.single-instance] forwarding transcription request for {}",
                    pipeline::log::clip_text(&path, 200)
                );
                if let Err(error) = app.emit(
                    crate::constants::APP_EVENT_TRANSCRIBE_FILE,
                    serde_json::json!({ "path": path }),
                ) {
                    warn!("[app.single-instance] failed to forward transcription request: {error}");
                }
                commands::windows::show_main_window(app);
                return;
            }
            commands::windows::show_main_window(app);
        }));
    }

    builder
        .manage(app_state)
        .manage(tts_setup_state)
        // Every webview, including the dock created at runtime, gets the same
        // frame treatment; DWM draws the border per window.
        .on_page_load(|webview, _| {
            platform::window_frame::restyle_system_frame(&webview.window());
        })
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

            if let Some(bench_args) = bench_args.clone() {
                let bench_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let code = match services::stt_bench::run(&bench_handle, &bench_args).await {
                        Ok(path) => {
                            info!("[stt.bench] results written to {}", path.display());
                            0
                        }
                        Err(message) => {
                            error!("[stt.bench] {}", pipeline::log::single_line(&message));
                            1
                        }
                    };
                    bench_handle.exit(code);
                });
                return Ok(());
            }

            let app_handle = app.handle().clone();
            commands::windows::build_tray_icon(&app_handle)?;
            audio::runtimes::ensure_idle_sweeper();
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
            stt_timeout_bounds,
            max_tokens_bounds,
            temperature_bounds,
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
            note_paste_target,
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
            get_voice_clone_status,
            ensure_voice_clone_model,
            list_voice_clones,
            clone_voice,
            preview_cloned_voice,
            delete_voice_clone,
            unload_voice_clone_model,
            start_tts_runtime_setup,
            get_tts_runtime_setup_status,
            run_assistant_pipeline,
            show_update_settings,
            set_tray_update_available,
            toggle_main_window_visibility,
            configure_shell_integration,
            shell_integration_status,
            start_native_capture,
            stop_native_capture,
            cancel_native_capture,
            native_capture_level,
            take_pending_transcribe_file,
            read_audio_file_base64,
        ])
        .run(context)
        .expect("error while running tauri application");
}
