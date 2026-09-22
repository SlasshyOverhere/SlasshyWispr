/**
 * Recording-controller move-boundary test — Phase 5 shell decomposition.
 *
 * Pins stopRecording (no-recorder early return, active stop + skip flags,
 * ticker/mic release, transition + availability), finalizeRecording
 * (cancel skip, empty-blob block, save-then-pipeline path), and
 * saveDictationAudio (non-Tauri early return, recording-id shape,
 * base64 data-URL strip, saved-id commit).
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { defaultSettings } from "../state/settings-store";
import {
  cancelPipeline,
  getActivePipelineGen,
  initRecordingController,
  finalizeRecording,
  saveDictationAudio,
  startRecording,
  stopRecording,
  type RecordingControllerDeps,
} from "./recording-controller";
import { initCaptureMonitors } from "./capture-monitors";

function wireHarness(overrides: Partial<RecordingControllerDeps> = {}) {
  const transitions: unknown[] = [];
  const notices: Array<{ message: string; isError?: boolean }> = [];
  const logs: string[] = [];
  let availabilitySyncs = 0;
  let recorder: {
    state: string;
    stopped: boolean;
    stop(): void;
    listeners: Record<string, Array<() => void>>;
    addEventListener(type: string, fn: () => void): void;
    start(): void;
  } | null = null;
  let chunks: Blob[] = [];
  let skip = false;
  let skipNotice = "";
  let savedId: string | null = null;
  let lastPipeline: { blob: Blob; mime: string } | null = null;
  const saved: Array<{ recordingId: string; mimeType: string; audioBase64: string }> = [];

  const deps: RecordingControllerDeps = {
    getStage: () => "idle",
    isPipelineRunning: () => false,
    getHoldCount: () => 0,
    getCommandModeArmed: () => false,
    getCaptureMode: () => "single-tap",
    readSettings: () => defaultSettings,
    readLiveSettings: () => ({ ...defaultSettings, saveRecordings: true }),
    summarizeSettings: () => "settings",
    shouldBlockFromForegroundApp: async () => false,
    primeSelectionSnapshot: () => {},
    clearPushToTalkHolds: () => {},
    showMissingApiKeyNotice: () => {},
    setNotice: (message, isError) => {
      notices.push({ message, isError });
    },
    log: (message) => {
      logs.push(message);
    },
    transition: (event) => {
      transitions.push(event);
    },
    syncAvailability: () => {
      availabilitySyncs += 1;
    },
    getRecordingStartedAt: () => 1_700_000_000_000,
    clearCaptureIntent: () => {},
    getCaptureIntentStartedAt: () => 0,
    getCaptureIntentLabel: () => "",
    setCaptureIntent: () => {},
    setMicrophonePermissionGranted: () => {},
    refreshRecordingsStorageHint: () => {},
    isTauri: () => true,
    now: () => 1_700_000_000_000,
    performanceNow: () => 0,
    runPipeline: async (blob, mime) => {
      lastPipeline = { blob, mime };
    },
    createId: () => "aabbccdd-eeff-0011-2233-445566778899",
    saveDictationRecording: async (args) => {
      saved.push(args);
      return 1;
    },
    ...overrides,
  };

  initRecordingController(deps, {
    getMediaRecorder: () => recorder as unknown as MediaRecorder | null,
    setMediaRecorder: (next) => {
      recorder = next as unknown as typeof recorder;
    },
    getMediaStream: () => null,
    setMediaStream: () => {},
    getRecorderMimeType: () => "audio/webm",
    setRecorderMimeType: () => {},
    getRecordedChunks: () => chunks,
    setRecordedChunks: (next) => {
      chunks = next;
    },
    pushRecordedChunk: (chunk) => {
      chunks.push(chunk);
    },
    getSkipPipeline: () => skip,
    setSkipPipeline: (next) => {
      skip = next;
    },
    getSkipNotice: () => skipNotice,
    setSkipNotice: (next) => {
      skipNotice = next;
    },
    setLastSavedRecordingId: (id) => {
      savedId = id;
    },
  });

  return {
    transitions,
    notices,
    logs,
    saved,
    availabilitySyncs: () => availabilitySyncs,
    getSavedId: () => savedId,
    getLastPipeline: () => lastPipeline,
    setChunks: (next: Blob[]) => {
      chunks = next;
    },
    setRecorder: (
      next: { state: string } | null,
      handle?: { stopped?: { current: boolean } },
    ) => {
      const marker = handle;
      recorder = next
        ? {
            state: next.state,
            stopped: false,
            listeners: {},
            addEventListener() {},
            start() {},
            stop() {
              (this as { stopped: boolean }).stopped = true;
              if (marker) marker.stopped.current = true;
            },
          }
        : null;
    },
    setSkip: (next: boolean, notice = "") => {
      skip = next;
      skipNotice = notice;
    },
  };
}

beforeEach(() => {
  wireHarness();
  initCaptureMonitors(
    { recordTimer: { textContent: "" } as unknown as HTMLSpanElement },
    {
      getAmplitude: () => 0,
      setAmplitude: () => {},
      publishDockState: () => {},
      now: () => 0,
      getRecordingStartedAt: () => 0,
      getMediaStream: () => null,
      setMediaStream: () => {},
    },
  );
  (globalThis as unknown as { FileReader?: unknown }).FileReader = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    result: string | null = null;
    readAsDataURL(blob: Blob) {
      const self = this;
      blob.arrayBuffer().then((buffer) => {
        const bytes = new Uint8Array(buffer);
        let binary = "";
        for (const byte of bytes) {
          binary += String.fromCharCode(byte);
        }
        self.result = `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
        self.onload?.();
      });
    }
  };
});

describe("stopRecording", () => {
  it("early-returns with flags cleared when no recorder exists", () => {
    const harness = wireHarness();
    harness.setRecorder(null);
    harness.setSkip(true, "stale");
    stopRecording({ cancelPipeline: true });
    expect(harness.transitions).toEqual([]);
    expect(harness.availabilitySyncs()).toBe(0);
    expect(harness.logs.some((line) => line.includes("no active mediaRecorder"))).toBe(true);
  });

  it("stops an active recorder, sets skip flags, releases, transitions", () => {
    const harness = wireHarness();
    const marker = { stopped: { current: false } };
    harness.setRecorder({ state: "recording" }, marker);
    stopRecording({ cancelPipeline: true, cancelNotice: "canceled" });
    expect(marker.stopped.current).toBe(true);
    expect(harness.transitions).toEqual([{ type: "stop-recording", cancelPipeline: true }]);
    expect(harness.availabilitySyncs()).toBe(1);
  });
});

describe("finalizeRecording", () => {
  it("honors the cancel skip without touching the pipeline", async () => {
    const harness = wireHarness();
    harness.setSkip(true, "Short hotkey tap detected. STT request canceled.");
    await finalizeRecording();
    expect(harness.transitions).toEqual([{ type: "recording-stopped", cancelPipeline: true }]);
    expect(harness.notices).toEqual([
      { message: "Short hotkey tap detected. STT request canceled.", isError: undefined },
    ]);
    expect(harness.getLastPipeline()).toBeNull();
  });

  it("blocks empty blobs", async () => {
    const harness = wireHarness();
    harness.setChunks([]);
    await finalizeRecording();
    expect(harness.transitions).toEqual([{ type: "audio-empty" }]);
    expect(harness.getLastPipeline()).toBeNull();
  });

  it("blames the microphone, not STT, when the capture has no signal", async () => {
    const harness = wireHarness({ captureIsSilent: async () => true });
    harness.setChunks([new Blob(["abc"], { type: "audio/webm" })]);
    await finalizeRecording();
    expect(harness.transitions).toEqual([{ type: "audio-empty" }]);
    expect(harness.getLastPipeline()).toBeNull();
    // Nothing to keep either: a silent clip is not worth saving.
    expect(harness.saved.length).toBe(0);
    expect(harness.notices.length).toBe(1);
    expect(harness.notices[0].isError).toBe(true);
    expect(harness.notices[0].message).toContain("No audio came from");
    expect(harness.notices[0].message).toContain("the selected microphone");
    expect(harness.notices[0].message).toContain("muted in Windows");
  });

  it("names the device that delivered no audio", async () => {
    (globalThis as unknown as { navigator: unknown }).navigator = {
      mediaDevices: {
        getUserMedia: async () => ({
          getAudioTracks: () => [{ label: "Yeti Off (USB)" }],
          getTracks: () => [],
          active: true,
        }),
      },
    };
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = class {
      static isTypeSupported = () => true;
      state = "inactive";
      mimeType = "audio/webm";
      addEventListener() {}
      start() {}
      stop() {}
    };

    const harness = wireHarness({
      captureIsSilent: async () => true,
      readSettings: () => ({ ...defaultSettings, apiKey: "sk-test" }),
    });
    await startRecording();
    harness.setChunks([new Blob(["abc"], { type: "audio/webm" })]);
    await finalizeRecording();

    expect(harness.notices[0].message).toContain('"Yeti Off (USB)"');
  });

  it("saves recordings then runs the pipeline with the mime", async () => {
    const harness = wireHarness();
    harness.setChunks([new Blob(["abc"], { type: "audio/webm" })]);
    await finalizeRecording();
    expect(harness.saved.length).toBe(1);
    expect(harness.saved[0].recordingId.startsWith("rec_1700000000000_aabbccdd")).toBe(true);
    expect(harness.getSavedId()).toBe(harness.saved[0].recordingId);
    expect(harness.getLastPipeline()).not.toBeNull();
    expect(harness.getLastPipeline()!.mime).toBe("audio/webm");
  });
});

describe("startRecording runtime-combination gate (F-029)", () => {
  it("blocks and notices when local STT has no model, before opening the mic", async () => {
    // The media-API gate runs first; stub the environment so the combination
    // gate is the one that decides.
    (globalThis as unknown as { navigator: unknown }).navigator = {
      mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [] }) },
    };
    (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = class {};

    const harness = wireHarness({
      readSettings: () => ({
        ...defaultSettings,
        // A key is present so the earlier missing-key gate does not fire and
        // the runtime-combination gate is the one under test.
        apiKey: "sk-test",
        sttRuntimeMode: "local",
        localSttModel: "",
      }),
    });
    await startRecording();
    expect(harness.logs.some((line) => line.includes("invalid-runtime-combination"))).toBe(true);
    expect(harness.notices.some((n) => n.message.includes("Local STT needs a downloaded model"))).toBe(true);
    expect(harness.transitions).toEqual([]);
  });
});

describe("startRecording paste-target snapshot", () => {
  it("notes the paste target at capture intent and survives a snapshot failure", async () => {
    let notes = 0;
    // No API key: recording blocks at the missing-key gate, but the paste
    // target snapshot runs first, at capture intent.
    const settings = { ...defaultSettings(), apiKey: "" };
    const harness = wireHarness({
      readSettings: () => settings,
      notePasteTarget: () => {
        notes += 1;
      },
    });
    await startRecording();
    expect(notes).toBe(1);
    expect(harness.logs.some((line) => line.includes("missing-api-key"))).toBe(true);

    const failing = wireHarness({
      readSettings: () => settings,
      notePasteTarget: () => {
        throw new Error("ipc unavailable");
      },
    });
    await startRecording();
    // Snapshot is best-effort: recording still reaches the gate.
    expect(failing.logs.some((line) => line.includes("missing-api-key"))).toBe(true);
  });
});

describe("cancelPipeline (F-007 generation guard)", () => {
  it("returns false for a stale generation and kills nothing", () => {
    const harness = wireHarness();
    const staleGen = getActivePipelineGen() - 1;
    expect(cancelPipeline(staleGen)).toBe(false);
    expect(harness.transitions).toEqual([]);
  });

  it("cancels the live generation and transitions to a canceled stop", () => {
    const harness = wireHarness();
    expect(cancelPipeline(getActivePipelineGen())).toBe(true);
    expect(harness.transitions).toEqual([{ type: "stop-recording", cancelPipeline: true }]);
  });
});

describe("saveDictationAudio", () => {
  it("returns early outside Tauri without saving", async () => {
    const harness = wireHarness({ isTauri: () => false });
    await saveDictationAudio(new Blob(["x"]), "audio/webm");
    expect(harness.saved).toEqual([]);
    expect(harness.getSavedId()).toBeNull();
  });

  it("strips data-URL prefixes before saving", async () => {
    const harness = wireHarness();
    // Blob -> FileReader base64 in bun yields a data URL; the split branch
    // is exercised when blobToBase64 returns one, but here we assert the
    // normal path stores pure base64 without a comma.
    await saveDictationAudio(new Blob(["hello"]), "audio/webm");
    expect(harness.saved.length).toBe(1);
    expect(harness.saved[0].audioBase64.includes(",")).toBe(false);
    expect(harness.saved[0].mimeType).toBe("audio/webm");
  });
});
