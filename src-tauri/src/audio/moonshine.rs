//! In-process Moonshine STT runtime.
//!
//! Replaces the Python bridge for Moonshine: the ONNX encoder/decoder pair runs in
//! this process via `transcribe-rs`, so no venv is involved and the model stays
//! resident between dictations.

use std::path::{Path, PathBuf};

use log::info;

use transcribe_rs::engines::moonshine::{
    ModelVariant, MoonshineEngine, MoonshineInferenceParams, MoonshineModelParams,
};
use transcribe_rs::TranscriptionEngine;

use crate::audio::in_process::{AsrEngineCache, InProcessEngine};

/// Files the engine loads from the directory it is given.
pub(crate) const MOONSHINE_REQUIRED_FILES: &[&str] = &[
    "encoder_model.onnx",
    "decoder_model_merged.onnx",
    "tokenizer.json",
];

static MOONSHINE_CACHE: AsrEngineCache<MoonshineAsr> = AsrEngineCache::new();

/// Which architecture a model id refers to.
///
/// The engine needs this to size the decoder; getting it wrong loads the file and
/// then decodes nonsense, so an unknown id is an error rather than a default.
pub(crate) fn moonshine_variant_for_model(model: &str) -> Result<ModelVariant, String> {
    let normalized = model.trim().to_ascii_lowercase();
    if normalized.contains("moonshine-tiny") {
        return Ok(ModelVariant::Tiny);
    }
    if normalized.contains("moonshine-base") {
        return Ok(ModelVariant::Base);
    }
    Err(format!(
        "Unsupported Moonshine model '{model}'. Supported variants: moonshine-tiny, moonshine-base."
    ))
}

/// Locate the directory holding the Moonshine ONNX file set.
pub(crate) fn moonshine_model_root(model_dir: &Path) -> Result<PathBuf, String> {
    crate::audio::model_layout::find_directory_containing(model_dir, MOONSHINE_REQUIRED_FILES)
}

struct MoonshineAsr {
    engine: MoonshineEngine,
}

impl MoonshineAsr {
    fn build(root: &Path, variant: ModelVariant) -> Result<Self, String> {
        let mut engine = MoonshineEngine::new();
        engine
            .load_model_with_params(root, MoonshineModelParams::variant(variant))
            .map_err(|error| {
                format!(
                    "Failed to load Moonshine model from '{}': {error}",
                    root.display()
                )
            })?;
        Ok(Self { engine })
    }
}

impl InProcessEngine for MoonshineAsr {
    fn unload(&mut self) {
        self.engine.unload_model();
    }

    fn transcribe(&mut self, samples: &[f32]) -> Result<String, String> {
        let result = self
            .engine
            .transcribe_samples(samples.to_vec(), Some(MoonshineInferenceParams::default()))
            .map_err(|error| format!("Moonshine transcription failed: {error}"))?;
        Ok(result.text.trim().to_string())
    }
}

/// Transcribe with the resident Moonshine model, loading it if needed.
///
/// Returns the transcript and whether the model was already resident.
pub(crate) fn transcribe_moonshine(
    model: &str,
    model_dir: &Path,
    samples: &[f32],
) -> Result<(String, bool), String> {
    let variant = moonshine_variant_for_model(model)?;
    let root = moonshine_model_root(model_dir)?;
    let model_cached =
        MOONSHINE_CACHE.get_or_load(model, &root, |root| MoonshineAsr::build(root, variant))?;
    let transcript = MOONSHINE_CACHE.transcribe(samples)?;
    if transcript.is_empty() {
        return Err("Moonshine STT returned an empty transcript.".to_string());
    }
    info!(
        "[local.stt.moonshine.native] success transcript_chars={} model_cached={} device=cpu",
        transcript.chars().count(),
        model_cached
    );
    Ok((transcript, model_cached))
}

/// Whether a Moonshine model is currently resident.
pub(crate) fn runtime_loaded() -> Option<bool> {
    MOONSHINE_CACHE.is_loaded()
}

/// Release the resident Moonshine model.
pub(crate) fn unload_runtime() -> Result<bool, String> {
    MOONSHINE_CACHE.unload()
}

/// Release the resident Moonshine model if it has been idle. Returns its key.
pub(crate) fn unload_idle_runtime(max_idle: std::time::Duration) -> Option<String> {
    MOONSHINE_CACHE.unload_if_idle(max_idle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn variant_maps_known_moonshine_families() {
        assert_eq!(
            moonshine_variant_for_model("UsefulSensors/moonshine-tiny"),
            Ok(ModelVariant::Tiny)
        );
        assert_eq!(
            moonshine_variant_for_model("onnx-community/moonshine-base-ONNX"),
            Ok(ModelVariant::Base)
        );
        assert_eq!(
            moonshine_variant_for_model("Moonshine-Base"),
            Ok(ModelVariant::Base)
        );
    }

    #[test]
    fn an_unknown_variant_is_an_error_rather_than_a_guess() {
        let error = moonshine_variant_for_model("openai/whisper-small").unwrap_err();
        assert!(error.contains("Unsupported Moonshine model"), "{error}");
    }

    #[test]
    fn model_root_descends_to_the_onnx_folder() {
        let dir =
            std::env::temp_dir().join(format!("slasshywispr-moonshine-{}", std::process::id()));
        let onnx = dir.join("onnx");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&onnx).unwrap();
        for name in MOONSHINE_REQUIRED_FILES {
            std::fs::write(onnx.join(name), b"x").unwrap();
        }

        assert_eq!(moonshine_model_root(&dir).unwrap(), onnx);
    }
}
