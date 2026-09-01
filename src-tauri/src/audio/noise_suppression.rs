use log::info;
use nnnoiseless::DenoiseState;
use std::sync::{Mutex, OnceLock};

/// nnnoiseless processes audio in 480-sample frames (10ms at 48kHz).
const FRAME_SIZE: usize = 480;

/// Global denoiser instance, loaded once and reused across calls.
/// Model is ~50KB in memory. Mutex needed because process_frame takes &mut self.
static DENOISER: OnceLock<Mutex<Box<DenoiseState<'static>>>> = OnceLock::new();

fn get_denoiser() -> &'static Mutex<Box<DenoiseState<'static>>> {
    DENOISER.get_or_init(|| Mutex::new(DenoiseState::new()))
}

/// Single-pole IIR high-pass filter.
/// Removes low-frequency rumble (fan, AC, DC offset).
/// Cutoff freq formula: coeff = e^(-2*pi*fc/fs)
fn high_pass_filter(samples: &mut [f32], sample_rate: u32, cutoff_hz: f32) {
    let coeff = (-2.0 * std::f32::consts::PI * cutoff_hz / sample_rate as f32).exp();
    let mut prev = 0.0f32;
    let mut prev_out = 0.0f32;
    for sample in samples.iter_mut() {
        let input = *sample;
        let output = coeff * (prev_out + input - prev);
        prev = input;
        prev_out = output;
        *sample = output;
    }
}

/// Dynamic range compression with soft-knee.
/// Boosts quiet speech, limits loud peaks. Restores volume after denoising.
fn dynamic_range_compress(samples: &mut [f32], threshold_db: f32, ratio: f32) {
    let threshold = 10.0f32.powf(threshold_db / 20.0);
    for sample in samples.iter_mut() {
        let abs_val = sample.abs();
        if abs_val > threshold {
            // Soft-knee compression above threshold
            let excess_db = 20.0 * (abs_val / threshold).max(1e-10);
            let compressed_db = excess_db / ratio;
            let gain_db = compressed_db - excess_db;
            let gain = 10.0f32.powf(gain_db / 20.0);
            *sample *= gain;
        }
    }
}

/// Normalize peak amplitude to target level.
fn normalize_peak(samples: &mut [f32], target_peak: f32) {
    let peak = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
    if peak > 1e-6 {
        let gain = (target_peak / peak).min(10.0); // cap gain to avoid amplifying noise
        for sample in samples.iter_mut() {
            *sample = (*sample * gain).clamp(-1.0, 1.0);
        }
    }
}

/// Multi-stage noise suppression pipeline:
/// 1. High-pass filter (kill fan/AC rumble below 150Hz)
/// 2. nnnoiseless denoise (kill broadband noise)
/// 3. Dynamic range compression (restore speech volume)
/// 4. Peak normalization (ensure consistent level for STT)
pub fn denoise_audio(samples: &[f32], sample_rate: u32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    let mut audio = samples.to_vec();

    // Stage 1: High-pass filter at 150Hz — removes fan rumble and DC offset
    high_pass_filter(&mut audio, sample_rate, 150.0);
    info!("[noise_suppression] stage 1: high-pass 150Hz done");

    // Stage 2: nnnoiseless denoise — kill remaining broadband noise
    {
        let mut denoiser = get_denoiser().lock().unwrap_or_else(|poisoned| {
            info!("[noise_suppression] mutex poisoned, recovering");
            poisoned.into_inner()
        });

        let mut output = Vec::with_capacity(audio.len());
        let mut input_buf = vec![0.0f32; FRAME_SIZE];
        let mut output_buf = vec![0.0f32; FRAME_SIZE];

        for chunk in audio.chunks(FRAME_SIZE) {
            input_buf.fill(0.0);
            let copy_len = chunk.len().min(FRAME_SIZE);
            input_buf[..copy_len].copy_from_slice(&chunk[..copy_len]);

            denoiser.process_frame(&mut output_buf, &input_buf);
            output.extend_from_slice(&output_buf[..copy_len]);
        }
        audio = output;
    }
    info!("[noise_suppression] stage 2: nnnoiseless done");

    // Stage 3: Dynamic range compression — restore speech volume
    dynamic_range_compress(&mut audio, -20.0, 3.0);
    info!("[noise_suppression] stage 3: compression done");

    // Stage 4: Peak normalization — ensure consistent level for STT
    normalize_peak(&mut audio, 0.9);
    info!(
        "[noise_suppression] stage 4: normalization done, output {} samples",
        audio.len()
    );

    audio
}
