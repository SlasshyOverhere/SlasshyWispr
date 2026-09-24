//! Window/tray commands — Phase 6i thin-adapter extraction.
//!
//! Moved verbatim from lib.rs: rect capture, show/hide/toggle, tray
//! copies, tray icon builder. run() stays in lib.rs.

use log::{error, info, warn};
use serde_json::json;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};

use crate::constants::APP_EVENT_UPDATE_AVAILABLE;
use crate::constants::{
    APP_EVENT_MAIN_WINDOW_VISIBILITY, APP_EVENT_UPDATE_INSTALL_PROGRESS, MAIN_WINDOW_LABEL,
    TRAY_ID, TRAY_MENU_COPY_LAST_RESPONSE_ID, TRAY_MENU_COPY_LAST_TRANSCRIPTION_ID,
    TRAY_MENU_DASHBOARD_ID, TRAY_MENU_QUIT_ID, TRAY_MENU_UPDATE_AVAILABLE_ID,
};
use crate::pipeline::log::single_line;
use crate::state::window::clamp_to_main_window_min;
use crate::state::AppState;
use crate::state::{WindowRect, TRAY_UPDATE_ITEM};

pub(crate) fn emit_main_window_visibility(app: &AppHandle, hidden: bool) {
    let payload = json!({ "hidden": hidden });
    if let Err(error) = app.emit(APP_EVENT_MAIN_WINDOW_VISIBILITY, payload) {
        warn!("[tray] failed to emit main-window visibility event: {error}");
    }
}

pub(crate) fn emit_update_install_progress(
    app: &AppHandle,
    stage: &str,
    message: &str,
    downloaded_bytes: u64,
    total_bytes: u64,
    completed: bool,
    success: bool,
) {
    let progress_percent = if total_bytes == 0 {
        if completed {
            100.0
        } else {
            0.0
        }
    } else {
        ((downloaded_bytes as f64 / total_bytes as f64) * 100.0).clamp(0.0, 100.0)
    };
    let payload = super::updater::AppUpdateInstallProgressEvent {
        stage: stage.to_string(),
        message: message.to_string(),
        downloaded_bytes,
        total_bytes,
        progress_percent,
        completed,
        success,
    };
    if let Err(error) = app.emit(APP_EVENT_UPDATE_INSTALL_PROGRESS, payload) {
        warn!("[updater] failed to emit install progress event: {error}");
    }
}

pub(crate) fn capture_rect(win: &tauri::WebviewWindow) -> WindowRect {
    let position = win
        .outer_position()
        .unwrap_or(tauri::PhysicalPosition { x: 0, y: 0 });
    let size = win.outer_size().unwrap_or(tauri::PhysicalSize {
        width: 1280,
        height: 832,
    });
    WindowRect {
        position_x: position.x,
        position_y: position.y,
        width: size.width,
        height: size.height,
    }
}

pub(crate) fn show_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        warn!("[tray] dashboard window not found");
        return;
    };

    if let Err(error) = window.unminimize() {
        warn!("[tray] failed to unminimize main window: {error}");
    }
    if let Err(error) = window.show() {
        warn!("[tray] failed to show main window: {error}");
        return;
    }
    if let Err(error) = window.set_focus() {
        warn!("[tray] failed to focus main window: {error}");
    }

    // Sync state so the cached boolean matches the OS reality.
    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut visibility) = state.window_visibility.lock() {
            visibility.hidden = false;
        }
    }
    emit_main_window_visibility(app, false);
}

pub(crate) fn hide_main_window_to_tray(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    // Capture the rect first so we can restore to the same place on the
    // next show — the rect is the size+position the user last saw.
    let rect_capture = capture_rect(&window);

    if let Err(error) = window.hide() {
        warn!("[tray] failed to hide main window to tray: {error}");
    }

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut visibility) = state.window_visibility.lock() {
            visibility.last_rect = Some(rect_capture);
            visibility.hidden = true;
        }
    }
    emit_main_window_visibility(app, true);
}

/// Source-of-truth visibility check against the OS, not the cached flag.
/// This is what every toggle path should branch on so state can't drift.
pub(crate) fn is_actually_visible(win: &tauri::WebviewWindow) -> bool {
    win.is_visible().unwrap_or(false)
}

/// Click-to-toggle: if the main window is currently visible (per the OS),
/// hide it; otherwise show it. This is the path used by the tray icon
/// left-click and the titlebar double-click.
pub(crate) fn try_main_window_toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        warn!("[tray] main window not found for toggle");
        return;
    };

    if is_actually_visible(&window) {
        hide_main_window_to_tray(app);
    } else {
        show_main_window(app);
    }
}

#[tauri::command]
pub(crate) fn toggle_main_window_visibility(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        warn!("[tray] main window not found for toggle");
        return Ok(());
    };

    // Reconcile cached state with the OS before deciding — guards against
    // drift if the user used Win+D or any other path that hid the window
    // without going through our helpers.
    let actually_visible = is_actually_visible(&window);
    if let Ok(mut visibility) = state.window_visibility.lock() {
        visibility.hidden = !actually_visible;
    }

    if actually_visible {
        // Going from visible → hidden. Capture the rect first.
        let rect = capture_rect(&window);
        if let Ok(mut visibility) = state.window_visibility.lock() {
            visibility.last_rect = Some(rect);
            visibility.hidden = true;
        }
        if let Err(error) = window.hide() {
            warn!("[tray] failed to hide main window on toggle: {error}");
        }
        emit_main_window_visibility(&app, true);
    } else {
        // Going from hidden → visible. Restore the last-known rect.
        let rect = state
            .window_visibility
            .lock()
            .ok()
            .and_then(|v| v.last_rect);
        if let Ok(mut visibility) = state.window_visibility.lock() {
            visibility.hidden = false;
        }
        if let Err(error) = window.unminimize() {
            warn!("[tray] failed to unminimize main window on toggle: {error}");
        }
        if let Err(error) = window.show() {
            warn!("[tray] failed to show main window on toggle: {error}");
            return Ok(());
        }
        if let Some(r) = rect {
            if let Err(error) = window.set_position(tauri::PhysicalPosition {
                x: r.position_x,
                y: r.position_y,
            }) {
                warn!("[tray] failed to set position on toggle restore: {error}");
            }
            // F-026: never restore below the 1024x640 floor.
            let (width, height) = clamp_to_main_window_min(r.width, r.height);
            if let Err(error) = window.set_size(tauri::PhysicalSize { width, height }) {
                warn!("[tray] failed to set size on toggle restore: {error}");
            }
        }
        emit_main_window_visibility(&app, false);
    }
    Ok(())
}

pub(crate) fn copy_last_transcript_to_clipboard(app: &AppHandle) {
    let state = app.state::<AppState>();
    let transcript = match state.last_transcript_snapshot() {
        Ok(value) => value,
        Err(error) => {
            error!(
                "[tray] failed to read last transcript: {}",
                single_line(&error)
            );
            return;
        }
    };

    if transcript.trim().is_empty() {
        info!("[tray] last transcript copy requested but transcript is empty");
        return;
    }

    #[cfg(target_os = "windows")]
    {
        if let Err(error) = crate::platform::windows_native::set_clipboard_text_windows(&transcript)
        {
            error!(
                "[tray] failed to copy last transcript to clipboard: {}",
                single_line(&error)
            );
        } else {
            info!(
                "[tray] copied last transcript chars={}",
                transcript.chars().count()
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = transcript;
        warn!("[tray] clipboard copy from tray is implemented for Windows only");
    }
}

pub(crate) fn copy_last_response_to_clipboard(app: &AppHandle) {
    let state = app.state::<AppState>();
    let response = match state.last_assistant_response_snapshot() {
        Ok(value) => value,
        Err(error) => {
            error!(
                "[tray] failed to read last assistant response: {}",
                single_line(&error)
            );
            return;
        }
    };

    if response.trim().is_empty() {
        info!("[tray] last response copy requested but response is empty");
        return;
    }

    #[cfg(target_os = "windows")]
    {
        if let Err(error) = crate::platform::windows_native::set_clipboard_text_windows(&response) {
            error!(
                "[tray] failed to copy last assistant response to clipboard: {}",
                single_line(&error)
            );
        } else {
            info!(
                "[tray] copied last assistant response chars={}",
                response.chars().count()
            );
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = response;
        warn!("[tray] clipboard copy from tray is implemented for Windows only");
    }
}

pub(crate) fn build_tray_icon(app: &AppHandle) -> tauri::Result<()> {
    let copy_last_transcription = MenuItem::with_id(
        app,
        TRAY_MENU_COPY_LAST_TRANSCRIPTION_ID,
        "Copy last transcription",
        true,
        None::<&str>,
    )?;
    let copy_last_response = MenuItem::with_id(
        app,
        TRAY_MENU_COPY_LAST_RESPONSE_ID,
        "Copy last AI response",
        true,
        None::<&str>,
    )?;
    let dashboard = MenuItem::with_id(
        app,
        TRAY_MENU_DASHBOARD_ID,
        "Show SlasshyWispr",
        true,
        None::<&str>,
    )?;
    let update_available = MenuItem::with_id(
        app,
        TRAY_MENU_UPDATE_AVAILABLE_ID,
        "Update available",
        false,
        None::<&str>,
    )?;
    let _ = TRAY_UPDATE_ITEM.set(update_available.clone());
    let quit = MenuItem::with_id(
        app,
        TRAY_MENU_QUIT_ID,
        "Quit SlasshyWispr",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &copy_last_transcription,
            &copy_last_response,
            &dashboard,
            &update_available,
            &separator,
            &quit,
        ],
    )?;
    let app_handle_for_click = app.clone();

    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("SlasshyWispr")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            TRAY_MENU_COPY_LAST_TRANSCRIPTION_ID => {
                copy_last_transcript_to_clipboard(app);
            }
            TRAY_MENU_COPY_LAST_RESPONSE_ID => {
                copy_last_response_to_clipboard(app);
            }
            TRAY_MENU_DASHBOARD_ID => {
                try_main_window_toggle(app);
            }
            TRAY_MENU_UPDATE_AVAILABLE_ID => {
                show_main_window(app);
                if let Err(error) = app.emit(APP_EVENT_UPDATE_AVAILABLE, json!({})) {
                    warn!("[tray] failed to emit update-available event: {error}");
                }
            }
            TRAY_MENU_QUIT_ID => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                try_main_window_toggle(&app_handle_for_click);
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    } else {
        warn!("[tray] default window icon missing; tray icon may not be visible");
    }

    tray_builder.build(app)?;

    Ok(())
}
