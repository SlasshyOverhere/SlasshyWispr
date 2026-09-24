//! Main-window state + tray update handle (window boundary).
//!
//! Moved verbatim from lib.rs: `WindowRect` / `WindowVisibilityState`
//! (owned by AppState) and the tray update-menu static. Single consumers
//! are commands::windows, commands::updater, and state::app_state.

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use tauri::menu::MenuItem;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRect {
    pub position_x: i32,
    pub position_y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowVisibilityState {
    pub hidden: bool,
    pub last_rect: Option<WindowRect>,
    /// Tracks the minimize/restore transition. Set to true when the window
    /// enters the minimized state; cleared on the first Resized event after
    /// the user restores. Used to apply the saved rect on restore.
    pub was_minimized: bool,
}

// F-026: main-window floor. tauri.conf.json keeps resizable:false today;
// the PROPOSED config (coordinator approves) flips resizable/maximizable on
// with minWidth/minHeight = these values. This clamp is the runtime backstop
// so restores never shrink below the floor regardless of config.
pub const MAIN_WINDOW_MIN_WIDTH: u32 = 1024;
pub const MAIN_WINDOW_MIN_HEIGHT: u32 = 640;

pub fn clamp_to_main_window_min(width: u32, height: u32) -> (u32, u32) {
    (
        width.max(MAIN_WINDOW_MIN_WIDTH),
        height.max(MAIN_WINDOW_MIN_HEIGHT),
    )
}

impl WindowVisibilityState {
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json(value: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(value)
    }
}

pub(crate) static TRAY_UPDATE_ITEM: OnceLock<MenuItem<tauri::Wry>> = OnceLock::new();
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_keeps_large_rects_untouched() {
        assert_eq!(clamp_to_main_window_min(1280, 832), (1280, 832));
    }

    #[test]
    fn clamp_lifts_small_rects_to_floor() {
        assert_eq!(clamp_to_main_window_min(800, 600), (1024, 640));
        assert_eq!(clamp_to_main_window_min(1024, 640), (1024, 640));
    }
}
