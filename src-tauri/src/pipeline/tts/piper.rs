//! Piper TTS synthesis + provisioning (Phase 7b).
//!
//! Subprocess synthesis via the `piper` binary, voice-file provisioning, and
//! the tuning-argument support probe cache. Pure text normalization lives in
//! `super::normalize`; path resolution in `super::paths`.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
#[cfg(target_os = "windows")]
use zip::ZipArchive;

use log::{info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::constants::*;
use crate::pipeline::fs::{download_file, file_exists_with_content, find_file_by_name};
use crate::pipeline::log::clip_text;
use crate::pipeline::process::{apply_no_window, elapsed_ms, merge_process_output};

use super::normalize::{
    normalize_piper_text_for_tts, validate_piper_binary_path, validate_tts_input_length,
};
use super::paths::{piper_runtime_dir, voice_paths};

static PIPER_TUNING_SUPPORT: OnceLock<Mutex<Option<bool>>> = OnceLock::new();

pub(crate) fn piper_tuning_support() -> &'static Mutex<Option<bool>> {
    PIPER_TUNING_SUPPORT.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiperPipelineRequest {
    pub(crate) speed: Option<f32>,
    pub(crate) quality: Option<String>,
    pub(crate) emotion: Option<String>,
}

pub async fn synthesize_with_piper(
    piper_path: String,
    model_path: PathBuf,
    text: String,
    piper: Option<&PiperPipelineRequest>,
) -> Result<Vec<u8>, String> {
    validate_piper_binary_path(&piper_path)?;
    let synth_start = Instant::now();
    let clean_text = text.replace('\r', " ").trim().to_string();

    if clean_text.is_empty() {
        return Err("No text provided for TTS".to_string());
    }
    validate_tts_input_length(&clean_text)?;

    let numeric_stability_mode = clean_text
        .chars()
        .any(|character| character.is_ascii_digit());
    let normalized_text = normalize_piper_text_for_tts(&clean_text);
    if normalized_text.is_empty() {
        return Err("No text provided for Piper TTS after normalization".to_string());
    }

    let base_speed = piper
        .and_then(|config| config.speed)
        .unwrap_or(PIPER_DEFAULT_SPEED)
        .clamp(0.5, 2.0);
    let quality = piper
        .and_then(|config| config.quality.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(PIPER_DEFAULT_QUALITY)
        .to_ascii_lowercase();
    let emotion = piper
        .and_then(|config| config.emotion.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(PIPER_DEFAULT_EMOTION)
        .to_ascii_lowercase();

    let (quality_noise_scale, quality_noise_w) = match quality.as_str() {
        "fast" => (0.60_f32, 0.68_f32),
        "high" => (0.88_f32, 0.94_f32),
        _ => (0.74_f32, 0.82_f32),
    };
    let (emotion_speed_factor, emotion_noise_delta, emotion_noise_w_delta) = match emotion.as_str()
    {
        "calm" => (0.92_f32, -0.08_f32, -0.08_f32),
        "happy" => (1.06_f32, 0.04_f32, 0.05_f32),
        "excited" => (1.14_f32, 0.10_f32, 0.11_f32),
        "serious" => (0.96_f32, -0.03_f32, -0.02_f32),
        "sad" => (0.89_f32, -0.11_f32, -0.10_f32),
        _ => (1.0_f32, 0.0_f32, 0.0_f32),
    };
    let final_speed = (base_speed * emotion_speed_factor).clamp(0.5, 2.0);
    let length_scale = (1.0 / final_speed).clamp(0.5, 2.2);
    let noise_scale = (quality_noise_scale + emotion_noise_delta).clamp(0.35, 1.35);
    let noise_w = (quality_noise_w + emotion_noise_w_delta).clamp(0.45, 1.35);
    let length_scale_arg = format!("{length_scale:.3}");
    let noise_scale_arg = format!("{noise_scale:.3}");
    let noise_w_arg = format!("{noise_w:.3}");

    info!(
        "[piper.synthesize] request speed={} quality={} emotion={} length_scale={} noise_scale={} noise_w={}",
        final_speed,
        quality,
        emotion,
        length_scale_arg,
        noise_scale_arg,
        noise_w_arg
    );
    if normalized_text != clean_text {
        info!(
            "[piper.synthesize] normalized text chars={} source_chars={}",
            normalized_text.chars().count(),
            clean_text.chars().count()
        );
        info!(
            "[piper.synthesize] normalized preview={}",
            clip_text(&normalized_text, 240)
        );
    }
    if numeric_stability_mode {
        info!(
            "[piper.synthesize] numeric stability mode enabled (using Piper defaults for cleaner number speech)"
        );
    }

    tauri::async_runtime::spawn_blocking(move || {
        if !Path::new(&piper_path).exists() {
            return Err(format!("Piper executable was not found at: {piper_path}"));
        }

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("Failed to compute timestamp: {error}"))?
            .as_millis();

        let output_path = std::env::temp_dir().join(format!("slasshywispr-tts-{stamp}.wav"));

        let run_once = |with_tuning: bool| -> Result<std::process::Output, String> {
            let mut command = Command::new(&piper_path);
            apply_no_window(&mut command);
            command
                .arg("--model")
                .arg(&model_path)
                .arg("--output_file")
                .arg(&output_path);
            if with_tuning {
                command
                    .arg("--length_scale")
                    .arg(&length_scale_arg)
                    .arg("--noise_scale")
                    .arg(&noise_scale_arg)
                    .arg("--noise_w")
                    .arg(&noise_w_arg);
            }

            let mut child = command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|error| format!("Failed to start Piper process: {error}"))?;

            {
                let stdin = child
                    .stdin
                    .as_mut()
                    .ok_or_else(|| "Unable to access Piper stdin".to_string())?;

                stdin
                    .write_all(normalized_text.as_bytes())
                    .map_err(|error| format!("Failed writing text to Piper stdin: {error}"))?;
                stdin
                    .write_all(b"\n")
                    .map_err(|error| format!("Failed finalizing Piper stdin: {error}"))?;
            }

            child
                .wait_with_output()
                .map_err(|error| format!("Piper process failed to finish: {error}"))
        };

        let cached_tuning_support = {
            let guard = piper_tuning_support()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *guard
        };
        let should_try_tuning = !numeric_stability_mode && cached_tuning_support.unwrap_or(true);
        if !should_try_tuning && cached_tuning_support == Some(false) {
            info!(
                "[piper.synthesize] tuning args previously marked unsupported; using defaults"
            );
        }

        let output = if should_try_tuning {
            let first_output = run_once(true)?;
            if first_output.status.success() {
                let mut guard = piper_tuning_support()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if *guard != Some(true) {
                    *guard = Some(true);
                }
                first_output
            } else {
                let merged = merge_process_output(&first_output.stdout, &first_output.stderr);
                let lower = merged.to_ascii_lowercase();
                let unsupported_flag = lower.contains("unrecognized arguments")
                    || lower.contains("unknown option")
                    || lower.contains("unexpected argument")
                    || lower.contains("invalid choice");
                if unsupported_flag {
                    warn!(
                        "[piper.synthesize] piper runtime does not support tuning args; retrying with defaults"
                    );
                    let mut guard = piper_tuning_support()
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    *guard = Some(false);
                    run_once(false)?
                } else {
                    first_output
                }
            }
        } else {
            run_once(false)?
        };

        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Piper synthesis failed: {}",
                clip_text(merged.trim(), 420)
            ));
        }

        let wav_bytes = fs::read(&output_path)
            .map_err(|error| format!("Failed to read generated WAV file: {error}"))?;

        let _ = fs::remove_file(&output_path);

        Ok(wav_bytes)
    })
    .await
    .map_err(|error| format!("Piper synthesis worker failed: {error}"))
    .map(|result| {
        if let Ok(ref wav_bytes) = result {
            info!(
                "[piper.synthesize] success bytes={} latency_ms={}",
                wav_bytes.len(),
                elapsed_ms(synth_start)
            );
        }
        result
    })?
}

pub async fn ensure_voice_files(
    app: &AppHandle,
    client: &Client,
) -> Result<(PathBuf, PathBuf), String> {
    // Boundary: resolve roots once here; the download core takes owned paths.
    let (model_path, config_path) = voice_paths(app)?;
    return ensure_voice_files_in(model_path, config_path, client).await;
}

async fn ensure_voice_files_in(
    model_path: PathBuf,
    config_path: PathBuf,
    client: &Client,
) -> Result<(PathBuf, PathBuf), String> {
    if !file_exists_with_content(&model_path) {
        download_file(client, VOICE_MODEL_URL, &model_path).await?;
    }

    if !file_exists_with_content(&config_path) {
        download_file(client, VOICE_CONFIG_URL, &config_path).await?;
    }

    Ok((model_path, config_path))
}

#[cfg(target_os = "windows")]
fn extract_zip_archive(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path)
        .map_err(|error| format!("Failed to open Piper archive: {error}"))?;

    let mut archive = ZipArchive::new(archive_file)
        .map_err(|error| format!("Invalid Piper ZIP archive: {error}"))?;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("Failed reading ZIP entry {index}: {error}"))?;

        let Some(safe_name) = file.enclosed_name().map(|path| path.to_owned()) else {
            continue;
        };

        let output_path = destination.join(safe_name);

        if file.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| format!("Failed creating extracted directory: {error}"))?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed preparing extracted path: {error}"))?;
        }

        let mut output_file = fs::File::create(&output_path)
            .map_err(|error| format!("Failed creating extracted file: {error}"))?;

        std::io::copy(&mut file, &mut output_file)
            .map_err(|error| format!("Failed writing extracted file: {error}"))?;
    }

    Ok(())
}

pub async fn ensure_piper_binary(app: &AppHandle, client: &Client) -> Result<PathBuf, String> {
    // Boundary: resolve roots once here; the download core takes an owned dir.
    let runtime_dir = piper_runtime_dir(app)?;
    return ensure_piper_binary_in(runtime_dir, client).await;
}

async fn ensure_piper_binary_in(runtime_dir: PathBuf, client: &Client) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(existing_path) = find_file_by_name(&runtime_dir, PIPER_BINARY_NAME)? {
            return Ok(existing_path);
        }

        let archive_path = runtime_dir.join(PIPER_ARCHIVE_FILE);
        download_file(client, PIPER_ARCHIVE_URL, &archive_path).await?;
        extract_zip_archive(&archive_path, &runtime_dir)?;
        let _ = fs::remove_file(&archive_path);

        return find_file_by_name(&runtime_dir, PIPER_BINARY_NAME)?
            .ok_or_else(|| "Piper archive was extracted but piper.exe was not found".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (runtime_dir, client);
        Err(
            "Automatic Piper download is currently implemented for Windows in this build."
                .to_string(),
        )
    }
}
