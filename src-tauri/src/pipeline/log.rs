//! Log-safety string helpers shared across the pipeline and the app layer.
//!
//! Generic formatting/truncation utilities for log output. Pure — no Tauri,
//! no AppState, no I/O.

/// Collapse whitespace into a single space for log lines.
pub(crate) fn single_line(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut first = true;
    for token in input.split_whitespace() {
        if !first {
            out.push(' ');
        }
        out.push_str(token);
        first = false;
    }
    out
}

/// Truncate a string to `max_chars` and append `...` if over limit.
pub(crate) fn clip_text(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }

    let clipped: String = input.chars().take(max_chars).collect();
    format!("{clipped}...")
}