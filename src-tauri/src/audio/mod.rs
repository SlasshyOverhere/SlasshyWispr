//! Audio processing domain: signal processing, noise suppression, and VAD.
//!
//! This module owns:
//! - Pure audio signal processing (resampling, WAV encode/decode, format conversion)
//! - Noise suppression (high-pass filter, denoising, compression, normalization)
//! - Voice Activity Detection (VAD model loading, inference, speech segmentation)

pub mod noise_suppression;
pub mod processing;
pub mod vad;

pub use processing::*;
