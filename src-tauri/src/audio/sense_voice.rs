//! In-process SenseVoice STT runtime.
//!
//! Replaces the Python bridge for SenseVoice: the FunASR ONNX encoder runs in this
//! process via `transcribe-rs`, so the multilingual path no longer needs a venv.

use std::path::{Path, PathBuf};

use log::info;

use transcribe_rs::engines::sense_voice::{
    Language, SenseVoiceEngine, SenseVoiceInferenceParams, SenseVoiceModelParams,
};
use transcribe_rs::TranscriptionEngine;

use crate::audio::in_process::{AsrEngineCache, InProcessEngine};

/// Files the engine loads from the directory it is given.
pub(crate) const SENSE_VOICE_REQUIRED_FILES: &[&str] = &["model.onnx", "tokens.txt"];

static SENSE_VOICE_CACHE: AsrEngineCache<SenseVoiceAsr> = AsrEngineCache::new();

/// Map a dictation language hint onto the engine's fixed language list.
///
/// Anything outside the five trained languages falls back to auto-detect rather than
/// silently transcribing as English.
pub(crate) fn sense_voice_language(hint: Option<&str>) -> Language {
    let normalized = hint
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-");
    let base = normalized.split('-').next().unwrap_or_default();
    match base {
        "zh" => Language::Chinese,
        "en" => Language::English,
        "ja" => Language::Japanese,
        "ko" => Language::Korean,
        "yue" | "cantonese" => Language::Cantonese,
        _ => Language::Auto,
    }
}

/// Locate the directory holding the SenseVoice ONNX file set.
pub(crate) fn sense_voice_model_root(model_dir: &Path) -> Result<PathBuf, String> {
    crate::audio::model_layout::find_directory_containing(model_dir, SENSE_VOICE_REQUIRED_FILES)
}

struct SenseVoiceAsr {
    engine: SenseVoiceEngine,
    language: Language,
}

impl SenseVoiceAsr {
    fn build(root: &Path, language: Language) -> Result<Self, String> {
        let mut engine = SenseVoiceEngine::new();
        // The published export is the fp32 `model.onnx`; there is no int8 sibling.
        engine
            .load_model_with_params(root, SenseVoiceModelParams::fp32())
            .map_err(|error| {
                format!(
                    "Failed to load SenseVoice model from '{}': {error}",
                    root.display()
                )
            })?;
        Ok(Self { engine, language })
    }
}

impl InProcessEngine for SenseVoiceAsr {
    fn unload(&mut self) {
        self.engine.unload_model();
    }

    fn transcribe(&mut self, samples: &[f32]) -> Result<String, String> {
        let params = SenseVoiceInferenceParams {
            language: self.language.clone(),
            use_itn: true,
        };
        let result = self
            .engine
            .transcribe_samples(samples.to_vec(), Some(params))
            .map_err(|error| format!("SenseVoice transcription failed: {error}"))?;
        Ok(result.text.trim().to_string())
    }
}

/// Transcribe with the resident SenseVoice model, loading it if needed.
///
/// Returns the transcript and whether the model was already resident.
pub(crate) fn transcribe_sense_voice(
    model: &str,
    model_dir: &Path,
    samples: &[f32],
    language: Option<&str>,
) -> Result<(String, bool), String> {
    let root = sense_voice_model_root(model_dir)?;
    let language = sense_voice_language(language);
    let model_cached = SENSE_VOICE_CACHE.get_or_load(model, &root, |root| {
        SenseVoiceAsr::build(root, language.clone())
    })?;
    let transcript = SENSE_VOICE_CACHE.transcribe(samples)?;
    if transcript.is_empty() {
        return Err("SenseVoice STT returned an empty transcript.".to_string());
    }
    info!(
        "[local.stt.sense_voice.native] success transcript_chars={} model_cached={} language={}",
        transcript.chars().count(),
        model_cached,
        language.as_label()
    );
    Ok((transcript, model_cached))
}

/// Whether a SenseVoice model is currently resident.
pub(crate) fn runtime_loaded() -> Option<bool> {
    SENSE_VOICE_CACHE.is_loaded()
}

/// Release the resident SenseVoice model.
pub(crate) fn unload_runtime() -> Result<bool, String> {
    SENSE_VOICE_CACHE.unload()
}

/// Release the resident SenseVoice model if it has been idle. Returns its key.
pub(crate) fn unload_idle_runtime(max_idle: std::time::Duration) -> Option<String> {
    SENSE_VOICE_CACHE.unload_if_idle(max_idle)
}

trait LanguageLabel {
    fn as_label(&self) -> &'static str;
}

impl LanguageLabel for Language {
    fn as_label(&self) -> &'static str {
        match self {
            Language::Auto => "auto",
            Language::Chinese => "zh",
            Language::English => "en",
            Language::Japanese => "ja",
            Language::Korean => "ko",
            Language::Cantonese => "yue",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_hints_map_onto_the_trained_set() {
        assert_eq!(sense_voice_language(Some("en")), Language::English);
        assert_eq!(sense_voice_language(Some("EN-US")), Language::English);
        assert_eq!(sense_voice_language(Some("zh-CN")), Language::Chinese);
        assert_eq!(sense_voice_language(Some("ja")), Language::Japanese);
        assert_eq!(sense_voice_language(Some("ko")), Language::Korean);
        assert_eq!(sense_voice_language(Some("yue")), Language::Cantonese);
    }

    #[test]
    fn untrained_languages_auto_detect_instead_of_forcing_english() {
        assert_eq!(sense_voice_language(Some("fr")), Language::Auto);
        assert_eq!(sense_voice_language(Some("de-DE")), Language::Auto);
        assert_eq!(sense_voice_language(None), Language::Auto);
        assert_eq!(sense_voice_language(Some("  ")), Language::Auto);
    }

    #[test]
    fn model_root_accepts_the_snapshot_root() {
        let dir =
            std::env::temp_dir().join(format!("slasshywispr-sensevoice-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for name in SENSE_VOICE_REQUIRED_FILES {
            std::fs::write(dir.join(name), b"x").unwrap();
        }

        assert_eq!(sense_voice_model_root(&dir).unwrap(), dir);
    }
}
