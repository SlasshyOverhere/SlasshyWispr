//! Input/clipboard/OS-integration commands — Phase 6h extraction + platform split.
//!
//! Tauri command adapters only. Windows-native primitives live in
//! `crate::platform::windows_native`, pure foreground-blocking policy in
//! `crate::platform::input::policy`, shared types in
//! `crate::platform::windows_types` (re-exported here so existing
//! `commands::input::X` paths keep working).

use std::thread;
use std::time::Duration;

use log::{info, warn};

use crate::constants::{STARTUP_ARG_START_IN_TRAY, STARTUP_RUN_VALUE_NAME};
use crate::pipeline::log::{clip_text, single_line};
#[cfg(target_os = "windows")]
use crate::platform::clipboard_render::{self, ClipboardRestore, ConsumptionOutcome};
use crate::platform::windows_native::{
    capture_selected_text_windows, native_set_clipboard_text, probe_foreground_window_windows,
    simulate_ctrl_combo,
};
use crate::platform::windows_types::ForegroundInputBlockStatus;

pub(crate) use crate::platform::input::foreground_input_block_reason;
pub(crate) use crate::platform::windows_native::set_clipboard_text_windows;

#[tauri::command]
pub(crate) async fn capture_selected_text() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let text = capture_selected_text_windows()?;
        info!(
            "[client] captured selected text chars={}",
            text.chars().count()
        );
        return Ok(text);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Selected-text capture is currently implemented for Windows builds only.".to_string())
    }
}

#[tauri::command]
pub(crate) async fn set_clipboard_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        set_clipboard_text_windows(&text)?;
        info!("[client] clipboard updated chars={}", text.chars().count());
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Err("Clipboard write helper is currently implemented for Windows builds only.".to_string())
    }
}

#[tauri::command]
pub(crate) async fn configure_launch_at_login(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .open_subkey_with_flags(
                "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                KEY_READ | KEY_WRITE,
            )
            .or_else(|_| {
                hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
                    .map(|(key, _)| key)
            })
            .map_err(|e| format!("Unable to open startup registry key: {e}"))?;

        if enabled {
            let exe_path = std::env::current_exe()
                .map_err(|e| format!("Failed to resolve executable path: {e}"))?;
            let exe_text = exe_path.to_string_lossy().to_string();
            let value = format!("\"{}\" {}", exe_text, STARTUP_ARG_START_IN_TRAY);
            run_key
                .set_value(STARTUP_RUN_VALUE_NAME, &value)
                .map_err(|e| format!("Unable to enable launch at login: {e}"))?;
            info!(
                "[startup] launch at login enabled with start-in-tray flag path={}",
                clip_text(&single_line(&exe_text), 240)
            );
        } else {
            run_key.delete_value(STARTUP_RUN_VALUE_NAME).ok(); // ignore if not present
            info!("[startup] launch at login disabled");
        }
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = enabled;
        Err("Launch at login helper is currently implemented for Windows builds only.".to_string())
    }
}

/// Report whether the Windows Run key (or its non-Windows placeholder) currently
/// points at this executable, plus whether it is enabled at all. The frontend uses
/// this to reconcile "settings.launchAtLogin" against the actual OS state after an
/// update replaces the binary path.
#[tauri::command]
pub(crate) async fn launch_at_login_status() -> Result<LaunchAtLoginStatus, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let current_exe = std::env::current_exe()
            .map_err(|e| format!("Failed to resolve executable path: {e}"))?;
        let current_exe_text = current_exe.to_string_lossy().to_string();
        let expected_quoted = format!("\"{}\" {}", current_exe_text, STARTUP_ARG_START_IN_TRAY);

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .open_subkey_with_flags(
                "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
                KEY_READ,
            )
            .or_else(|_| {
                // Key may not exist yet (clean system, Group Policy removal).
                // Return a status indicating no entry — the frontend will
                // reconcile this as "not enabled."
                hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
                    .map(|(k, _)| k)
            })
            .map_err(|e| format!("Unable to open startup registry key: {e}"))?;
        let stored: Result<String, _> = run_key.get_value(STARTUP_RUN_VALUE_NAME);

        match stored {
            Ok(value) => {
                let path_matches = value == expected_quoted;
                Ok(LaunchAtLoginStatus {
                    enabled: true,
                    path_matches,
                    stored_value: Some(value),
                })
            }
            Err(_) => Ok(LaunchAtLoginStatus {
                enabled: false,
                path_matches: false,
                stored_value: None,
            }),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(LaunchAtLoginStatus {
            enabled: false,
            path_matches: false,
            stored_value: None,
        })
    }
}

#[derive(serde::Serialize)]
pub(crate) struct LaunchAtLoginStatus {
    pub enabled: bool,
    pub path_matches: bool,
    pub stored_value: Option<String>,
}

/// F-014: async sleep so the paste commands yield instead of blocking a
/// runtime worker for the settle delay.
#[cfg(target_os = "windows")]
async fn paste_settle_sleep(ms: u64) {
    tauri::async_runtime::spawn_blocking(move || thread::sleep(Duration::from_millis(ms)))
        .await
        .ok();
}

#[tauri::command]
pub(crate) async fn paste_clipboard_text() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let target = crate::platform::windows_native::noted_paste_target();
        paste_settle_sleep(70).await;
        ensure_paste_focus(target, "Auto-paste").await?;
        simulate_ctrl_combo(0x56).map_err(|e| format!("Auto-paste failed: {e}"))?; // Ctrl+V
        info!("[client] auto-paste triggered");
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Auto-paste is currently implemented for Windows builds only.".to_string())
    }
}

#[tauri::command]
pub(crate) async fn configure_shell_integration(enabled: bool) -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve the application path: {error}"))?;
    if enabled {
        crate::platform::shell_integration::register_shell_integration(&exe)
    } else {
        crate::platform::shell_integration::unregister_shell_integration()
    }
}

#[tauri::command]
pub(crate) async fn shell_integration_status() -> Result<bool, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("Failed to resolve the application path: {error}"))?;
    Ok(crate::platform::shell_integration::shell_integration_is_registered(&exe))
}

#[tauri::command]
pub(crate) async fn note_paste_target() -> Result<i64, String> {
    #[cfg(target_os = "windows")]
    {
        return Ok(crate::platform::windows_native::note_paste_target_windows());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Paste target snapshot is currently implemented for Windows builds only.".to_string())
    }
}

/// Decide whether Ctrl+V may fire for the snapshotted paste target.
///
/// - Focus already on the target: paste.
/// - Focus in one of our own windows (user glanced at the app while the
///   pipeline ran): hand focus back to the captured target, then paste.
/// - Focus in a different foreign window (user switched away): abort so the
///   dictation cannot land somewhere unexpected. The `label` picks the
///   command-specific abort message.
#[cfg(target_os = "windows")]
async fn ensure_paste_focus(target: Option<(isize, u32)>, label: &str) -> Result<(), String> {
    use crate::platform::windows_native as native;
    let current = native::foreground_window_handle();
    let wanted = target.map(|(hwnd, _)| hwnd).unwrap_or(current);
    if current != 0 && current == wanted {
        return Ok(());
    }
    if wanted != 0 && native::window_is_own_process(current) {
        native::focus_noted_paste_target().await?;
        info!("[client] paste focus returned to captured target");
        return Ok(());
    }
    if wanted == 0 {
        // No target captured and no focus to reason about; best effort.
        return Ok(());
    }
    Err(format!("{label} aborted: the active window changed."))
}

#[tauri::command]
pub(crate) async fn paste_text_via_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let target = crate::platform::windows_native::noted_paste_target();

        // UIPI blocks injection into a higher-integrity window. Publish the text
        // as ordinary clipboard data so the user can paste it manually — a
        // delayed render would disappear with this process.
        let target_elevated = target
            .and_then(|(_, pid)| crate::platform::windows_native::process_is_elevated(pid))
            .unwrap_or(false);
        let self_elevated =
            crate::platform::windows_native::current_process_is_elevated().unwrap_or(false);
        if let Some(reason) =
            crate::platform::input::elevation::paste_block_reason(target_elevated, self_elevated)
        {
            native_set_clipboard_text(&text)?;
            warn!("[client] dictation paste blocked: {}", reason.message());
            return Err(reason.message().to_string());
        }

        // F-002: snapshot so the user's clipboard survives the paste.
        let previous_clipboard = crate::platform::windows_native::native_get_clipboard_text().ok();

        // Publish as a delayed render: the target's read of the clipboard tells
        // us when to put the previous clipboard back, instead of a fixed sleep.
        let publisher = match clipboard_render::publish_delayed(&text, target.map(|(_, pid)| pid)) {
            Ok(publisher) => Some(publisher),
            Err(error) => {
                warn!("[client] delayed-render clipboard unavailable ({error}); writing directly");
                native_set_clipboard_text(&text)?;
                None
            }
        };

        if let Err(error) = ensure_paste_focus(target, "Dictation paste").await {
            match publisher {
                Some(publisher) => publisher.materialize(),
                None => {
                    if let Some(previous) = &previous_clipboard {
                        let _ = native_set_clipboard_text(previous);
                    }
                }
            }
            warn!("[client] dictation paste aborted: {error}");
            return Err(error);
        }

        simulate_ctrl_combo(0x56).map_err(|e| format!("Dictation paste failed: {e}"))?; // Ctrl+V

        let Some(publisher) = publisher else {
            info!(
                "[client] dictation clipboard+paste triggered chars={}",
                text.chars().count()
            );
            return Ok(());
        };

        // Waiting can burn the whole timeout, so keep it off the async workers.
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            publisher.wait_for_consumption(clipboard_render::CONSUMPTION_TIMEOUT)
        })
        .await
        .unwrap_or(ConsumptionOutcome::TimedOut);

        match clipboard_render::restore_action(outcome, previous_clipboard.as_deref()) {
            ClipboardRestore::Restore(previous) => {
                publisher.stop_rendering();
                if native_set_clipboard_text(&previous).is_err() {
                    // Never leave a delayed render that can no longer be pulled.
                    let _ = native_set_clipboard_text(&text);
                }
                info!(
                    "[client] dictation pasted and clipboard restored chars={}",
                    text.chars().count()
                );
            }
            ClipboardRestore::KeepTranscription => {
                publisher.materialize();
                info!(
                    "[client] dictation text left on the clipboard chars={}",
                    text.chars().count()
                );
            }
            ClipboardRestore::LeaveAlone => {
                publisher.stop_rendering();
                warn!("[client] clipboard taken over during dictation paste; left untouched");
            }
        }
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        Err("Dictation paste helper is currently implemented for Windows builds only.".to_string())
    }
}

#[tauri::command]
pub(crate) async fn control_media_playback(action: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::platform::windows_native::send_media_app_command(&action)?;
        info!(
            "[client] media playback action={}",
            action.trim().to_ascii_lowercase()
        );
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = action;
        Err("Media playback control is currently implemented for Windows builds only.".to_string())
    }
}

#[tauri::command]
pub(crate) async fn mute_system_audio(mute: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::platform::windows_native::set_system_mute(mute);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = mute;
        return Err(
            "System audio mute is currently implemented for Windows builds only.".to_string(),
        );
    }
}

#[tauri::command]
pub(crate) async fn get_foreground_input_block_status() -> Result<ForegroundInputBlockStatus, String>
{
    #[cfg(target_os = "windows")]
    {
        let probe = probe_foreground_window_windows()?;
        let reason = foreground_input_block_reason(
            &probe.process_name,
            &probe.window_title,
            probe.fullscreen,
        );
        return Ok(ForegroundInputBlockStatus {
            blocked: reason.is_some(),
            process_name: probe.process_name,
            reason: reason.unwrap_or_default().to_string(),
            fullscreen: probe.fullscreen,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(ForegroundInputBlockStatus {
            blocked: false,
            process_name: String::new(),
            reason: String::new(),
            fullscreen: false,
        })
    }
}
