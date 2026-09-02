//! Generic process/runtime helpers shared by the pipeline daemons, TTS
//! runtimes, and the app layer.
//!
//! Owns:
//! - Subprocess plumbing (`apply_no_window`, `merge_process_output`)
//! - Binary path validation for spawned interpreters (`validate_python_binary_path`)
//! - Latency measurement (`elapsed_ms`)
//!
//! No Tauri, no AppState, no filesystem beyond what each helper needs.

use std::path::Path;
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

pub(crate) fn validate_python_binary_path(path: &str) -> Result<(), String> {
    let path_str = path.trim();
    if path_str.is_empty() {
        return Err("Python binary path is empty.".to_string());
    }

    if path_str.contains(|c: char| matches!(c, '\0' | '\n' | '\r')) {
        return Err("Python binary path contains invalid characters.".to_string());
    }

    let path_buf = Path::new(path_str);
    let file_name = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "Invalid python binary path.".to_string())?;
    let file_name_lower = file_name.to_ascii_lowercase();

    let normalized = file_name_lower
        .strip_suffix(".exe")
        .unwrap_or(file_name_lower.as_str());
    let is_python3_with_version = normalized
        .strip_prefix("python3.")
        .map(|suffix| {
            !suffix.is_empty()
                && suffix
                    .chars()
                    .all(|character| character.is_ascii_digit() || character == '.')
        })
        .unwrap_or(false);

    if !matches!(normalized, "python" | "python3" | "pythonw" | "py") && !is_python3_with_version {
        return Err(format!(
            "Invalid python binary name '{}'. Expected a python executable name.",
            file_name
        ));
    }

    Ok(())
}

pub(crate) fn elapsed_ms(start: Instant) -> u64 {
    let elapsed = start.elapsed().as_millis();
    if elapsed > u128::from(u64::MAX) {
        u64::MAX
    } else {
        elapsed as u64
    }
}