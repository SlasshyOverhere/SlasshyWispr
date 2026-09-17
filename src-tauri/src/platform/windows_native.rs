//! Windows-native input/clipboard/foreground primitives (platform boundary).
//!
//! Moved verbatim from commands::input: raw Win32 input simulation, clipboard
//! (arboard), process-name resolution, foreground-window probing, selection
//! capture, the installer-relaunch watcher, and the clipboard-write helper.
//! Pure foreground-blocking policy lives in super::input::policy; shared
//! types in super::windows_types.

use std::path::Path;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use log::info;

#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{CloseHandle, RECT};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Media::Audio::{waveOutGetVolume, waveOutSetVolume};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, WaitForSingleObject, INFINITE,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::*;



use super::input::policy::is_blocked_terminal_process_name;
use super::windows_types::ForegroundWindowProbeResult;

#[cfg(target_os = "windows")]
pub(crate) fn make_key_input(vk: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Simulate Ctrl+<vk> (hold Ctrl, tap <vk>, release both).
#[cfg(target_os = "windows")]
pub(crate) fn simulate_ctrl_combo(vk: u16) -> Result<(), String> {
    let inputs = [
        make_key_input(VK_LCONTROL, 0),
        make_key_input(vk, 0),
        make_key_input(vk, KEYEVENTF_KEYUP),
        make_key_input(VK_LCONTROL, KEYEVENTF_KEYUP),
    ];
    let sent = unsafe { SendInput(4, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32) };
    if sent != 4 {
        return Err(format!("SendInput sent {}/4 events", sent));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn native_get_clipboard_text() -> Result<String, String> {
    let mut ctx = arboard::Clipboard::new().map_err(|e| format!("Clipboard open failed: {e}"))?;
    ctx.get_text()
        .map_err(|e| format!("Clipboard read failed: {e}"))
}

#[cfg(target_os = "windows")]
pub(crate) fn native_set_clipboard_text(text: &str) -> Result<(), String> {
    let mut ctx = arboard::Clipboard::new().map_err(|e| format!("Clipboard open failed: {e}"))?;
    ctx.set_text(text.to_owned())
        .map_err(|e| format!("Clipboard write failed: {e}"))
}

#[cfg(target_os = "windows")]
pub(crate) fn get_process_name_from_pid(pid: u32) -> String {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return String::new();
        }
        let mut buf = [0u16; 512];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
        CloseHandle(handle);
        if ok == 0 {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buf[..size as usize]);
        std::path::Path::new(&path)
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_ascii_lowercase()
    }
}


#[cfg(target_os = "windows")]
pub(crate) fn probe_foreground_window_windows() -> Result<ForegroundWindowProbeResult, String> {
    use crate::win32_native::{GetMonitorInfoW, MONITORINFO, MonitorFromWindow};

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return Ok(ForegroundWindowProbeResult {
                process_name: String::new(),
                window_title: String::new(),
                fullscreen: false,
            });
        }

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return Ok(ForegroundWindowProbeResult {
                process_name: String::new(),
                window_title: String::new(),
                fullscreen: false,
            });
        }

        let process_name = get_process_name_from_pid(pid);
        if process_name.is_empty() {
            return Ok(ForegroundWindowProbeResult {
                process_name: String::new(),
                window_title: String::new(),
                fullscreen: false,
            });
        }

        // Get window title
        let mut title_buf = [0u16; 512];
        let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
        let window_title = if title_len > 0 {
            String::from_utf16_lossy(&title_buf[..title_len as usize])
                .to_ascii_lowercase()
        } else {
            String::new()
        };

        // Detect fullscreen
        let mut fullscreen = false;
        let mut rect = std::mem::zeroed::<RECT>();
        let monitor = MonitorFromWindow(hwnd as isize, 2); // MONITOR_DEFAULTTONEAREST
        if monitor != 0 && GetWindowRect(hwnd, &mut rect) != 0 {
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                rcMonitor: std::mem::zeroed(),
                rcWork: std::mem::zeroed(),
                dwFlags: 0,
            };
            if GetMonitorInfoW(monitor, &mut info) != 0 {
                let t = 2i32;
                fullscreen =
                    (rect.left - info.rcMonitor.left).abs() <= t &&
                    (rect.top - info.rcMonitor.top).abs() <= t &&
                    (rect.right - info.rcMonitor.right).abs() <= t &&
                    (rect.bottom - info.rcMonitor.bottom).abs() <= t;
            }
        }

        Ok(ForegroundWindowProbeResult {
            process_name,
            window_title,
            fullscreen,
        })
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn capture_selected_text_windows() -> Result<String, String> {
    // Detect if the foreground window is a terminal or IDE with a terminal tab
    let is_terminal_focused = unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            false
        } else {
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                false
            } else {
                is_blocked_terminal_process_name(&get_process_name_from_pid(pid))
            }
        }
    };
    if is_terminal_focused {
        info!("[client] selection capture skipped while terminal window is focused");
        return Ok(String::new());
    }

    let marker_stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("Failed to compute marker timestamp: {error}"))?
        .as_millis();
    let marker = format!("SLASSHY_SEL_MARKER_{marker_stamp}");

    // Save clipboard state
    let prev = native_get_clipboard_text().ok();
    native_set_clipboard_text(&marker).ok();

    thread::sleep(Duration::from_millis(40));
    let mut sel = String::new();
    for _ in 0..4 {
        thread::sleep(Duration::from_millis(70));
        simulate_ctrl_combo(0x43)?; // Ctrl+C
        thread::sleep(Duration::from_millis(160));
        if let Ok(cur) = native_get_clipboard_text() {
            if cur != marker && !cur.trim().is_empty() {
                sel = cur;
                break;
            }
        }
    }

    // Restore previous clipboard
    if let Some(ref prev_text) = prev {
        native_set_clipboard_text(prev_text).ok();
    }

    Ok(sel.replace("\r\n", "\n"))
}

#[cfg(target_os = "windows")]
pub(crate) fn schedule_app_relaunch_after_installer(
    installer_pid: u32,
    app_exe_path: &Path,
) -> Result<(), String> {
    let exe_path = app_exe_path.to_path_buf();
    if exe_path.as_os_str().is_empty() {
        return Err("App executable path is empty; cannot schedule relaunch.".to_string());
    }

    // Snapshot the exe before the installer runs
    let snapshot = exe_path.metadata().ok().map(|m| {
        (
            m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH),
            m.len(),
        )
    });

    thread::spawn(move || {
        // Wait for the installer process to exit
        unsafe {
            let handle = OpenProcess(
                PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
                0,
                installer_pid,
            );
            if !handle.is_null() {
                WaitForSingleObject(handle, INFINITE);
                CloseHandle(handle);
            }
        }

        // Give the installer a moment to finalize file writes
        thread::sleep(Duration::from_secs(3));

        // Poll for the exe to change
        let max_attempts = 240;
        for _ in 0..max_attempts {
            if exe_path.exists() {
                let changed = match (&snapshot, exe_path.metadata()) {
                    (Some((old_time, old_len)), Ok(meta)) => {
                        meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH) != *old_time
                            || meta.len() != *old_len
                    }
                    (None, Ok(_)) => true,
                    _ => false,
                };
                if changed {
                    thread::sleep(Duration::from_millis(500));
                    let _ = std::process::Command::new(&exe_path).spawn();
                    return;
                }
            }
            thread::sleep(Duration::from_millis(500));
        }

        // Fallback: launch anyway
        if exe_path.exists() {
            let _ = std::process::Command::new(&exe_path).spawn();
        }
    });

    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn set_clipboard_text_windows(text: &str) -> Result<(), String> {
    native_set_clipboard_text(text)
}

static SAVED_SYSTEM_AUDIO_VOLUME: std::sync::Mutex<Option<u32>> =
    std::sync::Mutex::new(None);

/// Send a media play/pause app-command broadcast (moved verbatim from the
/// `control_media_playback` command adapter).
#[cfg(target_os = "windows")]
pub(crate) fn send_media_app_command(action: &str) -> Result<(), String> {
    let normalized = action.trim().to_ascii_lowercase();
    let app_command = match normalized.as_str() {
        "play" => 46isize,
        "pause" => 47isize,
        _ => {
            return Err("Invalid media action. Expected \"play\" or \"pause\".".to_string());
        }
    };

    let lparam = app_command << 16;
    let mut result: usize = 0;
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_APPCOMMAND,
            0,
            lparam,
            SMTO_ABORTIFHUNG,
            250,
            &mut result,
        );
    }
    Ok(())
}

/// Mute or restore the system wave-out volume (moved verbatim from the
/// `mute_system_audio` command adapter).
#[cfg(target_os = "windows")]
pub(crate) fn set_system_mute(mute: bool) {
    use log::{info, warn};

    if mute {
        // Save current volume
        let mut vol: u32 = 0;
        unsafe {
            if waveOutGetVolume(std::ptr::null_mut(), &mut vol) == 0 {
                if let Ok(mut saved) = SAVED_SYSTEM_AUDIO_VOLUME.lock() {
                    *saved = Some(vol);
                }
            } else {
                warn!("[client] failed to get system volume");
            }
        }
        // Mute
        unsafe {
            waveOutSetVolume(std::ptr::null_mut(), 0);
        }
        info!("[client] system audio muted");
    } else {
        let vol = SAVED_SYSTEM_AUDIO_VOLUME.lock().unwrap().take();
        if let Some(vol) = vol {
            unsafe {
                waveOutSetVolume(std::ptr::null_mut(), vol);
            }
            info!("[client] system audio volume restored to {}", vol);
        }
    }
}
