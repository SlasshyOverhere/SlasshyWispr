/**
 * Capture triggers — Phase 5 shell decomposition.
 *
 * Owns handleRecordToggle + handleDockMicToggle + engagePushToTalk +
 * releasePushToTalk + clearPushToTalkHolds. Moved verbatim from main.tsx;
 * PTT hold state lives here, and shell seams (settings, stage, pipeline,
 * foreground policy, playback, capture intent, recorder probe, action
 * availability, hotkey-capture guard) arrive via initCaptureTriggers so
 * this module never touches main.tsx module globals.
 */
import { ACCIDENTAL_PTT_HOTKEY_MAX_HOLD_MS } from "../constants";
import type { CaptureMode, HoldSource } from "../types";
import { boolFlag } from "../utils";
import { startRecording, stopRecording, type StopRecordingOptions } from "./recording-controller";

export interface CaptureTriggerDeps {
  getStage: () => string;
  isPipelineRunning: () => boolean;
  getCaptureMode: () => CaptureMode;
  setNotice: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  shouldBlockFromForegroundApp: () => Promise<boolean>;
  interruptPlayback: () => boolean;
  setCaptureIntent: (startedAt: number, label: string) => void;
  getRecorderState: () => string | null;
  syncAvailability: () => void;
  isHotkeyCaptureActive: () => boolean;
  performanceNow: () => number;
  now: () => number;
}

let triggerDeps!: CaptureTriggerDeps;
const pushToTalkHoldSources = new Set<HoldSource>();
const pushToTalkHoldStartedAt = new Map<HoldSource, number>();

export function initCaptureTriggers(deps: CaptureTriggerDeps): void {
  triggerDeps = deps;
}

export function getPushToTalkHoldCount(): number {
  return pushToTalkHoldSources.size;
}

export function hasPushToTalkHold(source: HoldSource): boolean {
  return pushToTalkHoldSources.has(source);
}

export async function handleRecordToggle(): Promise<void> {
  triggerDeps.log(
    `[record.toggle] stage=${triggerDeps.getStage()} pipelineRunning=${boolFlag(
      triggerDeps.isPipelineRunning(),
    )} holdCount=${pushToTalkHoldSources.size}`,
  );
  if (triggerDeps.getCaptureMode() === "push-to-talk") {
    triggerDeps.log("[record.toggle] ignored because capture mode is push-to-talk");
    if (triggerDeps.getStage() !== "recording") {
      triggerDeps.setNotice("Push-to-talk is enabled. Hold the hotkey or mic button while speaking.");
    }
    return;
  }
  if (triggerDeps.getStage() === "recording") {
    triggerDeps.log("[record.toggle] stage is recording -> stopRecording()");
    stopRecording();
    return;
  }

  if (await triggerDeps.shouldBlockFromForegroundApp()) {
    triggerDeps.log("[record.toggle] blocked by foreground app policy");
    return;
  }

  const interruptedPlayback = triggerDeps.interruptPlayback();
  if (interruptedPlayback) {
    triggerDeps.log("[record.toggle] interrupted active TTS playback before recording");
  }

  if (triggerDeps.isPipelineRunning()) {
    triggerDeps.log("[record.toggle] blocked because pipeline is already running");
    return;
  }

  triggerDeps.log("[record.toggle] invoking startRecording()");
  triggerDeps.setCaptureIntent(triggerDeps.performanceNow(), "toggle");
  await startRecording();
}

export async function handleDockMicToggle(): Promise<void> {
  if (triggerDeps.isHotkeyCaptureActive()) {
    return;
  }

  if (triggerDeps.getCaptureMode() === "push-to-talk") {
    triggerDeps.setNotice("Push-to-talk is enabled. Hold the hotkey or mic button while speaking.");
    return;
  }

  await handleRecordToggle();
}

export async function engagePushToTalk(source: HoldSource): Promise<void> {
  triggerDeps.log(
    `[record.ptt.engage] source=${source} capture=${triggerDeps.getCaptureMode()} stage=${triggerDeps.getStage()} pipelineRunning=${boolFlag(
      triggerDeps.isPipelineRunning(),
    )} holds=${pushToTalkHoldSources.size}`,
  );
  if (triggerDeps.getCaptureMode() !== "push-to-talk") {
    triggerDeps.log("[record.ptt.engage] ignored because capture mode is not push-to-talk");
    return;
  }

  if (pushToTalkHoldSources.has(source)) {
    triggerDeps.log("[record.ptt.engage] ignored because this hold source is already active");
    return;
  }

  const holdStartedAt = triggerDeps.now();
  pushToTalkHoldSources.add(source);
  pushToTalkHoldStartedAt.set(source, holdStartedAt);
  triggerDeps.log(`[record.ptt.engage] hold added source=${source} holds=${pushToTalkHoldSources.size}`);

  if (await triggerDeps.shouldBlockFromForegroundApp()) {
    pushToTalkHoldSources.delete(source);
    pushToTalkHoldStartedAt.delete(source);
    triggerDeps.log("[record.ptt.engage] blocked by foreground app policy");
    return;
  }

  if (!pushToTalkHoldSources.has(source)) {
    triggerDeps.log("[record.ptt.engage] hold was released before capture could begin");
    return;
  }

  const interruptedPlayback = triggerDeps.interruptPlayback();
  if (interruptedPlayback) {
    triggerDeps.log("[record.ptt.engage] interrupted active TTS playback");
  }

  if (triggerDeps.isPipelineRunning() || triggerDeps.getStage() === "recording") {
    triggerDeps.log(
      `[record.ptt.engage] delayed because pipelineRunning=${boolFlag(
        triggerDeps.isPipelineRunning(),
      )} stage=${triggerDeps.getStage()}`,
    );
    return;
  }

  triggerDeps.log("[record.ptt.engage] invoking startRecording()");
  triggerDeps.setCaptureIntent(triggerDeps.performanceNow(), source);
  await startRecording();

  if (triggerDeps.getRecorderState() !== "recording") {
    triggerDeps.log(
      `[record.ptt.engage] startRecording did not reach recording state (state=${
        triggerDeps.getRecorderState() || "none"
      }); removing hold`,
    );
    pushToTalkHoldSources.delete(source);
    pushToTalkHoldStartedAt.delete(source);
    return;
  }

  if (!pushToTalkHoldSources.has(source) && pushToTalkHoldSources.size === 0) {
    const holdDurationMs = triggerDeps.now() - holdStartedAt;
    const cancelShortHotkeyTap =
      source === "hotkey" && holdDurationMs <= ACCIDENTAL_PTT_HOTKEY_MAX_HOLD_MS;
    triggerDeps.log(
      `[record.ptt.engage] hold released before recording stabilized source=${source} holdMs=${holdDurationMs} cancel=${boolFlag(
        cancelShortHotkeyTap,
      )}`,
    );
    stopRecording(
      cancelShortHotkeyTap
        ? {
            cancelPipeline: true,
            cancelNotice: "Short hotkey tap detected. STT request canceled.",
            cancelStatus: "Hotkey tap canceled.",
          }
        : undefined,
    );
  }
}

export function releasePushToTalk(source: HoldSource): void {
  const holdStartedAt = pushToTalkHoldStartedAt.get(source) ?? 0;
  pushToTalkHoldStartedAt.delete(source);
  if (!pushToTalkHoldSources.delete(source)) {
    triggerDeps.log(`[record.ptt.release] ignored because hold source is not active: ${source}`);
    return;
  }
  const holdDurationMs = holdStartedAt > 0 ? triggerDeps.now() - holdStartedAt : -1;
  const cancelShortHotkeyTap =
    source === "hotkey" &&
    holdDurationMs >= 0 &&
    holdDurationMs <= ACCIDENTAL_PTT_HOTKEY_MAX_HOLD_MS;
  triggerDeps.log(
    `[record.ptt.release] source=${source} remainingHolds=${pushToTalkHoldSources.size} holdMs=${holdDurationMs} cancel=${boolFlag(
      cancelShortHotkeyTap,
    )}`,
  );

  if (triggerDeps.getStage() === "recording" && pushToTalkHoldSources.size === 0) {
    triggerDeps.log("[record.ptt.release] no holds left while recording -> stopRecording()");
    stopRecording(
      cancelShortHotkeyTap
        ? {
            cancelPipeline: true,
            cancelNotice: "Short hotkey tap detected. STT request canceled.",
            cancelStatus: "Hotkey tap canceled.",
          }
        : undefined,
    );
    return;
  }
}

export function clearPushToTalkHolds(): void {
  if (pushToTalkHoldSources.size > 0) {
    triggerDeps.log(`[record.ptt.clear] clearing holds=${pushToTalkHoldSources.size}`);
  }
  pushToTalkHoldSources.clear();
  pushToTalkHoldStartedAt.clear();
}

export type { StopRecordingOptions };

export interface PushToTalkBindDeps {
  isPushToTalkMode: () => boolean;
}

let bindDeps: PushToTalkBindDeps | null = null;

export function initPushToTalkBindings(deps: PushToTalkBindDeps): void {
  bindDeps = deps;
}

function isPushToTalkMode(): boolean {
  return bindDeps ? bindDeps.isPushToTalkMode() : false;
}

export function bindPushToTalkPointerHold(button: HTMLButtonElement, source: HoldSource): void {
  button.addEventListener("pointerdown", (event) => {
    if (!isPushToTalkMode()) {
      return;
    }
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    void engagePushToTalk(source);
  });

  const release = (event: PointerEvent): void => {
    if (event.type === "pointerup" && event.button !== 0) {
      return;
    }

    if (button.hasPointerCapture(event.pointerId)) {
      button.releasePointerCapture(event.pointerId);
    }
    releasePushToTalk(source);
  };

  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", () => {
    releasePushToTalk(source);
  });
}

export function bindPushToTalkKeyboardHold(button: HTMLButtonElement, source: HoldSource): void {
  let keyboardHoldActive = false;

  button.addEventListener("keydown", (event) => {
    if (!isPushToTalkMode()) {
      return;
    }
    if (event.repeat || (event.key !== " " && event.key !== "Enter")) {
      return;
    }

    event.preventDefault();
    if (keyboardHoldActive) {
      return;
    }
    keyboardHoldActive = true;
    void engagePushToTalk(source);
  });

  button.addEventListener("keyup", (event) => {
    if (!keyboardHoldActive || (event.key !== " " && event.key !== "Enter")) {
      return;
    }
    event.preventDefault();
    keyboardHoldActive = false;
    releasePushToTalk(source);
  });

  button.addEventListener("blur", () => {
    if (!keyboardHoldActive) {
      return;
    }
    keyboardHoldActive = false;
    releasePushToTalk(source);
  });
}
