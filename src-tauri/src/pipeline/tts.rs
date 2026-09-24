//! TTS synthesis for the voice assistant pipeline.
//!
//! Facade (Phase 7b): pure Piper normalization lives in `normalize`, path
//! resolution in `paths`, Piper synthesis/provisioning in `piper`, and native
//! voice cloning (ZipVoice over sherpa-onnx) in `zipvoice`. Re-exports preserve
//! the `pipeline::tts::X` paths used by commands, services, and `refinement`.

pub mod normalize;
pub mod paths;
pub mod piper;
pub mod zipvoice;

pub use normalize::{
    normalize_piper_math_symbols, normalize_piper_numeric_token, normalize_piper_text_for_tts,
    normalize_spacing, piper_digits_to_words, piper_integer_to_words, validate_piper_binary_path,
    validate_tts_input_length,
};
pub use paths::{
    piper_runtime_dir, voice_clone_models_dir, voice_clone_previews_dir, voice_clone_voice_dir,
    voice_clone_voices_dir, voice_paths,
};
pub use piper::{ensure_piper_binary, ensure_voice_files, synthesize_with_piper};
pub(crate) use zipvoice::{
    assets_present, delete_voice_profile, engine_loaded, ensure_clone_assets, list_voice_profiles,
    load_clone_assets, save_voice_profile, synthesize_cloned, unload_engine,
    validate_reference_duration, CloneAssets,
};

pub(crate) use piper::PiperPipelineRequest;
pub(crate) use zipvoice::VoiceClonePipelineRequest;
