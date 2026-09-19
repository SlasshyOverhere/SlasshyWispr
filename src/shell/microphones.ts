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
  micElements.summary.textContent = selected?.textContent?.trim() || "Auto-detect";
}

export async function refreshMicrophones(requestPermission: boolean): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    micElements.select.innerHTML = "<option value=''>Microphone listing not supported</option>";
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

    if (microphones.length === 0) {
      micElements.select.innerHTML = "<option value=''>No microphones found</option>";
      micDeps.setMicrophoneDeviceId("");
      micDeps.persist();
      updateMicrophoneSummary();
      return;
    }

    const currentId = micDeps.getMicrophoneDeviceId();
    const hasCurrent = microphones.some((device) => device.deviceId === currentId);
    // When the saved device isn't in the current list, select the first device in
    // the dropdown for display but keep the saved ID so it persists across sessions
    // (the device may reconnect or be a transient enumeration gap).
    const displayId = hasCurrent ? currentId : microphones[0]?.deviceId ?? "";

    micElements.select.innerHTML = microphones
      .map((device, index) => {
        const label = device.label?.trim() || `Microphone ${index + 1}`;
        const selected = device.deviceId === displayId ? " selected" : "";
        return `<option value="${escapeHtml(device.deviceId)}"${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");

    if (hasCurrent) {
      // Device found — update in-memory settings to stay in sync with dropdown.
      micDeps.setMicrophoneDeviceId(currentId);
    }
    // Always persist: if device was found, we updated the id; if not, we preserve
    // the saved id so the user's choice survives restarts.
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
