/**
 * Recording lifecycle controller — Phase 5 shell decomposition.
 *
 * Owns startRecording + stopRecording + finalizeRecording +
 * saveDictationAudio. Moved verbatim from main.tsx; the mutable capture
 * state lives behind accessors and shell seams (settings, stage,
 * state-machine, availability, PTT, command mode, monitors, IPC) arrive
 * via initRecordingController so this module never touches main.tsx
 * module globals.
 */
import type { CaptureMode, PersistedSettings } from "../types";
import { asErrorMessage, boolFlag } from "../utils";
import {
  base64ToBytes,
  blobToBase64,
  captureIsSilent,
  invalidRuntimeCombinationReason,
  missingApiKeyForOnlineRuntime,
  pickBestRecorderMimeType,
  resolvePreferredOnlineSttBitrate,
} from "./audio-utils";
import {
  beginRecordingTicker,
  releaseMicrophone,
  startAmplitudeMonitoring,
  startNativeAmplitudeMonitoring,
  stopAmplitudeMonitoring,
  stopRecordingTicker,
} from "./capture-monitors";
import { openMicrophoneStream } from "./mic-stream";
import { selectedMicrophoneLabel } from "../shell/microphones";
import {
  cancelNativeCapture,
  nativeCaptureLevel,
  startNativeCapture,
  stopNativeCapture,
} from "../ipc/client";

export interface StopRecordingOptions {
  cancelPipeline?: boolean;
  cancelNotice?: string;
  cancelStatus?: string;
}

export type RecordingControllerEvent =
  | { type: "recording-failed"; reason: string }
  | { type: "recording-ready" }
  | { type: "stop-recording"; cancelPipeline?: boolean }
  | { type: "recording-stopped"; cancelPipeline?: boolean }
  | { type: "audio-empty" };

export interface RecordingControllerDeps {
  getStage: () => string;
  isPipelineRunning: () => boolean;
  getHoldCount: () => number;
  getCommandModeArmed: () => boolean;
  getCaptureMode: () => CaptureMode;
  readSettings: () => PersistedSettings;
  readLiveSettings: () => PersistedSettings;
  summarizeSettings: (settings: PersistedSettings) => string;
  shouldBlockFromForegroundApp: () => Promise<boolean>;
  primeSelectionSnapshot: () => void;
  clearPushToTalkHolds: () => void;
  showMissingApiKeyNotice: (source: string) => void;
  setNotice: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  transition: (event: RecordingControllerEvent) => void;
  syncAvailability: () => void;
  getRecordingStartedAt: () => number;
  clearCaptureIntent: () => void;
  getCaptureIntentStartedAt: () => number;
  getCaptureIntentLabel: () => string;
  setCaptureIntent: (startedAt: number, label: string) => void;
  setMicrophonePermissionGranted: (granted: boolean) => void;
  refreshRecordingsStorageHint: () => void;
  isTauri: () => boolean;
  now: () => number;
  performanceNow: () => number;
  runPipeline: (
    blob: Blob,
    mimeType: string,
    precomputed?: { rawPcmBase64: string },
  ) => Promise<void>;
  createId: () => string;
  /** Snapshot the paste target at capture intent (best-effort, never blocks recording). */
  notePasteTarget?: () => void;
  /** Test seam for the no-signal check. Defaults to the real decode. */
  captureIsSilent?: (blob: Blob) => Promise<boolean>;
  saveDictationRecording: (args: {
    recordingId: string;
    mimeType: string;
    audioBase64: string;
  }) => Promise<unknown>;
}

export interface RecordingControllerState {
  getMediaRecorder: () => MediaRecorder | null;
  setMediaRecorder: (recorder: MediaRecorder | null) => void;
  getMediaStream: () => MediaStream | null;
  setMediaStream: (stream: MediaStream | null) => void;
  getRecorderMimeType: () => string;
  setRecorderMimeType: (mimeType: string) => void;
  getRecordedChunks: () => Blob[];
  setRecordedChunks: (chunks: Blob[]) => void;
  pushRecordedChunk: (chunk: Blob) => void;
  getSkipPipeline: () => boolean;
  setSkipPipeline: (skip: boolean) => void;
  getSkipNotice: () => string;
  setSkipNotice: (notice: string) => void;
  setLastSavedRecordingId: (id: string) => void;
}

let controllerDeps!: RecordingControllerDeps;
let controllerState!: RecordingControllerState;

// F-007: every capture gets a generation. A cancel targeting a specific
// generation always wins, even if the state machine has not flipped yet, and
// a finalize whose generation was superseded never reaches the pipeline.
let activePipelineGen = 0;

/// True while the in-flight capture is owned by the Rust backend.
let activeCaptureNative = false;

/// Device that produced the in-flight capture, for notices about it.
let activeCaptureDevice = "";

export function getActivePipelineGen(): number {
  return activePipelineGen;
}

/**
 * Cancel the pipeline for a specific capture generation (F-007). Returns true
 * when the cancel applied to the live generation; a stale gen is a no-op so a
 * late release cannot kill the next recording.
 */
export function cancelPipeline(gen: number): boolean {
  if (gen !== activePipelineGen) {
    return false;
  }
  controllerDeps.log(`[record.cancel] canceled generation=${gen}`);
  controllerState.setSkipPipeline(true);
  controllerState.setSkipNotice("Canceled.");
  if (controllerDeps.getStage() === "recording") {
    stopRecording({ cancelPipeline: true });
  } else {
    controllerDeps.transition({ type: "stop-recording", cancelPipeline: true });
  }
  return true;
}

export function initRecordingController(
  deps: RecordingControllerDeps,
  state: RecordingControllerState,
): void {
  controllerDeps = deps;
  controllerState = state;
}

export async function startRecording(): Promise<void> {
  const startRequestedAt = controllerDeps.performanceNow();
  activePipelineGen += 1;
  // Capture the paste target now, while focus is still where the user was
  // working. By paste time (seconds later) focus may sit in our own window.
  try {
    controllerDeps.notePasteTarget?.();
  } catch {
    // Best-effort only; the paste path falls back to invoke-time focus.
  }
  controllerDeps.log(
    `[record.start] requested stage=${controllerDeps.getStage()} pipelineRunning=${boolFlag(
      controllerDeps.isPipelineRunning(),
    )} holdCount=${controllerDeps.getHoldCount()} commandModeArmed=${boolFlag(controllerDeps.getCommandModeArmed())}`,
  );
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    controllerDeps.log("[record.start] blocked because browser media recording APIs are unavailable");
    controllerDeps.clearCaptureIntent();
    controllerDeps.transition({ type: "recording-failed", reason: "Media APIs unavailable." });
    return;
  }

  const foregroundCheckStartedAt = controllerDeps.performanceNow();
  if (await controllerDeps.shouldBlockFromForegroundApp()) {
    controllerDeps.log(
      `[record.start] blocked by foreground app policy after ${Math.round(
        controllerDeps.performanceNow() - foregroundCheckStartedAt,
      )}ms`,
    );
    controllerDeps.log("[record.start] blocked by foreground app policy");
    controllerDeps.clearCaptureIntent();
    controllerDeps.clearPushToTalkHolds();
    return;
  }

  const activeSettings = controllerDeps.readSettings();
  controllerDeps.log(`[record.start] settings ${controllerDeps.summarizeSettings(activeSettings)}`);
  if (controllerDeps.getCommandModeArmed()) {
    controllerDeps.log("[record.start] command mode was armed; capturing selection snapshot");
    controllerDeps.primeSelectionSnapshot();
  }
  if (missingApiKeyForOnlineRuntime(activeSettings)) {
    controllerDeps.log(
      `[record.start.blocked] missing-api-key stt=${activeSettings.sttRuntimeMode} ai=${activeSettings.aiRuntimeMode} remember=${boolFlag(
        activeSettings.rememberApiKey,
      )}`,
    );
    controllerDeps.clearCaptureIntent();
    controllerDeps.clearPushToTalkHolds();
    controllerDeps.showMissingApiKeyNotice("record-start");
    return;
  }

  // F-029: refuse an unusable runtime combination before opening the mic, so
  // the user is not asked to speak into a pipeline that cannot run.
  const invalidCombination = invalidRuntimeCombinationReason(activeSettings);
  if (invalidCombination) {
    controllerDeps.log(`[record.start.blocked] invalid-runtime-combination: ${invalidCombination}`);
    controllerDeps.clearCaptureIntent();
    controllerDeps.clearPushToTalkHolds();
    controllerDeps.setNotice(invalidCombination, true);
    return;
  }

  // Which backend produced the in-flight capture. Read once at start so a
  // setting change mid-recording cannot strand the other backend's teardown.
  const useNativeCapture =
    activeSettings.captureBackend === "native" && controllerDeps.isTauri();

  const completeStart = (): void => {
    controllerDeps.transition({ type: "recording-ready" });
    if (controllerDeps.getCaptureIntentStartedAt() > 0) {
      controllerDeps.log(
        `[record.intent.ready] source=${controllerDeps.getCaptureIntentLabel() || "unknown"} totalMs=${Math.round(
          controllerDeps.performanceNow() - controllerDeps.getCaptureIntentStartedAt(),
        )}`,
      );
      controllerDeps.clearCaptureIntent();
    }
    controllerDeps.syncAvailability();
  };

  if (useNativeCapture) {
    try {
      const captureStartedAt = controllerDeps.performanceNow();
      const info = await startNativeCapture(selectedMicrophoneLabel());
      activeCaptureNative = true;
      activeCaptureDevice = info.deviceName;
      controllerState.setMediaRecorder(null);
      controllerState.setRecordedChunks([]);
      controllerState.setRecorderMimeType("audio/wav");
      controllerDeps.setMicrophonePermissionGranted(true);
      startNativeAmplitudeMonitoring(nativeCaptureLevel);
      beginRecordingTicker();
      controllerDeps.log(
        `[record.start] native capture device='${info.deviceName}' rate=${info.sampleRate} fallback=${boolFlag(
          info.fallbackUsed,
        )} openMs=${Math.round(controllerDeps.performanceNow() - captureStartedAt)}`,
      );
      completeStart();
    } catch (error) {
      activeCaptureNative = false;
      controllerDeps.log(`[record.start] native capture failed: ${asErrorMessage(error)}`);
      controllerDeps.clearCaptureIntent();
      controllerDeps.transition({
        type: "recording-failed",
        reason: `Microphone access failed: ${asErrorMessage(error)}`,
      });
      controllerDeps.syncAvailability();
    }
    return;
  }

  const recorderOptions: MediaRecorderOptions = {};

  const preferredMimeType = pickBestRecorderMimeType();
  if (preferredMimeType) {
    recorderOptions.mimeType = preferredMimeType;
  }
  const preferredBitrate = resolvePreferredOnlineSttBitrate(activeSettings);
  recorderOptions.audioBitsPerSecond = preferredBitrate ?? 96_000;
  controllerDeps.log(
    `[record.start] opening microphone device=${
      activeSettings.microphoneDeviceId || "default"
    } preferredMime=${preferredMimeType || "auto"} bitrate=${recorderOptions.audioBitsPerSecond}`,
  );

  try {
    const micOpenStartedAt = controllerDeps.performanceNow();
    const stream = await openMicrophoneStream(activeSettings.microphoneDeviceId);
    controllerState.setMediaStream(stream);
    activeCaptureDevice = stream.getAudioTracks()[0]?.label ?? "";
    controllerDeps.setMicrophonePermissionGranted(true);
    controllerDeps.log(
      `[record.start] microphone stream opened tracks=${stream.getAudioTracks().length} openMs=${Math.round(
        controllerDeps.performanceNow() - micOpenStartedAt,
      )}`,
    );

    const recorderInitStartedAt = controllerDeps.performanceNow();
    const mediaRecorder = new MediaRecorder(stream, recorderOptions);
    controllerState.setMediaRecorder(mediaRecorder);
    controllerState.setRecorderMimeType(mediaRecorder.mimeType || preferredMimeType || "audio/webm");
    controllerState.setRecordedChunks([]);
    startAmplitudeMonitoring(stream);

    mediaRecorder.addEventListener("dataavailable", (event: BlobEvent) => {
      if (event.data.size > 0) {
        controllerState.pushRecordedChunk(event.data);
      }
    });

    mediaRecorder.addEventListener("error", () => {
      controllerDeps.log("[record.start] media recorder emitted error event");
      controllerDeps.transition({ type: "recording-failed", reason: "Recording failed due to media recorder error." });
    });

    mediaRecorder.addEventListener("stop", () => {
      controllerDeps.log("[record.start] media recorder stop event received");
      void finalizeRecording();
    });

    mediaRecorder.start(180);
    const recordingReadyLatencyMs = Math.round(controllerDeps.performanceNow() - startRequestedAt);
    controllerDeps.log(
      `[record.start] media recorder started mime=${controllerState.getRecorderMimeType()} recorderInitMs=${Math.round(
        controllerDeps.performanceNow() - recorderInitStartedAt,
      )} readyMs=${recordingReadyLatencyMs}`,
    );
    completeStart();
  } catch (error) {
    controllerDeps.log(`[record.start] failed to open microphone: ${asErrorMessage(error)}`);
    controllerDeps.clearCaptureIntent();
    controllerDeps.transition({ type: "recording-failed", reason: `Microphone access failed: ${asErrorMessage(error)}` });
    controllerDeps.syncAvailability();
  }
}

export function stopRecording(options: StopRecordingOptions = {}): void {
  const cancelPipeline = Boolean(options.cancelPipeline);
  const cancelNotice = options.cancelNotice?.trim();
  const mediaRecorder = controllerState.getMediaRecorder();
  controllerDeps.log(
    `[record.stop] requested stage=${controllerDeps.getStage()} recorderState=${mediaRecorder?.state || "none"}`,
  );
  controllerDeps.clearPushToTalkHolds();

  if (activeCaptureNative) {
    controllerState.setSkipPipeline(cancelPipeline);
    controllerState.setSkipNotice(cancelPipeline ? cancelNotice || "" : "");
    stopRecordingTicker();
    stopAmplitudeMonitoring(true);

    if (cancelPipeline) {
      activeCaptureNative = false;
      void cancelNativeCapture().catch((error) => {
        controllerDeps.log(`[record.stop] native cancel failed: ${asErrorMessage(error)}`);
      });
      controllerDeps.transition({ type: "stop-recording", cancelPipeline: true });
      controllerDeps.syncAvailability();
      return;
    }

    // Rust owns this capture, so there is no recorder stop event to wait for:
    // stopping is what yields the audio, and that is finalizeRecording's job.
    controllerDeps.transition({ type: "stop-recording" });
    void finalizeRecording();
    controllerDeps.syncAvailability();
    return;
  }

  if (!mediaRecorder) {
    controllerState.setSkipPipeline(false);
    controllerState.setSkipNotice("");
    controllerDeps.log("[record.stop] no active mediaRecorder");
    return;
  }

  const recorderWasActive = mediaRecorder.state !== "inactive";
  controllerState.setSkipPipeline(cancelPipeline && recorderWasActive);
  controllerState.setSkipNotice(cancelPipeline && recorderWasActive ? cancelNotice || "" : "");

  if (recorderWasActive) {
    controllerDeps.log("[record.stop] invoking mediaRecorder.stop()");
    mediaRecorder.stop();
  }

  stopRecordingTicker();
  releaseMicrophone();
  if (cancelPipeline) {
    controllerDeps.transition({ type: "stop-recording", cancelPipeline: true });
  } else {
    controllerDeps.transition({ type: "stop-recording" });
  }
  controllerDeps.syncAvailability();
}

export async function finalizeRecording(): Promise<void> {
  const skipPipeline = controllerState.getSkipPipeline();
  const skipNotice = controllerState.getSkipNotice();
  const finalizeGen = activePipelineGen;
  controllerState.setSkipPipeline(false);
  controllerState.setSkipNotice("");

  if (skipPipeline) {
    controllerDeps.log("[record.finalize] pipeline canceled before transcription");
    controllerDeps.transition({ type: "recording-stopped", cancelPipeline: true });
    if (skipNotice) {
      controllerDeps.setNotice(skipNotice);
    }
    controllerDeps.syncAvailability();
    return;
  }

  let blob: Blob;
  let mimeType: string;
  let nativePcmBase64: string | null = null;

  if (activeCaptureNative) {
    activeCaptureNative = false;
    try {
      const captured = await stopNativeCapture();
      nativePcmBase64 = captured.rawPcmBase64;
      mimeType = "audio/wav";
      blob = new Blob([base64ToBytes(captured.wavBase64)], { type: mimeType });
      controllerDeps.log(
        `[record.finalize.native] wavBytes=${blob.size} samples=${captured.sampleCount} sampleRate=${captured.sampleRate} durationMs=${captured.durationMs}`,
      );
    } catch (error) {
      controllerDeps.log(`[record.finalize.native] failed: ${asErrorMessage(error)}`);
      controllerDeps.transition({ type: "audio-empty" });
      controllerDeps.syncAvailability();
      return;
    }
  } else {
    mimeType = controllerState.getRecorderMimeType();
    blob = new Blob(controllerState.getRecordedChunks(), { type: mimeType });
    controllerState.setRecordedChunks([]);
    controllerDeps.log(`[record.finalize] blobSize=${blob.size} mime=${mimeType}`);
  }

  if (blob.size === 0) {
    controllerDeps.log("[record.finalize] blocked because captured blob is empty");
    controllerDeps.transition({ type: "audio-empty" });
    controllerDeps.syncAvailability();
    return;
  }

  // F-007: a newer capture started while this one was finalizing; do not feed
  // the pipeline from a superseded generation (it would paste stale audio).
  if (finalizeGen !== activePipelineGen) {
    controllerDeps.log(
      `[record.finalize] dropping superseded generation=${finalizeGen} active=${activePipelineGen}`,
    );
    controllerDeps.transition({ type: "recording-stopped", cancelPipeline: true });
    controllerDeps.syncAvailability();
    return;
  }

  // A capture with no signal is a microphone problem, not a transcription one:
  // the selected device delivered silence, so say that instead of blaming STT.
  if (await (controllerDeps.captureIsSilent ?? captureIsSilent)(blob)) {
    const device = activeCaptureDevice.trim();
    controllerDeps.log(`[record.finalize] no signal from device='${device}' bytes=${blob.size}`);
    controllerDeps.transition({ type: "audio-empty" });
    controllerDeps.setNotice(
      `No audio came from ${device ? `"${device}"` : "the selected microphone"}. Check that it is switched on and not muted in Windows, or choose a different microphone.`,
      true,
    );
    controllerDeps.syncAvailability();
    return;
  }

  const liveSettings = controllerDeps.readLiveSettings();
  const saveRecordingsEnabled = liveSettings.saveRecordings && controllerDeps.isTauri();
  if (saveRecordingsEnabled) {
    try {
      await saveDictationAudio(blob, mimeType);
    } catch (error) {
      controllerDeps.log(`[record.finalize.save] failed: ${asErrorMessage(error)}`);
    }
  }

  await controllerDeps.runPipeline(
    blob,
    mimeType,
    nativePcmBase64 ? { rawPcmBase64: nativePcmBase64 } : undefined,
  );
}

export async function saveDictationAudio(
  audioBlob: Blob,
  audioMimeType: string,
): Promise<void> {
  if (!controllerDeps.isTauri()) {
    return;
  }
  const recordingStartedAt = controllerDeps.getRecordingStartedAt();
  const recordingId = `rec_${recordingStartedAt || controllerDeps.now()}_${controllerDeps.createId().replace(/-/g, "").slice(0, 8)}`;
  const audioBase64 = await blobToBase64(audioBlob);
  const base64Body = audioBase64.startsWith("data:") ? audioBase64.split(",", 2)[1] : audioBase64;
  await controllerDeps.saveDictationRecording({
    recordingId,
    mimeType: audioMimeType,
    audioBase64: base64Body,
  });
  controllerState.setLastSavedRecordingId(recordingId);
  controllerDeps.log(
    `[record.finalize.save] saved id=${recordingId} bytes=${audioBlob.size} mime=${audioMimeType}`,
  );
  controllerDeps.refreshRecordingsStorageHint();
}
