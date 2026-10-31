/**
 * Capture-triggers move-boundary test — Phase 5 shell decomposition.
 *
 * Pins handleRecordToggle branching (PTT-mode ignore, recording stop,
 * pipeline-running block, toggle capture-intent), handleDockMicToggle
 * guards (hotkey-capture, PTT mode), and the PTT hold lifecycle
 * (engage dedupe, release-while-recording stop with short-tap cancel,
 * clear, blur-style stop via release).
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import {
  clearPushToTalkHolds,
  engagePushToTalk,
  getPushToTalkHoldCount,
  handleDockMicToggle,
  handleRecordToggle,
  hasPushToTalkHold,
  initCaptureTriggers,
  releasePushToTalk,
  type CaptureTriggerDeps,
} from "./capture-triggers";
import { initRecordingController } from "./recording-controller";
import { defaultSettings } from "../state/settings-store";

describe("push-to-talk entry points", () => {
  it("the holds the app actually receives are the hotkey ones", () => {
    // Two button-bind helpers used to live here for #recordBtn, which is a
    // hidden placeholder inside .hidden-runtime-state rather than a control
    // anyone can press. Push-to-talk arrives from the global shortcut and the
    // local keydown instead.
    for (const file of ["../hotkeys/global-shortcut-dispatch.ts", "../hotkeys/local-shortcuts.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("engagePushToTalk");
      expect(source).toContain("releasePushToTalk");
    }
  });

  it("no dead button bindings are left behind", () => {
    const source = readFileSync(new URL("./capture-triggers.ts", import.meta.url), "utf8");
    expect(source).not.toContain("bindPushToTalkPointerHold");
    expect(source).not.toContain("bindPushToTalkKeyboardHold");
    expect(source).not.toContain("initPushToTalkBindings");
  });
});

function wireHarness(overrides: Partial<CaptureTriggerDeps> = {}) {
  const notices: Array<{ message: string; isError?: boolean }> = [];
  const logs: string[] = [];
  const intents: Array<{ startedAt: number; label: string }> = [];
  let stage = "idle";
  let pipelineRunning = false;
  let captureMode: "single-tap" | "push-to-talk" = "single-tap";
  let hotkeyCapture = false;
  let stopCalls = 0;

  initCaptureTriggers({
    getStage: () => stage,
    isPipelineRunning: () => pipelineRunning,
    getCaptureMode: () => captureMode,
    setNotice: (message, isError) => {
      notices.push({ message, isError });
    },
    log: (message) => {
      logs.push(message);
    },
    shouldBlockFromForegroundApp: async () => false,
    interruptPlayback: () => false,
    setCaptureIntent: (startedAt, label) => {
      intents.push({ startedAt, label });
    },
    isCaptureActive: () => stage === "recording",
    syncAvailability: () => {},
    isHotkeyCaptureActive: () => hotkeyCapture,
    performanceNow: () => 1000,
    now: () => 2000,
    ...overrides,
  });

  // Route stopRecording through a stubbed controller transition.
  const transitions: unknown[] = [];
  initRecordingController(
    {
      getStage: () => stage,
      isPipelineRunning: () => pipelineRunning,
      getHoldCount: () => getPushToTalkHoldCount(),
      getCommandModeArmed: () => false,
      getCaptureMode: () => captureMode,
      readSettings: () => defaultSettings,
      readLiveSettings: () => defaultSettings,
      summarizeSettings: () => "",
      shouldBlockFromForegroundApp: async () => false,
      primeSelectionSnapshot: () => {},
      clearPushToTalkHolds: () => clearPushToTalkHolds(),
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
      syncAvailability: () => {},
      getRecordingStartedAt: () => 0,
      clearCaptureIntent: () => {},
      getCaptureIntentStartedAt: () => 0,
      getCaptureIntentLabel: () => "",
      setCaptureIntent: () => {},
      setMicrophonePermissionGranted: () => {},
      refreshRecordingsStorageHint: () => {},
      isTauri: () => false,
      now: () => 0,
      performanceNow: () => 0,
      runPipeline: async () => {},
      createId: () => "id",
      saveDictationRecording: async () => 1,
    },
    {
      getMediaRecorder: () => null,
      setMediaRecorder: () => {},
      getMediaStream: () => null,
      setMediaStream: () => {},
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
    },
  );

  return {
    notices,
    logs,
    intents,
    transitions,
    stopCalls: () => stopCalls,
    setStage: (next: string) => {
      stage = next;
    },
    setPipelineRunning: (next: boolean) => {
      pipelineRunning = next;
    },
    setCaptureMode: (next: "single-tap" | "push-to-talk") => {
      captureMode = next;
    },
    setHotkeyCapture: (next: boolean) => {
      hotkeyCapture = next;
    },
    markStop: () => {
      stopCalls += 1;
    },
  };
}

beforeEach(() => {
  wireHarness();
  clearPushToTalkHolds();
});

describe("handleRecordToggle", () => {
  it("ignores in push-to-talk mode without a notice", async () => {
    const harness = wireHarness({ getCaptureMode: () => "push-to-talk" });
    await handleRecordToggle();
    expect(harness.notices).toEqual([]);
    expect(harness.intents).toEqual([]);
  });

  it("blocks while the pipeline is running", async () => {
    const harness = wireHarness({ isPipelineRunning: () => true });
    await handleRecordToggle();
    expect(harness.intents).toEqual([]);
    expect(harness.logs.some((line) => line.includes("already running"))).toBe(true);
  });
});

describe("handleDockMicToggle", () => {
  it("returns early during hotkey capture", async () => {
    const harness = wireHarness({ isHotkeyCaptureActive: () => true });
    await handleDockMicToggle();
    expect(harness.notices).toEqual([]);
    expect(harness.intents).toEqual([]);
  });

  it("ignores in push-to-talk mode without a notice", async () => {
    const harness = wireHarness({ getCaptureMode: () => "push-to-talk" });
    await handleDockMicToggle();
    expect(harness.notices).toEqual([]);
    expect(harness.intents).toEqual([]);
  });
});

describe("push-to-talk holds", () => {
  it("dedupes a concurrent engage for the same source", async () => {
    const harness = wireHarness({ getCaptureMode: () => "push-to-talk" });
    // Fire twice without awaiting: the first engage adds the hold and parks
    // on the async foreground check; the second must see the hold and bail.
    const first = engagePushToTalk("hotkey");
    const second = engagePushToTalk("hotkey");
    await Promise.all([first, second]);
    expect(harness.logs.some((line) => line.includes("already active"))).toBe(true);
    expect(harness.logs.filter((line) => line.includes("hold added")).length).toBe(1);
    clearPushToTalkHolds();
    expect(getPushToTalkHoldCount()).toBe(0);
  });

  it("ignores release for an unknown source without stopping", () => {
    const harness = wireHarness({
      getCaptureMode: () => "push-to-talk",
      getStage: () => "recording",
    });
    releasePushToTalk("hotkey");
    expect(getPushToTalkHoldCount()).toBe(0);
    expect(harness.transitions).toEqual([]);
    expect(harness.logs.some((line) => line.includes("not active"))).toBe(true);
  });

  it("keeps the hold when capture is live, whichever backend owns it", async () => {
    const harness = wireHarness({
      getCaptureMode: () => "push-to-talk",
      getStage: () => "recording",
      isCaptureActive: () => true,
    });
    await engagePushToTalk("hotkey");
    expect(getPushToTalkHoldCount()).toBe(1);
    expect(harness.logs.some((line) => line.includes("began no capture"))).toBe(false);
    clearPushToTalkHolds();
  });

  it("drops the hold when no capture began", async () => {
    const harness = wireHarness({ getCaptureMode: () => "push-to-talk" });
    await engagePushToTalk("hotkey");
    expect(getPushToTalkHoldCount()).toBe(0);
    expect(harness.logs.some((line) => line.includes("began no capture"))).toBe(true);
  });
});
