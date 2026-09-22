//! Audio processing domain: signal processing, noise suppression, and VAD.
//!
//! This module owns:
//! - Pure audio signal processing (resampling, WAV encode/decode, format conversion)
//! - Noise suppression (high-pass filter, denoising, compression, normalization)
//! - Voice Activity Detection (VAD model loading, inference, speech segmentation)
//! - Native Parakeet in-process STT runtime (engine lifecycle, int8 transcription)
//! - Shared in-process ASR engine cache (`in_process`) used by the Whisper,
//!   Moonshine and SenseVoice runtimes, replacing their Python bridge

pub mod capture;
pub mod in_process;
pub mod model_layout;
pub mod moonshine;
pub mod noise_suppression;
pub mod parakeet;
pub mod processing;
pub mod runtimes;
pub mod sense_voice;
pub mod vad;
// whisper.cpp via transcribe-cpp, which we build for Windows x86_64 only.
#[cfg(all(windows, target_arch = "x86_64"))]
pub mod whisper;

pub use processing::*;
