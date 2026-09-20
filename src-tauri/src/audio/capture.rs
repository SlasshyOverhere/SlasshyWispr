//! Native microphone capture (cpal → WASAPI on Windows).
//!
//! Replaces the WebView `MediaRecorder` path so samples are captured in Rust
//! and never round-trip through the webview as an encoded blob. Selected by
//! the `captureBackend` setting; the webview path remains the fallback.
//!
//! cpal streams are not `Send` on every backend, so the stream is owned by a
//! dedicated thread that parks until capture is stopped.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use log::{info, warn};
use serde::Serialize;

use super::processing::{encode_mono_f32_to_wav, resample_mono_linear};

/// Rate the pipeline is fed at. Silero VAD frames and both STT backends
/// expect this, and it keeps the payload a third of the device's usual 48 kHz.
pub(crate) const TARGET_SAMPLE_RATE: u32 = 16_000;

/// ~30 minutes at the target rate, so a stuck session cannot grow without bound.
const MAX_CAPTURE_SAMPLES: usize = TARGET_SAMPLE_RATE as usize * 60 * 30;

/// A finished recording, already in the shapes the pipeline consumes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CapturedAudio {
    /// `[sample_rate: u32 LE][samples: f32 LE...]`, matching the webview fast path.
    pub(crate) raw_pcm_base64: String,
    /// 16-bit mono WAV, for the online STT upload path.
    pub(crate) wav_base64: String,
    pub(crate) sample_rate: u32,
    pub(crate) sample_count: usize,
    pub(crate) duration_ms: u64,
}

/// What the device turned out to be, reported so the UI can log it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaptureInfo {
    pub(crate) device_name: String,
    pub(crate) sample_rate: u32,
    pub(crate) fallback_used: bool,
}

struct CaptureSession {
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

static ACTIVE: AtomicBool = AtomicBool::new(false);
/// Peak level as raw f32 bits, so the level poll never touches the sample lock.
static LEVEL_BITS: AtomicU32 = AtomicU32::new(0);
/// Rate the current capture came in at, so it can be resampled on stop.
static SOURCE_RATE: AtomicU32 = AtomicU32::new(TARGET_SAMPLE_RATE);
static BUFFER: Mutex<Vec<f32>> = Mutex::new(Vec::new());
static SESSION: Mutex<Option<CaptureSession>> = Mutex::new(None);

/// Pipeline PCM payload: `[sample_rate: u32 LE][samples: f32 LE...]`.
pub(crate) fn encode_capture_payload(sample_rate: u32, samples: &[f32]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(4 + samples.len() * 4);
    payload.extend_from_slice(&sample_rate.to_le_bytes());
    for sample in samples {
        payload.extend_from_slice(&sample.to_le_bytes());
    }
    payload
}

/// Downmix interleaved frames to mono, appending to `out`.
///
/// Returns the peak magnitude of the appended chunk so the caller can publish
/// a level without rescanning the whole buffer.
pub(crate) fn append_mono<T>(data: &[T], channels: usize, out: &mut Vec<f32>) -> f32
where
    T: cpal::Sample,
    f32: cpal::FromSample<T>,
{
    let channels = channels.max(1);
    let mut peak = 0.0_f32;

    for frame in data.chunks(channels) {
        let sum: f32 = frame.iter().map(|sample| sample.to_sample::<f32>()).sum();
        let mono = sum / channels as f32;
        if mono.abs() > peak {
            peak = mono.abs();
        }
        if out.len() < MAX_CAPTURE_SAMPLES {
            out.push(mono);
        }
    }

    peak
}

fn level_to_bits(level: f32) -> u32 {
    level.to_bits()
}

fn bits_to_level(bits: u32) -> f32 {
    f32::from_bits(bits)
}

fn reset_buffer() {
    if let Ok(mut buffer) = BUFFER.lock() {
        buffer.clear();
    }
    LEVEL_BITS.store(level_to_bits(0.0), Ordering::Relaxed);
}

fn publish_peak(peak: f32) {
    // Keep the loudest moment of the interval rather than the last sample,
    // so a quick syllable is still visible to a polling meter.
    let previous = bits_to_level(LEVEL_BITS.load(Ordering::Relaxed));
    let next = peak.max(previous * 0.7);
    LEVEL_BITS.store(level_to_bits(next), Ordering::Relaxed);
}

/// Peak level of the current capture, 0.0..=1.0.
pub(crate) fn current_level() -> f32 {
    bits_to_level(LEVEL_BITS.load(Ordering::Relaxed))
}

pub(crate) fn is_active() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}

fn resolve_device(
    host: &cpal::Host,
    device_id: Option<&str>,
) -> Result<(cpal::Device, bool), String> {
    let default_device = || {
        host.default_input_device()
            .ok_or_else(|| "No microphone input device is available.".to_string())
    };

    let Some(device_id) = device_id.filter(|id| !id.is_empty()) else {
        return Ok((default_device()?, false));
    };

    // The webview exposes device ids as strings; cpal matches on name, so treat
    // the id as a name and fall back rather than failing the whole recording.
    if let Ok(devices) = host.input_devices() {
        for device in devices {
            if device.name().map(|name| name == device_id).unwrap_or(false) {
                return Ok((device, false));
            }
        }
    }

    warn!("[capture] requested device '{device_id}' not found; using default");
    Ok((default_device()?, true))
}

fn build_stream(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
) -> Result<cpal::Stream, String> {
    let channels = config.channels() as usize;
    let stream_config: cpal::StreamConfig = config.clone().into();

    let push = move |mono: &mut Vec<f32>, peak: f32| {
        if let Ok(mut buffer) = BUFFER.lock() {
            buffer.extend_from_slice(mono);
        }
        publish_peak(peak);
    };

    let error_callback = |error| warn!("[capture] stream error: {error}");

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &stream_config,
            move |data: &[f32], _| {
                let mut mono = Vec::with_capacity(data.len() / channels);
                let peak = append_mono(data, channels, &mut mono);
                push(&mut mono, peak);
            },
            error_callback,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &stream_config,
            move |data: &[i16], _| {
                let mut mono = Vec::with_capacity(data.len() / channels);
                let peak = append_mono(data, channels, &mut mono);
                push(&mut mono, peak);
            },
            error_callback,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &stream_config,
            move |data: &[u16], _| {
                let mut mono = Vec::with_capacity(data.len() / channels);
                let peak = append_mono(data, channels, &mut mono);
                push(&mut mono, peak);
            },
            error_callback,
            None,
        ),
        other => return Err(format!("unsupported capture sample format: {other:?}")),
    }
    .map_err(|error| format!("Failed to build capture stream: {error}"))?;

    stream
        .play()
        .map_err(|error| format!("Failed to start capture stream: {error}"))?;
    Ok(stream)
}

/// Begin capturing. Errors when a capture is already running.
pub(crate) fn start(device_id: Option<String>) -> Result<CaptureInfo, String> {
    if is_active() {
        return Err("A recording is already in progress.".to_string());
    }

    reset_buffer();
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel::<Result<CaptureInfo, String>>();

    let stop_for_thread = stop.clone();
    let handle = std::thread::Builder::new()
        .name("native-capture".to_string())
        .spawn(move || {
            let host = cpal::default_host();
            let (device, fallback_used) = match resolve_device(&host, device_id.as_deref()) {
                Ok(resolved) => resolved,
                Err(error) => {
                    let _ = ready_tx.send(Err(error));
                    return;
                }
            };

            let device_name = device.name().unwrap_or_else(|_| "default".to_string());
            let config = match device.default_input_config() {
                Ok(config) => config,
                Err(error) => {
                    let _ = ready_tx.send(Err(format!("Failed to read capture config: {error}")));
                    return;
                }
            };

            let info = CaptureInfo {
                device_name: device_name.clone(),
                sample_rate: config.sample_rate().0,
                fallback_used,
            };

            SOURCE_RATE.store(config.sample_rate().0, Ordering::SeqCst);

            let stream = match build_stream(&device, &config) {
                Ok(stream) => stream,
                Err(error) => {
                    let _ = ready_tx.send(Err(error));
                    return;
                }
            };

            info!(
                "[capture] started device='{}' rate={} fallback={}",
                device_name,
                config.sample_rate().0,
                fallback_used
            );

            if ready_tx.send(Ok(info)).is_err() {
                return;
            }

            // Own the stream on this thread; cpal streams are not Send
            // everywhere, so it is dropped here when capture stops.
            while !stop_for_thread.load(Ordering::SeqCst) {
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            drop(stream);
            info!("[capture] stopped");
        })
        .map_err(|error| format!("Failed to spawn capture thread: {error}"))?;

    match ready_rx.recv() {
        Ok(Ok(info)) => {
            ACTIVE.store(true, Ordering::SeqCst);
            if let Ok(mut session) = SESSION.lock() {
                *session = Some(CaptureSession { stop, handle });
            }
            Ok(info)
        }
        Ok(Err(error)) => {
            let _ = handle.join();
            Err(error)
        }
        Err(_) => {
            let _ = handle.join();
            Err("Capture thread exited before starting.".to_string())
        }
    }
}

/// Stop capturing and return the recording in pipeline-ready shapes.
pub(crate) fn stop() -> Result<CapturedAudio, String> {
    let session = SESSION
        .lock()
        .map_err(|_| "Capture state is poisoned.".to_string())?
        .take();

    let Some(session) = session else {
        return Err("No recording is in progress.".to_string());
    };

    session.stop.store(true, Ordering::SeqCst);
    let _ = session.handle.join();
    ACTIVE.store(false, Ordering::SeqCst);

    let samples = BUFFER
        .lock()
        .map_err(|_| "Capture buffer is poisoned.".to_string())?
        .clone();
    LEVEL_BITS.store(level_to_bits(0.0), Ordering::Relaxed);

    if samples.is_empty() {
        return Err("Recording captured no audio.".to_string());
    }

    let source_rate = SOURCE_RATE.load(Ordering::SeqCst).max(1);
    let resampled = if source_rate == TARGET_SAMPLE_RATE {
        samples
    } else {
        resample_mono_linear(&samples, source_rate, TARGET_SAMPLE_RATE)
    };

    let wav = encode_mono_f32_to_wav(&resampled, TARGET_SAMPLE_RATE)?;
    let duration_ms = (resampled.len() as u64 * 1000) / TARGET_SAMPLE_RATE as u64;

    Ok(CapturedAudio {
        raw_pcm_base64: BASE64_STANDARD
            .encode(encode_capture_payload(TARGET_SAMPLE_RATE, &resampled)),
        wav_base64: BASE64_STANDARD.encode(&wav),
        sample_rate: TARGET_SAMPLE_RATE,
        sample_count: resampled.len(),
        duration_ms,
    })
}

/// Discard the current capture without producing audio.
pub(crate) fn cancel() -> Result<(), String> {
    let session = SESSION
        .lock()
        .map_err(|_| "Capture state is poisoned.".to_string())?
        .take();
    if let Some(session) = session {
        session.stop.store(true, Ordering::SeqCst);
        let _ = session.handle.join();
    }
    ACTIVE.store(false, Ordering::SeqCst);
    reset_buffer();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payload_puts_the_sample_rate_first() {
        let payload = encode_capture_payload(16_000, &[0.5, -0.5]);
        assert_eq!(&payload[..4], &16_000_u32.to_le_bytes());
        assert_eq!(payload.len(), 4 + 2 * 4);
        assert_eq!(
            &payload[4..8],
            &0.5_f32.to_le_bytes(),
            "samples are little-endian f32"
        );
    }

    #[test]
    fn payload_of_no_samples_is_just_the_header() {
        let payload = encode_capture_payload(48_000, &[]);
        assert_eq!(payload.len(), 4);
        assert_eq!(&payload[..4], &48_000_u32.to_le_bytes());
    }

    #[test]
    fn mono_passthrough_keeps_samples_and_reports_peak() {
        let mut out = Vec::new();
        let peak = append_mono(&[0.1_f32, -0.8, 0.2], 1, &mut out);
        assert_eq!(out, vec![0.1, -0.8, 0.2]);
        assert!((peak - 0.8).abs() < 1e-6);
    }

    #[test]
    fn stereo_is_averaged_to_mono() {
        let mut out = Vec::new();
        append_mono(&[1.0_f32, 0.0, 0.4, 0.0], 2, &mut out);
        assert_eq!(out.len(), 2);
        assert!((out[0] - 0.5).abs() < 1e-6);
        assert!((out[1] - 0.2).abs() < 1e-6);
    }

    #[test]
    fn i16_samples_convert_to_normalized_f32() {
        let mut out = Vec::new();
        let peak = append_mono(&[i16::MAX, i16::MIN], 1, &mut out);
        assert_eq!(out.len(), 2);
        assert!(out[0] > 0.99 && out[0] <= 1.0, "{:?}", out[0]);
        assert!(out[1] <= -0.99, "{:?}", out[1]);
        assert!(peak <= 1.0);
    }

    #[test]
    fn a_partial_frame_does_not_drop_the_tail() {
        let mut out = Vec::new();
        append_mono(&[0.5_f32, 0.25, 0.75], 2, &mut out);
        assert_eq!(out.len(), 2, "a trailing odd sample still forms a frame");
    }

    #[test]
    fn level_bits_round_trip() {
        assert_eq!(bits_to_level(level_to_bits(0.42)), 0.42);
    }

    #[test]
    fn stopping_without_a_session_is_an_error() {
        let _ = cancel();
        assert!(stop().is_err());
    }
}
