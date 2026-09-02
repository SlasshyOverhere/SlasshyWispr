//! Pure audio signal processing functions.
//!
//! This module owns resampling, WAV encoding/decoding, and audio format conversion.
//! It has no Tauri, no network, no runtime state dependencies.

/// Linear interpolation resampling (mono, f32).
/// Expands sample count — used when source rate < target rate.
pub fn resample_mono_linear(samples: &[f32], source_rate: u32, target_rate: u32) -> Vec<f32> {
    if samples.is_empty() || source_rate == target_rate {
        return samples.to_vec();
    }

    let ratio = target_rate as f64 / source_rate as f64;
    let output_len = ((samples.len() as f64) * ratio).round().max(1.0) as usize;
    let mut output = Vec::with_capacity(output_len);
    for index in 0..output_len {
        let source_pos = (index as f64) / ratio;
        let left = source_pos.floor() as usize;
        let right = (left + 1).min(samples.len().saturating_sub(1));
        let frac = (source_pos - left as f64) as f32;
        let left_value = samples[left];
        let right_value = samples[right];
        output.push(left_value + (right_value - left_value) * frac);
    }
    output
}

/// Linear interpolation resampling (mono, f32).
/// Shrinks sample count — used when source rate > target rate.
pub fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = (samples.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_pos = i as f64 * ratio;
        let idx = src_pos as usize;
        let frac = src_pos - idx as f64;
        let s0 = samples[idx.min(samples.len() - 1)];
        let s1 = samples[(idx + 1).min(samples.len() - 1)];
        output.push(s0 + (s1 - s0) * frac as f32);
    }
    output
}

/// Decode WAV bytes into mono f32 samples and sample rate.
///
/// Handles multi-channel audio (mixes down to mono), int16/int32/float formats,
/// and returns normalized [-1.0, 1.0] samples.
pub fn decode_wav_audio_to_mono_f32(audio_bytes: &[u8]) -> Result<(Vec<f32>, u32), String> {
    let cursor = std::io::Cursor::new(audio_bytes);
    let mut reader = hound::WavReader::new(cursor)
        .map_err(|error| format!("Failed to parse WAV audio: {error}"))?;
    let spec = reader.spec();
    let channels = usize::from(spec.channels.max(1));
    let sample_rate = spec.sample_rate;

    let interleaved: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .map(|sample| {
                sample.map_err(|error| format!("Failed to read WAV float sample: {error}"))
            })
            .collect::<Result<Vec<f32>, String>>()?,
        hound::SampleFormat::Int => {
            if spec.bits_per_sample <= 16 {
                let scale = i16::MAX as f32;
                reader
                    .samples::<i16>()
                    .map(|sample| {
                        sample
                            .map(|value| (value as f32 / scale).clamp(-1.0, 1.0))
                            .map_err(|error| format!("Failed to read WAV int16 sample: {error}"))
                    })
                    .collect::<Result<Vec<f32>, String>>()?
            } else {
                let max_value = ((1_i64 << (spec.bits_per_sample.saturating_sub(1))) - 1) as f32;
                reader
                    .samples::<i32>()
                    .map(|sample| {
                        sample
                            .map(|value| (value as f32 / max_value).clamp(-1.0, 1.0))
                            .map_err(|error| format!("Failed to read WAV int sample: {error}"))
                    })
                    .collect::<Result<Vec<f32>, String>>()?
            }
        }
    };

    if interleaved.is_empty() {
        return Ok((Vec::new(), sample_rate));
    }

    if channels == 1 {
        return Ok((interleaved, sample_rate));
    }

    let frames = interleaved.len() / channels;
    if frames == 0 {
        return Ok((Vec::new(), sample_rate));
    }
    let mut mono = Vec::with_capacity(frames);
    for frame in 0..frames {
        let start = frame * channels;
        let end = start + channels;
        let sum = interleaved[start..end].iter().copied().sum::<f32>();
        mono.push(sum / channels as f32);
    }
    Ok((mono, sample_rate))
}

/// Encode mono f32 samples to WAV bytes using hound.
pub fn encode_mono_f32_to_wav(samples: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(&mut buf, spec)
            .map_err(|e| format!("Failed to create WAV writer: {e}"))?;
        for &sample in samples {
            let clamped = sample.clamp(-1.0, 1.0);
            let i16_sample = (clamped * i16::MAX as f32) as i16;
            writer
                .write_sample(i16_sample)
                .map_err(|e| format!("Failed to write WAV sample: {e}"))?;
        }
        writer
            .finalize()
            .map_err(|e| format!("Failed to finalize WAV: {e}"))?;
    }
    Ok(buf.into_inner())
}

/// Decode audio bytes (WAV) and resample to 16kHz mono f32.
///
/// Returns an error if the input is not WAV or contains no samples.
pub fn decode_local_stt_audio_to_mono_f32(
    audio_bytes: &[u8],
    audio_mime_type: &str,
) -> Result<Vec<f32>, String> {
    if audio_bytes.is_empty() {
        return Err("Recorded audio is empty.".to_string());
    }

    let normalized_mime = audio_mime_type.trim().to_ascii_lowercase();
    if !normalized_mime.is_empty() && !normalized_mime.contains("wav") {
        return Err(format!(
            "Native local Parakeet currently expects WAV input. Received '{}'.",
            &normalized_mime[..normalized_mime.len().min(80)]
        ));
    }

    let (samples, sample_rate) = decode_wav_audio_to_mono_f32(audio_bytes)?;
    if samples.is_empty() {
        return Err("Recorded WAV audio did not contain any samples.".to_string());
    }

    let normalized = if sample_rate != 16_000 {
        resample_mono_linear(&samples, sample_rate, 16_000)
    } else {
        samples
    };
    if normalized.is_empty() {
        return Err("Audio normalization produced no samples.".to_string());
    }
    Ok(normalized)
}

// ===== Tests =====

#[cfg(test)]
mod tests {
    use super::*;

    // ===== resample_mono_linear =====

    #[test]
    fn resample_mono_linear_identity_returns_same_samples() {
        let samples = vec![0.1, 0.2, 0.3, 0.4];
        let result = resample_mono_linear(&samples, 44100, 44100);
        assert_eq!(result, samples);
    }

    #[test]
    fn resample_mono_linear_empty_input() {
        let result = resample_mono_linear(&[], 44100, 48000);
        assert!(result.is_empty());
    }

    #[test]
    fn resample_mono_linear_upsamples() {
        // 2 samples at 100Hz → ~6 samples at 300Hz (3x ratio)
        let samples = vec![0.0, 1.0];
        let result = resample_mono_linear(&samples, 100, 300);
        assert!(result.len() >= 5); // 2 * 3 = 6, with rounding
        assert!(result.len() <= 7);
        // First sample should be near 0.0
        assert!(result[0].abs() < 0.1);
        // Last sample should be near 1.0
        assert!((result.last().unwrap() - 1.0).abs() < 0.1);
    }

    #[test]
    fn resample_mono_linear_single_sample() {
        let samples = vec![0.5];
        let result = resample_mono_linear(&samples, 44100, 48000);
        assert!(!result.is_empty());
        // Should produce approximately one output sample
        assert!(result.len() >= 1);
    }

    // ===== resample_linear =====

    #[test]
    fn resample_linear_identity_returns_same_samples() {
        let samples = vec![0.1, 0.2, 0.3];
        let result = resample_linear(&samples, 48000, 48000);
        assert_eq!(result, samples);
    }

    #[test]
    fn resample_linear_empty_input() {
        let result = resample_linear(&[], 48000, 16000);
        assert!(result.is_empty());
    }

    #[test]
    fn resample_linear_downsamples() {
        // 6 samples at 300Hz → ~2 samples at 100Hz (3x ratio)
        let samples = vec![0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
        let result = resample_linear(&samples, 300, 100);
        assert!(result.len() >= 1 && result.len() <= 3);
    }

    // ===== decode_wav_audio_to_mono_f32 =====

    #[test]
    fn decode_wav_empty_input() {
        let result = decode_wav_audio_to_mono_f32(&[]);
        assert!(result.is_err());
    }

    #[test]
    fn decode_wav_invalid_bytes() {
        let result = decode_wav_audio_to_mono_f32(b"not a wav file");
        assert!(result.is_err());
    }

    #[test]
    fn decode_wav_roundtrip_mono() {
        let original = vec![0.0, 0.5, -0.5, 1.0, -1.0];
        let wav_bytes = encode_mono_f32_to_wav(&original, 16000).expect("encode should succeed");
        let (decoded, sr) = decode_wav_audio_to_mono_f32(&wav_bytes).expect("decode should succeed");
        assert_eq!(sr, 16000);
        assert_eq!(decoded.len(), original.len());
        // Allow small quantization error from int16 encoding
        for (a, b) in original.iter().zip(decoded.iter()) {
            assert!((a - b).abs() < 0.001, "mismatch: {a} vs {b}");
        }
    }

    // ===== encode_mono_f32_to_wav =====

    #[test]
    fn encode_wav_empty_samples() {
        let result = encode_mono_f32_to_wav(&[], 16000);
        assert!(result.is_ok());
        let bytes = result.unwrap();
        // Should produce a valid WAV header even with no samples
        assert!(bytes.len() >= 44);
    }

    #[test]
    fn encode_wav_clamps_out_of_range() {
        // Samples outside [-1.0, 1.0] should be clamped
        let samples = vec![2.0, -2.0, 0.5];
        let result = encode_mono_f32_to_wav(&samples, 16000);
        assert!(result.is_ok());
        let wav_bytes = result.unwrap();
        let (decoded, _) = decode_wav_audio_to_mono_f32(&wav_bytes).unwrap();
        assert_eq!(decoded.len(), 3);
        // Clamped values should be at ±1.0
        assert!(decoded[0] > 0.99);
        assert!(decoded[1] < -0.99);
    }

    // ===== decode_local_stt_audio_to_mono_f32 =====

    #[test]
    fn decode_local_stt_empty_audio() {
        let result = decode_local_stt_audio_to_mono_f32(&[], "audio/wav");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn decode_local_stt_rejects_non_wav() {
        let result = decode_local_stt_audio_to_mono_f32(b"some data", "audio/webm");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("WAV"));
    }

    #[test]
    fn decode_local_stt_accepts_wav_mime() {
        let wav_bytes = encode_mono_f32_to_wav(&vec![0.0; 16000], 16000).unwrap();
        let result = decode_local_stt_audio_to_mono_f32(&wav_bytes, "audio/wav");
        assert!(result.is_ok());
        assert_eq!(result.unwrap().len(), 16000);
    }

    #[test]
    fn decode_local_stt_resamples_to_16k() {
        // Create a WAV at 44100 Hz
        let samples = vec![0.1; 44100]; // 1 second
        let wav_bytes = encode_mono_f32_to_wav(&samples, 44100).unwrap();
        let result = decode_local_stt_audio_to_mono_f32(&wav_bytes, "audio/wav").unwrap();
        // Should be resampled to 16000 samples (approximately 1 second)
        assert!(result.len() > 15000 && result.len() < 17000);
    }
}
