use log::info;
use ndarray;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use reqwest::Client;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use crate::constants::*;

struct VadModel {
    session: Session,
}

static VAD_MODEL: OnceLock<Mutex<Option<VadModel>>> = OnceLock::new();

fn vad_model_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("vad").join(SILERO_VAD_MODEL_FILE)
}

pub async fn ensure_vad_model(app_data_dir: &Path, client: &Client) -> Result<PathBuf, String> {
    let path = vad_model_path(app_data_dir);
    if path.exists() {
        return Ok(path);
    }

    info!("[vad] downloading model from {}", SILERO_VAD_MODEL_URL);
    let dir = path.parent().ok_or("Invalid VAD model directory.")?;
    std::fs::create_dir_all(dir)
        .map_err(|e| format!("Failed to create VAD dir: {e}"))?;

    let temp_path = dir.join(format!("{}.downloading", SILERO_VAD_MODEL_FILE));
    let response = client
        .get(SILERO_VAD_MODEL_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to download VAD model: {e}"))?;
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read VAD model: {e}"))?;

    std::fs::write(&temp_path, &bytes)
        .map_err(|e| format!("Failed to write VAD model: {e}"))?;
    std::fs::rename(&temp_path, &path)
        .map_err(|e| format!("Failed to finalize VAD model: {e}"))?;

    info!("[vad] model downloaded to {}", path.display());
    Ok(path)
}

fn get_or_load_session(
    model_path: &Path,
) -> Result<std::sync::MutexGuard<'static, Option<VadModel>>, String> {
    let cell = VAD_MODEL.get_or_init(|| Mutex::new(None));
    let mut guard = cell.lock().map_err(|_| "VAD model lock poisoned.")?;

    if guard.is_none() {
        // Silero VAD is a tiny frame-level model; capping intra threads avoids
        // spinning up an ORT thread pool sized to the whole machine for a
        // sub-millisecond inference.
        let session = Session::builder()
            .map_err(|e| format!("VAD session builder failed: {e}"))?
            .with_optimization_level(GraphOptimizationLevel::Level3)
            .map_err(|e| format!("VAD optimization level failed: {e}"))?
            .with_intra_threads(2)
            .map_err(|e| format!("VAD intra-thread config failed: {e}"))?
            .commit_from_file(model_path)
            .map_err(|e| format!("Failed to load VAD model: {e}"))?;

        *guard = Some(VadModel { session });
        info!("[vad] session loaded");
    }

    Ok(guard)
}

fn vad_frame_probability(
    session: &mut Session,
    frame: &[f32],
    state_h: &mut [f32],
    state_c: &mut [f32],
) -> Result<f32, String> {
    let frame_size = frame.len();
    let mut concat_state = Vec::with_capacity(256);
    concat_state.extend_from_slice(state_h);
    concat_state.extend_from_slice(state_c);

    let input_arr = ndarray::Array::from_shape_vec(
        ndarray::IxDyn(&[1usize, 1usize, frame_size]),
        frame.to_vec(),
    )
    .map_err(|e| format!("VAD input shape: {e}"))?;

    let state_arr = ndarray::Array::from_shape_vec(
        ndarray::IxDyn(&[2usize, 1usize, 128usize]),
        concat_state,
    )
    .map_err(|e| format!("VAD state shape: {e}"))?;

    let sr_arr = ndarray::Array::from_shape_vec(
        ndarray::IxDyn(&[1usize]),
        vec![SILERO_VAD_SAMPLE_RATE as f32],
    )
    .map_err(|e| format!("VAD sr shape: {e}"))?;

    let input_t = Tensor::from_array(input_arr)
        .map_err(|e| format!("VAD input tensor: {e}"))?;
    let state_t = Tensor::from_array(state_arr)
        .map_err(|e| format!("VAD state tensor: {e}"))?;
    let sr_t = Tensor::from_array(sr_arr)
        .map_err(|e| format!("VAD sr tensor: {e}"))?;

    use ort::session::input::SessionInputValue;
    let sess_inputs: [SessionInputValue; 3] = [
        SessionInputValue::from(input_t),
        SessionInputValue::from(state_t),
        SessionInputValue::from(sr_t),
    ];

    let outputs = session
        .run(sess_inputs)
        .map_err(|e| format!("VAD inference: {e}"))?;

    let prob = outputs[0]
        .try_extract_scalar::<f32>()
        .map_err(|e| format!("VAD output extract: {e}"))?;

    let state_view = outputs[1]
        .try_extract_array::<f32>()
        .map_err(|e| format!("VAD state_n extract: {e}"))?;

    for (i, &v) in state_view.iter().enumerate() {
        if i < 128 {
            state_h[i] = v;
        } else if i < 256 {
            state_c[i - 128] = v;
        }
    }

    Ok(prob)
}

/// Runs Silero VAD on 16 kHz mono f32 samples.
/// Returns trimmed audio containing the longest speech segment,
/// or `None` if no speech is detected.
pub fn trim_speech(
    samples_16khz: &[f32],
    model_path: &Path,
) -> Result<Option<Vec<f32>>, String> {
    let start = Instant::now();

    if samples_16khz.is_empty() {
        return Ok(None);
    }

    if samples_16khz.len() < SILERO_VAD_FRAME_SIZE {
        let duration_ms = (samples_16khz.len() as f64 / SILERO_VAD_SAMPLE_RATE as f64) * 1000.0;
        if duration_ms < 30.0 {
            return Ok(None);
        }
        return Ok(Some(samples_16khz.to_vec()));
    }

    let mut guard = get_or_load_session(model_path)?;
    let vad_model = guard.as_mut().ok_or("VAD model not loaded.")?;

    let n_frames = samples_16khz.len().div_ceil(SILERO_VAD_FRAME_SIZE);
    let mut state_h = vec![0.0f32; 128];
    let mut state_c = vec![0.0f32; 128];
    let mut probs = Vec::with_capacity(n_frames);

    for fi in 0..n_frames {
        let lo = fi * SILERO_VAD_FRAME_SIZE;
        let hi = (lo + SILERO_VAD_FRAME_SIZE).min(samples_16khz.len());
        let mut frame = vec![0.0f32; SILERO_VAD_FRAME_SIZE];
        frame[..(hi - lo)].copy_from_slice(&samples_16khz[lo..hi]);

        let prob = vad_frame_probability(&mut vad_model.session, &frame, &mut state_h, &mut state_c)?;
        probs.push(prob);
    }

    drop(guard);

    let threshold = SILERO_VAD_THRESHOLD as f32;
    let min_speech = SILERO_VAD_MIN_SPEECH_FRAMES;
    let min_silence = SILERO_VAD_MIN_SILENCE_FRAMES;

    let mut segments: Vec<(usize, usize)> = Vec::new();
    let mut in_speech = false;
    let mut seg_start = 0;
    let mut speech_run = 0;
    let mut silence_run = 0;

    for (fi, &prob) in probs.iter().enumerate() {
        if prob >= threshold {
            if !in_speech {
                seg_start = fi;
                speech_run = 1;
                in_speech = true;
            } else {
                speech_run += 1;
            }
            silence_run = 0;
        } else if in_speech {
            silence_run += 1;
            if silence_run >= min_silence {
                if speech_run >= min_speech {
                    let se = (seg_start * SILERO_VAD_FRAME_SIZE).min(samples_16khz.len());
                    let ee =
                        ((fi + 1 - min_silence) * SILERO_VAD_FRAME_SIZE).min(samples_16khz.len());
                    segments.push((se, ee));
                }
                in_speech = false;
                speech_run = 0;
                silence_run = 0;
            }
        }
    }

    if in_speech && speech_run >= min_speech {
        let se = (seg_start * SILERO_VAD_FRAME_SIZE).min(samples_16khz.len());
        segments.push((se, samples_16khz.len()));
    }

    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    if segments.is_empty() {
        info!(
            "[vad] no speech detected in {:.2}s audio ({:.1}ms inference)",
            samples_16khz.len() as f64 / SILERO_VAD_SAMPLE_RATE as f64,
            elapsed_ms
        );
        return Ok(None);
    }

    let best = segments
        .iter()
        .max_by_key(|(s, e)| e - s)
        .copied()
        .ok_or("No VAD segments.")?;

    let trimmed = samples_16khz[best.0..best.1].to_vec();
    let saved_pct = (1.0 - trimmed.len() as f64 / samples_16khz.len().max(1) as f64) * 100.0;

    info!(
        "[vad] speech segment {}..{} ({:.1}s) of {:.1}s total ({:.0}% trimmed) in {:.1}ms",
        best.0,
        best.1,
        trimmed.len() as f64 / SILERO_VAD_SAMPLE_RATE as f64,
        samples_16khz.len() as f64 / SILERO_VAD_SAMPLE_RATE as f64,
        saved_pct,
        elapsed_ms
    );

    Ok(Some(trimmed))
}
