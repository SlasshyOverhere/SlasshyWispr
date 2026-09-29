/**
 * The double-start guard on startRecording.
 *
 * Two triggers can race: the global shortcut and the dock mic button, or a
 * repeat press during the 50-300ms the mic takes to open. Both clear every
 * caller-side check, so the guard has to live inside the controller — and it
 * has to be set before the first await, or both calls still slip past.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { RecordingControllerDeps } from "./recording-controller";

let openCalls = 0;
let openGate: Promise<void> | null = null;

mock.module("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(null),
}));

mock.module("./mic-stream", () => ({
  canPreWarmMicrophone: async () => false,
  initMicStream: () => {},
  openMicrophoneStream: async () => {
    openCalls += 1;
    if (openGate) {
      await openGate;
    }
    return { getTracks: () => [{ stop() {} }], getAudioTracks: () => [{ label: "mic" }] } as unknown as MediaStream;
  },
  preWarmMicrophoneStream: async () => {},
  releasePreWarmedStream: async () => {},
}));

const { defaultSettings } = await import("../state/settings-store");
const { initCaptureMonitors } = await import("./capture-monitors");
const { initRecordingController, startRecording } = await import("./recording-controller");

let liveStream: MediaStream | null = null;
const stoppedStreams: MediaStream[] = [];
const logLines: string[] = [];

function wireDeps(stage: () => string): RecordingControllerDeps {
  return {
    getStage: stage,
    isPipelineRunning: () => false,
    getHoldCount: () => 1,
    getCommandModeArmed: () => false,
    getCaptureMode: () => "push-to-talk",
    readSettings: () => ({
      ...defaultSettings(),
      // Hybrid still needs a key for the online AI stage, and startRecording
      // blocks before the mic without one.
      apiKey: "sk-test",
      sttRuntimeMode: "local",
      aiRuntimeMode: "online",
      localSttModel: "nvidia/parakeet-tdt-0.6b-v3",
      localOllamaModel: "llama3",
    }),
    readLiveSettings: () => ({ ...defaultSettings() }),
    summarizeSettings: () => "test",
    shouldBlockFromForegroundApp: async () => false,
    primeSelectionSnapshot: () => {},
    clearPushToTalkHolds: () => {},
    showMissingApiKeyNotice: () => {},
    setNotice: () => {},
    log: (line: string) => {
      logLines.push(line);
    },
    transition: () => {},
    syncAvailability: () => {},
    getRecordingStartedAt: () => 0,
    clearCaptureIntent: () => {},
    setMicrophonePermissionGranted: () => {},
    refreshRecordingsStorageHint: () => {},
    isTauri: () => true,
    now: () => 0,
    performanceNow: () => 0,
    runPipeline: async () => {},
    createId: () => "id",
    saveDictationRecording: async () => 1,
  } as unknown as RecordingControllerDeps;
}

beforeEach(() => {
  openCalls = 0;
  openGate = null;
  liveStream = null;
  stoppedStreams.length = 0;
  logLines.length = 0;

  // startRecording bails early unless the media APIs exist, and bun's DOM shim
  // has neither.
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    value: { getUserMedia: () => Promise.resolve(null) },
    configurable: true,
  });
  (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder = class {
    static isTypeSupported() {
      return true;
    }
    state = "inactive";
    mimeType = "audio/webm";
    addEventListener() {}
    start() {}
    stop() {}
  };

  initCaptureMonitors(
    { recordTimer: { textContent: "" } as unknown as HTMLSpanElement },
    {
      getAmplitude: () => 0,
      setAmplitude: () => {},
      publishDockState: () => {},
      now: () => 0,
      getRecordingStartedAt: () => 0,
      getMediaStream: () => liveStream,
      setMediaStream: (next) => {
        if (liveStream && liveStream !== next) {
          stoppedStreams.push(liveStream);
        }
        liveStream = next;
      },
    },
  );

  initRecordingController(wireDeps(() => "idle"), {
    getMediaRecorder: () => null,
    setMediaRecorder: () => {},
    getMediaStream: () => liveStream,
    setMediaStream: (next) => {
      liveStream = next;
    },
    getRecorderMimeType: () => "audio/webm",
    setRecorderMimeType: () => {},
    getRecordedChunks: () => [],
    setRecordedChunks: () => {},
    pushRecordedChunk: () => {},
    getSkipPipeline: () => false,
    setSkipPipeline: () => {},
    getSkipNotice: () => "",
    setSkipNotice: () => {},
    setLastSavedRecordingId: () => {},
  });
});

describe("startRecording re-entrancy", () => {
  it("opens the microphone once when two triggers race", async () => {
    // Hold the first start inside the mic open, the way a real device does.
    let unblock = () => {};
    openGate = new Promise<void>((resolve) => {
      unblock = resolve;
    });

    const first = startRecording();
    const second = startRecording();
    unblock();
    await Promise.all([first, second]);

    expect(openCalls).toBe(1);
  });

  it("rejects the second start before it can orphan the first stream", async () => {
    const first = startRecording();
    const second = startRecording();
    await Promise.all([first, second]);

    expect(logLines.filter((line) => line.includes("already live or starting")).length).toBe(1);
    // No stream was replaced, so none is left running unreferenced.
    expect(stoppedStreams.length).toBe(0);
    expect(openCalls).toBe(1);
  });
});
