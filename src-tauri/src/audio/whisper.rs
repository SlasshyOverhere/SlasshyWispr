//! In-process Whisper STT runtime.
//!
//! Whisper is the last local model that needed the Python bridge, because `transcribe-rs`
//! hardcodes whisper-rs's Vulkan feature and its binding layer does not survive this
//! toolchain. `transcribe-cpp` wraps whisper.cpp directly, so Whisper now runs here too
//! and zero-Python mode covers every local model.
//!
//! The artifact differs from the other engines: whisper.cpp reads a single self-contained
//! GGUF, not a HuggingFace directory of safetensors.

use std::path::{Path, PathBuf};

use log::info;
use transcribe_cpp::{Model, RunOptions, Session};

use crate::audio::in_process::{AsrEngineCache, InProcessEngine};

/// Quantization downloaded by default, and preferred when several are on disk.
pub(crate) const WHISPER_QUANTIZATION: &str = "Q5_K_M";

static WHISPER_CACHE: AsrEngineCache<WhisperAsr> = AsrEngineCache::new();

/// Locate the GGUF file for a downloaded Whisper model.
pub(crate) fn whisper_model_file(model_dir: &Path) -> Result<PathBuf, String> {
    crate::audio::model_layout::find_file_with_extension(model_dir, "gguf", WHISPER_QUANTIZATION)
}

/// Whisper takes a two-letter ISO code; anything else means autodetect.
///
/// Region suffixes are dropped so `en-US` still selects English, and a hint the model was
/// never trained on is discarded rather than passed through as a wrong answer.
fn whisper_language_hint(raw: Option<&str>) -> Option<String> {
    let code = raw?.trim().to_ascii_lowercase();
    let code = code.split(['-', '_']).next()?.to_string();
    let known = [
        "en", "zh", "de", "es", "ru", "ko", "fr", "ja", "pt", "tr", "pl", "ca", "nl", "ar", "sv",
        "it", "id", "hi", "fi", "vi", "he", "uk", "el", "ms", "cs", "ro", "da", "hu", "ta", "no",
        "th", "ur", "hr", "bg", "lt", "la", "mi", "ml", "cy", "sk", "te", "fa", "lv", "bn", "sr",
        "az", "sl", "kn", "et", "mk", "br", "eu", "is", "hy", "ne", "mn", "bs", "kk", "sq", "sw",
        "gl", "mr", "pa", "si", "km", "sn", "yo", "so", "af", "oc", "ka", "be", "tg", "sd", "gu",
        "am", "yi", "lo", "uz", "fo", "ht", "ps", "tk", "nn", "mt", "sa", "lb", "my", "bo", "tl",
        "mg", "as", "tt", "haw", "ln", "ha", "ba", "jw", "su", "yue",
    ];
    known.contains(&code.as_str()).then_some(code)
}

struct WhisperAsr {
    /// A session keeps its model alive through an internal `Arc`, so this is the model
    /// handle too — dropping it is what releases the ggml context.
    session: Option<Session>,
    language: Option<String>,
}

impl WhisperAsr {
    fn build(path: &Path, language: Option<String>) -> Result<Self, String> {
        let model = Model::load(path).map_err(|error| {
            format!("Failed to load Whisper model '{}': {error}", path.display())
        })?;
        let session = model
            .session()
            .map_err(|error| format!("Failed to create a Whisper session: {error}"))?;
        Ok(Self {
            session: Some(session),
            language,
        })
    }
}

impl InProcessEngine for WhisperAsr {
    fn unload(&mut self) {
        self.session = None;
    }

    fn transcribe(&mut self, samples: &[f32]) -> Result<String, String> {
        let session = self
            .session
            .as_mut()
            .ok_or_else(|| "Whisper model is not loaded.".to_string())?;
        let options = RunOptions {
            language: self.language.clone(),
            ..Default::default()
        };
        let result = session
            .run(samples, &options)
            .map_err(|error| format!("Whisper transcription failed: {error}"))?;
        Ok(result.text.trim().to_string())
    }
}

/// Transcribe with the resident Whisper model, loading it if needed.
///
/// Returns the transcript and whether the model was already resident.
pub(crate) fn transcribe_whisper(
    model: &str,
    model_dir: &Path,
    samples: &[f32],
    language: Option<&str>,
) -> Result<(String, bool), String> {
    let path = whisper_model_file(model_dir)?;
    let language = whisper_language_hint(language);
    // The language is baked into the session, so it belongs in the key — otherwise
    // switching languages without switching models would keep serving the old one.
    let key = format!("{model}|{}", language.as_deref().unwrap_or("auto"));
    let model_cached = WHISPER_CACHE.get_or_load(&key, &path, |path| {
        WhisperAsr::build(path, language.clone())
    })?;
    let transcript = WHISPER_CACHE.transcribe(samples)?;
    if transcript.is_empty() {
        return Err("Whisper STT returned an empty transcript.".to_string());
    }
    info!(
        "[local.stt.whisper.native] success transcript_chars={} model_cached={} device=auto language={}",
        transcript.chars().count(),
        model_cached,
        language.as_deref().unwrap_or("auto")
    );
    Ok((transcript, model_cached))
}

/// Whether a Whisper model is currently resident.
pub(crate) fn runtime_loaded() -> Option<bool> {
    WHISPER_CACHE.is_loaded()
}

/// Release the resident Whisper model.
pub(crate) fn unload_runtime() -> Result<bool, String> {
    WHISPER_CACHE.unload()
}

/// Release the resident Whisper model if it has been idle. Returns its key.
pub(crate) fn unload_idle_runtime(max_idle: std::time::Duration) -> Option<String> {
    WHISPER_CACHE.unload_if_idle(max_idle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_hints_normalize_to_iso_codes() {
        assert_eq!(whisper_language_hint(Some("en")), Some("en".to_string()));
        assert_eq!(whisper_language_hint(Some("EN-US")), Some("en".to_string()));
        assert_eq!(whisper_language_hint(Some("zh_CN")), Some("zh".to_string()));
        assert_eq!(
            whisper_language_hint(Some("  Ja  ")),
            Some("ja".to_string())
        );
    }

    #[test]
    fn an_unusable_hint_becomes_autodetect_rather_than_a_wrong_answer() {
        assert_eq!(whisper_language_hint(None), None);
        assert_eq!(whisper_language_hint(Some("")), None);
        assert_eq!(whisper_language_hint(Some("auto")), None);
        assert_eq!(whisper_language_hint(Some("klingon")), None);
    }

    #[test]
    fn model_file_descends_to_the_gguf() {
        let dir = std::env::temp_dir().join(format!("slasshywispr-whisper-{}", std::process::id()));
        let nested = dir.join("snapshot");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("whisper-small-Q5_K_M.gguf"), b"x").unwrap();

        assert_eq!(
            whisper_model_file(&dir).unwrap(),
            nested.join("whisper-small-Q5_K_M.gguf")
        );
    }
}
