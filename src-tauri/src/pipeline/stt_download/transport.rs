//! STT archive download transport.
//!
//! Parallel range downloads (with concatenation) and the single-stream
//! fallback. Reports progress through the shared download status sink.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use log::warn;
use reqwest::{header::{ACCEPT_RANGES, RANGE}, Client, StatusCode};

use crate::constants::*;
use crate::pipeline::log::{clip_text, single_line};
use super::archive::{
    find_local_parakeet_model_root, local_parakeet_archive_source, LocalParakeetArchiveSource,
};
use super::progress::SharedStatus;

/// Number of parallel archive chunks, capped by size policy and env override.
pub(crate) fn local_stt_archive_parallel_chunk_count(total_bytes: u64) -> usize {
    if total_bytes == 0 {
        return 1;
    }

    let configured = std::env::var(LOCAL_STT_ARCHIVE_PARALLEL_CHUNKS_ENV)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(LOCAL_STT_ARCHIVE_PARALLEL_CHUNKS_DEFAULT)
        .clamp(1, LOCAL_STT_ARCHIVE_PARALLEL_CHUNKS_MAX);

    if total_bytes < LOCAL_STT_ARCHIVE_MIN_BYTES_PER_CHUNK.saturating_mul(2) {
        return 1;
    }

    let max_chunks_by_size = ((total_bytes + LOCAL_STT_ARCHIVE_MIN_BYTES_PER_CHUNK - 1)
        / LOCAL_STT_ARCHIVE_MIN_BYTES_PER_CHUNK)
        .max(1) as usize;
    configured.min(max_chunks_by_size).max(1)
}

/// Download one byte range into `part_path`, accumulating into `progress`.
pub(crate) async fn download_archive_range_chunk(
    client: Client,
    url: String,
    start: u64,
    end: u64,
    part_path: PathBuf,
    progress: Arc<AtomicU64>,
) -> Result<u64, String> {
    let range_header = format!("bytes={start}-{end}");
    let mut response = client
        .get(&url)
        .header(RANGE, range_header)
        .timeout(Duration::from_secs(60 * 60))
        .send()
        .await
        .map_err(|error| format!("Parallel range request failed: {error}"))?;
    if response.status() != StatusCode::PARTIAL_CONTENT {
        return Err(format!(
            "Server refused range request for '{}' (status {}).",
            clip_text(&url, 220),
            response.status()
        ));
    }

    let mut file = fs::File::create(&part_path).map_err(|error| {
        format!(
            "Failed to create archive part '{}': {error}",
            part_path.display()
        )
    })?;

    let mut downloaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Failed reading range stream: {error}"))?
    {
        file.write_all(&chunk).map_err(|error| {
            format!(
                "Failed writing archive part '{}': {error}",
                part_path.display()
            )
        })?;
        let chunk_size = u64::try_from(chunk.len()).unwrap_or(0);
        downloaded = downloaded.saturating_add(chunk_size);
        progress.fetch_add(chunk_size, Ordering::Relaxed);
    }

    if downloaded == 0 {
        return Err(format!(
            "Downloaded archive part '{}' was empty.",
            part_path.display()
        ));
    }

    Ok(downloaded)
}

/// Concatenate downloaded archive parts into a single archive file.
pub(crate) fn concatenate_archive_parts(parts: &[PathBuf], destination: &Path) -> Result<(), String> {
    let mut output = fs::File::create(destination).map_err(|error| {
        format!(
            "Failed to create archive destination '{}': {error}",
            destination.display()
        )
    })?;

    for part in parts {
        let mut input = fs::File::open(part).map_err(|error| {
            format!("Failed to open archive part '{}': {error}", part.display())
        })?;
        std::io::copy(&mut input, &mut output).map_err(|error| {
            format!(
                "Failed merging archive part '{}' into '{}': {error}",
                part.display(),
                destination.display()
            )
        })?;
    }

    Ok(())
}

/// Download an archive via parallel HTTP ranges and concatenate the parts.
pub(crate) async fn download_archive_parallel_ranges(
    client: &Client,
    url: &str,
    temp_archive_path: &Path,
    total_bytes: u64,
    chunk_count: usize,
    status: &SharedStatus<'_>,
) -> Result<u64, String> {
    if total_bytes == 0 || chunk_count <= 1 {
        return Err(
            "Parallel range download requires known content length and >1 chunks.".to_string(),
        );
    }

    let chunk_size = ((total_bytes + chunk_count as u64 - 1) / chunk_count as u64).max(1);
    let mut part_paths: Vec<PathBuf> = Vec::new();
    let mut tasks = Vec::new();
    let progress = Arc::new(AtomicU64::new(0));

    for index in 0..chunk_count {
        let start = (index as u64).saturating_mul(chunk_size);
        if start >= total_bytes {
            break;
        }
        let end = start
            .saturating_add(chunk_size)
            .saturating_sub(1)
            .min(total_bytes.saturating_sub(1));
        let part_path = PathBuf::from(format!(
            "{}.part{}",
            temp_archive_path.to_string_lossy(),
            index
        ));
        if part_path.exists() {
            let _ = fs::remove_file(&part_path);
        }

        let task = tauri::async_runtime::spawn(download_archive_range_chunk(
            client.clone(),
            url.to_string(),
            start,
            end,
            part_path.clone(),
            progress.clone(),
        ));
        part_paths.push(part_path);
        tasks.push(task);
    }

    let mut first_error: Option<String> = None;
    for task in tasks {
        match task.await {
            Ok(Ok(_)) => {
                let downloaded_bytes = progress.load(Ordering::Relaxed);
                let _ = status.update(|status| {
                    status.downloaded_bytes = downloaded_bytes;
                });
            }
            Ok(Err(error)) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(format!("Parallel archive worker failed: {error}"));
                }
            }
        }
    }

    if let Some(error) = first_error {
        for path in &part_paths {
            let _ = fs::remove_file(path);
        }
        return Err(error);
    }

    concatenate_archive_parts(&part_paths, temp_archive_path)?;
    for path in &part_paths {
        let _ = fs::remove_file(path);
    }
    Ok(progress.load(Ordering::Relaxed))
}

/// Download an archive as a single stream (fallback and small-archive path).
pub(crate) async fn download_archive_single_stream(
    client: &Client,
    url: &str,
    temp_archive_path: &Path,
    status: &SharedStatus<'_>,
    total_bytes_hint: u64,
) -> Result<u64, String> {
    let mut response = client
        .get(url)
        .timeout(Duration::from_secs(60 * 60))
        .send()
        .await
        .map_err(|error| {
            format!(
                "Failed to download archive '{}': {error}",
                clip_text(url, 220)
            )
        })?;
    let status_code = response.status();
    if !status_code.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Archive download failed ({status_code}): {}",
            clip_text(&single_line(&body), 320)
        ));
    }

    let total_bytes = response.content_length().unwrap_or(total_bytes_hint);
    if total_bytes > 0 {
        status.update(|status| {
            status.total_bytes = total_bytes;
        })?;
    }

    let mut output_file = fs::File::create(temp_archive_path).map_err(|error| {
        format!(
            "Failed to create temporary archive '{}': {error}",
            temp_archive_path.display()
        )
    })?;
    let mut downloaded_bytes = 0u64;
    let mut last_status_update = Instant::now();

    while let Some(chunk) = response.chunk().await.map_err(|error| {
        format!(
            "Failed reading archive stream '{}': {error}",
            clip_text(url, 220)
        )
    })? {
        output_file.write_all(&chunk).map_err(|error| {
            format!(
                "Failed writing archive chunk '{}': {error}",
                temp_archive_path.display()
            )
        })?;
        downloaded_bytes = downloaded_bytes.saturating_add(u64::try_from(chunk.len()).unwrap_or(0));

        if last_status_update.elapsed() >= Duration::from_millis(120) {
            status.update(|status| {
                status.downloaded_bytes = downloaded_bytes;
            })?;
            last_status_update = Instant::now();
        }
    }
    drop(output_file);
    Ok(downloaded_bytes)
}

/// Download and extract a prepacked Parakeet int8 archive.
pub(crate) async fn download_prepacked_parakeet_model(
    client: &Client,
    repo_id: &str,
    target_dir: &Path,
    status: &SharedStatus<'_>,
) -> Result<String, String> {
    let source: LocalParakeetArchiveSource =
        local_parakeet_archive_source(repo_id).ok_or_else(|| {
        format!("No prepacked Parakeet archive source configured for '{repo_id}'.")
    })?;

    if let Ok(existing_root) = find_local_parakeet_model_root(target_dir) {
        return Ok(format!(
            "Model '{repo_id}' is already cached at '{}'.",
            existing_root.display()
        ));
    }

    fs::create_dir_all(target_dir)
        .map_err(|error| format!("Failed to create STT model target directory: {error}"))?;

    let archive_path = target_dir.join(format!("{}.tar.gz", source.expected_root_dir));
    let temp_archive_path = target_dir.join(format!("{}.tar.gz.partial", source.expected_root_dir));
    if temp_archive_path.exists() {
        let _ = fs::remove_file(&temp_archive_path);
    }

    status.update(|status| {
        status.stage = "Downloading model archive...".to_string();
        status.message = format!("Downloading '{}'.", repo_id);
        status.files_total = 1;
        status.files_completed = 0;
        status.downloaded_bytes = 0;
        status.total_bytes = 0;
        status.current_file = archive_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("model.tar.gz")
            .to_string();
    })?;

    let head_probe = client
        .head(source.archive_url)
        .timeout(Duration::from_secs(35))
        .send()
        .await
        .ok();
    let total_bytes = head_probe
        .as_ref()
        .and_then(|response| response.content_length())
        .unwrap_or(0);
    let range_supported = head_probe
        .as_ref()
        .and_then(|response| response.headers().get(ACCEPT_RANGES))
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_ascii_lowercase().contains("bytes"))
        .unwrap_or(false);
    let parallel_chunks = if range_supported {
        local_stt_archive_parallel_chunk_count(total_bytes)
    } else {
        1
    };

    status.update(|status| {
        status.total_bytes = total_bytes;
        if parallel_chunks > 1 {
            status.message = format!(
                "Downloading '{}' using {} parallel streams.",
                repo_id, parallel_chunks
            );
        }
    })?;

    let downloaded_bytes = if parallel_chunks > 1 && total_bytes > 0 {
        match download_archive_parallel_ranges(
            client,
            source.archive_url,
            &temp_archive_path,
            total_bytes,
            parallel_chunks,
            status,
        )
        .await
        {
            Ok(bytes) => bytes,
            Err(error) => {
                warn!(
                    "[local.stt.download] parallel archive download failed repo={} reason={} fallback=single-stream",
                    clip_text(repo_id, 160),
                    clip_text(&single_line(&error), 260)
                );
                status.update(|status| {
                    status.message = format!(
                        "Parallel download fallback triggered. Retrying '{}' with single stream.",
                        repo_id
                    );
                    status.downloaded_bytes = 0;
                })?;
                download_archive_single_stream(
                    client,
                    source.archive_url,
                    &temp_archive_path,
                    status,
                    total_bytes,
                )
                .await?
            }
        }
    } else {
        download_archive_single_stream(
            client,
            source.archive_url,
            &temp_archive_path,
            status,
            total_bytes,
        )
        .await?
    };

    if downloaded_bytes == 0 {
        let _ = fs::remove_file(&temp_archive_path);
        return Err(format!("Downloaded archive for '{repo_id}' was empty."));
    }

    if archive_path.exists() {
        fs::remove_file(&archive_path).map_err(|error| {
            format!(
                "Failed to replace local archive '{}': {error}",
                archive_path.display()
            )
        })?;
    }
    fs::rename(&temp_archive_path, &archive_path).map_err(|error| {
        format!(
            "Failed to finalize archive '{}': {error}",
            archive_path.display()
        )
    })?;

    let expected_root = target_dir.join(source.expected_root_dir);
    if expected_root.exists() {
        fs::remove_dir_all(&expected_root).map_err(|error| {
            format!(
                "Failed to clear previous extracted model directory '{}': {error}",
                expected_root.display()
            )
        })?;
    }

    status.update(|status| {
        status.stage = "Extracting model archive...".to_string();
        status.message = format!("Extracting '{}'.", repo_id);
        status.downloaded_bytes = downloaded_bytes;
        if status.total_bytes == 0 {
            status.total_bytes = downloaded_bytes;
        }
        status.current_file = archive_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("model.tar.gz")
            .to_string();
    })?;

    crate::pipeline::fs::extract_tar_gz_archive(&archive_path, target_dir)?;
    let _ = fs::remove_file(&archive_path);

    let model_root = find_local_parakeet_model_root(target_dir)?;
    let size_mb = downloaded_bytes as f64 / (1024.0 * 1024.0);
    Ok(format!(
        "Downloaded and extracted Parakeet archive ({size_mb:.1} MiB) for '{repo_id}' into '{}'. Model root: '{}'.",
        target_dir.display(),
        model_root.display()
    ))
}