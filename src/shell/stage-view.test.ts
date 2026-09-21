/**
 * Stage-view move-boundary test — Phase 5 shell decomposition.
 *
 * Pins stageLabel mapping, refreshRecordButton branches (recording /
 * processing / idle with push-to-talk labels), and setStage side
 * effects (status DOM, mic prewarm on return to idle, start/stop/error
 * sounds, media mute pairing). Runs against stub elements.
 */
import { describe, it, expect, beforeEach } from "bun:test";

// bun test has no DOM document; the record button toggles an .app-frame
// class on the side. Stub querySelector at module scope.
{
  (globalThis as unknown as { document?: unknown }).document = {
    querySelector: () => ({ classList: { add() {}, remove() {} } }),
  };
}
import type { Stage } from "../types";
import {
  initStageView,
  refreshRecordButton,
  setStage,
  stageLabel,
} from "./stage-view";

function fakeDiv(): HTMLDivElement {
  return { dataset: {}, textContent: "" } as unknown as HTMLDivElement;
}

function fakeParagraph(): HTMLParagraphElement {
  return { textContent: "" } as unknown as HTMLParagraphElement;
}

function fakeButton(): HTMLButtonElement {
  return {
    textContent: "",
    disabled: false,
    dataset: {},
    classList: { add() {}, remove() {} },
  } as unknown as HTMLButtonElement;
}

function wireHarness(options: {
  stage?: Stage;
  pipelineRunning?: boolean;
  captureMode?: string;
  muting?: boolean;
  mediaMuted?: boolean;
} = {}) {
  const elements = {
    statusPill: fakeDiv(),
    statusDetail: fakeParagraph(),
    recordBtn: fakeButton(),
  };
  let stage: Stage = options.stage ?? "idle";
  const sounds: string[] = [];
  const calls: string[] = [];
  let prewarmed: string | null = null;
  initStageView(elements, {
    getStage: () => stage,
    setStageState: (next) => {
      stage = next;
    },
    getPipelineRunning: () => options.pipelineRunning ?? false,
    getCaptureMode: () => options.captureMode ?? "single-tap",
    isMutingEnabled: () => options.muting ?? false,
    isExternalMediaMuted: () => options.mediaMuted ?? false,
    getMicrophoneDeviceId: () => "mic-1",
    publishDockState: () => {
      calls.push("dock");
    },
    syncFloatingIndicatorWindow: () => {
      calls.push("float");
    },
    preWarmMicrophoneStream: (deviceId) => {
      prewarmed = deviceId;
    },
    playSoundEffect: (kind) => {
      sounds.push(kind);
    },
    pauseExternalMedia: () => {
      calls.push("mute");
    },
    resumeExternalMedia: () => {
      calls.push("unmute");
    },
  });
  return { elements, sounds, calls, prewarmed: () => prewarmed, getStage: () => stage };
}

beforeEach(() => {
  wireHarness();
});

describe("stageLabel", () => {
  it("maps every stage", () => {
    expect(stageLabel("recording")).toBe("Recording");
    expect(stageLabel("processing")).toBe("Processing");
    expect(stageLabel("speaking")).toBe("Speaking");
    expect(stageLabel("error")).toBe("Error");
    expect(stageLabel("idle")).toBe("Idle");
  });
});

describe("refreshRecordButton", () => {
  it("labels recording state for push-to-talk", () => {
    const harness = wireHarness({ stage: "recording", captureMode: "push-to-talk" });
    refreshRecordButton();
    expect(harness.elements.recordBtn.textContent).toBe("Release to Stop");
    expect(harness.elements.recordBtn.disabled).toBe(false);
  });

  it("disables the button while the pipeline runs", () => {
    const harness = wireHarness({ stage: "processing", pipelineRunning: true });
    refreshRecordButton();
    expect(harness.elements.recordBtn.textContent).toBe("Processing...");
    expect(harness.elements.recordBtn.disabled).toBe(true);
  });

  it("labels idle state per capture mode", () => {
    const harness = wireHarness({ stage: "idle", captureMode: "push-to-talk" });
    refreshRecordButton();
    expect(harness.elements.recordBtn.textContent).toBe("Hold to Talk");
  });
});

describe("setStage", () => {
  it("writes status DOM and prewarms on return to idle", () => {
    const harness = wireHarness({ stage: "processing" });
    setStage("idle", "Ready.");
    expect(harness.elements.statusPill.textContent).toBe("Idle");
    expect(harness.elements.statusDetail.textContent).toBe("Ready.");
    expect(harness.getStage()).toBe("idle");
    expect(harness.prewarmed()).toBe("mic-1");
    expect(harness.calls).toContain("dock");
  });

  it("plays start/stop sounds with media pairing", () => {
    const harness = wireHarness({ stage: "idle", muting: true });
    setStage("recording", "Go.");
    expect(harness.sounds).toEqual(["start"]);
    expect(harness.calls).toContain("mute");
    const stopper = wireHarness({ stage: "recording", mediaMuted: true });
    setStage("idle", "Done.");
    expect(stopper.sounds).toEqual(["stop"]);
    expect(stopper.calls).toContain("unmute");
  });

  it("plays stop (not error) when recording ends in error", () => {
    // recording -> error hits the stop branch, which returns early —
    // verbatim from main.tsx, the error branch is unreachable from
    // recording. The error sound fires from processing/speaking instead.
    const harness = wireHarness({ stage: "recording", pipelineRunning: true });
    setStage("error", "Boom.");
    expect(harness.sounds).toEqual(["stop"]);
    const failed = wireHarness({ stage: "processing", pipelineRunning: true });
    setStage("error", "Boom.");
    expect(failed.sounds).toEqual(["error"]);
  });
});
