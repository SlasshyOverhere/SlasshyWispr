//! Generic process/runtime helpers shared by the pipeline daemons, TTS
//! runtimes, and the app layer.
//!
//! Owns:
//! - Subprocess plumbing (`apply_no_window`, `merge_process_output`)
//! - Latency measurement (`elapsed_ms`)
//!
//! No Tauri, no AppState, no filesystem beyond what each helper needs.

use std::process::Command;
use std::time::Instant;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::constants::CREATE_NO_WINDOW;

#[cfg(target_os = "windows")]
pub(crate) fn apply_no_window(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn apply_no_window(_command: &mut Command) {}

pub(crate) fn merge_process_output(stdout: &[u8], stderr: &[u8]) -> String {
    let stdout_text = String::from_utf8_lossy(stdout);
    let stderr_text = String::from_utf8_lossy(stderr);
    let merged = if stderr_text.trim().is_empty() {
        stdout_text.as_ref()
    } else if stdout_text.trim().is_empty() {
        stderr_text.as_ref()
    } else {
        return format!("{} {}", stdout_text.trim(), stderr_text.trim());
    };
    merged.trim().to_string()
}

pub(crate) fn elapsed_ms(start: Instant) -> u64 {
    let elapsed = start.elapsed().as_millis();
    if elapsed > u128::from(u64::MAX) {
        u64::MAX
    } else {
        elapsed as u64
    }
}
