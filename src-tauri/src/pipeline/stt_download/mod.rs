//! STT model download infrastructure.
//!
//! Owns the entire "get a local STT model onto disk" pipeline: repository
//! resolution and file-selection policy (`resolve`), archive transport
//! (`transport`), prepacked archive handling (`archive`), and the snapshot
//! orchestrator that coordinates metadata, parallel file downloads and
//! progress reporting (`self`).
//!
//! The subsystem reports progress through the `DownloadSink` boundary
//! (`progress`), so it never touches `AppState` or Tauri application state.

pub mod adapt;
pub mod archive;
pub mod progress;
pub mod resolve;
pub mod transport;

pub(crate) use adapt::AppStateSink;

pub(crate) use archive::find_local_parakeet_model_root;
pub(crate) use progress::{
    calculate_local_stt_progress_percent, now_unix_ms, LocalSttDownloadStatusResponse,
    SharedStatus,
};
pub(crate) use resolve::{
    legacy_huggingface_repo_id_for_model, resolve_huggingface_repo_id,
    sanitize_model_cache_dir_name,
};

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use log::info;
use reqwest::{Client, Url};
use serde_json::Value;

use crate::pipeline::fs::file_exists_with_content;
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::stt_download::archive::local_parakeet_archive_source;
use crate::pipeline::stt_download::transport::download_prepacked_parakeet_model;
use crate::pipeline::stt_download::resolve::{
    normalize_huggingface_relative_path, select_huggingface_stt_download_entries,
    should_download_huggingface_stt_file,
};

/// Download a HuggingFace snapshot (or prepacked archive) into `target_dir`.
///
/// Reports progress through `status`; returns a human-readable download detail
/// string, the number of files downloaded, and the final total byte count.
pub(crate) async fn download_huggingface_stt_model(
    client: &Client,
    repo_id: &str,
    target_dir: &Path,
    huggingface_token: Option<&str>,
    status: &SharedStatus<'_>,
) -> Result<DownloadSummary, String> {
    if local_parakeet_archive_source(repo_id).is_some() {
        let details =
            download_prepacked_parakeet_model(client, repo_id, target_dir, status).await?;
        return Ok(DownloadSummary {
            details,
            files_downloaded: 1,
            total_bytes: status.snapshot().total_bytes,
        });
    }

    let token = huggingface_token
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let metadata_url = format!("https://huggingface.co/api/models/{repo_id}");
    let metadata_response = apply_optional_bearer_auth(client.get(&metadata_url), token)
        .send()
        .await
        .map_err(|error| format!("Failed to query HuggingFace model '{repo_id}': {error}"))?;
    let metadata_status = metadata_response.status();
    let metadata_body = metadata_response
        .text()
        .await
        .map_err(|error| format!("Failed to parse HuggingFace metadata body: {error}"))?;
    if !metadata_status.is_success() {
        return Err(format!(
            "HuggingFace model metadata request failed ({metadata_status}): {}",
            clip_text(&single_line(&metadata_body), 360)
        ));
    }

    let metadata: Value = serde_json::from_str(&metadata_body)
        .map_err(|error| format!("Invalid HuggingFace metadata JSON: {error}"))?;
    let siblings = metadata
        .get("siblings")
        .and_then(Value::as_array)
        .ok_or_else(|| "HuggingFace metadata does not include a file listing.".to_string())?;

    let candidate_entries = siblings
        .iter()
        .filter_map(|entry| {
            let relative_raw = entry
                .get("rfilename")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?;
            if !should_download_huggingface_stt_file(relative_raw) {
                return None;
            }
            let relative_path = normalize_huggingface_relative_path(relative_raw).ok()?;
            let size_hint = entry.get("size").and_then(Value::as_u64);
            Some((relative_path, size_hint))
        })
        .collect::<Vec<_>>();
    if candidate_entries.is_empty() {
        return Err(format!(
            "No downloadable model artifacts found for HuggingFace model '{repo_id}'."
        ));
    }
    let file_entries = select_huggingface_stt_download_entries(repo_id, &candidate_entries);
    if file_entries.is_empty() {
        return Err(format!(
            "Unable to select required downloadable artifacts for '{repo_id}'."
        ));
    }
    let selected_estimated_bytes = file_entries
        .iter()
        .map(|(_, size)| size.unwrap_or(0))
        .fold(0_u64, |acc, value| acc.saturating_add(value));
    info!(
        "[local.stt.download] repo={} selected_files={} selected_estimated_mib={:.1}",
        clip_text(repo_id, 160),
        file_entries.len(),
        selected_estimated_bytes as f64 / (1024.0 * 1024.0)
    );

    fs::create_dir_all(target_dir)
        .map_err(|error| format!("Failed to create STT model target directory: {error}"))?;

    let mut to_download: Vec<(PathBuf, PathBuf, Option<u64>)> = Vec::new();
    let mut skipped_files = 0usize;
    let mut total_bytes = 0u64;
    for (relative_path, size_hint) in file_entries {
        let output_path = target_dir.join(&relative_path);
        if file_exists_with_content(&output_path) {
            skipped_files += 1;
            continue;
        }
        if let Some(size) = size_hint {
            total_bytes = total_bytes.saturating_add(size);
        }
        to_download.push((relative_path, output_path, size_hint));
    }

    status.update(|status| {
        status.stage = "Downloading model files...".to_string();
        status.message = format!(
            "Downloading '{}' ({} files pending).",
            repo_id,
            to_download.len()
        );
        status.files_total = to_download.len();
        status.files_completed = 0;
        status.downloaded_bytes = 0;
        status.total_bytes = total_bytes;
        status.current_file.clear();
    })?;

    if to_download.is_empty() {
        return Ok(DownloadSummary {
            details: format!(
                "Model '{repo_id}' is already cached at '{}'.",
                target_dir.display()
            ),
            files_downloaded: 0,
            total_bytes,
        });
    }

    let download_progress = Arc::new(AtomicU64::new(0));
    let completed_files = Arc::new(AtomicU64::new(0));
    let parallel_limit = usize::min(4, usize::max(1, to_download.len()));
    let mut next_index = 0usize;
    let mut active_tasks = Vec::new();

    let spawn_file_download = |relative_path: PathBuf,
                               output_path: PathBuf,
                               size_hint: Option<u64>| {
        let client = client.clone();
        let token = token.map(str::to_string);
        let repo_id = repo_id.to_string();
        let progress = Arc::clone(&download_progress);
        let completed = Arc::clone(&completed_files);
        tauri::async_runtime::spawn(async move {
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!(
                        "Failed to create model directory '{}': {error}",
                        parent.display()
                    )
                })?;
            }

            let mut download_url = Url::parse(&format!(
                "https://huggingface.co/{repo_id}/resolve/main/"
            ))
            .map_err(|error| format!("Invalid HuggingFace download URL for '{repo_id}': {error}"))?;
            {
                let mut segments = download_url
                    .path_segments_mut()
                    .map_err(|_| "Failed to build HuggingFace download path.".to_string())?;
                segments.pop_if_empty();
                for component in relative_path.components() {
                    if let std::path::Component::Normal(segment) = component {
                        let value = segment.to_string_lossy();
                        segments.push(value.as_ref());
                    }
                }
            }
            download_url
                .query_pairs_mut()
                .append_pair("download", "true");

            let token_ref = token.as_deref();
            let mut response =
                apply_optional_bearer_auth(client.get(download_url.clone()), token_ref)
                    .timeout(Duration::from_secs(60 * 60))
                    .send()
                    .await
                    .map_err(|error| {
                        format!(
                            "Failed to download HuggingFace file '{}': {error}",
                            relative_path.display()
                        )
                    })?;
            let status_code = response.status();
            if !status_code.is_success() {
                let body = response.text().await.unwrap_or_default();
                return Err(format!(
                    "HuggingFace file download failed '{}' ({status_code}): {}",
                    relative_path.display(),
                    clip_text(&single_line(&body), 320)
                ));
            }

            let discovered_content_length = if size_hint.is_none() {
                response.content_length()
            } else {
                None
            };

            let temp_path = output_path.with_extension("partial");
            if temp_path.exists() {
                let _ = fs::remove_file(&temp_path);
            }

            let mut output_file = fs::File::create(&temp_path).map_err(|error| {
                format!(
                    "Failed to create temporary model file '{}': {error}",
                    temp_path.display()
                )
            })?;
            let mut bytes_for_file = 0u64;

            while let Some(chunk) = response.chunk().await.map_err(|error| {
                format!(
                    "Failed reading HuggingFace download stream '{}': {error}",
                    relative_path.display()
                )
            })? {
                output_file.write_all(&chunk).map_err(|error| {
                    format!(
                        "Failed writing HuggingFace file chunk '{}': {error}",
                        temp_path.display()
                    )
                })?;
                let chunk_size = u64::try_from(chunk.len()).unwrap_or(u64::MAX);
                bytes_for_file = bytes_for_file.saturating_add(chunk_size);
                progress.fetch_add(chunk_size, Ordering::Relaxed);
            }
            drop(output_file);

            if bytes_for_file == 0 {
                let _ = fs::remove_file(&temp_path);
                return Err(format!(
                    "Downloaded file '{}' was empty.",
                    relative_path.display()
                ));
            }

            if output_path.exists() {
                fs::remove_file(&output_path).map_err(|error| {
                    format!(
                        "Failed to replace existing model file '{}': {error}",
                        output_path.display()
                    )
                })?;
            }
            fs::rename(&temp_path, &output_path).map_err(|error| {
                format!(
                    "Failed to finalize model file '{}': {error}",
                    output_path.display()
                )
            })?;

            completed.fetch_add(1, Ordering::Relaxed);
            Ok::<(String, u64, Option<u64>), String>((
                relative_path.display().to_string(),
                bytes_for_file,
                discovered_content_length,
            ))
        })
    };

    while next_index < to_download.len() && active_tasks.len() < parallel_limit {
        let (relative_path, output_path, size_hint) = to_download[next_index].clone();
        active_tasks.push(spawn_file_download(relative_path, output_path, size_hint));
        next_index += 1;
    }

    let mut downloaded_files = 0usize;
    let mut downloaded_bytes = 0u64;
    let mut last_status_update = Instant::now();

    while !active_tasks.is_empty() {
        let task = active_tasks.remove(0);
        let result = task
            .await
            .map_err(|error| format!("Parallel file download worker failed: {error}"))?;
        match result {
            Ok((current_file, bytes_for_file, discovered_content_length)) => {
                downloaded_files += 1;
                downloaded_bytes = download_progress.load(Ordering::Relaxed);
                if let Some(content_length) = discovered_content_length {
                    total_bytes = total_bytes.saturating_add(content_length);
                }
                status
                    .update(|status| {
                        status.current_file = current_file;
                        status.stage = if parallel_limit > 1 {
                            "Downloading model files in parallel...".to_string()
                        } else {
                            "Downloading file...".to_string()
                        };
                        status.total_bytes = total_bytes;
                        status.downloaded_bytes = downloaded_bytes;
                        status.files_completed = downloaded_files;
                        status.message = format!(
                            "Downloaded {}/{} files.",
                            status.files_completed, status.files_total
                        );
                    })
                    .map_err(|error| format!("Failed to update download status: {error}"))?;
                let _ = bytes_for_file;
            }
            Err(error) => {
                return Err(error);
            }
        }

        while next_index < to_download.len() && active_tasks.len() < parallel_limit {
            let (relative_path, output_path, size_hint) = to_download[next_index].clone();
            active_tasks.push(spawn_file_download(relative_path, output_path, size_hint));
            next_index += 1;
        }

        if last_status_update.elapsed() >= Duration::from_millis(120) {
            let progress_bytes = download_progress.load(Ordering::Relaxed);
            let completed_count = completed_files.load(Ordering::Relaxed) as usize;
            status
                .update(|status| {
                    status.stage = if parallel_limit > 1 {
                        format!("Downloading model files with {parallel_limit} parallel workers...")
                    } else {
                        "Downloading model files...".to_string()
                    };
                    status.downloaded_bytes = progress_bytes;
                    status.files_completed = completed_count;
                })
                .map_err(|error| format!("Failed to update download status: {error}"))?;
            last_status_update = Instant::now();
        }
    }

    if downloaded_files == 0 && skipped_files == 0 {
        return Err(format!(
            "No files were downloaded for HuggingFace model '{repo_id}'."
        ));
    }

    if downloaded_files == 0 {
        return Ok(DownloadSummary {
            details: format!(
                "Model '{repo_id}' is already cached at '{}'.",
                target_dir.display()
            ),
            files_downloaded: 0,
            total_bytes,
        });
    }

    let size_mb = downloaded_bytes as f64 / (1024.0 * 1024.0);
    let skipped_suffix = if skipped_files > 0 {
        format!(" Skipped {skipped_files} already-present files.")
    } else {
        String::new()
    };
    Ok(DownloadSummary {
        details: format!(
            "Downloaded {downloaded_files} files ({size_mb:.1} MiB) from '{repo_id}' into '{}'.{}",
            target_dir.display(),
            skipped_suffix
        ),
        files_downloaded: downloaded_files,
        total_bytes,
    })
}

/// Summary of a completed model download.
pub(crate) struct DownloadSummary {
    pub(crate) details: String,
    pub(crate) files_downloaded: usize,
    pub(crate) total_bytes: u64,
}

/// Apply a Bearer token to a request builder when provided.
fn apply_optional_bearer_auth(
    request: reqwest::RequestBuilder,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    match token {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}