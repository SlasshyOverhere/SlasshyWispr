//! Pipeline input preparation.
//!
//! This module owns audio validation, noise suppression orchestration,
//! and input normalization for the pipeline.

use crate::audio::processing::{decode_wav_audio_to_mono_f32, encode_mono_f32_to_wav, resample_linear};
use crate::audio::noise_suppression;
use log::info;

/// Validate and decode base64 audio input, returning raw bytes.
///
/// Checks: non-empty, minimum size, valid base64.
pub fn validate_audio_input(audio_base64: &str) -> Result<Vec<u8>, String> {
    use crate::security::validate_base64_input;
    let audio_bytes = validate_base64_input(audio_base64, 10 * 1024 * 1024)
        .map_err(|error| format!("Invalid audio input: {error}"))?;

    if audio_bytes.is_empty() {
        return Err("Recorded audio is empty".to_string());
    }

    if audio_bytes.len() < 3000 {
        return Err(
            "Recording too short. Hold the hotkey longer while speaking and try again.".to_string(),
        );
    }

    Ok(audio_bytes)
}

/// Apply noise suppression to audio bytes if enabled.
///
/// Returns the (possibly denoised) audio bytes.
pub fn apply_noise_suppression(
    audio_bytes: &[u8],
    noise_suppression_enabled: bool,
    raw_pcm_base64: Option<&str>,
) -> Result<Vec<u8>, String> {
    if !noise_suppression_enabled {
        return Ok(audio_bytes.to_vec());
    }

    let denoise_start = std::time::Instant::now();

    // Use raw PCM if frontend sent it (faster — no WAV decode needed)
    let (samples, sample_rate) = if let Some(ref raw_pcm) = raw_pcm_base64 {
        use base64::Engine;
        let raw_bytes = base64::engine::general_purpose::STANDARD
            .decode(raw_pcm.as_bytes())
            .map_err(|error| format!("Failed to decode raw PCM base64: {error}"))?;
        if raw_bytes.len() < 4 {
            return Err("Raw PCM data too short".to_string());
        }
        // Parse: [sample_rate: u32 LE][samples: f32 LE...]
        let sr = u32::from_le_bytes([
            raw_bytes[0], raw_bytes[1], raw_bytes[2], raw_bytes[3],
        ]);
        let f32_data = &raw_bytes[4..];
        let num_samples = f32_data.len() / 4;
        let mut samples = Vec::with_capacity(num_samples);
        for i in 0..num_samples {
            let offset = i * 4;
            let val = f32::from_le_bytes([
                f32_data[offset],
                f32_data[offset + 1],
                f32_data[offset + 2],
                f32_data[offset + 3],
            ]);
            samples.push(val);
        }
        info!("[pipeline.noise_suppression] raw PCM: samples={} sample_rate={}", samples.len(), sr);
        (samples, sr)
    } else {
        // Fallback: decode WAV
        let (samples, sr) = decode_wav_audio_to_mono_f32(audio_bytes)
            .map_err(|error| format!("Failed to decode audio for noise suppression: {error}"))?;
        info!("[pipeline.noise_suppression] WAV decode: samples={} sample_rate={}", samples.len(), sr);
        (samples, sr)
    };

    // Resample to 48kHz if needed (nnnoiseless expects 48kHz)
    let samples_48k = if sample_rate != 48000 {
        resample_linear(&samples, sample_rate, 48000)
    } else {
        samples
    };

    // Denoise
    let denoised = noise_suppression::denoise_audio(&samples_48k, 48000);

    // Re-encode to WAV bytes for STT
    let denoised_bytes = encode_mono_f32_to_wav(&denoised, 48000)
        .map_err(|error| format!("Failed to encode denoised audio: {error}"))?;
    let denoise_ms = denoise_start.elapsed().as_millis();
    info!(
        "[pipeline.noise_suppression] done input_bytes={} output_bytes={} denoise_ms={}",
        audio_bytes.len(), denoised_bytes.len(), denoise_ms
    );
    Ok(denoised_bytes)
}

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_audio_input_rejects_empty() {
        let result = validate_audio_input("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn validate_audio_input_rejects_short() {
        // Less than 3000 bytes
        let short = "a".repeat(100);
        let result = validate_audio_input(&short);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("too short"));
    }

    #[test]
    fn apply_noise_suppression_passthrough_when_disabled() {
        let audio = vec![0u8; 5000];
        let result = apply_noise_suppression(&audio, false, None).unwrap();
        assert_eq!(result, audio);
    }
}
