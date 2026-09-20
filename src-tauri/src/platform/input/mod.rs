//! Platform input policy boundary (platform split).
//!
//! Pure foreground-blocking policy lives in `policy`. Windows-native
//! primitives live in `super::windows_native`, shared types in
//! `super::windows_types`.

pub mod elevation;
pub mod policy;

pub(crate) use policy::foreground_input_block_reason;
