/**
 * Stage and record-button view — Phase 5 shell decomposition.
 *
 * Owns setStage + stageLabel + refreshRecordButton. Moved verbatim from
 * main.tsx; stage state, status/record elements, and shell seams
 * (settings, pipeline flag, dock publish, sounds, media, mic prewarm)
 * arrive via initStageView so this module never touches main.tsx globals.
 * transitionRecordingState stays in main.tsx: it is the state-machine
 * integration point that must remain beside the machine instance.
 */
import type { Stage } from "../types";

export interface StageViewElements {
  statusPill: HTMLDivElement;
  statusDetail: HTMLParagraphElement;
  recordBtn: HTMLButtonElement;
  notesQuickMicBtn: HTMLButtonElement;
}

export interface StageViewDeps {
  getStage: () => Stage;
  setStageState: (next: Stage) => void;
  getPipelineRunning: () => boolean;
  getCaptureMode: () => string;
  isMutingEnabled: () => boolean;
  isExternalMediaMuted: () => boolean;
  getMicrophoneDeviceId: () => string;
  publishDockState: () => void;
  syncFloatingIndicatorWindow: () => void;
  preWarmMicrophoneStream: (deviceId: string) => void;
  playSoundEffect: (kind: "start" | "stop" | "error") => void;
  pauseExternalMedia: () => void;
  resumeExternalMedia: () => void;
}

let stageElements!: StageViewElements;
let stageDeps!: StageViewDeps;

export function initStageView(
  elements: StageViewElements,
  deps: StageViewDeps,
): void {
  stageElements = elements;
  stageDeps = deps;
}

export function stageLabel(next: Stage): string {
  if (next === "recording") return "Recording";
  if (next === "processing") return "Processing";
  if (next === "speaking") return "Speaking";
  if (next === "error") return "Error";
  return "Idle";
}

export function setStage(next: Stage, detail: string): void {
  const previousStage = stageDeps.getStage();
  stageDeps.setStageState(next);
  stageElements.statusPill.dataset.stage = next;
  stageElements.statusPill.textContent = stageLabel(next);
  stageElements.statusDetail.textContent = detail;
  refreshRecordButton();
  stageDeps.publishDockState();
  void stageDeps.syncFloatingIndicatorWindow();

  if (previousStage !== "idle" && next === "idle") {
    stageDeps.preWarmMicrophoneStream(stageDeps.getMicrophoneDeviceId());
  }

  if (previousStage !== "recording" && next === "recording") {
    stageDeps.playSoundEffect("start");
    if (stageDeps.isMutingEnabled()) {
      stageDeps.pauseExternalMedia();
    }
    return;
  }

  if (previousStage === "recording" && next !== "recording") {
    stageDeps.playSoundEffect("stop");
    if (stageDeps.isExternalMediaMuted()) {
      stageDeps.resumeExternalMedia();
    }
    return;
  }

  if (
    previousStage !== "error" &&
    next === "error" &&
    (stageDeps.getPipelineRunning() || previousStage === "recording" || previousStage === "speaking")
  ) {
    stageDeps.playSoundEffect("error");
  }
}

export function refreshRecordButton(): void {
  const stage = stageDeps.getStage();
  const captureMode = stageDeps.getCaptureMode();
  if (stage === "recording") {
    stageElements.recordBtn.textContent =
      captureMode === "push-to-talk" ? "Release to Stop" : "Stop Recording";
    stageElements.recordBtn.classList.add("is-recording");
    stageElements.recordBtn.disabled = false;
    stageElements.notesQuickMicBtn.dataset.stage = "recording";
    stageElements.notesQuickMicBtn.disabled = false;
    document.querySelector(".app-frame")?.classList.add("is-recording");
    return;
  }

  if (stageDeps.getPipelineRunning()) {
    stageElements.recordBtn.textContent = "Processing...";
    stageElements.recordBtn.classList.remove("is-recording");
    stageElements.recordBtn.disabled = true;
    stageElements.notesQuickMicBtn.dataset.stage = "processing";
    stageElements.notesQuickMicBtn.disabled = true;
    document.querySelector(".app-frame")?.classList.remove("is-recording");
    return;
  }

  stageElements.recordBtn.textContent = captureMode === "push-to-talk" ? "Hold to Talk" : "Start Recording";
  stageElements.recordBtn.classList.remove("is-recording");
  stageElements.recordBtn.disabled = false;
  document.querySelector(".app-frame")?.classList.remove("is-recording");
  stageElements.notesQuickMicBtn.dataset.stage = "idle";
  stageElements.notesQuickMicBtn.disabled = false;
}
