//! OS platform integration boundary (platform split).
//!
//! Pure foreground-blocking input policy lives in `input::policy`.
//! Windows-native Win32 input/clipboard/foreground primitives live in
//! `windows_native`; shared input types in `windows_types`.

pub mod input;
pub mod windows_native;
pub mod windows_types;
