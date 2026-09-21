//! Window frame cosmetics.
//!
//! DWM composites a 1px border around every top-level window, decorated or not.
//! On a `#000` canvas that reads as a bright white outline the app never drew,
//! and Windows only colours it white because the process is treated as a
//! light-themed app. Both attributes are Win10/11 frame hints; a build that
//! rejects one keeps the frame it had, so failures are not worth surfacing.

/// Paint the system frame in the app's colours: no border, dark immersive mode
/// so the shadow and any native surface DWM still draws stay black.
#[cfg(target_os = "windows")]
pub(crate) fn restyle_system_frame(window: &tauri::Window) {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_USE_IMMERSIVE_DARK_MODE,
    };

    let Ok(hwnd) = window.hwnd() else {
        return;
    };

    let border: u32 = DWMWA_COLOR_NONE;
    let dark: u32 = 1;
    unsafe {
        DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_BORDER_COLOR as u32,
            &border as *const u32 as *const core::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );
        DwmSetWindowAttribute(
            hwnd.0,
            DWMWA_USE_IMMERSIVE_DARK_MODE as u32,
            &dark as *const u32 as *const core::ffi::c_void,
            std::mem::size_of::<u32>() as u32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn restyle_system_frame(_window: &tauri::Window) {}
