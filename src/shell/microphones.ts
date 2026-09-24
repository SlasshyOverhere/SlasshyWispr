/**
 * Microphone enumeration — Phase 5 shell decomposition.
 *
 * Owns refreshMicrophones + updateMicrophoneSummary + the permission flag.
 * Moved verbatim from main.tsx; DOM selects and shell seams (settings,
 * persist, stage probe, capture priming, notice, escape) arrive via
 * MicrophoneDeps so this module never touches main.tsx module globals.
 */
import { escapeHtml } from "../utils";

export interface MicrophoneDeps {
  getMicrophoneDeviceId: () => string;
  setMicrophoneDeviceId: (id: string) => void;
  persist: () => void;
  getStage: () => string;
  getShowFlowBar: () => boolean;
  primeCapture: (deviceId: string, showFlowBar: boolean) => void;
  notify: (message: string, isError?: boolean) => void;
}

export interface MicrophoneElements {
  select: HTMLSelectElement;
  summary: HTMLElement;
}

let microphonePermissionGranted = false;
let micElements!: MicrophoneElements;
let micDeps!: MicrophoneDeps;

const AUTO_DETECT_LABEL = "Auto-detect";
const UNAVAILABLE_MIC_LABEL = "Selected microphone unavailable";

export function initMicrophones(elements: MicrophoneElements, deps: MicrophoneDeps): void {
  micElements = elements;
  micDeps = deps;
}

export function isMicrophonePermissionGranted(): boolean {
  return microphonePermissionGranted;
}

export function setMicrophonePermissionGranted(granted: boolean): void {
  microphonePermissionGranted = granted;
}

export function updateMicrophoneSummary(): void {
  const selected = micElements.select.selectedOptions.item(0);
  micElements.summary.textContent = selected?.value
    ? selected.textContent?.trim() || UNAVAILABLE_MIC_LABEL
    : AUTO_DETECT_LABEL;
}

function renderMicrophoneOptions(microphones: MediaDeviceInfo[], currentId: string): boolean {
  const hasCurrent = microphones.some((device) => device.deviceId === currentId);
  const options = [
    `<option value=""${currentId ? "" : " selected"}>${AUTO_DETECT_LABEL}</option>`,
    ...microphones.map((device, index) => {
      const label = device.label?.trim() || `Microphone ${index + 1}`;
      const selected = device.deviceId === currentId ? " selected" : "";
      return `<option value="${escapeHtml(device.deviceId)}"${selected}>${escapeHtml(label)}</option>`;
    }),
  ];

  if (currentId && !hasCurrent) {
    options.push(
      `<option value="${escapeHtml(currentId)}" selected>${UNAVAILABLE_MIC_LABEL}</option>`,
    );
  }

  micElements.select.innerHTML = options.join("");
  return hasCurrent;
}

/// Label of the selected microphone, as the device list shows it. The native
/// backend matches real device names, so it is handed this and not the
/// webview's opaque device id, which no audio API can resolve.
export function selectedMicrophoneLabel(): string {
  const selected = micElements?.select?.selectedOptions.item(0);
  const currentId = micDeps?.getMicrophoneDeviceId() ?? "";
  if (currentId && selected?.value !== currentId) {
    return UNAVAILABLE_MIC_LABEL;
  }
  return selected?.value ? selected.textContent?.trim() || UNAVAILABLE_MIC_LABEL : "";
}

export async function refreshMicrophones(requestPermission: boolean): Promise<void> {
  const currentId = micDeps.getMicrophoneDeviceId();

  if (!navigator.mediaDevices?.enumerateDevices) {
    renderMicrophoneOptions([], currentId);
    updateMicrophoneSummary();
    return;
  }

  try {
    if (requestPermission && !microphonePermissionGranted) {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of tempStream.getTracks()) {
        track.stop();
      }
      microphonePermissionGranted = true;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter((device) => device.kind === "audioinput");
    const hasCurrent = renderMicrophoneOptions(microphones, currentId);

    if (hasCurrent && currentId) {
      // Keep the saved ID in memory in sync with the populated dropdown.
      micDeps.setMicrophoneDeviceId(currentId);
    }
    micDeps.persist();
    updateMicrophoneSummary();

    if (requestPermission && micDeps.getStage() === "idle") {
      micDeps.primeCapture(micDeps.getMicrophoneDeviceId(), micDeps.getShowFlowBar());
    }

    if (!microphonePermissionGranted && microphones.every((device) => !device.label)) {
      micDeps.notify("Click refresh in Settings > General to grant mic permission and show device names.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    micDeps.notify(`Unable to list microphones: ${message}`, true);
  }
}
