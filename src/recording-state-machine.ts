/**
 * Recording state machine — pure state transition logic extracted from main.tsx.
 *
 * This module contains NO DOM, NO MediaRecorder, NO Tauri invocations.
 * It models the valid state transitions and determines the outcome of each
 * event. The caller (main.tsx) is responsible for executing the actual
 * side effects based on the returned outcome.
 *
 * States: idle | recording | processing | speaking | error
 *
 * The actual pipeline stages in the product are:
 *   idle → recording → processing → speaking → idle
 *                                  ↘ (dictation, no TTS) → idle
 *
 * Plus error transitions from any state.
 */

import type { Stage } from "./types";

// ===== Types =====

/** All events that can trigger a state transition. */
export type MachineEvent =
  | { type: "start-recording" }
  | { type: "recording-ready" }
  | { type: "recording-failed"; reason: string }
  | { type: "stop-recording"; cancelPipeline?: boolean }
  | { type: "recording-stopped"; cancelPipeline?: boolean }
  | { type: "audio-captured" }
  | { type: "audio-empty" }
  | { type: "pipeline-started" }
  | { type: "pipeline-completed"; hasAudio: boolean }
  | { type: "pipeline-failed"; reason: string }
  | { type: "pipeline-blocked"; reason: string }
  | { type: "tts-playback-started" }
  | { type: "tts-playback-completed" }
  | { type: "tts-playback-interrupted" }
  | { type: "interrupt-playback" }
  | { type: "reset-to-idle" };

/** Describes the outcome of processing an event. */
export interface TransitionResult {
  /** The next state to enter. */
  stage: Stage;
  /** Human-readable description of the transition for logging/UI. */
  detail: string;
  /** Actions the caller should execute. */
  actions: TransitionAction[];
}

/** Actions the caller should execute as side effects of a transition. */
export type TransitionAction =
  | { type: "set-stage"; stage: Stage; detail: string }
  | { type: "set-notice"; message: string; isError?: boolean }
  | { type: "play-sound"; when: "start" | "stop" }
  | { type: "release-recorder" }
  | { type: "clear-chunks" }
  | { type: "clear-ptt-holds" }
  | { type: "pre-warm-microphone" }
  | { type: "resume-external-media" }
  | { type: "run-pipeline" }
  | { type: "skip-pipeline"; notice: string; detail: string }
  | { type: "set-pipeline-running"; running: boolean }
  | { type: "set-recording-started-at"; timestamp: number }
  | { type: "begin-recording-ticker" }
  | { type: "stop-recording-ticker" }
  | { type: "start-amplitude-monitoring" }
  | { type: "stop-amplitude-monitoring" }
  | { type: "publish-dock-state" }
  | { type: "reset-command-mode" };

/** Configuration affecting transition behavior. */
export interface MachineConfig {
  captureMode: "single-tap" | "push-to-talk";
  muteMusicWhileDictating: boolean;
}

/** Current machine state snapshot. */
export interface MachineState {
  stage: Stage;
  pipelineRunning: boolean;
  isRecording: boolean;
  pttHoldCount: number;
  commandModeArmed: boolean;
}

// ===== State Machine =====

/**
 * Process a state machine event and return the transition result.
 *
 * This is a pure function — given the same input, it always returns the
 * same output. It does NOT mutate any external state.
 */
export function processEvent(
  state: MachineState,
  event: MachineEvent,
  config: MachineConfig,
): TransitionResult {
  switch (event.type) {
    case "start-recording":
      return handleStartRecording(state, config);
    case "recording-ready":
      return handleRecordingReady(state, config);
    case "recording-failed":
      return handleRecordingFailed(state, event.reason);
    case "stop-recording":
      return handleStopRecording(state, event.cancelPipeline ?? false);
    case "recording-stopped":
      return handleRecordingStopped(state, event.cancelPipeline ?? false);
    case "audio-captured":
      return handleAudioCaptured(state);
    case "audio-empty":
      return handleAudioEmpty(state);
    case "pipeline-started":
      return handlePipelineStarted(state);
    case "pipeline-completed":
      return handlePipelineCompleted(state, event.hasAudio);
    case "pipeline-failed":
      return handlePipelineFailed(state, event.reason);
    case "pipeline-blocked":
      return handlePipelineBlocked(state, event.reason);
    case "tts-playback-started":
      return handleTtsPlaybackStarted(state);
    case "tts-playback-completed":
      return handleTtsPlaybackCompleted(state);
    case "tts-playback-interrupted":
      return handleTtsPlaybackInterrupted(state);
    case "interrupt-playback":
      return handleInterruptPlayback(state);
    case "reset-to-idle":
      return handleResetToIdle(state);
  }
}

function handleStartRecording(
  state: MachineState,
  config: MachineConfig,
): TransitionResult {
  // In push-to-talk mode, a new recording should only start from idle
  if (config.captureMode === "push-to-talk" && state.stage !== "idle") {
    return {
      stage: state.stage,
      detail: `PTT ignored: stage is ${state.stage}`,
      actions: [],
    };
  }

  // In single-tap mode, toggle: if already recording, stop
  if (config.captureMode === "single-tap" && state.stage === "recording") {
    return {
      stage: state.stage,
      detail: "toggle-stop-requested",
      actions: [
        { type: "clear-ptt-holds" },
      ],
    };
  }

  // If pipeline is running or already recording, block
  if (state.pipelineRunning || state.stage === "recording") {
    return {
      stage: state.stage,
      detail: `blocked: pipeline=${state.pipelineRunning} stage=${state.stage}`,
      actions: [],
    };
  }

  // Block if not idle and not in a valid start state
  if (state.stage !== "idle") {
    return {
      stage: state.stage,
      detail: `blocked: stage is ${state.stage}, not idle`,
      actions: [],
    };
  }

  return {
    stage: state.stage,
    detail: "recording-requested",
    actions: [
      { type: "clear-ptt-holds" },
    ],
  };
}

function handleRecordingReady(
  _state: MachineState,
  config: MachineConfig,
): TransitionResult {
  const actions: TransitionAction[] = [
    { type: "set-recording-started-at", timestamp: Date.now() },
    { type: "begin-recording-ticker" },
    { type: "set-stage", stage: "recording", detail: "Listening..." },
    { type: "set-notice", message: "Recording started." },
    { type: "publish-dock-state" },
  ];

  if (config.muteMusicWhileDictating) {
    actions.push({ type: "resume-external-media" });
  }

  return {
    stage: "recording",
    detail: "Listening...",
    actions,
  };
}

function handleRecordingFailed(
  _state: MachineState,
  reason: string,
): TransitionResult {
  return {
    stage: "error",
    detail: reason,
    actions: [
      { type: "set-stage", stage: "error", detail: reason },
      { type: "set-notice", message: reason, isError: true },
      { type: "clear-ptt-holds" },
      { type: "stop-amplitude-monitoring" },
      { type: "release-recorder" },
      { type: "publish-dock-state" },
    ],
  };
}

function handleStopRecording(
  state: MachineState,
  cancelPipeline: boolean,
): TransitionResult {
  if (state.stage !== "recording") {
    return {
      stage: state.stage,
      detail: `stop-ignored: stage is ${state.stage}`,
      actions: [{ type: "clear-ptt-holds" }],
    };
  }

  const actions: TransitionAction[] = [
    { type: "clear-ptt-holds" },
    { type: "stop-recording-ticker" },
    { type: "release-recorder" },
    { type: "stop-amplitude-monitoring" },
  ];

  if (cancelPipeline) {
    actions.push(
      { type: "set-pipeline-running", running: false },
      { type: "set-stage", stage: "idle", detail: "Canceled before transcription." },
      { type: "set-notice", message: "Short hotkey tap detected. STT request canceled." },
    );
    return {
      stage: "idle",
      detail: "Canceled before transcription.",
      actions,
    };
  }

  actions.push(
    { type: "set-stage", stage: "processing", detail: "Preparing audio..." },
    { type: "set-notice", message: "Recording stopped. Running pipeline..." },
  );

  return {
    stage: "processing",
    detail: "Preparing audio...",
    actions,
  };
}

function handleRecordingStopped(
  _state: MachineState,
  cancelPipeline: boolean,
): TransitionResult {
  // This event fires when the MediaRecorder "stop" event fires
  // after stopRecording() was called
  if (cancelPipeline) {
    return {
      stage: "idle",
      detail: "Canceled before transcription.",
      actions: [
        { type: "clear-chunks" },
        { type: "set-stage", stage: "idle", detail: "Canceled before transcription." },
        { type: "publish-dock-state" },
      ],
    };
  }

  return {
    stage: "processing",
    detail: "processing-audio",
    actions: [
      { type: "clear-chunks" },
      { type: "run-pipeline" },
    ],
  };
}

function handleAudioCaptured(_state: MachineState): TransitionResult {
  return {
    stage: "processing",
    detail: "Transcribing...",
    actions: [
      { type: "set-stage", stage: "processing", detail: "Transcribing..." },
      { type: "set-notice", message: "Recording stopped. Running pipeline..." },
    ],
  };
}

function handleAudioEmpty(_state: MachineState): TransitionResult {
  return {
    stage: "error",
    detail: "No audio captured.",
    actions: [
      { type: "set-stage", stage: "error", detail: "No audio captured." },
      { type: "set-notice", message: "No usable audio captured. Please try again.", isError: true },
      { type: "publish-dock-state" },
    ],
  };
}

function handlePipelineStarted(_state: MachineState): TransitionResult {
  return {
    stage: "processing",
    detail: "Transcribing...",
    actions: [
      { type: "set-pipeline-running", running: true },
      { type: "set-stage", stage: "processing", detail: "Transcribing..." },
      { type: "publish-dock-state" },
    ],
  };
}

function handlePipelineCompleted(
  _state: MachineState,
  hasAudio: boolean,
): TransitionResult {
  if (hasAudio) {
    return {
      stage: "speaking",
      detail: "Playing audio...",
      actions: [
        { type: "set-stage", stage: "speaking", detail: "Playing audio..." },
        { type: "publish-dock-state" },
      ],
    };
  }

  // Dictation mode — no TTS audio
  return {
    stage: "idle",
    detail: "Pipeline completed.",
    actions: [
      { type: "set-pipeline-running", running: false },
      { type: "set-stage", stage: "idle", detail: "Ready for next request." },
      { type: "publish-dock-state" },
      { type: "pre-warm-microphone" },
    ],
  };
}

function handlePipelineFailed(
  _state: MachineState,
  reason: string,
): TransitionResult {
  return {
    stage: "error",
    detail: reason,
    actions: [
      { type: "set-pipeline-running", running: false },
      { type: "set-stage", stage: "error", detail: reason },
      { type: "set-notice", message: reason, isError: true },
      { type: "publish-dock-state" },
      { type: "reset-command-mode" },
    ],
  };
}

function handlePipelineBlocked(
  _state: MachineState,
  reason: string,
): TransitionResult {
  // Pipeline blocked by configuration (e.g., missing local model).
  // Goes to idle, not error — the user needs to configure, not retry.
  return {
    stage: "idle",
    detail: reason,
    actions: [
      { type: "set-pipeline-running", running: false },
      { type: "set-stage", stage: "idle", detail: reason },
      { type: "set-notice", message: reason, isError: true },
      { type: "publish-dock-state" },
    ],
  };
}

function handleTtsPlaybackStarted(_state: MachineState): TransitionResult {
  return {
    stage: "speaking",
    detail: "Playing Piper audio...",
    actions: [
      { type: "set-stage", stage: "speaking", detail: "Playing Piper audio..." },
      { type: "publish-dock-state" },
    ],
  };
}

function handleTtsPlaybackCompleted(_state: MachineState): TransitionResult {
  return {
    stage: "idle",
    detail: "Pipeline completed.",
    actions: [
      { type: "set-pipeline-running", running: false },
      { type: "set-stage", stage: "idle", detail: "Ready for next request." },
      { type: "set-notice", message: "Pipeline completed." },
      { type: "publish-dock-state" },
      { type: "pre-warm-microphone" },
    ],
  };
}

function handleTtsPlaybackInterrupted(_state: MachineState): TransitionResult {
  return {
    stage: "idle",
    detail: "Playback interrupted for new dictation.",
    actions: [
      { type: "set-pipeline-running", running: false },
      { type: "set-stage", stage: "idle", detail: "Playback interrupted for new dictation." },
      { type: "publish-dock-state" },
    ],
  };
}

function handleInterruptPlayback(state: MachineState): TransitionResult {
  if (state.stage !== "speaking") {
    return {
      stage: state.stage,
      detail: `interrupt-ignored: stage is ${state.stage}`,
      actions: [],
    };
  }

  return {
    stage: "idle",
    detail: "Playback interrupted.",
    actions: [
      { type: "set-pipeline-running", running: false },
      { type: "set-stage", stage: "idle", detail: "Playback interrupted." },
      { type: "publish-dock-state" },
    ],
  };
}

function handleResetToIdle(_state: MachineState): TransitionResult {
  return {
    stage: "idle",
    detail: "Reset to idle.",
    actions: [
      { type: "set-pipeline-running", running: false },
      { type: "set-stage", stage: "idle", detail: "Reset to idle." },
      { type: "publish-dock-state" },
      { type: "pre-warm-microphone" },
    ],
  };
}

// ===== Transition Validation =====

/** Set of valid state transitions in the recording lifecycle. */
const VALID_TRANSITIONS: Record<Stage, Stage[]> = {
  idle: ["recording", "error"],
  recording: ["processing", "idle", "error"],
  processing: ["speaking", "idle", "error"],
  speaking: ["idle", "error"],
  error: ["idle", "recording"],
};

/**
 * Check whether a transition from one stage to another is valid.
 * Used for assertions during development/debugging.
 */
export function isValidTransition(from: Stage, to: Stage): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get all valid destination states from a given stage.
 */
export function validTransitionsFrom(stage: Stage): Stage[] {
  return VALID_TRANSITIONS[stage] ?? [];
}
