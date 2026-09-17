//! TTS synthesis for the voice assistant pipeline.
//!
//! Facade (Phase 7b): pure Piper normalization lives in `normalize`, path
//! resolution in `paths`, Piper synthesis/provisioning in `piper`, and Coqui
//! synthesis in `coqui`. Re-exports preserve the `pipeline::tts::X` paths
//! used by commands, services, and `refinement`.

pub mod coqui;
pub mod normalize;
pub mod paths;
pub mod piper;

pub use coqui::{run_coqui_bridge, synthesize_with_coqui};
pub use normalize::{
    normalize_piper_math_symbols, normalize_piper_numeric_token, normalize_piper_text_for_tts,
    normalize_spacing, piper_digits_to_words, piper_integer_to_words, validate_piper_binary_path,
    validate_tts_input_length,
};
pub use paths::{
    coqui_cache_dir, coqui_previews_dir, coqui_root_dir, coqui_runtime_dir, coqui_uploads_dir,
    coqui_venv_python_path, coqui_voices_dir, piper_runtime_dir, resolve_coqui_python_path,
    voice_paths,
};
pub use piper::{ensure_piper_binary, ensure_voice_files, synthesize_with_piper};

pub(crate) use coqui::CoquiPipelineRequest;
pub(crate) use piper::PiperPipelineRequest;
