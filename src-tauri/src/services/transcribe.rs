//! STT transcription runtime — Phase 7a service extraction.
//!
//! Moved verbatim from lib.rs: online dispatch, local parakeet/HF paths,
//! OpenAI-compatible upload, plus mime/score helpers. commands/pipeline
//! calls transcribe_audio + transcribe_audio_local through here.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use log::info;
use reqwest::{multipart, Client};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::audio;
use crate::audio::vad;
use crate::pipeline::log::{clip_text, single_line};
use crate::pipeline::process::{apply_no_window, elapsed_ms};
use crate::pipeline::routing::{
    canonical_local_stt_model_id, infer_local_stt_provider_from_model, LocalSttConfig,
};
use crate::pipeline::stt::{
    looks_like_repetitive_transcript_noise, normalize_stt_allowed_languages,
    normalize_stt_language_hint,
};
use crate::pipeline::stt_download::archive::find_local_parakeet_model_root;
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
pub(crate) fn warmup_local_stt_parakeet_model_blocking(
    app: &AppHandle,
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
        Ok(())
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

/// Ceiling for one online transcription. The shared HTTP client's 150s default
/// is sized for model downloads, so STT bounds its own requests.
pub(crate) const STT_TIMEOUT_DEFAULT: Duration = Duration::from_secs(60);
pub(crate) const STT_TIMEOUT_MIN_SECS: u64 = 10;
pub(crate) const STT_TIMEOUT_MAX_SECS: u64 = 600;

/// Clamp a user-set timeout. A bad setting must not be able to make every
/// transcription fail instantly or hold the pipeline for hours.
pub(crate) fn resolve_stt_timeout(requested_secs: Option<u64>) -> Duration {
    match requested_secs {
        Some(secs) => Duration::from_secs(secs.clamp(STT_TIMEOUT_MIN_SECS, STT_TIMEOUT_MAX_SECS)),
        None => STT_TIMEOUT_DEFAULT,
    }
}

/// One transcription request against an OpenAI-compatible STT endpoint.
///
/// Required inputs are named in [`SttRequest::new`] and every other option
/// starts at a default, so adding one (timeouts, vocabulary hints, diarization)
/// only needs a default here and a setter below — existing call sites keep
/// working untouched.
#[derive(Clone, Copy)]
pub(crate) struct SttRequest<'a> {
    api_key: Option<&'a str>,
    api_base_url: &'a str,
    stt_model: &'a str,
    audio_bytes: &'a [u8],
    audio_mime_type: &'a str,
    language: Option<&'a str>,
    /// Identifies the caller in logs and error messages. Required rather than
    /// defaulted: a wrong label misattributes every log line downstream.
    source_label: &'a str,
    timeout: Duration,
}

impl<'a> SttRequest<'a> {
    pub(crate) fn new(
        api_base_url: &'a str,
        stt_model: &'a str,
        audio_bytes: &'a [u8],
        source_label: &'a str,
    ) -> Self {
        Self {
            api_key: None,
            api_base_url,
            stt_model,
            audio_bytes,
            audio_mime_type: "",
            language: None,
            source_label,
            timeout: STT_TIMEOUT_DEFAULT,
        }
    }

    pub(crate) fn api_key(self, api_key: Option<&'a str>) -> Self {
        Self { api_key, ..self }
    }

    /// An empty MIME type sends the audio with no Content-Type, leaving the
    /// endpoint to infer the format from the file name.
    pub(crate) fn audio_mime_type(self, audio_mime_type: &'a str) -> Self {
        Self {
            audio_mime_type,
            ..self
        }
    }

    /// Retargets a copy of the request, which is how the multi-language retry
    /// loop drives one language per attempt.
    pub(crate) fn language(self, language: Option<&'a str>) -> Self {
        Self { language, ..self }
    }

    /// Per-request ceiling for this transcription.
    pub(crate) fn timeout(self, timeout: Duration) -> Self {
        Self { timeout, ..self }
    }
}

pub(crate) async fn transcribe_audio(
    client: &Client,
    request: SttRequest<'_>,
    allowed_languages: Option<&[String]>,
) -> Result<String, String> {
    let normalized_allowed_languages = normalize_stt_allowed_languages(allowed_languages);
    let effective_language = normalize_stt_language_hint(request.language)
        .or_else(|| normalized_allowed_languages.first().cloned());
    let whisper_family = request
        .stt_model
        .trim()
        .to_ascii_lowercase()
        .contains("whisper");

    if whisper_family {
        let transcript = transcribe_audio_openai_compatible(
            client,
            request.language(effective_language.as_deref()),
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
                request.language(Some(candidate_language.as_str())),
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

    transcribe_audio_openai_compatible(client, request.language(effective_language.as_deref()))
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
    if matches!(provider.as_str(), "whisper" | "moonshine" | "sensevoice") {
        // Resolved once, the same way for every engine.
        let language_hint = normalize_stt_language_hint(language).or_else(|| {
            normalize_stt_allowed_languages(allowed_languages)
                .first()
                .cloned()
        });
        // Every local model is native, so a failure here is the answer rather than a
        // reason to reach for the Python bridge that used to serve these providers.
        return transcribe_audio_local_in_process(
            app,
            &provider,
            local,
            audio_bytes,
            audio_mime_type,
            language_hint.as_deref(),
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

/// Transcribe through an in-process engine, so no Python runtime is involved.
///
/// The model directory is the download target for the resolved repo, and each engine
/// finds its own file set inside it — a snapshot keeps the repo's nesting, so the
/// directory the engine is handed is rarely the snapshot root.
async fn transcribe_audio_local_in_process(
    app: &AppHandle,
    provider: &str,
    local: &LocalSttConfig,
    audio_bytes: &[u8],
    audio_mime_type: &str,
    language: Option<&str>,
) -> Result<String, String> {
    let model = canonical_local_stt_model_id(&local.stt_model);
    let repo_id = resolve_huggingface_repo_id(provider, &model);
    let model_dir = stt_models_dir(app)?.join(sanitize_model_cache_dir_name(&repo_id));
    if !model_dir.exists() {
        return Err(format!(
            "Local STT model is not downloaded yet. Download '{model}' first."
        ));
    }

    let samples =
        audio::processing::decode_local_stt_audio_to_mono_f32(audio_bytes, audio_mime_type)?;
    let provider = provider.to_string();
    let language = language.map(str::to_string);

    tauri::async_runtime::spawn_blocking(move || {
        let result = match provider.as_str() {
            "moonshine" => audio::moonshine::transcribe_moonshine(&model, &model_dir, &samples),
            "sensevoice" => audio::sense_voice::transcribe_sense_voice(
                &model,
                &model_dir,
                &samples,
                language.as_deref(),
            ),
            "whisper" => {
                #[cfg(all(windows, target_arch = "x86_64"))]
                {
                    audio::whisper::transcribe_whisper(
                        &model,
                        &model_dir,
                        &samples,
                        language.as_deref(),
                    )
                }
                #[cfg(not(all(windows, target_arch = "x86_64")))]
                {
                    Err("Whisper's native engine is only built for Windows x86_64.".to_string())
                }
            }
            other => Err(format!(
                "Unsupported in-process local STT provider '{other}'."
            )),
        }?;
        Ok::<String, String>(result.0)
    })
    .await
    .map_err(|error| format!("Local STT worker failed: {error}"))?
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
    request: SttRequest<'_>,
) -> Result<String, String> {
    let SttRequest {
        api_key,
        api_base_url,
        stt_model,
        audio_bytes,
        audio_mime_type,
        language,
        source_label,
        timeout,
    } = request;
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

    // F-010: a hung transcription must not hold the pipeline (and the mic
    // indicator) open on the shared client's 150s model-download default.
    let request_builder = client
        .post(format!("{api_base_url}/audio/transcriptions"))
        .timeout(timeout)
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
    fn stt_request_new_leaves_the_optional_inputs_at_their_defaults() {
        let audio = [1u8, 2, 3];
        let request = SttRequest::new("https://example.test/v1", "whisper-1", &audio, "online");
        assert_eq!(request.api_key, None);
        // Empty means "send no Content-Type", not "send an empty one".
        assert_eq!(request.audio_mime_type, "");
        assert_eq!(request.language, None);
        assert_eq!(request.source_label, "online");
        assert_eq!(request.audio_bytes, &audio[..]);
    }

    #[test]
    fn stt_request_new_bounds_the_request_by_default() {
        let audio = [0u8];
        let request = SttRequest::new("https://example.test/v1", "whisper-1", &audio, "online");
        assert_eq!(request.timeout, STT_TIMEOUT_DEFAULT);
    }

    #[test]
    fn resolve_stt_timeout_falls_back_to_the_default() {
        assert_eq!(resolve_stt_timeout(None), STT_TIMEOUT_DEFAULT);
    }

    #[test]
    fn resolve_stt_timeout_clamps_a_bad_setting_into_range() {
        // Zero would abort every request instantly; a day would hold the mic
        // indicator open until the app restarts.
        assert_eq!(resolve_stt_timeout(Some(0)), Duration::from_secs(10));
        assert_eq!(resolve_stt_timeout(Some(1)), Duration::from_secs(10));
        assert_eq!(resolve_stt_timeout(Some(86_400)), Duration::from_secs(600));
        assert_eq!(resolve_stt_timeout(Some(45)), Duration::from_secs(45));
        assert_eq!(resolve_stt_timeout(Some(600)), Duration::from_secs(600));
    }

    #[test]
    fn stt_request_setters_retarget_a_copy() {
        let audio = [0u8];
        let base = SttRequest::new("https://example.test/v1", "whisper-1", &audio, "online");
        let retargeted = base
            .language(Some("fr"))
            .api_key(Some("secret"))
            .audio_mime_type("audio/wav");

        // The retry loop reuses one request across attempts, so a retarget must
        // not mutate the request it came from.
        assert_eq!(base.language, None);
        assert_eq!(base.api_key, None);
        assert_eq!(base.audio_mime_type, "");
        assert_eq!(retargeted.language, Some("fr"));
        assert_eq!(retargeted.api_key, Some("secret"));
        assert_eq!(retargeted.audio_mime_type, "audio/wav");

        // A per-request timeout is an override on the copy, not on the source.
        let impatient = base.timeout(Duration::from_secs(15));
        assert_eq!(base.timeout, STT_TIMEOUT_DEFAULT);
        assert_eq!(impatient.timeout, Duration::from_secs(15));
    }

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
