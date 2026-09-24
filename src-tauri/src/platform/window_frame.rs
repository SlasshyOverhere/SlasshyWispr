//! Window frame cosmetics.
//!
//! The black shell wore a white 1px outline on three sides, and CSS cannot touch
//! it: `decorations: false` + `shadow: true` makes tao keep a non-client strip
//! (sides 4px, top 1px at 96 DPI — see tao's `calculate_insets_for_dpi`) because
//! that strip is what carries the native shadow, and Windows paints it itself as
//! a classic raised frame whose inner highlight, `COLOR_3DHILIGHT`, is pure white
//! in every theme.
//!
//! DWM draws a second 1px line of its own, 2px inside the window edge, and that
//! one is ours: it is the border colour, and on Windows 11 the rounded corner
//! belongs to the same visual — suppressing the border with `DWMWA_COLOR_NONE`
//! squares the window off. So the border is painted the app background rather
//! than removed, and the strip tao keeps is painted over in the same colour.

/// The app's surface colour. DWM's border and the non-client strip are painted
/// this, so the window edge reads as one continuous black shape.
#[cfg(target_os = "windows")]
const APP_BACKGROUND: u32 = 0x0000_0000;

/// Paint the system frame the way the app is drawn: border and non-client strip
/// in the app background, dark, and rounded at `DWMWCP_ROUND` (8px, matching the
/// card radius). Every hint here is cosmetic, so one a build rejects is not worth
/// surfacing.
#[cfg(target_os = "windows")]
pub(crate) fn restyle_system_frame(window: &tauri::Window) {
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
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

    set(DWMWA_BORDER_COLOR, APP_BACKGROUND);
    set(DWMWA_USE_IMMERSIVE_DARK_MODE, 1);
    set(DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND as u32);

    frame_paint::take_over(hwnd.0);
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn restyle_system_frame(_window: &tauri::Window) {}

/// Windows repaints the frame highlight from its own non-client painting, so the
/// window is subclassed (the way tao does it, which keeps its message handling
/// intact) and every frame paint is followed by one in the app background.
#[cfg(target_os = "windows")]
mod frame_paint {
    use super::APP_BACKGROUND;
    use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
    use windows_sys::Win32::Graphics::Gdi::{
        ClientToScreen, CreateSolidBrush, DeleteObject, FillRect, GetWindowDC, ReleaseDC,
    };
    use windows_sys::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass, SUBCLASSPROC};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowRect, WM_NCACTIVATE, WM_NCPAINT,
    };

    /// Distinct from tao's own ids (0 and 1) so both subclass procs stay installed.
    const FRAME_SUBCLASS_ID: usize = 0x5753_4650;

    pub(super) fn take_over(hwnd: HWND) {
        let proc: SUBCLASSPROC = Some(frame_proc);
        unsafe {
            SetWindowSubclass(hwnd, proc, FRAME_SUBCLASS_ID, 0);
            // the strip may already have been painted before the subclass landed
            paint_strip(hwnd);
        }
    }

    unsafe extern "system" fn frame_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _subclass_id: usize,
        _reference_data: usize,
    ) -> LRESULT {
        let result = DefSubclassProc(hwnd, message, wparam, lparam);

        // the two messages that draw the frame's white highlight
        if message == WM_NCPAINT || message == WM_NCACTIVATE {
            paint_strip(hwnd);
        }

        result
    }

    const fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    /// Fill the frame around the client with the app background, leaving the
    /// client to the webview that covers it. A window with no frame insets — the
    /// transparent dock, say — has four empty strips, so this paints nothing.
    unsafe fn paint_strip(hwnd: HWND) {
        let (mut window, mut client, mut client_origin) =
            (rect(0, 0, 0, 0), rect(0, 0, 0, 0), POINT { x: 0, y: 0 });
        if GetWindowRect(hwnd, &mut window) == 0
            || GetClientRect(hwnd, &mut client) == 0
            || ClientToScreen(hwnd, &mut client_origin) == 0
        {
            return;
        }

        let left = client_origin.x - window.left;
        let top = client_origin.y - window.top;
        let right = left + client.right;
        let bottom = top + client.bottom;
        let (width, height) = (window.right - window.left, window.bottom - window.top);

        let dc = GetWindowDC(hwnd);
        let brush = CreateSolidBrush(APP_BACKGROUND);
        if !dc.is_null() && !brush.is_null() {
            for strip in [
                rect(0, 0, width, top),
                rect(0, bottom, width, height),
                rect(0, top, left, bottom),
                rect(right, top, width, bottom),
            ] {
                FillRect(dc, &strip, brush);
            }
        }
        if !brush.is_null() {
            DeleteObject(brush);
        }
        if !dc.is_null() {
            ReleaseDC(hwnd, dc);
        }
    }
}
