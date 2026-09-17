//! OS platform integration boundary (Phase 6 platform).
//!
//! Pure foreground-blocking input policy lives in `input::policy`.
//! Windows-native Win32 primitives stay in `commands::input` for now.

pub mod input;
