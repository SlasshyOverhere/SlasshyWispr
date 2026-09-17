//! Platform input policy boundary (Phase 6 platform).
//!
//! Pure foreground-blocking policy lives in `policy`. Windows-native
//! primitives stay in `commands::input` (Win32 + arboard) until a later
//! phase isolates them behind this boundary.

pub mod policy;

pub(crate) use policy::{
    foreground_input_block_reason, is_allowed_fullscreen_process_name,
    is_blocked_game_process_name, is_blocked_terminal_process_name,
    is_ide_terminal_window, is_likely_fullscreen_game_window,
};
