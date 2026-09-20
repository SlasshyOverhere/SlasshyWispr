//! Provider runtime helpers — Ollama + update token.
//!
//! Moved verbatim from lib.rs: Ollama version/service/installer helpers and
//! the update GitHub-token env read. Single consumers are commands::providers
//! and commands::updater.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use log::warn;
use reqwest::Client;
use tauri::{AppHandle, Manager};

use crate::constants::{OLLAMA_WINDOWS_INSTALLER_FILE, UPDATE_GITHUB_TOKEN_ENV};
use crate::pipeline::fs::file_exists_with_content;
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::process::{apply_no_window, merge_process_output};
use crate::pipeline::routing::non_empty_env_var;

pub(crate) async fn query_ollama_version() -> Result<String, String> {
    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new("ollama");
        apply_no_window(&mut command);
        command
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
            .output()
            .map_err(|error| format!("Failed to execute 'ollama --version': {error}"))
    })
    .await
    .map_err(|error| format!("Ollama version check task failed: {error}"))??;

    if !output.status.success() {
        let merged = merge_process_output(&output.stdout, &output.stderr);
        return Err(format!(
            "Ollama CLI is not available: {}",
            clip_text(&single_line(&merged), 260)
        ));
    }

    let raw = merge_process_output(&output.stdout, &output.stderr);
    let version = raw.trim().to_string();
    if version.is_empty() {
        return Err("Ollama CLI returned an empty version string.".to_string());
    }

    Ok(version)
}

pub(crate) async fn is_ollama_service_running(client: &Client, base_url: &str) -> bool {
    client
        .get(format!("{base_url}/api/tags"))
        .timeout(Duration::from_secs(4))
        .send()
        .await
        .map(|response| response.status().is_success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
pub(crate) fn ollama_installer_path(app: &AppHandle) -> Result<PathBuf, String> {
    let installer_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
        .join("ollama")
        .join("installer");
    fs::create_dir_all(&installer_dir)
        .map_err(|error| format!("Failed to create Ollama installer directory: {error}"))?;
    Ok(installer_dir.join(OLLAMA_WINDOWS_INSTALLER_FILE))
}

#[cfg(target_os = "windows")]
pub(crate) fn run_ollama_installer_windows(installer_path: &Path) -> Result<(), String> {
    if !file_exists_with_content(installer_path) {
        return Err(format!(
            "Ollama installer is missing at '{}'.",
            installer_path.display()
        ));
    }

    let mut silent_command = Command::new(installer_path);
    apply_no_window(&mut silent_command);
    silent_command
        .arg("/S")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());
    let silent_output = silent_command.output().map_err(|error| {
        format!(
            "Failed to launch Ollama installer '{}': {error}",
            installer_path.display()
        )
    })?;
    if silent_output.status.success() {
        return Ok(());
    }

    let merged = merge_process_output(&silent_output.stdout, &silent_output.stderr);
    warn!(
        "[ollama.install] silent install failed; falling back to interactive launch: {}",
        clip_text(&single_line(&merged), 220)
    );

    let mut interactive_command = Command::new(installer_path);
    interactive_command
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    interactive_command.spawn().map_err(|error| {
        format!(
            "Failed to start interactive Ollama installer '{}': {error}",
            installer_path.display()
        )
    })?;

    Ok(())
}

pub(crate) fn update_github_token() -> Option<String> {
    non_empty_env_var(UPDATE_GITHUB_TOKEN_ENV)
}
