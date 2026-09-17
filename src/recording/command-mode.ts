/**
 * Command-mode state — Phase 5 shell decomposition.
 *
 * Owns captureSelectedTextForRewrite + primeSelectionSnapshotForCommandMode
 * + setCommandModeArmed + toggleCommandModeArmed + the armed/snapshot
 * accessors. Moved verbatim from main.tsx; shell seams (IPC capture,
 * notice/log, dock publish, Tauri probe) arrive via initCommandMode so
 * this module never touches main.tsx module globals.
 */
import { asErrorMessage } from "../utils";

export interface CommandModeDeps {
  isTauri: () => boolean;
  captureSelectedText: () => Promise<string | null | undefined>;
  setNotice: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  publishDockState: () => void;
}

let commandDeps!: CommandModeDeps;
let commandModeArmed = false;
let commandSelectionSnapshot: string | null = null;

export function initCommandMode(deps: CommandModeDeps): void {
  commandDeps = deps;
}

export function isCommandModeArmed(): boolean {
  return commandModeArmed;
}

export function getCommandSelectionSnapshot(): string | null {
  return commandSelectionSnapshot;
}

export function setCommandSelectionSnapshot(snapshot: string | null): void {
  commandSelectionSnapshot = snapshot;
}

export function resetCommandMode(): void {
  commandModeArmed = false;
  commandSelectionSnapshot = null;
  commandDeps.publishDockState();
}

export async function captureSelectedTextForRewrite(options: { silent?: boolean } = {}): Promise<string> {
  if (!commandDeps.isTauri()) {
    return "";
  }

  try {
    const selected = await commandDeps.captureSelectedText();
    return String(selected ?? "");
  } catch (error) {
    if (!options.silent) {
      commandDeps.setNotice(`Unable to capture selected text: ${asErrorMessage(error)}`, true);
    }
    return "";
  }
}

export async function primeSelectionSnapshotForCommandMode(): Promise<void> {
  const selected = (await captureSelectedTextForRewrite({ silent: true })).trim();
  commandSelectionSnapshot = selected || null;
  if (commandSelectionSnapshot) {
    commandDeps.log(`selection.prime chars=${commandSelectionSnapshot.length}`);
  }
}

export function setCommandModeArmed(next: boolean): void {
  commandModeArmed = next;
  if (commandModeArmed) {
    commandDeps.setNotice("Command mode armed for the next dictation.");
    void primeSelectionSnapshotForCommandMode();
  } else {
    commandSelectionSnapshot = null;
    commandDeps.setNotice("Command mode disabled for the next dictation.");
  }
  commandDeps.publishDockState();
}

export function toggleCommandModeArmed(): void {
  setCommandModeArmed(!commandModeArmed);
}
