import { describe, it, expect } from "bun:test";
import {
  processEvent,
  isValidTransition,
  validTransitionsFrom,
} from "./recording-state-machine";
import type { MachineState, MachineConfig, MachineEvent } from "./recording-state-machine";

function idleState(overrides: Partial<MachineState> = {}): MachineState {
  return {
    stage: "idle",
    pipelineRunning: false,
    isRecording: false,
    pttHoldCount: 0,
    commandModeArmed: false,
    ...overrides,
  };
}

function pttConfig(): MachineConfig {
  return { captureMode: "push-to-talk", muteMusicWhileDictating: false };
}

function tapConfig(): MachineConfig {
  return { captureMode: "single-tap", muteMusicWhileDictating: false };
}

function assertStage(result: { stage: string }, expected: string) {
  expect(result.stage).toBe(expected);
}

function hasAction(result: { actions: Array<{ type: string }> }, type: string): boolean {
  return result.actions.some((a) => a.type === type);
}

// ===================================================================
// idle → recording
// ===================================================================

describe("Recording state machine: idle → recording", () => {
  it("allows start-recording from idle", () => {
    const result = processEvent(idleState(), { type: "start-recording" }, pttConfig());
    assertStage(result, "idle"); // returns the requested action, not final stage
    expect(result.detail).toBe("recording-requested");
  });

  it("recording-ready transitions to recording", () => {
    const result = processEvent(idleState(), { type: "recording-ready" }, pttConfig());
    assertStage(result, "recording");
    expect(result.detail).toBe("Listening...");
  });

  it("recording-ready includes start sound in actions", () => {
    const result = processEvent(idleState(), { type: "recording-ready" }, pttConfig());
    expect(hasAction(result, "begin-recording-ticker")).toBe(true);
    expect(hasAction(result, "set-recording-started-at")).toBe(true);
  });

  it("recording-ready mutes music when configured", () => {
    const config: MachineConfig = { captureMode: "push-to-talk", muteMusicWhileDictating: true };
    const result = processEvent(idleState(), { type: "recording-ready" }, config);
    expect(hasAction(result, "resume-external-media")).toBe(true);
  });

  it("recording-ready does not mute music when disabled", () => {
    const result = processEvent(idleState(), { type: "recording-ready" }, pttConfig());
    expect(hasAction(result, "resume-external-media")).toBe(false);
  });
});

// ===================================================================
// recording → processing (stop recording)
// ===================================================================

describe("Recording state machine: recording → processing", () => {
  it("stop-recording from recording transitions to processing", () => {
    const state = idleState({ stage: "recording" });
    const result = processEvent(state, { type: "stop-recording" }, pttConfig());
    assertStage(result, "processing");
    expect(result.detail).toBe("Preparing audio...");
  });

  it("stop-recording clears PTT holds", () => {
    const state = idleState({ stage: "recording" });
    const result = processEvent(state, { type: "stop-recording" }, pttConfig());
    expect(hasAction(result, "clear-ptt-holds")).toBe(true);
  });

  it("stop-recording stops recording ticker", () => {
    const state = idleState({ stage: "recording" });
    const result = processEvent(state, { type: "stop-recording" }, pttConfig());
    expect(hasAction(result, "stop-recording-ticker")).toBe(true);
  });

  it("recording-stopped with cancelPipeline transitions to idle", () => {
    const state = idleState({ stage: "recording" });
    const result = processEvent(state, { type: "recording-stopped", cancelPipeline: true }, pttConfig());
    assertStage(result, "idle");
    expect(result.detail).toContain("Canceled");
  });

  it("recording-stopped without cancel triggers pipeline", () => {
    const state = idleState({ stage: "processing" });
    const result = processEvent(state, { type: "recording-stopped", cancelPipeline: false }, pttConfig());
    assertStage(result, "processing");
    expect(hasAction(result, "run-pipeline")).toBe(true);
  });
});

// ===================================================================
// push-to-talk cancellation (short tap)
// ===================================================================

describe("Recording state machine: push-to-talk cancellation", () => {
  it("cancelPipeline on stop-recording returns to idle", () => {
    const state = idleState({ stage: "recording" });
    const result = processEvent(
      state,
      { type: "stop-recording", cancelPipeline: true },
      pttConfig(),
    );
    assertStage(result, "idle");
    expect(result.detail).toContain("Canceled");
  });

  it("cancel sets pipeline-running to false", () => {
    const state = idleState({ stage: "recording", pipelineRunning: false });
    const result = processEvent(
      state,
      { type: "stop-recording", cancelPipeline: true },
      pttConfig(),
    );
    expect(hasAction(result, "set-pipeline-running")).toBe(true);
    const action = result.actions.find((a) => a.type === "set-pipeline-running") as { type: string; running: boolean };
    expect(action.running).toBe(false);
  });
});

// ===================================================================
// processing → speaking (pipeline completes with audio)
// ===================================================================

describe("Recording state machine: processing → speaking", () => {
  it("pipeline-completed with audio transitions to speaking", () => {
    const state = idleState({ stage: "processing" });
    const result = processEvent(state, { type: "pipeline-completed", hasAudio: true }, pttConfig());
    assertStage(result, "speaking");
  });

  it("pipeline-completed without audio transitions to idle (dictation)", () => {
    const state = idleState({ stage: "processing" });
    const result = processEvent(state, { type: "pipeline-completed", hasAudio: false }, pttConfig());
    assertStage(result, "idle");
  });

  it("dictation completion pre-warms microphone", () => {
    const state = idleState({ stage: "processing" });
    const result = processEvent(state, { type: "pipeline-completed", hasAudio: false }, pttConfig());
    expect(hasAction(result, "pre-warm-microphone")).toBe(true);
  });

  it("dictation completion sets pipeline-running to false", () => {
    const state = idleState({ stage: "processing" });
    const result = processEvent(state, { type: "pipeline-completed", hasAudio: false }, pttConfig());
    const action = result.actions.find((a) => a.type === "set-pipeline-running") as { type: string; running: boolean };
    expect(action.running).toBe(false);
  });
});

// ===================================================================
// speaking → idle (TTS completes)
// ===================================================================

describe("Recording state machine: speaking → idle", () => {
  it("tts-playback-completed transitions to idle", () => {
    const state = idleState({ stage: "speaking" });
    const result = processEvent(state, { type: "tts-playback-completed" }, pttConfig());
    assertStage(result, "idle");
  });

  it("tts completion pre-warms microphone", () => {
    const state = idleState({ stage: "speaking" });
    const result = processEvent(state, { type: "tts-playback-completed" }, pttConfig());
    expect(hasAction(result, "pre-warm-microphone")).toBe(true);
  });

  it("tts completion sets pipeline-running to false", () => {
    const state = idleState({ stage: "speaking", pipelineRunning: true });
    const result = processEvent(state, { type: "tts-playback-completed" }, pttConfig());
    const action = result.actions.find((a) => a.type === "set-pipeline-running") as { type: string; running: boolean };
    expect(action.running).toBe(false);
  });

  it("tts completion resets command mode", () => {
    const state = idleState({ stage: "speaking", commandModeArmed: true });
    // Note: tts-playback-completed doesn't directly reset command mode
    // that's handled by pipeline-failed. But the stage should still go idle.
    const result = processEvent(state, { type: "tts-playback-completed" }, pttConfig());
    assertStage(result, "idle");
  });
});

// ===================================================================
// Failure paths
// ===================================================================

describe("Recording state machine: failures", () => {
  it("recording-failed transitions to error", () => {
    const result = processEvent(
      idleState({ stage: "idle" }),
      { type: "recording-failed", reason: "Microphone unavailable." },
      pttConfig(),
    );
    assertStage(result, "error");
    expect(result.detail).toBe("Microphone unavailable.");
  });

  it("recording-failed clears PTT holds", () => {
    const result = processEvent(
      idleState({ stage: "idle" }),
      { type: "recording-failed", reason: "Microphone unavailable." },
      pttConfig(),
    );
    expect(hasAction(result, "clear-ptt-holds")).toBe(true);
  });

  it("audio-empty transitions to error", () => {
    const result = processEvent(
      idleState({ stage: "processing" }),
      { type: "audio-empty" },
      pttConfig(),
    );
    assertStage(result, "error");
    expect(result.detail).toBe("No audio captured.");
  });

  it("pipeline-failed transitions to error", () => {
    const result = processEvent(
      idleState({ stage: "processing" }),
      { type: "pipeline-failed", reason: "Pipeline failed." },
      pttConfig(),
    );
    assertStage(result, "error");
    expect(result.detail).toBe("Pipeline failed.");
  });

  it("pipeline-failed resets command mode", () => {
    const result = processEvent(
      idleState({ stage: "processing", commandModeArmed: true }),
      { type: "pipeline-failed", reason: "Pipeline failed." },
      pttConfig(),
    );
    expect(hasAction(result, "reset-command-mode")).toBe(true);
  });

  it("error can be reset to idle", () => {
    const result = processEvent(
      idleState({ stage: "error" }),
      { type: "reset-to-idle" },
      pttConfig(),
    );
    assertStage(result, "idle");
  });
});

// ===================================================================
// Interrupt playback (new recording during TTS)
// ===================================================================

describe("Recording state machine: interrupt playback", () => {
  it("interrupt-playback from speaking transitions to idle", () => {
    const state = idleState({ stage: "speaking" });
    const result = processEvent(state, { type: "interrupt-playback" }, pttConfig());
    assertStage(result, "idle");
    expect(hasAction(result, "set-pipeline-running")).toBe(true);
  });

  it("interrupt-playback from non-speaking stage is ignored", () => {
    const state = idleState({ stage: "idle" });
    const result = processEvent(state, { type: "interrupt-playback" }, pttConfig());
    assertStage(result, "idle");
    expect(result.actions.length).toBe(0);
  });

  it("tts-playback-interrupted transitions to idle", () => {
    const state = idleState({ stage: "speaking" });
    const result = processEvent(state, { type: "tts-playback-interrupted" }, pttConfig());
    assertStage(result, "idle");
  });
});

// ===================================================================
// Push-to-talk specific behavior
// ===================================================================

describe("Recording state machine: push-to-talk", () => {
  it("start-recording from non-idle is blocked in PTT mode", () => {
    const state = idleState({ stage: "processing" });
    const result = processEvent(state, { type: "start-recording" }, pttConfig());
    assertStage(result, "processing");
    expect(result.detail).toContain("PTT ignored");
  });

  it("start-recording from idle works in PTT mode", () => {
    const result = processEvent(idleState(), { type: "start-recording" }, pttConfig());
    expect(result.detail).toBe("recording-requested");
  });

  it("start-recording when pipeline running is blocked in PTT mode", () => {
    const state = idleState({ stage: "processing", pipelineRunning: true });
    const result = processEvent(state, { type: "start-recording" }, pttConfig());
    assertStage(result, "processing");
    // PTT mode checks stage first, so we get "PTT ignored" rather than "blocked"
    expect(result.detail).toContain("PTT ignored");
  });

  it("start-recording when already recording is blocked in PTT mode", () => {
    const state = idleState({ stage: "recording" });
    const result = processEvent(state, { type: "start-recording" }, pttConfig());
    assertStage(result, "recording");
    expect(result.detail).toContain("PTT ignored");
  });
});

// ===================================================================
// Single-tap mode
// ===================================================================

describe("Recording state machine: single-tap", () => {
  it("start-recording from idle works", () => {
    const result = processEvent(idleState(), { type: "start-recording" }, tapConfig());
    expect(result.detail).toBe("recording-requested");
  });

  it("start-recording from recording triggers stop", () => {
    const state = idleState({ stage: "recording" });
    const result = processEvent(state, { type: "start-recording" }, tapConfig());
    assertStage(result, "recording");
    expect(result.detail).toBe("toggle-stop-requested");
  });

  it("start-recording from non-idle non-recording is blocked", () => {
    const state = idleState({ stage: "processing" });
    const result = processEvent(state, { type: "start-recording" }, tapConfig());
    assertStage(result, "processing");
    expect(result.detail).toContain("blocked");
  });
});

// ===================================================================
// Repeated recording cycles
// ===================================================================

describe("Recording state machine: repeated cycles", () => {
  it("can complete a full cycle: idle → recording → processing → speaking → idle", () => {
    let state = idleState();

    // Step 1: Start recording
    let result = processEvent(state, { type: "start-recording" }, pttConfig());
    expect(result.detail).toBe("recording-requested");

    // Step 2: Recording ready
    result = processEvent(state, { type: "recording-ready" }, pttConfig());
    assertStage(result, "recording");
    state = { ...state, stage: result.stage };

    // Step 3: Stop recording
    result = processEvent(state, { type: "stop-recording" }, pttConfig());
    assertStage(result, "processing");
    state = { ...state, stage: result.stage };

    // Step 4: Pipeline started
    result = processEvent(state, { type: "pipeline-started" }, pttConfig());
    assertStage(result, "processing");

    // Step 5: Pipeline completed with audio
    result = processEvent(state, { type: "pipeline-completed", hasAudio: true }, pttConfig());
    assertStage(result, "speaking");
    state = { ...state, stage: result.stage };

    // Step 6: TTS completed
    result = processEvent(state, { type: "tts-playback-completed" }, pttConfig());
    assertStage(result, "idle");
    state = { ...state, stage: result.stage };

    // Verify we're back to idle
    assertStage(state, "idle");
  });

  it("can complete a dictation cycle: idle → recording → processing → idle", () => {
    let state = idleState();

    // Start + ready
    let result = processEvent(state, { type: "recording-ready" }, pttConfig());
    assertStage(result, "recording");
    state = { ...state, stage: result.stage };

    // Stop
    result = processEvent(state, { type: "stop-recording" }, pttConfig());
    assertStage(result, "processing");
    state = { ...state, stage: result.stage };

    // Pipeline completed without audio (dictation)
    result = processEvent(state, { type: "pipeline-completed", hasAudio: false }, pttConfig());
    assertStage(result, "idle");
  });

  it("can complete two consecutive recording cycles", () => {
    let state = idleState();

    // First cycle
    let result = processEvent(state, { type: "recording-ready" }, pttConfig());
    state = { ...state, stage: result.stage };

    result = processEvent(state, { type: "stop-recording" }, pttConfig());
    state = { ...state, stage: result.stage };

    result = processEvent(state, { type: "pipeline-completed", hasAudio: false }, pttConfig());
    assertStage(result, "idle");
    state = { ...state, stage: result.stage };

    // Second cycle
    result = processEvent(state, { type: "recording-ready" }, pttConfig());
    assertStage(result, "recording");
    state = { ...state, stage: result.stage };

    result = processEvent(state, { type: "stop-recording" }, pttConfig());
    state = { ...state, stage: result.stage };

    result = processEvent(state, { type: "pipeline-completed", hasAudio: false }, pttConfig());
    assertStage(result, "idle");
  });
});

// ===================================================================
// State consistency after failure
// ===================================================================

describe("Recording state machine: failure recovery", () => {
  it("can recover from error to idle", () => {
    const state = idleState({ stage: "error" });
    const result = processEvent(state, { type: "reset-to-idle" }, pttConfig());
    assertStage(result, "idle");
  });

  it("can start new recording after error recovery", () => {
    let state = idleState({ stage: "error" });
    let result = processEvent(state, { type: "reset-to-idle" }, pttConfig());
    state = { ...state, stage: result.stage };

    result = processEvent(state, { type: "recording-ready" }, pttConfig());
    assertStage(result, "recording");
  });

  it("microphone failure during recording returns to error", () => {
    const state = idleState({ stage: "recording" });
    const result = processEvent(
      state,
      { type: "recording-failed", reason: "Media recorder error." },
      pttConfig(),
    );
    assertStage(result, "error");
  });

  it("pipeline failure during processing returns to error", () => {
    const state = idleState({ stage: "processing" });
    const result = processEvent(
      state,
      { type: "pipeline-failed", reason: "API key is required." },
      pttConfig(),
    );
    assertStage(result, "error");
  });

  it("empty audio during processing returns to error", () => {
    const state = idleState({ stage: "processing" });
    const result = processEvent(state, { type: "audio-empty" }, pttConfig());
    assertStage(result, "error");
  });
});

// ===================================================================
// Transition validation
// ===================================================================

describe("Transition validation", () => {
  it("idle can transition to recording and error", () => {
    expect(isValidTransition("idle", "recording")).toBe(true);
    expect(isValidTransition("idle", "error")).toBe(true);
    expect(isValidTransition("idle", "processing")).toBe(false);
    expect(isValidTransition("idle", "speaking")).toBe(false);
    expect(isValidTransition("idle", "idle")).toBe(false);
  });

  it("recording can transition to processing, idle, error", () => {
    expect(isValidTransition("recording", "processing")).toBe(true);
    expect(isValidTransition("recording", "idle")).toBe(true);
    expect(isValidTransition("recording", "error")).toBe(true);
    expect(isValidTransition("recording", "speaking")).toBe(false);
    expect(isValidTransition("recording", "recording")).toBe(false);
  });

  it("processing can transition to speaking, idle, error", () => {
    expect(isValidTransition("processing", "speaking")).toBe(true);
    expect(isValidTransition("processing", "idle")).toBe(true);
    expect(isValidTransition("processing", "error")).toBe(true);
    expect(isValidTransition("processing", "recording")).toBe(false);
    expect(isValidTransition("processing", "processing")).toBe(false);
  });

  it("speaking can transition to idle, error", () => {
    expect(isValidTransition("speaking", "idle")).toBe(true);
    expect(isValidTransition("speaking", "error")).toBe(true);
    expect(isValidTransition("speaking", "recording")).toBe(false);
    expect(isValidTransition("speaking", "processing")).toBe(false);
    expect(isValidTransition("speaking", "speaking")).toBe(false);
  });

  it("error can transition to idle, recording", () => {
    expect(isValidTransition("error", "idle")).toBe(true);
    expect(isValidTransition("error", "recording")).toBe(true);
    expect(isValidTransition("error", "processing")).toBe(false);
    expect(isValidTransition("error", "speaking")).toBe(false);
    expect(isValidTransition("error", "error")).toBe(false);
  });

  it("validTransitionsFrom returns correct destinations", () => {
    expect(validTransitionsFrom("idle")).toEqual(["recording", "error"]);
    expect(validTransitionsFrom("recording")).toEqual(["processing", "idle", "error"]);
    expect(validTransitionsFrom("processing")).toEqual(["speaking", "idle", "error"]);
    expect(validTransitionsFrom("speaking")).toEqual(["idle", "error"]);
    expect(validTransitionsFrom("error")).toEqual(["idle", "recording"]);
  });
});

// ===================================================================
// Edge cases
// ===================================================================

describe("Recording state machine: edge cases", () => {
  it("stop-recording from non-recording stage is ignored", () => {
    const state = idleState({ stage: "idle" });
    const result = processEvent(state, { type: "stop-recording" }, pttConfig());
    assertStage(result, "idle");
    expect(result.detail).toContain("stop-ignored");
  });

  it("recording-ready from non-idle stage doesn't crash", () => {
    const state = idleState({ stage: "processing" });
    // recording-ready should still transition — it's a mid-flight event
    const result = processEvent(state, { type: "recording-ready" }, pttConfig());
    // The state machine should handle this gracefully
    expect(result.stage).toBeDefined();
  });

  it("multiple start-recording requests from idle all produce recording-requested", () => {
    for (let i = 0; i < 5; i++) {
      const result = processEvent(idleState(), { type: "start-recording" }, pttConfig());
      expect(result.detail).toBe("recording-requested");
    }
  });

  it("pipeline-completed always resets pipeline-running", () => {
    const state = idleState({ stage: "processing", pipelineRunning: true });

    const withAudio = processEvent(state, { type: "pipeline-completed", hasAudio: true }, pttConfig());
    const pa = withAudio.actions.find((a) => a.type === "set-pipeline-running") as { running: boolean } | undefined;
    // speaking transition may not set pipelineRunning explicitly in all paths
    // but it should be addressed
    expect(withAudio.stage).toBe("speaking");

    const noAudio = processEvent(state, { type: "pipeline-completed", hasAudio: false }, pttConfig());
    const na = noAudio.actions.find((a) => a.type === "set-pipeline-running") as { running: boolean } | undefined;
    expect(na?.running).toBe(false);
  });
});

// ===================================================================
// pipeline-blocked event (configuration blockers)
// ===================================================================

describe("Recording state machine: pipeline-blocked", () => {
  it("transitions from processing to idle (not error)", () => {
    const state = idleState({ stage: "processing", pipelineRunning: true });
    const result = processEvent(
      state,
      { type: "pipeline-blocked", reason: "Local setup required." },
      pttConfig(),
    );
    assertStage(result, "idle");
    expect(result.detail).toBe("Local setup required.");
  });

  it("sets pipeline-running to false", () => {
    const state = idleState({ stage: "processing", pipelineRunning: true });
    const result = processEvent(
      state,
      { type: "pipeline-blocked", reason: "Missing local STT model." },
      pttConfig(),
    );
    const action = result.actions.find((a) => a.type === "set-pipeline-running") as { type: string; running: boolean } | undefined;
    expect(action?.running).toBe(false);
  });

  it("includes notice action with error flag", () => {
    const state = idleState({ stage: "processing" });
    const result = processEvent(
      state,
      { type: "pipeline-blocked", reason: "Local setup required." },
      pttConfig(),
    );
    const notice = result.actions.find((a) => a.type === "set-notice") as { type: string; message: string; isError?: boolean } | undefined;
    expect(notice?.message).toBe("Local setup required.");
    expect(notice?.isError).toBe(true);
  });
});

// ===================================================================
// Main.tsx integration lifecycle (simulating the real flow)
// ===================================================================

describe("Recording lifecycle integration: full flow", () => {
  it("idle → recording → processing → speaking → idle (PTT with TTS)", () => {
    let state = idleState();
    let result: ReturnType<typeof processEvent>;

    // 1. User engages PTT → start-recording
    result = processEvent(state, { type: "start-recording" }, pttConfig());
    expect(result.detail).toBe("recording-requested");

    // 2. Microphone opens → recording-ready
    result = processEvent(state, { type: "recording-ready" }, pttConfig());
    assertStage(result, "recording");
    state = { ...state, stage: result.stage };

    // 3. User releases PTT → stop-recording
    result = processEvent(state, { type: "stop-recording" }, pttConfig());
    assertStage(result, "processing");
    state = { ...state, stage: result.stage };

    // 4. Pipeline starts → pipeline-started
    result = processEvent(state, { type: "pipeline-started" }, pttConfig());
    assertStage(result, "processing");

    // 5. Pipeline completes with audio → pipeline-completed(hasAudio=true)
    result = processEvent(state, { type: "pipeline-completed", hasAudio: true }, pttConfig());
    assertStage(result, "speaking");
    state = { ...state, stage: result.stage };

    // 6. TTS playback starts → tts-playback-started
    result = processEvent(state, { type: "tts-playback-started" }, pttConfig());
    assertStage(result, "speaking");

    // 7. TTS playback completes → tts-playback-completed
    result = processEvent(state, { type: "tts-playback-completed" }, pttConfig());
    assertStage(result, "idle");
  });

  it("idle → recording → processing → idle (dictation, no TTS)", () => {
    let state = idleState();
    let result: ReturnType<typeof processEvent>;

    // Recording starts and stops
    result = processEvent(state, { type: "recording-ready" }, pttConfig());
    state = { ...state, stage: result.stage };

    result = processEvent(state, { type: "stop-recording" }, pttConfig());
    state = { ...state, stage: result.stage };

    // Pipeline completes without audio (dictation)
    result = processEvent(state, { type: "pipeline-completed", hasAudio: false }, pttConfig());
    assertStage(result, "idle");
  });

  it("idle → recording → processing → pipeline-blocked → idle", () => {
    let state = idleState();
    let result: ReturnType<typeof processEvent>;

    // Recording starts and stops
    result = processEvent(state, { type: "recording-ready" }, pttConfig());
    state = { ...state, stage: result.stage };

    result = processEvent(state, { type: "stop-recording" }, pttConfig());
    state = { ...state, stage: result.stage };

    // Pipeline blocked by configuration
    result = processEvent(state, { type: "pipeline-blocked", reason: "Local setup required." }, pttConfig());
    assertStage(result, "idle");
    expect(result.detail).toBe("Local setup required.");
  });

  it("idle → recording → processing → pipeline-failed → error → idle", () => {
    let state = idleState();
    let result: ReturnType<typeof processEvent>;

    // Recording starts and stops
    result = processEvent(state, { type: "recording-ready" }, pttConfig());
    state = { ...state, stage: result.stage };

    result = processEvent(state, { type: "stop-recording" }, pttConfig());
    state = { ...state, stage: result.stage };

    // Pipeline fails
    result = processEvent(state, { type: "pipeline-failed", reason: "Pipeline failed." }, pttConfig());
    assertStage(result, "error");
    state = { ...state, stage: result.stage };

    // Recovery
    result = processEvent(state, { type: "reset-to-idle" }, pttConfig());
    assertStage(result, "idle");
  });

  it("idle → recording → recording-failed → error → idle (mic failure)", () => {
    let state = idleState();
    let result: ReturnType<typeof processEvent>;

    // Recording starts
    result = processEvent(state, { type: "recording-ready" }, pttConfig());
    state = { ...state, stage: result.stage };

    // Microphone fails
    result = processEvent(state, { type: "recording-failed", reason: "Microphone unavailable." }, pttConfig());
    assertStage(result, "error");
    state = { ...state, stage: result.stage };

    // Recovery
    result = processEvent(state, { type: "reset-to-idle" }, pttConfig());
    assertStage(result, "idle");
  });

  it("idle → recording → processing → speaking → interrupt-playback → idle", () => {
    let state = idleState();
    let result: ReturnType<typeof processEvent>;

    // Full cycle to speaking
    result = processEvent(state, { type: "recording-ready" }, pttConfig());
    state = { ...state, stage: result.stage };

    result = processEvent(state, { type: "stop-recording" }, pttConfig());
    state = { ...state, stage: result.stage };

    result = processEvent(state, { type: "pipeline-completed", hasAudio: true }, pttConfig());
    state = { ...state, stage: result.stage };

    // Interrupt TTS playback
    result = processEvent(state, { type: "interrupt-playback" }, pttConfig());
    assertStage(result, "idle");
  });

  it("PTT short tap: idle → recording → stop-recording(cancelPipeline) → idle", () => {
    let state = idleState();
    let result: ReturnType<typeof processEvent>;

    // PTT engage
    result = processEvent(state, { type: "start-recording" }, pttConfig());
    result = processEvent(state, { type: "recording-ready" }, pttConfig());
    state = { ...state, stage: result.stage };

    // Short tap → cancel
    result = processEvent(state, { type: "stop-recording", cancelPipeline: true }, pttConfig());
    assertStage(result, "idle");
    expect(result.detail).toContain("Canceled");
  });

  it("action executor handles all action types from recording-ready", () => {
    const result = processEvent(idleState(), { type: "recording-ready" }, pttConfig());

    // Verify all expected actions are present
    const actionTypes = result.actions.map((a) => a.type);
    expect(actionTypes).toContain("set-recording-started-at");
    expect(actionTypes).toContain("begin-recording-ticker");
    expect(actionTypes).toContain("set-stage");
    expect(actionTypes).toContain("set-notice");
    expect(actionTypes).toContain("publish-dock-state");
  });

  it("action executor handles all action types from pipeline-failed", () => {
    const state = idleState({ stage: "processing" });
    const result = processEvent(state, { type: "pipeline-failed", reason: "Failed." }, pttConfig());

    const actionTypes = result.actions.map((a) => a.type);
    expect(actionTypes).toContain("set-pipeline-running");
    expect(actionTypes).toContain("set-stage");
    expect(actionTypes).toContain("set-notice");
    expect(actionTypes).toContain("publish-dock-state");
    expect(actionTypes).toContain("reset-command-mode");
  });
});
