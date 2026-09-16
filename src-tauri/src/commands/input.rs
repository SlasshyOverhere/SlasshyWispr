//! Input/clipboard/OS-integration commands — Phase 6h extraction.
//!
//! Moved verbatim from lib.rs: capture, clipboard, launch-at-login,
//! paste, media playback, mute, foreground-block status. Windows helpers
//! stay in lib.rs for Phase 7 platform split (shared with tray + STT
//! hardware probes); this module calls back into them.

use std::path::Path;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use log::{info, warn};
use serde::Serialize;

use crate::constants::{STARTUP_ARG_START_IN_TRAY, STARTUP_RUN_VALUE_NAME};
use crate::pipeline::log::{clip_text, single_line};
use crate::SAVED_SYSTEM_AUDIO_VOLUME;

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


#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ForegroundInputBlockStatus {
    pub(crate) blocked: bool,
    pub(crate) process_name: String,
    pub(crate) reason: String,
    pub(crate) fullscreen: bool,
}
#[derive(Debug, Clone)]
pub(crate) struct ForegroundWindowProbeResult {
    pub(crate) process_name: String,
    pub(crate) window_title: String,
    pub(crate) fullscreen: bool,
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

pub(crate) fn is_blocked_game_process_name(process_name: &str) -> bool {
    let normalized = process_name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    let base = normalized.trim_end_matches(".exe");

    // Known IDE/editor process names that start with a game-prefix substring
    // must be exempted before prefix matching to avoid false positives.
    const IDE_EXEMPT: [&str; 4] = ["code", "code - insiders", "cursor", "windsurf"];
    if IDE_EXEMPT.contains(&base) {
        return false;
    }

    const BLOCKED_EXACT: [&str; 35] = [
        "ac_client",
        "apex",
        "bf1",
        "bf2042",
        "bo6",
        "valorant",
        "valorant-win64-shipping",
        "cs2",
        "hl2",
        "dota2",
        "r5apex",
        "fortniteclient-win64-shipping",
        "overwatch",
        "rainbowsix",
        "rocketleague",
        "gta5",
        "eldenring",
        "escapedfromtarkov",
        "eurotrucks2",
        "farlight84",
        "fc25",
        "leagueclientux",
        "leagueclientuxrender",
        "leagueoflegends",
        "minecraft",
        "minecraftlauncher",
        "palworld-win64-shipping",
        "pathofexile",
        "pathofexilesteam",
        "warframe.x64",
        "witcher3",
        "wow",
        "destiny2",
        "pubg",
        "rustclient",
    ];

    if BLOCKED_EXACT.contains(&base) {
        return true;
    }

    const BLOCKED_PREFIXES: [&str; 32] = [
        "arma",
        "assettocorsa",
        "blackops",
        "cod",
        "counter-strike",
        "cyberpunk",
        "valorant",
        "fortniteclient",
        "r5apex",
        "diablo",
        "dragonage",
        "ea sports fc",
        "eafc",
        "elden",
        "fifa",
        "forza",
        "genshin",
        "honkai",
        "leagueclient",
        "leagueoflegends",
        "nba2k",
        "nfs",
        "rainbowsix",
        "rocketleague",
        "overwatch",
        "palworld",
        "destiny2",
        "pubg",
        "rustclient",
        "starrail",
        "tekken",
        "witcher",
    ];

    BLOCKED_PREFIXES
        .iter()
        .any(|prefix| base.starts_with(prefix))
}

pub(crate) fn is_allowed_fullscreen_process_name(process_name: &str) -> bool {
    let normalized = process_name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }

    let base = normalized.trim_end_matches(".exe");
    const ALLOWED_FULLSCREEN_EXACT: [&str; 25] = [
        "app",
        "arc",
        "brave",
        "chrome",
        "code",
        "cursor",
        "discord",
        "explorer",
        "firefox",
        "mpc-hc64",
        "msedge",
        "obs64",
        "opera",
        "outlook",
        "photos",
        "potplayermini64",
        "powerpnt",
        "slack",
        "spotify",
        "steam",
        "telegram",
        "teams",
        "vlc",
        "webview2manager",
        "zoom",
    ];
    if ALLOWED_FULLSCREEN_EXACT.contains(&base) {
        return true;
    }

    const ALLOWED_FULLSCREEN_PREFIXES: [&str; 7] = [
        "code - insiders",
        "microsoft",
        "ms-teams",
        "powerpoint",
        "wezterm",
        "windows terminal",
        "windowsterminal",
    ];
    ALLOWED_FULLSCREEN_PREFIXES
        .iter()
        .any(|prefix| base.starts_with(prefix))
}

pub(crate) fn is_likely_fullscreen_game_window(
    process_name: &str,
    window_title: &str,
    fullscreen: bool,
) -> bool {
    if !fullscreen || is_allowed_fullscreen_process_name(process_name) {
        return false;
    }

    let normalized_title = window_title.trim().to_ascii_lowercase();
    !(normalized_title.contains("youtube")
        || normalized_title.contains("netflix")
        || normalized_title.contains("twitch")
        || normalized_title.contains("prime video")
        || normalized_title.contains("presentation")
        || normalized_title.contains("powerpoint"))
}

pub(crate) fn is_blocked_terminal_process_name(process_name: &str) -> bool {
    let normalized = process_name.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }

    let base = normalized.trim_end_matches(".exe");
    const BLOCKED_TERMINAL_EXACT: [&str; 11] = [
        "cmd",
        "conhost",
        "powershell",
        "pwsh",
        "windowsterminal",
        "wt",
        "bash",
        "zsh",
        "fish",
        "mintty",
        "tabby",
    ];
    if BLOCKED_TERMINAL_EXACT.contains(&base) {
        return true;
    }

    const BLOCKED_TERMINAL_PREFIXES: [&str; 5] = [
        "windows terminal",
        "wezterm",
        "alacritty",
        "cmder",
        "git-bash",
    ];
    if BLOCKED_TERMINAL_PREFIXES
        .iter()
        .any(|prefix| base.starts_with(prefix))
    {
        return true;
    }

    base.contains("terminal")
}

pub(crate) fn is_ide_terminal_window(process_name: &str, window_title: &str) -> bool {
    let normalized_process = process_name.trim().to_ascii_lowercase();
    let normalized_title = window_title.trim().to_ascii_lowercase();
    if normalized_process.is_empty() || normalized_title.is_empty() {
        return false;
    }

    let is_ide = normalized_process == "code"
        || normalized_process == "cursor"
        || normalized_process == "code - insiders"
        || normalized_process == "windsurf";
    if !is_ide {
        return false;
    }

    normalized_title.contains("terminal")
        || normalized_title.contains("powershell")
        || normalized_title.contains("pwsh")
        || normalized_title.contains("cmd")
        || normalized_title.contains("bash")
        || normalized_title.contains("zsh")
        || normalized_title.contains("fish")
}

pub(crate) fn foreground_input_block_reason(
    process_name: &str,
    window_title: &str,
    fullscreen: bool,
) -> Option<&'static str> {
    if is_blocked_game_process_name(process_name) {
        return Some("game-process");
    }
    if is_likely_fullscreen_game_window(process_name, window_title, fullscreen) {
        return Some("fullscreen-game-heuristic");
    }
    if is_blocked_terminal_process_name(process_name) {
        return Some("terminal-process");
    }
    if is_ide_terminal_window(process_name, window_title) {
        return Some("ide-terminal");
    }
    None
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
            run_key
                .delete_value(STARTUP_RUN_VALUE_NAME)
                .ok(); // ignore if not present
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

#[tauri::command]
pub(crate) async fn paste_clipboard_text() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        thread::sleep(Duration::from_millis(70));
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
pub(crate) async fn paste_text_via_clipboard(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        native_set_clipboard_text(&text)?;
        thread::sleep(Duration::from_millis(90));
        simulate_ctrl_combo(0x56).map_err(|e| format!("Dictation paste failed: {e}"))?; // Ctrl+V
        info!(
            "[client] dictation clipboard+paste triggered chars={}",
            text.chars().count()
        );
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

        info!("[client] media playback action={}", normalized);
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

    #[cfg(not(target_os = "windows"))]
    {
        let _ = mute;
        return Err("System audio mute is currently implemented for Windows builds only.".to_string());
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn get_foreground_input_block_status() -> Result<ForegroundInputBlockStatus, String> {
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

