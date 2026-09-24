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

use log::{info, warn};

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
pub(crate) mod win32_native {
    use windows_sys::Win32::Foundation::RECT;

    #[repr(C)]
    #[allow(non_snake_case)]
    // Mirrors the Win32 type name.
    #[allow(clippy::upper_case_acronyms)]
    pub struct MONITORINFO {
        pub cbSize: u32,
        pub rcMonitor: RECT,
        pub rcWork: RECT,
        pub dwFlags: u32,
    }

    extern "system" {
        pub fn GetMonitorInfoW(hMonitor: isize, lpmi: *mut MONITORINFO) -> i32;
        pub fn MonitorFromWindow(hwnd: isize, dwFlags: u32) -> isize;
    }

    // windows-sys 0.59 does not expose OpenProcessToken, so declare it here.
    #[link(name = "advapi32")]
    extern "system" {
        pub fn OpenProcessToken(
            ProcessHandle: windows_sys::Win32::Foundation::HANDLE,
            DesiredAccess: u32,
            TokenHandle: *mut windows_sys::Win32::Foundation::HANDLE,
        ) -> i32;
    }
}

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

/// Whether `pid` runs with an elevated token. `None` when the process or its
/// token cannot be opened (protected process, exited target, access denied).
#[cfg(target_os = "windows")]
pub(crate) fn process_is_elevated(pid: u32) -> Option<bool> {
    use self::win32_native::OpenProcessToken;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };

    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }

        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(process, TOKEN_QUERY, &mut token) == 0 {
            CloseHandle(process);
            return None;
        }

        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut returned = 0_u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            std::ptr::addr_of_mut!(elevation).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        );

        CloseHandle(token);
        CloseHandle(process);

        if ok == 0 {
            return None;
        }
        Some(elevation.TokenIsElevated != 0)
    }
}

/// Whether this process runs elevated.
#[cfg(target_os = "windows")]
pub(crate) fn current_process_is_elevated() -> Option<bool> {
    process_is_elevated(std::process::id())
}

#[cfg(target_os = "windows")]
pub(crate) fn probe_foreground_window_windows() -> Result<ForegroundWindowProbeResult, String> {
    use self::win32_native::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO};

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
            String::from_utf16_lossy(&title_buf[..title_len as usize]).to_ascii_lowercase()
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
                fullscreen = (rect.left - info.rcMonitor.left).abs() <= t
                    && (rect.top - info.rcMonitor.top).abs() <= t
                    && (rect.right - info.rcMonitor.right).abs() <= t
                    && (rect.bottom - info.rcMonitor.bottom).abs() <= t;
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
    let marker = format!("SLASSHYWISPR_SEL_MARKER_{marker_stamp}");

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

    // Restore previous clipboard. F-008: a failed restore used to be silent,
    // which leaves the user's clipboard holding our probe text; surface it.
    if let Some(ref prev_text) = prev {
        if let Err(error) = native_set_clipboard_text(prev_text) {
            warn!(
                "[client] clipboard restore failed after selection capture: {}",
                error
            );
        }
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

/// F-002: current foreground window as an opaque HWND value, or 0 when there
/// is none. Compared before/after a paste so a focus steal aborts it.
#[cfg(target_os = "windows")]
pub(crate) fn foreground_window_handle() -> isize {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            0
        } else {
            hwnd as isize
        }
    }
}

/// Paste-target snapshot: the foreground window at capture intent is where
/// the user was working. Stored as (HWND, owning PID) so a recycled handle
/// can never redirect a paste — the PID is re-validated before any refocus.
#[cfg(target_os = "windows")]
static PASTE_TARGET: std::sync::Mutex<Option<(isize, u32)>> = std::sync::Mutex::new(None);

#[cfg(target_os = "windows")]
fn window_owner_pid(hwnd: isize) -> u32 {
    unsafe {
        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd as _, &mut pid);
        pid
    }
}

/// Snapshot the current foreground window as the paste target. Called at
/// capture intent (record start), when focus is still where the user was
/// working. Returns the HWND as i64, or 0 when there is none.
#[cfg(target_os = "windows")]
pub(crate) fn note_paste_target_windows() -> i64 {
    let hwnd = foreground_window_handle();
    if hwnd == 0 {
        if let Ok(mut guard) = PASTE_TARGET.lock() {
            *guard = None;
        }
        return 0;
    }
    let pid = window_owner_pid(hwnd);
    if let Ok(mut guard) = PASTE_TARGET.lock() {
        *guard = Some((hwnd, pid));
    }
    info!("[client] paste target noted hwnd={} pid={}", hwnd, pid);
    hwnd as i64
}

/// The snapshotted paste target, if any.
#[cfg(target_os = "windows")]
pub(crate) fn noted_paste_target() -> Option<(isize, u32)> {
    PASTE_TARGET.lock().ok().and_then(|guard| *guard)
}

/// True when the window belongs to this process — one of our own windows
/// (main, dock overlay, selection popup).
#[cfg(target_os = "windows")]
pub(crate) fn window_is_own_process(hwnd: isize) -> bool {
    hwnd != 0 && window_owner_pid(hwnd) == std::process::id()
}

/// Refocus a previously snapshotted paste target. Rejects a dead handle
/// (IsWindow) and a recycled one (owner PID changed), then foregrounds the
/// window and verifies. Only invoked when one of our own windows currently
/// holds focus — the case the foreground API permits, since a foreground
/// app may pass focus onward.
#[cfg(target_os = "windows")]
pub(crate) async fn focus_noted_paste_target() -> Result<(), String> {
    let (hwnd, pid) = noted_paste_target()
        .ok_or_else(|| "No paste target was captured for this recording.".to_string())?;
    unsafe {
        if IsWindow(hwnd as _) == 0 {
            if let Ok(mut guard) = PASTE_TARGET.lock() {
                *guard = None;
            }
            return Err("Paste target window was closed before pasting.".to_string());
        }
        if window_owner_pid(hwnd) != pid {
            if let Ok(mut guard) = PASTE_TARGET.lock() {
                *guard = None;
            }
            return Err("Paste target window is no longer the same app.".to_string());
        }
        SetForegroundWindow(hwnd as _);
    }
    tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(120));
    })
    .await
    .ok();
    if foreground_window_handle() != hwnd {
        return Err("Could not return focus to the dictation target window.".to_string());
    }
    Ok(())
}

static SAVED_SYSTEM_AUDIO_VOLUME: std::sync::Mutex<Option<u32>> = std::sync::Mutex::new(None);

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
        // The mute path tolerates a poisoned lock; this one must too, or a
        // panic elsewhere would leave the system volume stuck at zero.
        let vol = SAVED_SYSTEM_AUDIO_VOLUME
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Some(vol) = vol {
            unsafe {
                waveOutSetVolume(std::ptr::null_mut(), vol);
            }
            info!("[client] system audio volume restored to {}", vol);
        }
    }
}
