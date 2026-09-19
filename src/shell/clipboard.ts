/**
 * Clipboard and auto-paste shell — Phase 5 shell decomposition.
 *
 * Owns copyToClipboard + triggerAutoPaste. Moved verbatim from main.tsx;
 * shell seams (Tauri probe, clipboard/paste IPC, notice) arrive via
 * initClipboard so this module never touches main.tsx module globals.
 */
import {
  pasteClipboardText as ipcPasteClipboardText,
  pasteTextViaClipboard as ipcPasteTextViaClipboard,
  setClipboardText as ipcSetClipboardText,
} from "../ipc/client";
import { asErrorMessage } from "../utils";

export interface ClipboardDeps {
  isTauri: () => boolean;
  notify: (message: string, isError?: boolean) => void;
}

let clipboardDeps!: ClipboardDeps;

export function initClipboard(deps: ClipboardDeps): void {
  clipboardDeps = deps;
}

export async function copyToClipboard(
  value: string,
  options: { quiet?: boolean; successMessage?: string; errorMessage?: string } = {},
): Promise<boolean> {
  try {
    if (clipboardDeps.isTauri()) {
      await ipcSetClipboardText(value);
    } else {
      await navigator.clipboard.writeText(value);
    }
    if (!options.quiet) {
      clipboardDeps.notify(options.successMessage ?? "Assistant response copied to clipboard.");
    }
    return true;
  } catch {
    if (!options.quiet) {
      clipboardDeps.notify(options.errorMessage ?? "Unable to copy response to clipboard in this environment.", true);
    }
    return false;
  }
}

export async function triggerAutoPaste(text?: string): Promise<boolean> {
  if (!clipboardDeps.isTauri()) {
    return false;
  }

  try {
    if (typeof text === "string" && text.trim().length > 0) {
      await ipcPasteTextViaClipboard(text);
    } else {
      await ipcPasteClipboardText();
    }
    return true;
  } catch (error) {
    clipboardDeps.notify(`Auto paste failed: ${asErrorMessage(error)}`, true);
    return false;
  }
}
