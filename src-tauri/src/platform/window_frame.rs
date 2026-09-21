//! Window frame cosmetics.
//!
//! DWM composites the frame around every top-level window, decorated or not, and
//! its defaults are wrong for us on three counts: it draws a 1px border the app
//! never asked for, it colours that frame as if the process were light-themed,
//! and it leaves an undecorated window square instead of rounded. Each hint is a
//! no-op on a build that rejects it — cosmetic, so a failure is not worth
//! surfacing. The shadow is not ours to set: it comes from the non-client frame
//! tao keeps for undecorated windows, which is also why these attributes land.

/// Paint the system frame the way the app is drawn: no border, dark, and rounded
/// at `DWMWCP_ROUND` (8px, matching the card radius).
#[cfg(target_os = "windows")]
pub(crate) fn restyle_system_frame(window: &tauri::Window) {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_USE_IMMERSIVE_DARK_MODE,
        DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    let set = |attribute: i32, value: u32| unsafe {
        DwmSetWindowAttribute(
            hwnd.0,
            attribute as u32,
            &value as *const u32 as *const core::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );
    };

    set(DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE);
    set(DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
    set(DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND as u32);
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn restyle_system_frame(_window: &tauri::Window) {}
