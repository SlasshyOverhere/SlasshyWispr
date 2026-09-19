//! Updater + misc commands — Phase 6g thin-adapter extraction.
//!
//! Moved verbatim from lib.rs: log_client_event, check/download-install
//! update, show_update_settings, set_tray_update_available, plus their
//! request/response structs. Service thinning happens in Phase 7.

use std::fs;
use std::io::{Read, Write};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use log::{info, warn};
use reqwest::header::{RANGE, USER_AGENT};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::constants::{
    APP_EVENT_UPDATE_AVAILABLE, UPDATE_GITHUB_TOKEN_ENV, UPDATE_HTTP_USER_AGENT,
    UPDATE_REPOSITORY_NAME_ENV, UPDATE_REPOSITORY_OWNER_ENV,
};
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::process::apply_no_window;
use crate::state::AppState;

use super::windows::{emit_update_install_progress, show_main_window};
use crate::commands::input::configure_launch_at_login;
use crate::constants::TRAY_ID;
use crate::platform::windows_native::schedule_app_relaunch_after_installer;
use crate::services::providers::update_github_token;
use crate::services::startup::read_launch_at_login_preference;
use crate::state::TRAY_UPDATE_ITEM;
use crate::updater::{
    exe_installer_supports_silent_mode, extract_version_from_download_url, is_newer_version,
    is_safe_update_url, normalize_release_version, resolve_installer_file_name,
    resolve_update_repository, select_latest_stable_release, select_windows_installer_asset,
    validate_downloaded_installer_file, verify_installer_signature,
    windows_installer_kind_from_name, GithubLatestReleaseResponse, WindowsInstallerKind,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateCheckResponse {
    pub current_version: String,
    pub latest_version: String,
    pub available: bool,
    pub release_name: String,
    pub release_notes: String,
    pub published_at: String,
    pub release_url: String,
    pub installer_download_url: String,
    pub installer_asset_name: String,
    pub expected_sha256: String,
}
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub(crate) struct UpdaterManifest {
    pub product: String,
    pub version: String,
    pub tag: String,
    pub installer: String,
    #[serde(rename = "sha256")]
    pub sha256_hash: String,
    #[serde(rename = "releaseUrl")]
    pub release_url: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUpdateInstallProgressEvent {
    pub stage: String,
    pub message: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub progress_percent: f64,
    pub completed: bool,
    pub success: bool,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallAppUpdateRequest {
    pub download_url: String,
    pub asset_name: Option<String>,
    pub silent: Option<bool>,
    pub expected_sha256: Option<String>,
    /// Version the check-step advertised (e.g. "1.0.11"). Re-checked against
    /// the download URL tag before any exec: a stale/relayed request that
    /// would install an older build is rejected (downgrade guard).
    pub expected_version: Option<String>,
}
#[tauri::command]
pub(crate) async fn log_client_event(message: String) -> Result<(), String> {
    let line = single_line(message.trim());
    if line.is_empty() {
        return Ok(());
    }

    info!("[client] {}", clip_text(&line, 1200));
    Ok(())
}

#[tauri::command]
pub(crate) async fn check_for_app_update(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AppUpdateCheckResponse, String> {
    let current_version = app.package_info().version.to_string();
    let (repository_owner, repository_name) = resolve_update_repository();
    let request_url = format!(
        "https://api.github.com/repos/{repository_owner}/{repository_name}/releases?per_page=30"
    );
    let max_retries = 2u32;
    let mut attempt = 0u32;
    let response = loop {
        let mut req = state
            .http
            .get(&request_url)
            .header(USER_AGENT, UPDATE_HTTP_USER_AGENT);
        if let Some(token) = update_github_token() {
            req = req.bearer_auth(token);
        }
        let resp = req
            .send()
            .await
            .map_err(|error| format!("Failed to check for updates: {error}"))?;
        let status = resp.status();
        if (status == reqwest::StatusCode::FORBIDDEN
            || status == reqwest::StatusCode::TOO_MANY_REQUESTS)
            && attempt < max_retries
        {
            attempt += 1;
            let delay = if attempt == 1 { 5u64 } else { 15u64 };
            warn!(
                "[updater] rate-limited (status={}) retry {attempt}/{max_retries}",
                status,
            );
            std::thread::sleep(Duration::from_secs(delay));
            continue;
        }
        break resp;
    };
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(format!(
                "Update repository '{repository_owner}/{repository_name}' is not accessible. \
Set {UPDATE_GITHUB_TOKEN_ENV} for private repositories, or verify {UPDATE_REPOSITORY_OWNER_ENV}/{UPDATE_REPOSITORY_NAME_ENV}."
            ));
        }
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::UNAUTHORIZED {
            let hint = if update_github_token().is_some() {
                "The configured GitHub token may be invalid or lacks permission.".to_string()
            } else {
                format!(
                    "GitHub API rate limit may be exceeded (unauthenticated: 60 req/h). \
Consider setting {UPDATE_GITHUB_TOKEN_ENV} for a higher limit."
                )
            };
            return Err(format!(
                "Update check failed with status {} (rate-limited or unauthorized). {hint}",
                status,
            ));
        }
        return Err(format!(
            "Update check failed with status {}: {}",
            status,
            clip_text(&single_line(&body), 280)
        ));
    }

    let releases: Vec<GithubLatestReleaseResponse> = response
        .json()
        .await
        .map_err(|error| format!("Failed to parse update response: {error}"))?;
    let Some(release) = select_latest_stable_release(&releases) else {
        info!(
            "[updater] no stable release available source={}/{}",
            repository_owner, repository_name
        );
        return Ok(AppUpdateCheckResponse {
            current_version: current_version.clone(),
            latest_version: current_version,
            available: false,
            release_name: String::new(),
            release_notes: String::new(),
            published_at: String::new(),
            release_url: String::new(),
            installer_download_url: String::new(),
            installer_asset_name: String::new(),
            expected_sha256: String::new(),
        });
    };
    let latest_version = normalize_release_version(&release.tag_name);

    let (installer_download_url, installer_asset_name) = select_windows_installer_asset(release)
        .map(|asset| (asset.browser_download_url.clone(), asset.name.clone()))
        .unwrap_or_else(|| (String::new(), String::new()));

    let available =
        !installer_download_url.is_empty() && is_newer_version(&current_version, &latest_version);

    info!(
        "[updater] checked source={}/{} current={} latest={} available={} asset={}",
        repository_owner,
        repository_name,
        current_version,
        latest_version,
        available,
        installer_asset_name
    );

    let expected_sha256 = if !installer_asset_name.is_empty() {
        let manifest_url = format!(
            "https://github.com/{repository_owner}/{repository_name}/releases/download/{}/updater-manifest.json",
            release.tag_name
        );
        match state
            .http
            .get(&manifest_url)
            .header(USER_AGENT, UPDATE_HTTP_USER_AGENT)
            .send()
            .await
        {
            Ok(manifest_resp) if manifest_resp.status().is_success() => {
                match manifest_resp.json::<UpdaterManifest>().await {
                    Ok(manifest) => manifest.sha256_hash,
                    Err(error) => {
                        warn!("[updater] failed to parse updater manifest: {error}");
                        String::new()
                    }
                }
            }
            Ok(manifest_resp) => {
                warn!(
                    "[updater] manifest fetch returned status={}",
                    manifest_resp.status()
                );
                String::new()
            }
            Err(error) => {
                warn!("[updater] manifest fetch failed: {error}");
                String::new()
            }
        }
    } else {
        String::new()
    };

    Ok(AppUpdateCheckResponse {
        current_version,
        latest_version,
        available,
        release_name: release.name.clone().unwrap_or_default(),
        release_notes: release.body.clone().unwrap_or_default(),
        published_at: release.published_at.clone().unwrap_or_default(),
        release_url: release.html_url.clone().unwrap_or_default(),
        installer_download_url,
        installer_asset_name,
        expected_sha256,
    })
}

// is_safe_update_url has been moved to updater::

#[tauri::command]
pub(crate) async fn download_and_install_app_update(
    app: AppHandle,
    state: State<'_, AppState>,
    request: InstallAppUpdateRequest,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let download_url = request.download_url.trim();
        if download_url.is_empty() {
            return Err("Update download URL is empty.".to_string());
        }

        if !is_safe_update_url(download_url) {
            return Err(format!(
                "Update download URL is not from a trusted source: {}",
                clip_text(download_url, 120)
            ));
        }

        // Downgrade guard: the URL tag must identify a build strictly newer
        // than this binary, and must match the advertised expected_version
        // when the caller provides one. A relayed/stale request for an older
        // installer is rejected before a single byte downloads.
        let current_version = app.package_info().version.to_string();
        let url_version = extract_version_from_download_url(download_url).ok_or_else(|| {
            "Update download URL does not identify a release version.".to_string()
        })?;
        if !is_newer_version(&current_version, &url_version) {
            return Err(format!(
                "Update {url_version} is not newer than installed {current_version}; refusing downgrade."
            ));
        }
        if let Some(expected) = request
            .expected_version
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            let expected = normalize_release_version(expected);
            if normalize_release_version(&url_version) != expected {
                return Err(format!(
                    "Update URL version {url_version} does not match expected {expected}; refusing."
                ));
            }
        }

        let updates_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
            .join("updates");
        fs::create_dir_all(&updates_dir)
            .map_err(|error| format!("Failed to create updates directory: {error}"))?;

        let installer_name = resolve_installer_file_name(
            request.asset_name.as_deref(),
            download_url,
            app.package_info().version.to_string().as_str(),
        );
        let installer_path = updates_dir.join(installer_name);
        emit_update_install_progress(
            &app,
            "starting",
            "Preparing update download...",
            0,
            0,
            false,
            false,
        );

        let existing_size = fs::metadata(&installer_path).ok().and_then(|m| {
            if m.len() > 0 {
                Some(m.len())
            } else {
                None
            }
        });

        let mut req_builder = state
            .http
            .get(download_url)
            .header(USER_AGENT, UPDATE_HTTP_USER_AGENT);
        if let Some(size) = existing_size {
            info!(
                "[updater] partial installer found ({} bytes), requesting resume",
                size
            );
            req_builder = req_builder.header(RANGE, format!("bytes={size}-"));
        }
        let response = req_builder.send().await.map_err(|error| {
            let message = format!("Failed to download update installer: {error}");
            emit_update_install_progress(&app, "error", &message, 0, 0, true, false);
            message
        })?;
        let status = response.status();
        if !status.is_success() && status != reqwest::StatusCode::PARTIAL_CONTENT {
            let body = response.text().await.unwrap_or_default();
            let message = format!(
                "Installer download failed with status {}: {}",
                status,
                clip_text(&single_line(&body), 280)
            );
            emit_update_install_progress(&app, "error", &message, 0, 0, true, false);
            return Err(message);
        }

        let is_resume = existing_size.is_some() && status == reqwest::StatusCode::PARTIAL_CONTENT;
        let total_bytes = if is_resume {
            existing_size.unwrap() + response.content_length().unwrap_or(0)
        } else {
            response.content_length().unwrap_or(0)
        };
        let default_downloaded = existing_size.unwrap_or(0);
        let mut downloaded_bytes = if is_resume { default_downloaded } else { 0_u64 };
        let mut installer_file: fs::File = if is_resume {
            fs::OpenOptions::new().append(true).open(&installer_path)
        } else {
            if existing_size.is_some() {
                info!("[updater] server does not support resume, downloading from scratch");
            }
            fs::File::create(&installer_path)
        }
        .map_err(|error| {
            let message = format!("Failed to open installer file: {error}");
            emit_update_install_progress(
                &app,
                "error",
                &message,
                downloaded_bytes,
                total_bytes,
                true,
                false,
            );
            message
        })?;

        emit_update_install_progress(
            &app,
            "downloading",
            "Downloading update installer...",
            downloaded_bytes,
            total_bytes,
            false,
            false,
        );

        let mut hasher = Sha256::new();
        if is_resume {
            let mut existing_file = fs::File::open(&installer_path).map_err(|error| {
                let message = format!("Failed to read partial installer for hash: {error}");
                emit_update_install_progress(
                    &app,
                    "error",
                    &message,
                    downloaded_bytes,
                    total_bytes,
                    true,
                    false,
                );
                message
            })?;
            let mut buf = [0u8; 8192];
            loop {
                let n = existing_file.read(&mut buf).map_err(|error| {
                    let message = format!("Failed to read partial installer: {error}");
                    emit_update_install_progress(
                        &app,
                        "error",
                        &message,
                        downloaded_bytes,
                        total_bytes,
                        true,
                        false,
                    );
                    message
                })?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
            }
        }
        let mut response = response;
        while let Some(chunk) = response.chunk().await.map_err(|error| {
            let message = format!("Failed while reading installer download: {error}");
            emit_update_install_progress(
                &app,
                "error",
                &message,
                downloaded_bytes,
                total_bytes,
                true,
                false,
            );
            message
        })? {
            installer_file.write_all(&chunk).map_err(|error| {
                let message = format!("Failed to write installer file: {error}");
                emit_update_install_progress(
                    &app,
                    "error",
                    &message,
                    downloaded_bytes,
                    total_bytes,
                    true,
                    false,
                );
                message
            })?;
            hasher.update(&chunk);
            downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
            emit_update_install_progress(
                &app,
                "downloading",
                "Downloading update installer...",
                downloaded_bytes,
                total_bytes,
                false,
                false,
            );
        }

        installer_file.flush().map_err(|error| {
            let message = format!("Failed to finalize installer file: {error}");
            emit_update_install_progress(
                &app,
                "error",
                &message,
                downloaded_bytes,
                total_bytes,
                true,
                false,
            );
            message
        })?;

        // Release the write handle before validating/launching — Windows
        // requires zero open write handles before a new process can execute
        // the file. Without this, command.spawn() below fails with
        // ERROR_SHARING_VIOLATION (os error 32).
        drop(installer_file);

        if downloaded_bytes == 0 {
            let message = "Installer download returned an empty file.".to_string();
            emit_update_install_progress(
                &app,
                "error",
                &message,
                downloaded_bytes,
                total_bytes,
                true,
                false,
            );
            return Err(message);
        }

        // Verify downloaded size matches expected when content-length is known
        if total_bytes > 0 && downloaded_bytes != total_bytes {
            let message = format!(
                "Installer download size mismatch (expected={total_bytes} got={downloaded_bytes})"
            );
            emit_update_install_progress(
                &app,
                "error",
                &message,
                downloaded_bytes,
                total_bytes.max(downloaded_bytes),
                true,
                false,
            );
            let _ = fs::remove_file(&installer_path);
            return Err(message);
        }

        // Verify SHA256 if manifest hash was provided
        let computed_hash = format!("{:x}", hasher.finalize());
        if let Some(ref expected) = request.expected_sha256 {
            if !expected.is_empty() {
                if !computed_hash.eq_ignore_ascii_case(expected) {
                    let message = format!(
                        "Installer SHA256 mismatch (expected={expected} computed={computed_hash})"
                    );
                    emit_update_install_progress(
                        &app,
                        "error",
                        &message,
                        downloaded_bytes,
                        total_bytes.max(downloaded_bytes),
                        true,
                        false,
                    );
                    let _ = fs::remove_file(&installer_path);
                    return Err(message);
                }
            }
        }
        // Enforce SHA256: fail if hash is missing (None or empty) when asset is known
        let hash_missing =
            request.expected_sha256.is_none() || request.expected_sha256.as_deref() == Some("");
        if hash_missing {
            let has_asset = request
                .asset_name
                .as_deref()
                .map_or(false, |n| !n.is_empty());
            if has_asset {
                let message =
                    "Update installer manifest is missing SHA256 hash. Cannot verify installer integrity.".to_string();
                emit_update_install_progress(
                    &app,
                    "error",
                    &message,
                    downloaded_bytes,
                    total_bytes.max(downloaded_bytes),
                    true,
                    false,
                );
                let _ = fs::remove_file(&installer_path);
                return Err(message);
            }
        }

        emit_update_install_progress(
            &app,
            "downloaded",
            "Download complete. Launching installer...",
            downloaded_bytes,
            total_bytes.max(downloaded_bytes),
            false,
            false,
        );

        let installer_kind = installer_path
            .file_name()
            .and_then(|value| value.to_str())
            .and_then(windows_installer_kind_from_name)
            .ok_or_else(|| {
                format!(
                    "Downloaded update file '{}' is not a supported Windows installer (.exe/.msi).",
                    installer_path.display()
                )
            })?;
        if let Err(error) = validate_downloaded_installer_file(&installer_path, installer_kind) {
            emit_update_install_progress(
                &app,
                "error",
                &error,
                downloaded_bytes,
                total_bytes.max(downloaded_bytes),
                true,
                false,
            );
            let _ = fs::remove_file(&installer_path);
            return Err(error);
        }

        // Signature gate: no exec until verify passes. Currently fails closed
        // (see verify_installer_signature stub); remove_file + error below.
        let installer_bytes = fs::read(&installer_path).map_err(|error| {
            let message = format!("Failed to read installer for signature check: {error}");
            emit_update_install_progress(
                &app,
                "error",
                &message,
                downloaded_bytes,
                total_bytes.max(downloaded_bytes),
                true,
                false,
            );
            message
        })?;
        if let Err(error) = verify_installer_signature(&installer_bytes, "") {
            let message = format!("Installer signature check failed: {error}");
            emit_update_install_progress(
                &app,
                "error",
                &message,
                downloaded_bytes,
                total_bytes.max(downloaded_bytes),
                true,
                false,
            );
            let _ = fs::remove_file(&installer_path);
            return Err(message);
        }

        let mut command = match installer_kind {
            WindowsInstallerKind::Exe => {
                let mut command = Command::new(&installer_path);
                let installer_file_name = installer_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or_default();
                if request.silent.unwrap_or(true)
                    && exe_installer_supports_silent_mode(installer_file_name)
                {
                    command.arg("/S");
                } else if request.silent.unwrap_or(true) {
                    warn!(
                        "[updater] skipped EXE silent flag because installer name '{}' is not recognized as setup-like",
                        clip_text(installer_file_name, 160)
                    );
                }
                command
            }
            WindowsInstallerKind::Msi => {
                let mut command = Command::new("msiexec");
                command.arg("/i").arg(&installer_path);
                if request.silent.unwrap_or(true) {
                    command.args(["/qn", "/norestart"]);
                } else {
                    command.args(["/passive", "/norestart"]);
                }
                command
            }
        };
        apply_no_window(&mut command);
        let installer_child = command.spawn().map_err(|error| {
            let message = format!(
                "Failed to launch installer '{}': {error}",
                installer_path.display()
            );
            emit_update_install_progress(
                &app,
                "error",
                &message,
                downloaded_bytes,
                total_bytes.max(downloaded_bytes),
                true,
                false,
            );
            message
        })?;
        let installer_pid = installer_child.id();
        let app_exe_path = std::env::current_exe()
            .map_err(|error| format!("Failed to resolve current app executable path: {error}"))?;

        info!(
            "[updater] installer launched path={} silent={} pid={}",
            installer_path.display(),
            request.silent.unwrap_or(true),
            installer_pid
        );
        emit_update_install_progress(
            &app,
            "installing",
            "Installer launched. Closing app so the update can finish.",
            downloaded_bytes,
            total_bytes.max(downloaded_bytes),
            true,
            true,
        );
        match schedule_app_relaunch_after_installer(installer_pid, &app_exe_path) {
            Ok(()) => {
                info!(
                    "[updater] relaunch watcher scheduled installer_pid={} app_exe={}",
                    installer_pid,
                    clip_text(&single_line(&app_exe_path.to_string_lossy()), 260)
                );
                // Re-arm the Windows Run key after an update. The exe path may
                // have been swapped or relocated by the installer, so the value
                // we wrote previously points at a stale path and Windows silently
                // skips it on next boot. Honor the user's saved preference.
                let reapply = read_launch_at_login_preference(&app);
                if let Err(error) = configure_launch_at_login(reapply).await {
                    warn!(
                        "[updater] failed to re-apply launch-at-login after update error={}",
                        error
                    );
                }
            }
            Err(error) => {
                warn!(
                    "[updater] relaunch watcher scheduling failed installer_pid={} error={}",
                    installer_pid,
                    clip_text(&single_line(&error), 260)
                );
            }
        }

        let app_for_exit = app.clone();
        let installer_for_poll = installer_path.clone();
        thread::spawn(move || {
            let initial_len = fs::metadata(&installer_for_poll)
                .ok()
                .map(|m| m.len())
                .unwrap_or(0);
            let deadline = Instant::now() + Duration::from_secs(10);
            loop {
                let current_len = fs::metadata(&installer_for_poll)
                    .ok()
                    .map(|m| m.len())
                    .unwrap_or(0);
                if current_len != initial_len {
                    info!("[updater] installer process started writing to disk");
                    break;
                }
                if Instant::now() >= deadline {
                    warn!("[updater] installer did not start writing within 10s, exiting anyway");
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            info!("[updater] exiting app to allow installer to proceed");
            std::thread::sleep(Duration::from_millis(1000));
            app_for_exit.exit(0);
        });
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, state, request);
        Err("Auto-update installer is currently implemented for Windows only.".to_string())
    }
}

#[tauri::command]
pub(crate) async fn show_update_settings(app: AppHandle) -> Result<(), String> {
    show_main_window(&app);
    if let Err(error) = app.emit(APP_EVENT_UPDATE_AVAILABLE, json!({})) {
        return Err(format!("Failed to emit update settings event: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn set_tray_update_available(
    app: AppHandle,
    available: bool,
    version: String,
) -> Result<(), String> {
    let label = if available {
        format!("Update v{version} available")
    } else {
        "No updates available".to_string()
    };
    if let Some(item) = TRAY_UPDATE_ITEM.get() {
        let _ = item.set_text(&label);
        let _ = item.set_enabled(available);
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if available {
            let _ = tray.set_tooltip(Some(&format!("SlasshyWispr — Update v{version} available")));
        } else {
            let _ = tray.set_tooltip(Some("SlasshyWispr"));
        }
    }
    Ok(())
}
