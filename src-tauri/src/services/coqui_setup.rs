//! Coqui runtime setup + voice inventory — service extraction.
//!
//! Moved verbatim from lib.rs: blocking venv/pip/torch setup
//! (`setup_coqui_runtime_blocking`), the `run_python_command` helper it is
//! built on, `list_coqui_voice_ids` directory inventory, and the small
//! `detect_nvidia_gpu` probe it uses. Single caller is commands::tts.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use log::{info, warn};
use tauri::AppHandle;

use crate::pipeline::daemon::stop_all_coqui_bridge_daemons;
use crate::pipeline::fs::file_exists_with_content;
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::process::{apply_no_window, merge_process_output, validate_python_binary_path};
use crate::pipeline::tts::{coqui_cache_dir, coqui_runtime_dir, coqui_venv_python_path};

pub(crate) fn detect_nvidia_gpu() -> bool {
    let output = {
        let mut command = Command::new("nvidia-smi");
        apply_no_window(&mut command);
        command
            .arg("-L")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
    };
    let Ok(output) = output else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let text = String::from_utf8_lossy(&output.stdout).to_ascii_lowercase();
    text.contains("gpu")
}

pub(crate) fn setup_coqui_runtime_blocking(
    app: &AppHandle,
    bootstrap_python: &str,
    use_gpu: bool,
) -> Result<(String, String), String> {
    validate_python_binary_path(bootstrap_python)?;
    let runtime_dir = coqui_runtime_dir(app)?;
    let venv_dir = runtime_dir.join("venv");
    let venv_python_path = coqui_venv_python_path(app)?;
    let tts_home = coqui_cache_dir(app)?;
    let mut details = Vec::new();
    stop_all_coqui_bridge_daemons();
    details.push("Stopped active Coqui bridge daemons before runtime update.".to_string());
    let nvidia_detected = detect_nvidia_gpu();
    let prefer_gpu_runtime = use_gpu || nvidia_detected;

    if prefer_gpu_runtime {
        if use_gpu {
            details.push("GPU runtime preference: enabled by user.".to_string());
        } else {
            details.push(
                "GPU runtime preference: auto-enabled because NVIDIA GPU was detected.".to_string(),
            );
        }
    } else {
        details.push("GPU runtime preference: CPU-only mode.".to_string());
    }

    if !file_exists_with_content(&venv_python_path) {
        let mut create_venv = Command::new(bootstrap_python);
        apply_no_window(&mut create_venv);
        create_venv
            .arg("-m")
            .arg("venv")
            .arg(&venv_dir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let output = create_venv
            .output()
            .map_err(|error| format!("Failed to create Coqui virtualenv: {error}"))?;
        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Coqui virtualenv creation failed: {}",
                clip_text(merged.trim(), 420)
            ));
        }
        details.push(format!(
            "Created virtualenv at {}.",
            venv_dir.to_string_lossy()
        ));
    }

    let venv_python = venv_python_path.to_string_lossy().to_string();
    let pip_upgrade_output = run_python_command(
        &venv_python,
        &["-m", "pip", "install", "--upgrade", "pip"],
        &tts_home,
    )?;
    if !pip_upgrade_output.trim().is_empty() {
        details.push(format!(
            "pip: {}",
            clip_text(&single_line(&pip_upgrade_output), 220)
        ));
    }

    let package_candidates: Vec<&str> = if prefer_gpu_runtime {
        vec!["coqui-tts[codec]", "coqui-tts", "TTS"]
    } else {
        vec![
            "coqui-tts[cpu,codec]",
            "coqui-tts[cpu]",
            "coqui-tts[codec]",
            "coqui-tts",
            "TTS",
        ]
    };
    let mut install_errors = Vec::new();
    let mut installed_package = "";
    let mut install_output = String::new();

    for candidate in package_candidates {
        match run_python_command(
            &venv_python,
            &["-m", "pip", "install", "--upgrade", candidate],
            &tts_home,
        ) {
            Ok(output) => {
                installed_package = candidate;
                install_output = output;
                break;
            }
            Err(error) => install_errors.push(format!("{candidate}: {error}")),
        }
    }

    if installed_package.is_empty() {
        return Err(format!(
            "Failed to install Coqui packages. {}",
            clip_text(&install_errors.join(" | "), 520)
        ));
    }

    details.push(format!("Installed {installed_package}."));
    if !install_output.trim().is_empty() {
        details.push(format!(
            "install: {}",
            clip_text(&single_line(&install_output), 260)
        ));
    }

    // Pin torch/torchaudio to the 2.8 line to avoid torchcodec/FFmpeg hard dependency
    // that breaks voice-clone audio loading in newer releases.
    let torch_candidates: Vec<(&str, Vec<&str>)> = if prefer_gpu_runtime {
        vec![
            (
                "CUDA (cu128) torch==2.8.0 + torchaudio==2.8.0",
                vec![
                    "-m",
                    "pip",
                    "install",
                    "--upgrade",
                    "--force-reinstall",
                    "torch==2.8.0",
                    "torchaudio==2.8.0",
                    "--index-url",
                    "https://download.pytorch.org/whl/cu128",
                ],
            ),
            (
                "CUDA (cu124) torch==2.8.0 + torchaudio==2.8.0",
                vec![
                    "-m",
                    "pip",
                    "install",
                    "--upgrade",
                    "--force-reinstall",
                    "torch==2.8.0",
                    "torchaudio==2.8.0",
                    "--index-url",
                    "https://download.pytorch.org/whl/cu124",
                ],
            ),
            (
                "CPU torch==2.8.0 + torchaudio==2.8.0 fallback",
                vec![
                    "-m",
                    "pip",
                    "install",
                    "--upgrade",
                    "--force-reinstall",
                    "torch==2.8.0",
                    "torchaudio==2.8.0",
                ],
            ),
        ]
    } else {
        vec![(
            "CPU torch==2.8.0 + torchaudio==2.8.0",
            vec![
                "-m",
                "pip",
                "install",
                "--upgrade",
                "--force-reinstall",
                "torch==2.8.0",
                "torchaudio==2.8.0",
            ],
        )]
    };

    let mut torch_install_output = String::new();
    let mut torch_install_label = "";
    let mut torch_install_errors = Vec::new();
    for (label, args) in torch_candidates {
        match run_python_command(&venv_python, &args, &tts_home) {
            Ok(output) => {
                torch_install_label = label;
                torch_install_output = output;
                break;
            }
            Err(error) => torch_install_errors.push(format!("{label}: {error}")),
        }
    }

    if torch_install_label.is_empty() {
        return Err(format!(
            "Failed to install PyTorch runtime for Coqui. {}",
            clip_text(&torch_install_errors.join(" | "), 520)
        ));
    }

    details.push(format!("Installed {torch_install_label}."));
    if !torch_install_output.trim().is_empty() {
        details.push(format!(
            "torch: {}",
            clip_text(&single_line(&torch_install_output), 260)
        ));
    }

    // torchcodec is not needed on the pinned torch 2.8 line; remove stale installs if present.
    match run_python_command(
        &venv_python,
        &["-m", "pip", "uninstall", "-y", "torchcodec"],
        &tts_home,
    ) {
        Ok(remove_output) => {
            details.push("Removed torchcodec for stable Coqui audio I/O.".to_string());
            if !remove_output.trim().is_empty() {
                details.push(format!(
                    "torchcodec: {}",
                    clip_text(&single_line(&remove_output), 260)
                ));
            }
        }
        Err(error) => {
            details.push(format!(
                "torchcodec cleanup warning: {}",
                clip_text(&single_line(&error), 260)
            ));
        }
    }

    // Coqui currently breaks with transformers 5.x, and older 4.x builds can miss symbols too.
    // Pin to a known-compatible window.
    let transformer_pin_output = run_python_command(
        &venv_python,
        &["-m", "pip", "install", "--upgrade", "transformers>=4.57,<5"],
        &tts_home,
    )?;
    details.push("Pinned transformers>=4.57,<5 for Coqui compatibility.".to_string());
    if !transformer_pin_output.trim().is_empty() {
        details.push(format!(
            "transformers: {}",
            clip_text(&single_line(&transformer_pin_output), 260)
        ));
    }

    stop_all_coqui_bridge_daemons();
    details.push("Cleared Coqui bridge daemon cache after runtime setup.".to_string());

    Ok((venv_python, details.join(" ")))
}


pub(crate) fn run_python_command(python_path: &str, args: &[&str], tts_home: &Path) -> Result<String, String> {
    let mut command = Command::new(python_path);
    apply_no_window(&mut command);
    command.args(args);
    command
        .env("TTS_HOME", tts_home)
        .env("COQUI_TOS_AGREED", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command
        .output()
        .map_err(|error| format!("Failed to run Python command: {error}"))?;
    if !output.status.success() {
        let merged = merge_process_output(&output.stdout, &output.stderr);
        return Err(format!(
            "Python command failed: {}",
            clip_text(merged.trim(), 420)
        ));
    }
    Ok(merge_process_output(&output.stdout, &output.stderr))
}


pub(crate) fn list_coqui_voice_ids(voice_dir: &Path) -> Result<Vec<String>, String> {
    if !voice_dir.exists() {
        return Ok(Vec::new());
    }

    let mut voice_ids = BTreeSet::new();
    let entries = fs::read_dir(voice_dir)
        .map_err(|error| format!("Failed to read Coqui voice directory: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read voice entry: {error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if extension != "pth" && extension != "pt" && extension != "json" {
            continue;
        }
        if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
            if !stem.trim().is_empty() {
                voice_ids.insert(stem.trim().to_string());
            }
        }
    }

    Ok(voice_ids.into_iter().collect())
}









