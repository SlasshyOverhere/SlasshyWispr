//! Shared filesystem + simple download helpers.
//!
//! Owns generic "get files on disk" utilities used by both the app layer and
//! pipeline runtimes:
//! - `file_exists_with_content` (non-empty regular file check)
//! - `find_file_by_name` (recursive filename search)
//! - `download_file` (single-stream GET with temp-file + rename)
//!
//! No feature-specific download policy lives here — the updater, HuggingFace
//! model downloads, and archive range downloads keep their own logic where it
//! belongs.

use std::fs;
use std::path::{Path, PathBuf};

use reqwest::Client;

use crate::pipeline::log::{clip_text, single_line};

pub(crate) fn file_exists_with_content(path: &Path) -> bool {
    fs::metadata(path)
        .map(|meta| meta.is_file() && meta.len() > 0)
        .unwrap_or(false)
}

pub(crate) fn find_file_by_name(root: &Path, target_name: &str) -> Result<Option<PathBuf>, String> {
    if !root.exists() {
        return Ok(None);
    }

    let mut stack = vec![root.to_path_buf()];

    while let Some(current_dir) = stack.pop() {
        let entries = fs::read_dir(&current_dir).map_err(|error| {
            format!(
                "Failed to read directory '{}': {error}",
                current_dir.display()
            )
        })?;

        for entry in entries {
            let entry =
                entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
            let path = entry.path();

            if path.is_dir() {
                stack.push(path);
                continue;
            }

            let matches = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.eq_ignore_ascii_case(target_name))
                .unwrap_or(false);

            if matches {
                return Ok(Some(path));
            }
        }
    }

    Ok(None)
}

pub(crate) async fn download_file(client: &Client, url: &str, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to prepare destination folder: {error}"))?;
    }

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Failed to download {url}: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .unwrap_or_else(|_| "unable to read body".to_string());

        return Err(format!(
            "Download failed ({status}) for {url}: {}",
            clip_text(&single_line(&body), 400)
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed reading downloaded bytes from {url}: {error}"))?;

    let temp_path = destination.with_extension("downloading");
    fs::write(&temp_path, &bytes)
        .map_err(|error| format!("Failed writing temporary file: {error}"))?;

    fs::rename(&temp_path, destination)
        .map_err(|error| format!("Failed finalizing downloaded file: {error}"))?;

    Ok(())
}