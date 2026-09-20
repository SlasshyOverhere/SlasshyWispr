/**
 * Capture monitors — Phase 5 shell decomposition.
 *
 * Owns startAmplitudeMonitoring + stopAmplitudeMonitoring +
 * beginRecordingTicker + stopRecordingTicker + releaseMicrophone.
 * Moved verbatim from main.tsx; shell seams (dock amplitude level,
 * clock, timer element, live-stream access, dock publish) arrive via
 * initCaptureMonitors so this module never touches main.tsx globals.
 */
import { formatTimer } from "./audio-utils";

export interface CaptureMonitorDeps {
  getAmplitude: () => number;
  setAmplitude: (level: number) => void;
  publishDockState: () => void;
  now: () => number;
  getRecordingStartedAt: () => number;
  getMediaStream: () => MediaStream | null;
  setMediaStream: (stream: MediaStream | null) => void;
}

export interface CaptureMonitorElements {
  recordTimer: HTMLSpanElement;
}

let monitorElements!: CaptureMonitorElements;
let monitorDeps!: CaptureMonitorDeps;

let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let amplitudeSourceNode: MediaStreamAudioSourceNode | null = null;
let amplitudeBuffer: Float32Array<ArrayBuffer> | null = null;
let amplitudeFrameId: number | null = null;
let recordingTickerId: number | null = null;
let lastAmplitudePublishAt = 0;

export function initCaptureMonitors(
  elements: CaptureMonitorElements,
  deps: CaptureMonitorDeps,
): void {
  monitorElements = elements;
  monitorDeps = deps;
}

export function startAmplitudeMonitoring(stream: MediaStream): void {
  stopAmplitudeMonitoring(false);

  const AudioCtor = window.AudioContext;
  if (!AudioCtor) {
    return;
  }

  if (!audioContext) {
    audioContext = new AudioCtor();
  }

  if (audioContext.state === "suspended") {
    void audioContext.resume().catch(() => {
      // Ignore resume failures to keep dictation flow resilient.
    });
  }

  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 1024;
  analyserNode.smoothingTimeConstant = 0.75;
  amplitudeSourceNode = audioContext.createMediaStreamSource(stream);
  amplitudeSourceNode.connect(analyserNode);
  amplitudeBuffer = new Float32Array(analyserNode.fftSize) as Float32Array<ArrayBuffer>;
  monitorDeps.setAmplitude(0);
  lastAmplitudePublishAt = 0;
  monitorDeps.publishDockState();

  const tick = (now: number): void => {
    if (!analyserNode || !amplitudeBuffer) {
      return;
    }

    // Throttle visualization updates to ~30fps (33ms) to reduce IPC/CPU overhead
    // for this peripheral background visualizer.
    if (now - lastAmplitudePublishAt < 33) {
      amplitudeFrameId = window.requestAnimationFrame(tick);
      return;
    }

    analyserNode.getFloatTimeDomainData(amplitudeBuffer);

    let sumSquares = 0;
    for (let index = 0; index < amplitudeBuffer.length; index += 1) {
      const sample = amplitudeBuffer[index];
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / amplitudeBuffer.length);
    const normalized = Math.min(1, Math.max(0, (rms - 0.008) * 11.5));
    // Adjusted smoothing factor for lower update rate (0.72^2 ≈ 0.52) to maintain visual decay.
    monitorDeps.setAmplitude(monitorDeps.getAmplitude() * 0.52 + normalized * 0.48);

    monitorDeps.publishDockState();
    lastAmplitudePublishAt = now;

    amplitudeFrameId = window.requestAnimationFrame(tick);
  };

  amplitudeFrameId = window.requestAnimationFrame(tick);
}

/**
 * Native capture reports its level over IPC instead of exposing a MediaStream.
 * Same smoothing and ~30fps throttle as the Web Audio path so the meter reads
 * identically whichever backend is active.
 */
export function startNativeAmplitudeMonitoring(readLevel: () => Promise<number>): void {
  stopAmplitudeMonitoring(false);
  monitorDeps.setAmplitude(0);
  lastAmplitudePublishAt = 0;
  monitorDeps.publishDockState();

  let pollInFlight = false;
  const tick = (now: number): void => {
    if (now - lastAmplitudePublishAt >= 33 && !pollInFlight) {
      pollInFlight = true;
      lastAmplitudePublishAt = now;
      void readLevel()
        .then((level) => {
          const normalized = Math.min(1, Math.max(0, (level - 0.008) * 11.5));
          monitorDeps.setAmplitude(monitorDeps.getAmplitude() * 0.52 + normalized * 0.48);
          monitorDeps.publishDockState();
        })
        .catch(() => {
          // Level is cosmetic; a failed poll must never break recording.
        })
        .finally(() => {
          pollInFlight = false;
        });
    }

    amplitudeFrameId = window.requestAnimationFrame(tick);
  };

  amplitudeFrameId = window.requestAnimationFrame(tick);
}

export function stopAmplitudeMonitoring(resetLevel = true): void {
  if (amplitudeFrameId !== null) {
    window.cancelAnimationFrame(amplitudeFrameId);
    amplitudeFrameId = null;
  }

  if (amplitudeSourceNode) {
    try {
      amplitudeSourceNode.disconnect();
    } catch {
      // Ignore disconnect failures.
    }
    amplitudeSourceNode = null;
  }

  if (analyserNode) {
    try {
      analyserNode.disconnect();
    } catch {
      // Ignore disconnect failures.
    }
    analyserNode = null;
  }

  amplitudeBuffer = null;

  if (resetLevel && monitorDeps.getAmplitude() !== 0) {
    monitorDeps.setAmplitude(0);
    monitorDeps.publishDockState();
  }
}

export function beginRecordingTicker(): void {
  stopRecordingTicker();
  monitorElements.recordTimer.textContent = "00.0s";

  recordingTickerId = window.setInterval(() => {
    const elapsedMs = monitorDeps.now() - monitorDeps.getRecordingStartedAt();
    monitorElements.recordTimer.textContent = formatTimer(elapsedMs);
  }, 100);
}

export function stopRecordingTicker(): void {
  if (recordingTickerId !== null) {
    window.clearInterval(recordingTickerId);
    recordingTickerId = null;
  }
}

export function releaseMicrophone(): void {
  stopAmplitudeMonitoring();
  const mediaStream = monitorDeps.getMediaStream();
  if (!mediaStream) return;
  for (const track of mediaStream.getTracks()) {
    track.stop();
  }
  monitorDeps.setMediaStream(null);
}
