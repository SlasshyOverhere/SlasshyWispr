//! STT transcription runtime — Phase 7a service extraction.
//!
//! Moved verbatim from lib.rs: online dispatch, local parakeet/HF paths,
//! OpenAI-compatible upload, plus mime/score helpers. commands/pipeline
//! calls transcribe_audio + transcribe_audio_local through here.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use log::{info, warn};
use reqwest::{multipart, Client};
use serde_json::{Value, json};
use tauri::{AppHandle, Manager};

use crate::audio;
use crate::audio::parakeet::local_stt_native_parakeet_runtime;
use crate::audio::processing::decode_local_stt_audio_to_mono_f32;
use crate::audio::vad;
use crate::commands::local_stt::LocalSttDeactivateRequest;
use crate::constants::{
    LOCAL_STT_BRIDGE_SCRIPT, LOCAL_STT_RUNTIME_READY_MARKER_CONTENT,
    LOCAL_STT_RUNTIME_READY_MARKER_FILE, ZERO_PYTHON_STT_NOTICE,
};
use crate::pipeline::daemon::{
    run_local_stt_bridge_via_daemon, stop_all_local_stt_bridge_daemons,
};
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::fs::file_exists_with_content;
use crate::pipeline::process::{
    apply_no_window, elapsed_ms, merge_process_output, validate_python_binary_path,
};
use crate::pipeline::routing::{
    canonical_local_stt_model_id, infer_local_stt_provider_from_model, LocalSttConfig,
    zero_python_mode_enabled,
};
use crate::pipeline::stt::{
    is_known_stt_hallucination, looks_like_repetitive_transcript_noise,
    normalize_stt_allowed_languages, normalize_stt_language_hint,
};
use crate::pipeline::stt_download::archive::find_local_parakeet_model_root;
use crate::pipeline::stt_download::progress::now_unix_ms;
use crate::pipeline::stt_download::resolve::{
    legacy_huggingface_repo_id_for_model, resolve_huggingface_repo_id,
    sanitize_model_cache_dir_name,
};
use crate::state::AppState;

fn stt_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?
        .join("stt");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Failed to create STT root directory: {error}"))?;
    Ok(root)
}

pub(crate) fn stt_models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let models_dir = stt_root_dir(app)?.join("models");
    fs::create_dir_all(&models_dir)
        .map_err(|error| format!("Failed to create STT models directory: {error}"))?;
    Ok(models_dir)
}

pub(crate) fn resolve_local_stt_repo_and_dir(
    app: &AppHandle,
    provider: &str,
    model: &str,
) -> Result<(String, PathBuf), String> {
    let models_dir = stt_models_dir(app)?;
    let repo_id = resolve_huggingface_repo_id(provider, model);
    let target_dir = models_dir.join(sanitize_model_cache_dir_name(&repo_id));
    if target_dir.exists() {
        return Ok((repo_id, target_dir));
    }

    if let Some(legacy_repo_id) = legacy_huggingface_repo_id_for_model(provider, model) {
        let legacy_dir = models_dir.join(sanitize_model_cache_dir_name(&legacy_repo_id));
        if legacy_dir.exists() {
            return Ok((legacy_repo_id, legacy_dir));
        }
    }

    Ok((repo_id, target_dir))
}

pub(crate) fn stt_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = stt_root_dir(app)?.join("runtime");
    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("Failed to create STT runtime directory: {error}"))?;
    Ok(runtime_dir)
}

pub(crate) fn stt_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cache_dir = stt_root_dir(app)?.join("cache");
    fs::create_dir_all(&cache_dir)
        .map_err(|error| format!("Failed to create STT cache directory: {error}"))?;
    Ok(cache_dir)
}

pub(crate) fn stt_venv_python_path(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = stt_runtime_dir(app)?;
    #[cfg(target_os = "windows")]
    {
        Ok(runtime_dir.join("venv").join("Scripts").join("python.exe"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(runtime_dir.join("venv").join("bin").join("python"))
    }
}

pub(crate) fn ensure_local_stt_bridge_script(app: &AppHandle) -> Result<PathBuf, String> {
    let runtime_dir = stt_runtime_dir(app)?;
    let script_path = runtime_dir.join("local_stt_bridge.py");
    let should_write = fs::read_to_string(&script_path)
        .map(|existing| existing != LOCAL_STT_BRIDGE_SCRIPT)
        .unwrap_or(true);
    if should_write {
        fs::write(&script_path, LOCAL_STT_BRIDGE_SCRIPT)
            .map_err(|error| format!("Failed to write local STT bridge script: {error}"))?;
        stop_all_local_stt_bridge_daemons();
    }
    Ok(script_path)
}





pub(crate) fn local_stt_runtime_ready_marker_path(runtime_dir: &Path) -> PathBuf {
    runtime_dir.join(LOCAL_STT_RUNTIME_READY_MARKER_FILE)
}

pub(crate) fn write_local_stt_runtime_ready_marker(runtime_dir: &Path) -> Result<(), String> {
    let marker_path = local_stt_runtime_ready_marker_path(runtime_dir);
    fs::write(&marker_path, LOCAL_STT_RUNTIME_READY_MARKER_CONTENT).map_err(|error| {
        format!(
            "Failed to write local STT runtime ready marker '{}': {error}",
            marker_path.display()
        )
    })
}

pub(crate) fn clear_local_stt_runtime_ready_marker(runtime_dir: &Path) {
    let marker_path = local_stt_runtime_ready_marker_path(runtime_dir);
    let _ = fs::remove_file(marker_path);
}

fn try_install_local_stt_cuda_torch(
    python_path: &str,
    cache_dir: &Path,
    runtime_dir: &Path,
    reason_label: &str,
) -> Result<bool, String> {
    if !detect_nvidia_gpu_available() {
        return Ok(false);
    }

    if local_stt_torch_cuda_available(python_path, cache_dir).unwrap_or(false) {
        return Ok(true);
    }

    let failed_marker = runtime_dir.join("cuda-torch-install.failed");
    if failed_marker.exists() {
        return Ok(false);
    }

    info!(
        "[local.stt.runtime] nvidia gpu detected but torch cuda unavailable; installing cuda torch ({})",
        reason_label
    );
    let install_result = run_local_stt_python_command(
        python_path,
        &[
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--index-url",
            "https://download.pytorch.org/whl/cu128",
            "torch==2.8.0+cu128",
            "torchaudio==2.8.0+cu128",
        ],
        cache_dir,
    );
    match install_result {
        Ok(output) => {
            if !output.trim().is_empty() {
                info!(
                    "[local.stt.runtime] cuda torch install output={}",
                    clip_text(&single_line(&output), 260)
                );
            }
        }
        Err(error) => {
            warn!(
                "[local.stt.runtime] cuda torch install failed ({}): {}",
                reason_label,
                clip_text(&single_line(&error), 320)
            );
            let _ = fs::write(&failed_marker, now_unix_ms().to_string());
            return Ok(false);
        }
    }

    let available = local_stt_torch_cuda_available(python_path, cache_dir).unwrap_or(false);
    if available {
        let _ = fs::remove_file(&failed_marker);
        stop_all_local_stt_bridge_daemons();
        info!("[local.stt.runtime] cuda torch enabled");
        return Ok(true);
    }

    warn!(
        "[local.stt.runtime] cuda torch install completed but torch.cuda.is_available() is still false"
    );
    let _ = fs::write(&failed_marker, now_unix_ms().to_string());
    Ok(false)
}












pub(crate) fn run_local_stt_python_command(
    python_path: &str,
    args: &[&str],
    cache_dir: &Path,
) -> Result<String, String> {
    validate_python_binary_path(python_path)?;
    let mut command = Command::new(python_path);
    apply_no_window(&mut command);
    command.args(args);
    command
        .env("HF_HOME", cache_dir)
        .env("NEMO_CACHE_DIR", cache_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command
        .output()
        .map_err(|error| format!("Failed to run local STT Python command: {error}"))?;
    if !output.status.success() {
        let merged = merge_process_output(&output.stdout, &output.stderr);
        return Err(format!(
            "Local STT Python command failed: {}",
            clip_text(merged.trim(), 460)
        ));
    }
    Ok(merge_process_output(&output.stdout, &output.stderr))
}
pub(crate) fn detect_nvidia_gpu_available() -> bool {
    let mut command = Command::new("nvidia-smi");
    apply_no_window(&mut command);
    command
        .arg("-L")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match command.output() {
        Ok(output) if output.status.success() => {
            !String::from_utf8_lossy(&output.stdout).trim().is_empty()
        }
        _ => false,
    }
}
pub(crate) fn local_stt_torch_cuda_available(python_path: &str, cache_dir: &Path) -> Result<bool, String> {
    let output = run_local_stt_python_command(
        python_path,
        &[
            "-c",
            "import torch; print('CUDA_AVAILABLE=' + ('1' if torch.cuda.is_available() else '0'))",
        ],
        cache_dir,
    )?;
    let available = output
        .lines()
        .any(|line| line.trim().eq_ignore_ascii_case("CUDA_AVAILABLE=1"));
    Ok(available)
}
static LOCAL_STT_RUNTIME_PYTHON_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn local_stt_runtime_python_cache() -> &'static Mutex<Option<String>> {
    LOCAL_STT_RUNTIME_PYTHON_CACHE.get_or_init(|| Mutex::new(None))
}

pub(crate) fn setup_local_stt_runtime_blocking(
    app: &AppHandle,
    bootstrap_python: &str,
) -> Result<String, String> {
    validate_python_binary_path(bootstrap_python)?;
    let runtime_dir = stt_runtime_dir(app)?;
    let cache_dir = stt_cache_dir(app)?;
    let venv_dir = runtime_dir.join("venv");
    let venv_python_path = stt_venv_python_path(app)?;
    let venv_python = venv_python_path.to_string_lossy().to_string();
    let runtime_ready_marker_path = local_stt_runtime_ready_marker_path(&runtime_dir);
    let marker_ready = file_exists_with_content(&runtime_ready_marker_path);

    if let Ok(guard) = local_stt_runtime_python_cache().lock() {
        if let Some(cached_python) = guard.as_ref() {
            let same_path = {
                #[cfg(target_os = "windows")]
                {
                    cached_python.eq_ignore_ascii_case(&venv_python)
                }
                #[cfg(not(target_os = "windows"))]
                {
                    cached_python == &venv_python
                }
            };
            if same_path && file_exists_with_content(&venv_python_path) && marker_ready {
                info!(
                    "[local.stt.runtime] ready python={} cached=true marker=true",
                    clip_text(cached_python, 220)
                );
                return Ok(cached_python.clone());
            }
        }
    }

    if file_exists_with_content(&venv_python_path) && marker_ready {
        info!(
            "[local.stt.runtime] ready python={} marker=true",
            clip_text(&venv_python, 220)
        );
        if let Ok(mut guard) = local_stt_runtime_python_cache().lock() {
            *guard = Some(venv_python.clone());
        }
        return Ok(venv_python);
    }

    if !file_exists_with_content(&venv_python_path) {
        clear_local_stt_runtime_ready_marker(&runtime_dir);
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
            .map_err(|error| format!("Failed to create local STT virtualenv: {error}"))?;
        if !output.status.success() {
            let merged = merge_process_output(&output.stdout, &output.stderr);
            return Err(format!(
                "Local STT virtualenv creation failed: {}",
                clip_text(merged.trim(), 460)
            ));
        }
    }

    let probe_nemo = run_local_stt_python_command(
        &venv_python,
        &["-c", "import nemo.collections.asr"],
        &cache_dir,
    );
    let probe_faster_whisper =
        run_local_stt_python_command(&venv_python, &["-c", "import faster_whisper"], &cache_dir);
    if probe_nemo.is_ok() && probe_faster_whisper.is_ok() {
        let _ = try_install_local_stt_cuda_torch(
            &venv_python,
            &cache_dir,
            &runtime_dir,
            "runtime-ready",
        );
        let cuda_available =
            local_stt_torch_cuda_available(&venv_python, &cache_dir).unwrap_or(false);
        info!(
            "[local.stt.runtime] ready python={} cuda={}",
            clip_text(&venv_python, 220),
            cuda_available
        );
        if let Ok(mut guard) = local_stt_runtime_python_cache().lock() {
            *guard = Some(venv_python.clone());
        }
        if let Err(error) = write_local_stt_runtime_ready_marker(&runtime_dir) {
            warn!(
                "[local.stt.runtime] unable to persist runtime-ready marker: {}",
                clip_text(&single_line(&error), 260)
            );
        }
        return Ok(venv_python);
    }
    if probe_nemo.is_ok() && probe_faster_whisper.is_err() {
        info!(
            "[local.stt.runtime] installing faster-whisper acceleration packages for local Whisper models"
        );
        let install_output = run_local_stt_python_command(
            &venv_python,
            &[
                "-m",
                "pip",
                "install",
                "--upgrade",
                "ctranslate2>=4.5",
                "faster-whisper>=1.1.0",
            ],
            &cache_dir,
        )?;
        if !install_output.trim().is_empty() {
            info!(
                "[local.stt.runtime] faster-whisper install output={}",
                clip_text(&single_line(&install_output), 260)
            );
        }
        let recheck_faster_whisper = run_local_stt_python_command(
            &venv_python,
            &["-c", "import faster_whisper"],
            &cache_dir,
        );
        if recheck_faster_whisper.is_ok() {
            let _ = try_install_local_stt_cuda_torch(
                &venv_python,
                &cache_dir,
                &runtime_dir,
                "runtime-ready",
            );
            let cuda_available =
                local_stt_torch_cuda_available(&venv_python, &cache_dir).unwrap_or(false);
            info!(
                "[local.stt.runtime] ready python={} cuda={} faster_whisper=true",
                clip_text(&venv_python, 220),
                cuda_available
            );
            if let Ok(mut guard) = local_stt_runtime_python_cache().lock() {
                *guard = Some(venv_python.clone());
            }
            if let Err(error) = write_local_stt_runtime_ready_marker(&runtime_dir) {
                warn!(
                    "[local.stt.runtime] unable to persist runtime-ready marker: {}",
                    clip_text(&single_line(&error), 260)
                );
            }
            return Ok(venv_python);
        }
        warn!(
            "[local.stt.runtime] faster-whisper import still failing after install; continuing with full dependency bootstrap"
        );
    }
    info!(
        "[local.stt.runtime] installing runtime packages for Parakeet STT (first run may take several minutes)"
    );

    let _ = run_local_stt_python_command(
        &venv_python,
        &[
            "-m",
            "pip",
            "install",
            "--upgrade",
            "pip",
            "setuptools",
            "wheel",
        ],
        &cache_dir,
    )?;

    let cuda_torch_installed =
        try_install_local_stt_cuda_torch(&venv_python, &cache_dir, &runtime_dir, "first-install")
            .unwrap_or(false);
    if !cuda_torch_installed {
        let torch_install_output = run_local_stt_python_command(
            &venv_python,
            &[
                "-m",
                "pip",
                "install",
                "--upgrade",
                "torch==2.8.0",
                "torchaudio==2.8.0",
            ],
            &cache_dir,
        )?;
        if !torch_install_output.trim().is_empty() {
            info!(
                "[local.stt.runtime] torch install output={}",
                clip_text(&single_line(&torch_install_output), 260)
            );
        }
    }

    let deps_install_output = run_local_stt_python_command(
        &venv_python,
        &[
            "-m",
            "pip",
            "install",
            "--upgrade",
            "nemo_toolkit[asr]>=2,<3",
            "soundfile",
            "transformers>=4.45",
            "accelerate",
            "ctranslate2>=4.5",
            "faster-whisper>=1.1.0",
        ],
        &cache_dir,
    )?;
    if !deps_install_output.trim().is_empty() {
        info!(
            "[local.stt.runtime] deps install output={}",
            clip_text(&single_line(&deps_install_output), 260)
        );
    }

    run_local_stt_python_command(
        &venv_python,
        &["-c", "import nemo.collections.asr"],
        &cache_dir,
    )
    .map_err(|error| format!("Local STT runtime validation failed: {error}"))?;
    let cuda_available = local_stt_torch_cuda_available(&venv_python, &cache_dir).unwrap_or(false);
    info!(
        "[local.stt.runtime] install complete python={} cuda={}",
        clip_text(&venv_python, 220),
        cuda_available
    );
    stop_all_local_stt_bridge_daemons();
    if let Ok(mut guard) = local_stt_runtime_python_cache().lock() {
        *guard = Some(venv_python.clone());
    }
    if let Err(error) = write_local_stt_runtime_ready_marker(&runtime_dir) {
        warn!(
            "[local.stt.runtime] unable to persist runtime-ready marker: {}",
            clip_text(&single_line(&error), 260)
        );
    }

    Ok(venv_python)
}

pub(crate) fn warmup_local_stt_parakeet_model_blocking(
    app: &AppHandle,
    _python_path: &str,
    model: &str,
) -> Result<String, String> {
    let canonical_model = canonical_local_stt_model_id(model);
    let provider = infer_local_stt_provider_from_model(&canonical_model);
    if provider != "parakeet" {
        return Ok("Warmup skipped (non-Parakeet model).".to_string());
    }

    let repo_id = resolve_huggingface_repo_id(&provider, &canonical_model);
    let model_dir = stt_models_dir(app)?.join(sanitize_model_cache_dir_name(&repo_id));
    let model_root = find_local_parakeet_model_root(&model_dir)?;
    let model_cached = audio::parakeet::get_or_load_native_parakeet_runtime(&model_root)?;
    let device = "cpu";
    let precision = "int8";
    info!(
        "[local.stt.parakeet.native] warmup complete model={} repo={} cached={} device={} precision={}",
        clip_text(&canonical_model, 140),
        clip_text(&repo_id, 140),
        model_cached,
        clip_text(device, 40),
        clip_text(precision, 24)
    );

    Ok(format!(
        "Warmup ready (device={device}, precision={precision}, cached={model_cached})."
    ))
}

pub(crate) fn warmup_local_stt_hf_model_blocking(
    app: &AppHandle,
    python_path: &str,
    model: &str,
) -> Result<String, String> {
    let canonical_model = canonical_local_stt_model_id(model);
    let provider = infer_local_stt_provider_from_model(&canonical_model);
    if provider != "whisper" && provider != "moonshine" && provider != "sensevoice" {
        return Ok("Warmup skipped (non-HF-ASR model).".to_string());
    }

    let (repo_id, model_dir) = resolve_local_stt_repo_and_dir(app, &provider, &canonical_model)?;
    if !model_dir.exists() {
        return Err(format!(
            "Local STT model directory does not exist: {}",
            model_dir.display()
        ));
    }

    let script_path = ensure_local_stt_bridge_script(app)?;
    let cache_dir = stt_cache_dir(app)?;
    let payload = json!({
        "action": "warmup_hf_asr",
        "provider": provider.clone(),
        "modelId": canonical_model.clone(),
        "modelPath": model_dir.to_string_lossy().to_string(),
    });
    let result = run_local_stt_bridge_via_daemon(
        python_path,
        &script_path,
        &cache_dir,
        "warmup_hf_asr",
        &payload,
    )?;
    let model_cached = result
        .get("modelCached")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let device = result
        .get("device")
        .and_then(Value::as_str)
        .unwrap_or("cpu");
    info!(
        "[local.stt.hf] warmup complete model={} repo={} cached={} device={}",
        clip_text(&canonical_model, 140),
        clip_text(&repo_id, 140),
        model_cached,
        clip_text(device, 40)
    );

    Ok(format!(
        "Warmup ready (device={device}, cached={model_cached})."
    ))
}

pub(crate) fn open_path_in_file_explorer(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer");
        command.arg(path).spawn().map_err(|error| {
            format!(
                "Failed to open '{}' in File Explorer: {error}",
                path.display()
            )
        })?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open '{}': {error}", path.display()))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open '{}': {error}", path.display()))?;
        return Ok(());
    }
}

pub(crate) fn mime_to_extension(mime: &str) -> &'static str {
    let normalized = mime.to_ascii_lowercase();

    if normalized.contains("ogg") {
        return "ogg";
    }

    if normalized.contains("wav") {
        return "wav";
    }

    if normalized.contains("mp4") {
        return "m4a";
    }

    if normalized.contains("mpeg") || normalized.contains("mp3") {
        return "mp3";
    }

    "webm"
}
pub(crate) fn transcript_candidate_score(input: &str) -> usize {
    input.chars().filter(|ch| ch.is_alphanumeric()).count()
}
pub(crate) async fn transcribe_audio(
    client: &Client,
    api_key: &str,
    api_base_url: &str,
    stt_model: &str,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    language: Option<&str>,
    allowed_languages: Option<&[String]>,
) -> Result<String, String> {
    let normalized_allowed_languages = normalize_stt_allowed_languages(allowed_languages);
    let effective_language = normalize_stt_language_hint(language)
        .or_else(|| normalized_allowed_languages.first().cloned());
    let whisper_family = stt_model.trim().to_ascii_lowercase().contains("whisper");

    if whisper_family {
        let transcript = transcribe_audio_openai_compatible(
            client,
            Some(api_key),
            api_base_url,
            stt_model,
            audio_bytes,
            audio_mime_type,
            effective_language.as_deref(),
            "online",
        )
        .await?;

        let transcript_trimmed = transcript.trim();
        let looks_noisy = transcript_trimmed.is_empty()
            || looks_like_repetitive_transcript_noise(&transcript, effective_language.as_deref());
        if !looks_noisy || normalized_allowed_languages.len() <= 1 {
            return Ok(transcript_trimmed.to_string());
        }
    }

    if whisper_family && normalized_allowed_languages.len() > 1 {
        let mut best_transcript = String::new();
        let mut best_score = 0usize;
        let mut last_error = String::new();

        for candidate_language in &normalized_allowed_languages {
            match transcribe_audio_openai_compatible(
                client,
                Some(api_key),
                api_base_url,
                stt_model,
                audio_bytes,
                audio_mime_type,
                Some(candidate_language.as_str()),
                "online",
            )
            .await
            {
                Ok(transcript) => {
                    if transcript.trim().is_empty() {
                        continue;
                    }
                    if looks_like_repetitive_transcript_noise(
                        &transcript,
                        Some(candidate_language.as_str()),
                    ) {
                        continue;
                    }
                    let score = transcript_candidate_score(&transcript);
                    if score > best_score {
                        best_score = score;
                        best_transcript = transcript;
                    }
                }
                Err(error) => {
                    last_error = error;
                }
            }
        }

        if !best_transcript.trim().is_empty() {
            return Ok(best_transcript.trim().to_string());
        }
        if !last_error.is_empty() {
            return Err(last_error);
        }
    }

    transcribe_audio_openai_compatible(
        client,
        Some(api_key),
        api_base_url,
        stt_model,
        audio_bytes,
        audio_mime_type,
        effective_language.as_deref(),
        "online",
    )
    .await
}

pub(crate) async fn transcribe_audio_local(
    app: &AppHandle,
    _client: &Client,
    local: &LocalSttConfig,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    language: Option<&str>,
    allowed_languages: Option<&[String]>,
) -> Result<String, String> {
    let state = app.state::<AppState>();
    if !state.local_stt_runtime_loaded_snapshot()? {
        return Err(
            "Local STT runtime is unloaded. Use 'Load STT' in the left sidebar to enable local dictation."
                .to_string(),
        );
    }

    let provider = infer_local_stt_provider_from_model(&local.stt_model);
    if provider == "parakeet" {
        return transcribe_audio_local_parakeet(app, local, audio_bytes, audio_mime_type, language)
            .await;
    }
    if provider == "whisper" || provider == "moonshine" || provider == "sensevoice" {
        if zero_python_mode_enabled() {
            return Err(ZERO_PYTHON_STT_NOTICE.to_string());
        }
        return transcribe_audio_local_hf_asr(
            app,
            local,
            audio_bytes,
            audio_mime_type,
            language,
            allowed_languages,
        )
        .await;
    }
    Err("Unsupported local STT model/provider.".to_string())
}

pub(crate) async fn transcribe_audio_local_parakeet(
    app: &AppHandle,
    local: &LocalSttConfig,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    _language: Option<&str>,
) -> Result<String, String> {
    let model = canonical_local_stt_model_id(&local.stt_model);
    let provider = infer_local_stt_provider_from_model(&model);
    let repo_id = resolve_huggingface_repo_id(&provider, &model);
    let model_dir = stt_models_dir(app)?.join(sanitize_model_cache_dir_name(&repo_id));
    if !model_dir.exists() {
        return Err(format!(
            "Local Parakeet model is not downloaded yet. Download '{model}' first."
        ));
    }
    let model_root = find_local_parakeet_model_root(&model_dir)?;
    info!(
        "[local.stt.parakeet] model={} repo={} model_root={} bytes={}",
        clip_text(&model, 140),
        clip_text(&repo_id, 140),
        clip_text(&model_root.to_string_lossy(), 220),
        audio_bytes.len()
    );

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data dir for VAD: {error}"))?;
    let vad_model_path_str = {
        let state = app.state::<AppState>();
        let vad_path = vad::ensure_vad_model(&app_data_dir, &state.http).await?;
        vad_path.to_string_lossy().into_owned()
    };

    let model_root_for_worker = model_root.clone();
    let audio_bytes_for_worker = audio_bytes.to_vec();
    let audio_mime_type_for_worker = audio_mime_type.to_string();
    let native_result = tauri::async_runtime::spawn_blocking(move || {
        let (transcript, model_cached, unloaded_after_transcribe) =
            audio::parakeet::transcribe_local_stt_parakeet_native(
                &model_root_for_worker,
                &audio_bytes_for_worker,
                &audio_mime_type_for_worker,
                Some(vad_model_path_str),
            )?;
        info!(
            "[local.stt.parakeet.native] success transcript_chars={} model_cached={} device=cpu precision=int8 unloaded_after_transcribe={}",
            transcript.chars().count(),
            model_cached,
            unloaded_after_transcribe
        );
        Ok(transcript)
    })
    .await
    .map_err(|error| format!("Local STT worker failed: {error}"))?;

    native_result
}

pub(crate) async fn transcribe_audio_local_hf_asr(
    app: &AppHandle,
    local: &LocalSttConfig,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    language: Option<&str>,
    allowed_languages: Option<&[String]>,
) -> Result<String, String> {
    let model = canonical_local_stt_model_id(&local.stt_model);
    let provider = infer_local_stt_provider_from_model(&model);
    let allowed_language_hints = normalize_stt_allowed_languages(allowed_languages);
    let language_hint =
        normalize_stt_language_hint(language).or_else(|| allowed_language_hints.first().cloned());
    let (repo_id, model_dir) = resolve_local_stt_repo_and_dir(app, &provider, &model)?;
    if !model_dir.exists() {
        return Err(format!(
            "Local STT model is not downloaded yet. Download '{model}' first."
        ));
    }
    info!(
        "[local.stt.hf] model={} provider={} repo={} model_dir={} bytes={}",
        clip_text(&model, 140),
        clip_text(&provider, 40),
        clip_text(&repo_id, 140),
        clip_text(&model_dir.to_string_lossy(), 220),
        audio_bytes.len()
    );

    let runtime_dir = stt_runtime_dir(app)?;
    let stamp = now_unix_ms();
    let extension = mime_to_extension(audio_mime_type);
    let audio_path = runtime_dir.join(format!("local-stt-audio-{stamp}.{extension}"));
    fs::write(&audio_path, audio_bytes)
        .map_err(|error| format!("Failed to write local STT audio file: {error}"))?;

    let app_for_worker = app.clone();
    let provider_for_worker = provider.clone();
    let model_for_worker = model.clone();
    let model_dir_for_worker = model_dir.clone();
    let audio_path_for_worker = audio_path.clone();
    let language_hint_for_worker = language_hint.clone();
    let allowed_language_hints_for_worker = allowed_language_hints.clone();
    let bridge_result = tauri::async_runtime::spawn_blocking(move || {
        let python_path = setup_local_stt_runtime_blocking(&app_for_worker, "python")?;
        let script_path = ensure_local_stt_bridge_script(&app_for_worker)?;
        let cache_dir = stt_cache_dir(&app_for_worker)?;
        let payload = json!({
            "action": "transcribe_hf_asr",
            "provider": provider_for_worker,
            "modelId": model_for_worker,
            "language": language_hint_for_worker,
            "allowedLanguages": allowed_language_hints_for_worker,
            "modelPath": model_dir_for_worker.to_string_lossy().to_string(),
            "audioPath": audio_path_for_worker.to_string_lossy().to_string(),
        });
        let response = run_local_stt_bridge_via_daemon(
            &python_path,
            &script_path,
            &cache_dir,
            "transcribe_hf_asr",
            &payload,
        )?;
        let transcript = response
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string();
        if transcript.is_empty() {
            return Err("Local STT model returned an empty transcript.".to_string());
        }
        let model_cached = response
            .get("modelCached")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let device = response
            .get("device")
            .and_then(Value::as_str)
            .unwrap_or("cpu");
        info!(
            "[local.stt.hf] daemon success transcript_chars={} model_cached={} device={}",
            transcript.chars().count(),
            model_cached,
            clip_text(device, 40)
        );

        Ok(transcript)
    })
    .await
    .map_err(|error| format!("Local STT worker failed: {error}"))?;

    let _ = fs::remove_file(&audio_path);

    bridge_result
}

pub(crate) fn apply_optional_bearer_auth(
    builder: reqwest::RequestBuilder,
    api_key: Option<&str>,
) -> reqwest::RequestBuilder {
    if let Some(token) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
        builder.bearer_auth(token)
    } else {
        builder
    }
}

pub(crate) async fn transcribe_audio_openai_compatible(
    client: &Client,
    api_key: Option<&str>,
    api_base_url: &str,
    stt_model: &str,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    language: Option<&str>,
    source_label: &str,
) -> Result<String, String> {
    let request_start = Instant::now();
    let extension = mime_to_extension(audio_mime_type);
    let file_name = format!("recording.{extension}");

    let file_part = if audio_mime_type.is_empty() {
        multipart::Part::bytes(audio_bytes.to_vec()).file_name(file_name.clone())
    } else {
        multipart::Part::bytes(audio_bytes.to_vec())
            .file_name(file_name.clone())
            .mime_str(audio_mime_type)
            .unwrap_or_else(|_| multipart::Part::bytes(audio_bytes.to_vec()).file_name(file_name))
    };

    let mut form = multipart::Form::new()
        .text("model", stt_model.to_string())
        .part("file", file_part)
        .text("response_format", "json");

    if let Some(language) = language.map(str::trim).filter(|value| !value.is_empty()) {
        form = form.text("language", language.to_string());
    }

    let request_builder = client
        .post(format!("{api_base_url}/audio/transcriptions"))
        .multipart(form);
    let response = apply_optional_bearer_auth(request_builder, api_key)
        .send()
        .await
        .map_err(|error| format!("Failed to call {source_label} STT endpoint: {error}"))?;
    let response_headers_ms = elapsed_ms(request_start);

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("Failed to parse {source_label} STT response body: {error}"))?;
    let response_body_ms = elapsed_ms(request_start);

    info!(
        "[online.stt.http] source={} status={} bytes={} headers_ms={} total_ms={} model={} base_url={}",
        source_label,
        status,
        body.len(),
        response_headers_ms,
        response_body_ms,
        clip_text(stt_model, 120),
        clip_text(api_base_url, 180)
    );

    if !status.is_success() {
        return Err(format!(
            "{source_label} STT request failed ({status}): {}",
            clip_text(&single_line(&body), 420)
        ));
    }

    let payload: Value = serde_json::from_str(&body)
        .map_err(|error| format!("Invalid {source_label} STT JSON response: {error}"))?;

    let transcript = payload
        .get("text")
        .and_then(Value::as_str)
        .or_else(|| payload.get("transcript").and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string();

    Ok(transcript)
}

#[cfg(test)]
mod tests {
    use super::*;

#[test]
fn mime_to_extension_handles_common_types() {
    assert_eq!(mime_to_extension("audio/webm"), "webm");
    assert_eq!(mime_to_extension("audio/wav"), "wav");
    assert_eq!(mime_to_extension("audio/ogg"), "ogg");
    assert_eq!(mime_to_extension("audio/mp4"), "m4a");
    assert_eq!(mime_to_extension("audio/mpeg"), "mp3");
    assert_eq!(mime_to_extension("audio/mp3"), "mp3");
}

#[test]
fn mime_to_extension_defaults_to_webm() {
    assert_eq!(mime_to_extension("audio/unknown"), "webm");
    assert_eq!(mime_to_extension("application/octet-stream"), "webm");
}

// ===== SELECTION EDIT DECISION =====
}
