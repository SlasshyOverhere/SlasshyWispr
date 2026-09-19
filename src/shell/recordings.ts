/**
 * Dictation recordings shell — Phase 5 shell decomposition.
 *
 * Owns formatRecordingsStorage + refreshRecordingsStorageHint +
 * handleClearRecordingsClick. Moved verbatim from main.tsx; elements and
 * shell seams (tauri probe, stats/clear ipc, notice/log, store notify)
 * arrive via initRecordings so this module never touches main.tsx
 * module globals.
 */
import {
  clearDictationRecordings as ipcClearDictationRecordings,
  listDictationRecordingsStats as ipcListDictationRecordingsStats,
} from "../ipc/client";
import type { RecordingsStats } from "../types";
import { asErrorMessage } from "../utils";

export interface RecordingsDeps {
  isTauri: () => boolean;
  notify: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  notifyStoreUpdated: () => void;
}

export interface RecordingsElements {
  clearButton: HTMLButtonElement;
  storageHint: HTMLElement;
  storageHintWeb: HTMLParagraphElement;
}

let recElements!: RecordingsElements;
let recDeps!: RecordingsDeps;

export function initRecordings(elements: RecordingsElements, deps: RecordingsDeps): void {
  recElements = elements;
  recDeps = deps;
  elements.clearButton.addEventListener("click", () => {
    void handleClearRecordingsClick();
  });
}

export function formatRecordingsStorage(stats: RecordingsStats): string {
  const files = stats.fileCount;
  const bytes = stats.totalBytes;
  let sizeLabel: string;
  if (bytes < 1024) {
    sizeLabel = `${bytes} B`;
  } else if (bytes < 1024 * 1024) {
    sizeLabel = `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 0 : 1)} KB`;
  } else if (bytes < 1024 * 1024 * 1024) {
    sizeLabel = `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  } else {
    sizeLabel = `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${files} file${files === 1 ? "" : "s"} · ${sizeLabel}`;
}

export async function refreshRecordingsStorageHint(): Promise<void> {
  if (!recDeps.isTauri()) {
    recElements.storageHint.textContent = "Desktop only";
    recElements.storageHintWeb.hidden = false;
    return;
  }
  try {
    const stats = await ipcListDictationRecordingsStats();
    recElements.storageHint.textContent = formatRecordingsStorage(stats);
  } catch (error) {
    recElements.storageHint.textContent = "Unable to read storage";
    recDeps.log(`[recordings] stats failed: ${asErrorMessage(error)}`);
  }
}

export async function handleClearRecordingsClick(): Promise<void> {
  if (!recDeps.isTauri()) {
    recDeps.notify("Recordings can only be cleared from the desktop app.");
    return;
  }
  recElements.clearButton.disabled = true;
  try {
    await ipcClearDictationRecordings();
    await refreshRecordingsStorageHint();
    recDeps.notifyStoreUpdated();
    recDeps.notify("Recordings cleared.");
  } catch (error) {
    recDeps.notify(`Unable to clear recordings: ${asErrorMessage(error)}`, true);
  } finally {
    recElements.clearButton.disabled = false;
  }
}
