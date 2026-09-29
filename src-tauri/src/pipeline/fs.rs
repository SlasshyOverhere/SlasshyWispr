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
use std::fs::File;
use std::path::{Path, PathBuf};

use bzip2::read::BzDecoder;
use flate2::read::GzDecoder;
use reqwest::Client;
use std::io::Read;
use tar::Archive;

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

/// Ceiling for a single artifact fetched by [`download_file`]. Generous enough
/// for the largest one shipped (the ZipVoice archive), but a hostile or hijacked
/// response cannot exhaust memory: this streams to disk rather than buffering.
const MAX_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;

pub(crate) async fn download_file(
    client: &Client,
    url: &str,
    destination: &Path,
) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to prepare destination folder: {error}"))?;
    }

    let mut response = client
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

    if let Some(length) = response.content_length() {
        if length > MAX_DOWNLOAD_BYTES {
            return Err(format!(
                "Refusing {url}: advertised size {length} exceeds the {MAX_DOWNLOAD_BYTES}-byte limit."
            ));
        }
    }

    let temp_path = destination.with_extension("downloading");
    let mut file = File::create(&temp_path)
        .map_err(|error| format!("Failed writing temporary file: {error}"))?;
    let mut written: u64 = 0;

    // Streamed rather than buffered, so a multi-hundred-MB artifact never sits
    // in memory, and a lying Content-Length cannot get past the check above.
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Failed reading downloaded bytes from {url}: {error}"))?
    {
        written = written.saturating_add(u64::try_from(chunk.len()).unwrap_or(0));
        if written > MAX_DOWNLOAD_BYTES {
            drop(file);
            let _ = fs::remove_file(&temp_path);
            return Err(format!(
                "Refusing {url}: body exceeded the {MAX_DOWNLOAD_BYTES}-byte limit."
            ));
        }
        std::io::Write::write_all(&mut file, &chunk)
            .map_err(|error| format!("Failed writing temporary file: {error}"))?;
    }
    drop(file);

    fs::rename(&temp_path, destination)
        .map_err(|error| format!("Failed finalizing downloaded file: {error}"))?;

    Ok(())
}

/// Extract a tar.gz archive into `destination`, rejecting unsafe entries.
pub(crate) fn extract_tar_gz_archive(
    archive_path: &Path,
    destination: &Path,
) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path).map_err(|error| {
        format!(
            "Failed to open archive '{}': {error}",
            archive_path.display()
        )
    })?;
    unpack_tar(GzDecoder::new(archive_file), archive_path, destination)
}

/// Extract a tar.bz2 archive into `destination`, rejecting unsafe entries.
pub(crate) fn extract_tar_bz2_archive(
    archive_path: &Path,
    destination: &Path,
) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path).map_err(|error| {
        format!(
            "Failed to open archive '{}': {error}",
            archive_path.display()
        )
    })?;
    unpack_tar(BzDecoder::new(archive_file), archive_path, destination)
}

/// One extraction path for both decoders, so the unsafe-entry guard cannot drift.
fn unpack_tar<R: Read>(reader: R, archive_path: &Path, destination: &Path) -> Result<(), String> {
    let mut archive = Archive::new(reader);
    let entries = archive
        .entries()
        .map_err(|error| format!("Invalid archive '{}': {error}", archive_path.display()))?;

    for (index, entry_result) in entries.enumerate() {
        let mut entry = entry_result.map_err(|error| {
            format!(
                "Failed reading tar entry {} from '{}': {error}",
                index,
                archive_path.display()
            )
        })?;
        let unpacked = entry.unpack_in(destination).map_err(|error| {
            format!(
                "Failed extracting tar entry {} into '{}': {error}",
                index,
                destination.display()
            )
        })?;
        if !unpacked {
            return Err(format!(
                "Unsafe tar entry {} blocked while extracting '{}'.",
                index,
                archive_path.display()
            ));
        }
    }

    Ok(())
}
