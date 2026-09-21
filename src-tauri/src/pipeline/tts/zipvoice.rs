//! Native zero-shot voice cloning (ZipVoice via sherpa-onnx).
//!
//! Replaces the Coqui/XTT-S Python bridge: the model runs in this process, so voice
//! cloning costs no interpreter, no venv and no torch.
//!
//! Two artifacts, not one: the ZipVoice archive (encoder + decoder + tokens + lexicon +
//! espeak-ng-data) and a separate Vocos vocoder. ZipVoice is *not* prompt-free like
//! XTT-S — it conditions on the reference clip **and its exact transcript**, so a voice
//! profile stores both.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use log::{info, warn};
use reqwest::Client;

use crate::audio::processing::{decode_wav_audio_to_mono_f32, encode_mono_f32_to_wav};
use crate::constants::*;
use crate::pipeline::fs::{
    download_file, extract_tar_bz2_archive, file_exists_with_content, find_file_by_name,
};
use crate::pipeline::log::{clip_text, single_line};

use super::normalize::validate_tts_input_length;

/// Cloned-voice settings as they arrive from the pipeline request.
#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceClonePipelineRequest {
    pub(crate) speaker_id: String,
    pub(crate) speed: Option<f32>,
}

/// The files ZipVoice needs, resolved once so the engine never re-searches the tree.
pub(crate) struct CloneAssets {
    pub(crate) encoder: PathBuf,
    pub(crate) decoder: PathBuf,
    pub(crate) tokens: PathBuf,
    pub(crate) data_dir: PathBuf,
    pub(crate) lexicon: PathBuf,
    pub(crate) vocoder: PathBuf,
}

impl CloneAssets {
    /// Identity of the loaded model; a change means the engine must be rebuilt.
    fn key(&self) -> String {
        self.decoder.to_string_lossy().into_owned()
    }
}

fn find_directory_by_name(root: &Path, target_name: &str) -> Result<Option<PathBuf>, String> {
    if !root.exists() {
        return Ok(None);
    }

    let entries = fs::read_dir(root)
        .map_err(|error| format!("Failed to read directory '{}': {error}", root.display()))?;
    let mut subdirectories = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read directory entry: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.file_name().and_then(|name| name.to_str()) == Some(target_name) {
            return Ok(Some(path));
        }
        subdirectories.push(path);
    }

    for subdirectory in subdirectories {
        if let Some(found) = find_directory_by_name(&subdirectory, target_name)? {
            return Ok(Some(found));
        }
    }

    Ok(None)
}

/// Locate every ZipVoice file under `models_dir`, or `None` while any is missing.
fn discover_assets(models_dir: &Path) -> Result<Option<CloneAssets>, String> {
    let Some(encoder) = find_file_by_name(models_dir, "encoder.int8.onnx")? else {
        return Ok(None);
    };
    let Some(decoder) = find_file_by_name(models_dir, "decoder.int8.onnx")? else {
        return Ok(None);
    };
    let Some(tokens) = find_file_by_name(models_dir, "tokens.txt")? else {
        return Ok(None);
    };
    let Some(lexicon) = find_file_by_name(models_dir, "lexicon.txt")? else {
        return Ok(None);
    };
    let Some(data_dir) = find_directory_by_name(models_dir, "espeak-ng-data")? else {
        return Ok(None);
    };

    let vocoder = models_dir.join(VOICE_CLONE_VOCODER_FILE);
    if !file_exists_with_content(&vocoder) {
        return Ok(None);
    }

    Ok(Some(CloneAssets {
        encoder,
        decoder,
        tokens,
        data_dir,
        lexicon,
        vocoder,
    }))
}

/// Assets already on disk, or `None`. Never downloads — dictation must not start a
/// 150 MB fetch mid-utterance.
pub(crate) fn load_clone_assets(models_dir: &Path) -> Result<Option<CloneAssets>, String> {
    discover_assets(models_dir)
}

/// Cheap presence check for status polling: never downloads, never loads the engine.
pub(crate) fn assets_present(models_dir: &Path) -> Result<bool, String> {
    Ok(discover_assets(models_dir)?.is_some())
}

/// Download and unpack both artifacts if they are not already on disk.
pub(crate) async fn ensure_clone_assets(
    models_dir: &Path,
    client: &Client,
) -> Result<CloneAssets, String> {
    fs::create_dir_all(models_dir)
        .map_err(|error| format!("Failed to create voice-clone model directory: {error}"))?;

    if let Some(assets) = discover_assets(models_dir)? {
        return Ok(assets);
    }

    let archive_path = models_dir.join(VOICE_CLONE_ARCHIVE_FILE);
    info!("[zipvoice] downloading model archive");
    download_file(client, VOICE_CLONE_ARCHIVE_URL, &archive_path).await?;
    extract_tar_bz2_archive(&archive_path, models_dir)?;
    let _ = fs::remove_file(&archive_path);

    let vocoder = models_dir.join(VOICE_CLONE_VOCODER_FILE);
    if !file_exists_with_content(&vocoder) {
        info!("[zipvoice] downloading vocoder");
        download_file(client, VOICE_CLONE_VOCODER_URL, &vocoder).await?;
    }

    let assets = discover_assets(models_dir)?.ok_or_else(|| {
        "Voice-clone model files were downloaded but could not be located on disk.".to_string()
    })?;

    info!(
        "[zipvoice] assets ready decoder={}",
        clip_text(&assets.decoder.to_string_lossy(), 200)
    );

    Ok(assets)
}

/// One stored voice profile: the reference clip plus the transcript it was read from.
pub(crate) fn save_voice_profile(
    voice_dir: &Path,
    samples: &[f32],
    sample_rate: u32,
    reference_text: &str,
) -> Result<(), String> {
    fs::create_dir_all(voice_dir)
        .map_err(|error| format!("Failed to create voice profile directory: {error}"))?;

    let wav = encode_mono_f32_to_wav(samples, sample_rate)?;
    fs::write(voice_dir.join(VOICE_CLONE_REFERENCE_AUDIO_FILE), wav)
        .map_err(|error| format!("Failed to store reference audio: {error}"))?;

    let mut text_file = fs::File::create(voice_dir.join(VOICE_CLONE_REFERENCE_TEXT_FILE))
        .map_err(|error| format!("Failed to store reference transcript: {error}"))?;
    text_file
        .write_all(reference_text.trim().as_bytes())
        .map_err(|error| format!("Failed to write reference transcript: {error}"))?;

    Ok(())
}

/// Reference audio + transcript for a stored profile.
pub(crate) fn read_voice_profile(voice_dir: &Path) -> Result<(Vec<f32>, u32, String), String> {
    let audio_path = voice_dir.join(VOICE_CLONE_REFERENCE_AUDIO_FILE);
    let text_path = voice_dir.join(VOICE_CLONE_REFERENCE_TEXT_FILE);

    let audio_bytes = fs::read(&audio_path).map_err(|error| {
        format!(
            "Voice profile is missing its reference audio ({}): {error}",
            audio_path.display()
        )
    })?;
    let (samples, sample_rate) = decode_wav_audio_to_mono_f32(&audio_bytes)?;

    let reference_text = fs::read_to_string(&text_path).map_err(|error| {
        format!(
            "Voice profile is missing its reference transcript ({}): {error}",
            text_path.display()
        )
    })?;

    Ok((samples, sample_rate, reference_text))
}

/// Voice profiles on disk, newest-first order left to the filesystem.
pub(crate) fn list_voice_profiles(voices_dir: &Path) -> Result<Vec<String>, String> {
    if !voices_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(voices_dir)
        .map_err(|error| format!("Failed to read voice directory: {error}"))?;
    let mut voices = Vec::new();

    for entry in entries {
        let entry =
            entry.map_err(|error| format!("Failed to read voice directory entry: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if !file_exists_with_content(&path.join(VOICE_CLONE_REFERENCE_AUDIO_FILE)) {
            continue;
        }
        if let Some(name) = path.file_name().and_then(|value| value.to_str()) {
            voices.push(name.to_string());
        }
    }

    voices.sort();
    Ok(voices)
}

pub(crate) fn delete_voice_profile(voice_dir: &Path) -> Result<(), String> {
    if !voice_dir.exists() {
        return Ok(());
    }
    fs::remove_dir_all(voice_dir)
        .map_err(|error| format!("Failed to delete voice profile: {error}"))
}

/// Reject a clone request whose reference audio is longer than the model is tuned for.
pub(crate) fn validate_reference_duration(samples: &[f32], sample_rate: u32) -> Result<(), String> {
    if samples.is_empty() {
        return Err("The reference clip contained no audio.".to_string());
    }

    let seconds = samples.len() as f32 / sample_rate.max(1) as f32;
    if seconds > VOICE_CLONE_MAX_REFERENCE_SECONDS {
        return Err(format!(
            "The reference clip is {seconds:.1} seconds; keep it under {} seconds for a clean clone.",
            VOICE_CLONE_MAX_REFERENCE_SECONDS as i64
        ));
    }

    Ok(())
}

#[cfg(all(windows, target_arch = "x86_64"))]
mod engine {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    use sherpa_onnx::{
        GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsModelConfig,
        OfflineTtsZipvoiceModelConfig,
    };

    struct Loaded {
        key: String,
        tts: OfflineTts,
    }

    // Loading the model costs seconds and ~200 MB of resident memory, so the engine is
    // built once and reused; `unload_engine` is the explicit release.
    static ENGINE: OnceLock<Mutex<Option<Loaded>>> = OnceLock::new();

    fn slot() -> &'static Mutex<Option<Loaded>> {
        ENGINE.get_or_init(|| Mutex::new(None))
    }

    fn build(assets: &CloneAssets) -> Result<OfflineTts, String> {
        let config = OfflineTtsConfig {
            model: OfflineTtsModelConfig {
                zipvoice: OfflineTtsZipvoiceModelConfig {
                    tokens: Some(assets.tokens.to_string_lossy().into_owned()),
                    encoder: Some(assets.encoder.to_string_lossy().into_owned()),
                    decoder: Some(assets.decoder.to_string_lossy().into_owned()),
                    vocoder: Some(assets.vocoder.to_string_lossy().into_owned()),
                    data_dir: Some(assets.data_dir.to_string_lossy().into_owned()),
                    lexicon: Some(assets.lexicon.to_string_lossy().into_owned()),
                    ..Default::default()
                },
                // CPU is deliberate: GPU would need DirectML.dll shipped alongside, and
                // the measured CPU cost is already about real time.
                provider: Some("cpu".to_string()),
                num_threads: std::thread::available_parallelism()
                    .map(|count| count.get().min(4) as i32)
                    .unwrap_or(2),
                debug: false,
                ..Default::default()
            },
            ..Default::default()
        };

        OfflineTts::create(&config).ok_or_else(|| {
            format!(
                "Failed to load the voice-clone model from '{}'.",
                assets.decoder.display()
            )
        })
    }

    pub(crate) fn engine_loaded() -> bool {
        let guard = slot()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        guard.is_some()
    }

    /// Drop the engine and release its memory. The next synthesis reloads it.
    pub(crate) fn unload_engine() {
        let mut guard = slot()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.take().is_some() {
            info!("[zipvoice] engine unloaded");
        }
    }

    /// Synthesise `text` in the reference voice. The engine lock is held across
    /// generation, which also serialises concurrent requests.
    pub(crate) fn synthesize(
        assets: &CloneAssets,
        samples: &[f32],
        sample_rate: u32,
        reference_text: &str,
        text: &str,
        speed: f32,
    ) -> Result<Vec<u8>, String> {
        let key = assets.key();
        let mut guard = slot()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let stale = guard
            .as_ref()
            .map(|loaded| loaded.key != key)
            .unwrap_or(true);
        if stale {
            if guard.is_some() {
                info!("[zipvoice] model changed on disk; reloading engine");
            }
            let tts = build(assets)?;
            info!("[zipvoice] engine loaded sample_rate={}", tts.sample_rate());
            *guard = Some(Loaded { key, tts });
        }

        let loaded = guard
            .as_ref()
            .ok_or_else(|| "Voice-clone engine is not loaded.".to_string())?;

        let generation = GenerationConfig {
            speed: speed.clamp(0.5, 2.0),
            reference_audio: Some(samples.to_vec()),
            reference_sample_rate: sample_rate as i32,
            reference_text: Some(reference_text.to_string()),
            num_steps: VOICE_CLONE_NUM_STEPS,
            ..Default::default()
        };

        let audio = loaded
            .tts
            .generate_with_config(text, &generation, None::<fn(&[f32], f32) -> bool>)
            .ok_or_else(|| "Voice-clone synthesis returned no audio.".to_string())?;

        encode_mono_f32_to_wav(audio.samples(), audio.sample_rate().max(1) as u32)
    }
}

#[cfg(not(all(windows, target_arch = "x86_64")))]
mod engine {
    use super::*;

    pub(crate) fn engine_loaded() -> bool {
        false
    }

    pub(crate) fn unload_engine() {}

    pub(crate) fn synthesize(
        _assets: &CloneAssets,
        _samples: &[f32],
        _sample_rate: u32,
        _reference_text: &str,
        _text: &str,
        _speed: f32,
    ) -> Result<Vec<u8>, String> {
        Err("Voice cloning is implemented for Windows x86_64 in this build.".to_string())
    }
}

pub(crate) use engine::{engine_loaded, synthesize, unload_engine};

/// Synthesise `text` in the voice stored at `voice_dir`.
pub(crate) fn synthesize_cloned(
    assets: &CloneAssets,
    voice_dir: &Path,
    text: &str,
    speed: f32,
) -> Result<Vec<u8>, String> {
    let clean_text = text.replace('\r', " ").trim().to_string();
    if clean_text.is_empty() {
        return Err("No text provided for TTS".to_string());
    }
    validate_tts_input_length(&clean_text)?;

    let (samples, sample_rate, reference_text) = read_voice_profile(voice_dir)?;
    if reference_text.trim().is_empty() {
        return Err(
            "This voice profile has no reference transcript; re-clone it with the sentence you read."
                .to_string(),
        );
    }

    let started = std::time::Instant::now();
    let wav = synthesize(
        assets,
        &samples,
        sample_rate,
        reference_text.trim(),
        &clean_text,
        speed,
    );
    match &wav {
        Ok(bytes) => info!(
            "[zipvoice.synthesize] success bytes={} latency_ms={}",
            bytes.len(),
            started.elapsed().as_millis()
        ),
        Err(error) => warn!(
            "[zipvoice.synthesize] failed: {}",
            clip_text(&single_line(error), 300)
        ),
    }

    wav
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("zipvoice-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn discover_assets_requires_every_file() {
        let dir = temp_dir("discover");
        assert!(discover_assets(&dir).expect("scan").is_none());

        fs::write(dir.join("encoder.int8.onnx"), b"x").expect("encoder");
        assert!(discover_assets(&dir).expect("scan").is_none());

        fs::write(dir.join("decoder.int8.onnx"), b"x").expect("decoder");
        fs::write(dir.join("tokens.txt"), b"x").expect("tokens");
        fs::write(dir.join("lexicon.txt"), b"x").expect("lexicon");
        fs::create_dir_all(dir.join("espeak-ng-data")).expect("data dir");
        assert!(discover_assets(&dir).expect("scan").is_none());

        fs::write(dir.join(VOICE_CLONE_VOCODER_FILE), b"x").expect("vocoder");
        let assets = discover_assets(&dir).expect("scan").expect("assets");
        assert_eq!(assets.data_dir, dir.join("espeak-ng-data"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn discover_assets_finds_nested_archive_layout() {
        let dir = temp_dir("nested");
        let nested = dir.join("sherpa-onnx-zipvoice-distill-int8-zh-en-emilia");
        fs::create_dir_all(nested.join("espeak-ng-data")).expect("data dir");
        fs::write(nested.join("encoder.int8.onnx"), b"x").expect("encoder");
        fs::write(nested.join("decoder.int8.onnx"), b"x").expect("decoder");
        fs::write(nested.join("tokens.txt"), b"x").expect("tokens");
        fs::write(nested.join("lexicon.txt"), b"x").expect("lexicon");
        fs::write(dir.join(VOICE_CLONE_VOCODER_FILE), b"x").expect("vocoder");

        let assets = discover_assets(&dir).expect("scan").expect("assets");
        assert_eq!(assets.encoder, nested.join("encoder.int8.onnx"));
        assert_eq!(assets.data_dir, nested.join("espeak-ng-data"));
        assert_eq!(assets.vocoder, dir.join(VOICE_CLONE_VOCODER_FILE));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn voice_profile_round_trips_samples_and_transcript() {
        let dir = temp_dir("profile");
        let samples = vec![0.0_f32, 0.25, -0.5, 0.75];
        save_voice_profile(&dir, &samples, 16_000, "  hello there  ").expect("save");

        let (read_back, rate, text) = read_voice_profile(&dir).expect("read");
        assert_eq!(rate, 16_000);
        assert_eq!(text, "hello there");
        assert_eq!(read_back.len(), samples.len());
        for (left, right) in read_back.iter().zip(samples.iter()) {
            assert!((left - right).abs() < 0.001, "{left} vs {right}");
        }

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn voice_profile_without_transcript_is_an_error() {
        let dir = temp_dir("no-text");
        save_voice_profile(&dir, &[0.1_f32; 32], 16_000, "hi").expect("save");
        fs::remove_file(dir.join(VOICE_CLONE_REFERENCE_TEXT_FILE)).expect("remove text");

        assert!(read_voice_profile(&dir).is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn list_voice_profiles_ignores_incomplete_directories() {
        let dir = temp_dir("list");
        save_voice_profile(&dir.join("alpha"), &[0.1_f32; 32], 16_000, "hi").expect("alpha");
        fs::create_dir_all(dir.join("beta")).expect("beta");

        assert_eq!(
            list_voice_profiles(&dir).expect("list"),
            vec!["alpha".to_string()]
        );

        delete_voice_profile(&dir.join("alpha")).expect("delete");
        assert!(list_voice_profiles(&dir).expect("list").is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reference_duration_is_capped() {
        let one_second = vec![0.0_f32; 16_000];
        assert!(validate_reference_duration(&one_second, 16_000).is_ok());
        assert!(validate_reference_duration(&[], 16_000).is_err());

        let too_long = vec![0.0_f32; (VOICE_CLONE_MAX_REFERENCE_SECONDS as usize + 1) * 16_000];
        assert!(validate_reference_duration(&too_long, 16_000).is_err());
    }

    #[test]
    fn synthesized_text_is_rejected_before_the_engine_is_touched() {
        // No assets are needed: the text guards run first, so this stays a pure unit test.
        let assets = CloneAssets {
            encoder: PathBuf::new(),
            decoder: PathBuf::new(),
            tokens: PathBuf::new(),
            data_dir: PathBuf::new(),
            lexicon: PathBuf::new(),
            vocoder: PathBuf::new(),
        };
        let dir = temp_dir("empty-text");

        assert!(synthesize_cloned(&assets, &dir, "   ", 1.0).is_err());

        let _ = fs::remove_dir_all(&dir);
    }
}
