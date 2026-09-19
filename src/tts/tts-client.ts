/**
 * Piper TTS setup client — Phase 5 shell decomposition.
 *
 * Owns Piper auto-setup, validation, voice download, full TTS setup
 * flow, status polling, log render, and the setup gate. Moved verbatim
 * from main.tsx; shell seams (stage guards, settings read/commit,
 * notice/stage/log, assistant refresh, availability, gate elements)
 * arrive via initTtsClient so this module never touches main.tsx
 * module globals.
 */
import {
  ensureVoiceModel as ipcEnsureVoiceModel,
  getTtsRuntimeSetupStatus as ipcGetTtsRuntimeSetupStatus,
  setupAssistantRuntime as ipcSetupAssistantRuntime,
  startTtsRuntimeSetup as ipcStartTtsRuntimeSetup,
  validatePiper as ipcValidatePiper,
} from "../ipc/client";
import type { PersistedSettings, TtsSetupStatusResponse } from "../types";
import { asErrorMessage, escapeHtml } from "../utils";

export interface TtsClientDeps {
  isBusy: () => boolean;
  readSettings: () => PersistedSettings;
  getPiperPathInput: () => string;
  setPiperPathInput: (value: string) => void;
  commitSettings: () => void;
  setNotice: (message: string, isError?: boolean) => void;
  setStage: (stage: "idle" | "processing" | "speaking" | "error", detail: string) => void;
  getStage: () => string;
  refreshAssistantInfo: () => Promise<void>;
  syncAvailability: () => void;
  updateGate: () => void;
  isSetupRunning: () => boolean;
  setSetupRunning: (running: boolean) => void;
  isPollInFlight: () => boolean;
  setPollInFlight: (inFlight: boolean) => void;
}

export interface TtsClientElements {
  setupLogs: HTMLDivElement;
  setupAllBtn: HTMLButtonElement;
  setupStatus: HTMLParagraphElement;
  setupRuntimeBtn: HTMLButtonElement;
  validatePiperBtn: HTMLButtonElement;
  downloadVoiceBtn: HTMLButtonElement;
  piperStatusValue: HTMLElement;
  piperPathValue: HTMLElement;
  voiceStatusValue: HTMLElement;
  voicePathValue: HTMLElement;
}

let ttsElements!: TtsClientElements;
let ttsDeps!: TtsClientDeps;
let ttsSetupPollingId: number | null = null;

export function initTtsClient(elements: TtsClientElements, deps: TtsClientDeps): void {
  ttsElements = elements;
  ttsDeps = deps;

  elements.setupRuntimeBtn.addEventListener("click", () => {
    void handleAutoSetupRuntime();
  });
  elements.validatePiperBtn.addEventListener("click", () => {
    void handleValidatePiper();
  });
  elements.downloadVoiceBtn.addEventListener("click", () => {
    void handleDownloadVoice();
  });
  elements.setupAllBtn.addEventListener("click", () => {
    void handleSetupAllTts();
  });
}

export function isTtsSetupPolling(): boolean {
  return ttsSetupPollingId !== null;
}

export async function handleAutoSetupRuntime(): Promise<void> {
  if (ttsDeps.isBusy()) {
    return;
  }

  ttsDeps.setStage("processing", "Downloading Piper runtime and voice model...");

  try {
    const result = await ipcSetupAssistantRuntime();
    ttsDeps.setPiperPathInput(result.piperPath);
    ttsDeps.commitSettings();

    ttsElements.piperStatusValue.textContent = "Installed";
    ttsElements.piperPathValue.textContent = result.piperPath;
    ttsElements.voiceStatusValue.textContent = "Installed";
    ttsElements.voicePathValue.textContent = result.voiceModelPath;

    ttsDeps.setNotice("Runtime setup completed.");
    ttsDeps.setStage("idle", "Runtime ready.");
  } catch (error) {
    ttsDeps.setNotice(`Auto setup failed: ${asErrorMessage(error)}`, true);
    ttsDeps.setStage("error", "Auto setup failed.");
  }

  await ttsDeps.refreshAssistantInfo();
  ttsDeps.syncAvailability();
}

export async function handleValidatePiper(): Promise<void> {
  if (ttsDeps.isBusy()) {
    return;
  }

  const piperPath = ttsDeps.getPiperPathInput().trim();
  ttsDeps.setStage("processing", "Validating Piper executable...");

  try {
    const result = await ipcValidatePiper({ piperPath: piperPath || null });

    if (result.ok) {
      ttsDeps.setNotice(`Piper is reachable: ${result.details || "help output received."}`);
      ttsDeps.setStage("idle", "Piper validated.");
    } else {
      ttsDeps.setNotice(`Piper check did not return success: ${result.details}`, true);
      ttsDeps.setStage("error", "Piper validation failed.");
    }
  } catch (error) {
    ttsDeps.setNotice(`Piper validation failed: ${asErrorMessage(error)}`, true);
    ttsDeps.setStage("error", "Piper validation failed.");
  }

  await ttsDeps.refreshAssistantInfo();
  ttsDeps.syncAvailability();
}

export async function handleDownloadVoice(): Promise<void> {
  if (ttsDeps.isBusy()) {
    return;
  }

  ttsDeps.setStage("processing", "Downloading voice model...");

  try {
    const result = await ipcEnsureVoiceModel();
    ttsElements.voiceStatusValue.textContent = "Installed";
    ttsElements.voicePathValue.textContent = result.modelPath;
    ttsDeps.setNotice(`Voice model ready: ${result.modelPath}`);
    ttsDeps.setStage("idle", "Voice model installed.");
  } catch (error) {
    ttsDeps.setNotice(`Voice download failed: ${asErrorMessage(error)}`, true);
    ttsDeps.setStage("error", "Voice download failed.");
  }

  await ttsDeps.refreshAssistantInfo();
  ttsDeps.syncAvailability();
}

export function renderTtsSetupLogs(logs: string[]): void {
  if (logs.length === 0) {
    ttsElements.setupLogs.innerHTML = '<p class="setup-log-item">No setup logs yet.</p>';
    return;
  }

  ttsElements.setupLogs.innerHTML = logs
    .slice(-200)
    .map((line) => `<p class="setup-log-item">${escapeHtml(line)}</p>`)
    .join("");
  ttsElements.setupLogs.scrollTop = ttsElements.setupLogs.scrollHeight;
}

export function applyTtsSetupStatus(status: TtsSetupStatusResponse): void {
  ttsDeps.setSetupRunning(status.running);
  ttsElements.setupAllBtn.disabled = status.running || ttsDeps.isBusy();
  ttsElements.setupStatus.textContent = status.stage || (status.running ? "Setting up..." : "Waiting for setup.");
  renderTtsSetupLogs(status.logs);
  ttsDeps.updateGate();

  if (!status.running && status.completed) {
    if (status.success) {
      ttsDeps.setNotice("Piper runtime is ready.");
      if (ttsDeps.getStage() !== "recording") {
        ttsDeps.setStage("idle", "TTS setup complete.");
      }
    } else {
      ttsDeps.setNotice("TTS setup failed. Review logs in Settings > Models.", true);
      ttsDeps.setStage("error", "TTS setup failed.");
    }
  }
}

export function stopTtsSetupPolling(): void {
  if (ttsSetupPollingId !== null) {
    window.clearInterval(ttsSetupPollingId);
    ttsSetupPollingId = null;
  }
}

export async function pollTtsSetupStatusOnce(): Promise<void> {
  if (ttsDeps.isPollInFlight()) {
    return;
  }
  ttsDeps.setPollInFlight(true);

  try {
    const status = await ipcGetTtsRuntimeSetupStatus();
    applyTtsSetupStatus(status);
    if (!status.running) {
      stopTtsSetupPolling();
      await ttsDeps.refreshAssistantInfo();
      ttsDeps.syncAvailability();
    }
  } catch (error) {
    stopTtsSetupPolling();
    ttsDeps.setSetupRunning(false);
    ttsDeps.updateGate();
    ttsDeps.setNotice(`Unable to poll TTS setup status: ${asErrorMessage(error)}`, true);
    ttsDeps.syncAvailability();
  } finally {
    ttsDeps.setPollInFlight(false);
  }
}

export function startTtsSetupPolling(): void {
  if (ttsSetupPollingId !== null) {
    return;
  }
  ttsSetupPollingId = window.setInterval(() => {
    void pollTtsSetupStatusOnce();
  }, 850);
}

export async function handleSetupAllTts(): Promise<void> {
  if (ttsDeps.isBusy()) {
    return;
  }

  ttsDeps.setStage("processing", "Setting up Piper runtime...");
  ttsElements.setupAllBtn.disabled = true;
  ttsElements.setupStatus.textContent = "Starting setup...";
  ttsDeps.syncAvailability();

  try {
    const status = await ipcStartTtsRuntimeSetup({ pythonPath: null, useGpu: false });
    applyTtsSetupStatus(status);
    startTtsSetupPolling();
    await pollTtsSetupStatusOnce();
  } catch (error) {
    ttsDeps.setSetupRunning(false);
    ttsDeps.updateGate();
    ttsDeps.setNotice(`Setup failed to start: ${asErrorMessage(error)}`, true);
    ttsDeps.setStage("error", "Setup failed to start.");
    ttsDeps.syncAvailability();
  }
}
