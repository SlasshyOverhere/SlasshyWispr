/**
 * Tray background lifecycle — Phase 5 shell decomposition.
 *
 * Owns stopNonEssentialUiPollingForTray +
 * resumeNonEssentialUiPollingAfterTray + applyMainWindowTrayVisibility +
 * initializeTrayBackgroundLifecycle. Moved verbatim from main.tsx; shell
 * seams (Tauri probe, TTS/STT polling flags, window visibility, dock
 * sync, selection-popup close, tray-hidden flag) arrive via initTrayLifecycle
 * so this module never touches main.tsx module globals.
 */
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const TRAY_COACHMARK_STORAGE_KEY = "slasshywispr-tray-coachmark-v1";

// F-028: first-hide coachmark copy. Show/Quit stay in the Rust tray menu
// (commands/windows.rs); these hints describe them so the menu needs no change.
export const TRAY_FIRST_HIDE_COACHMARK =
  "SlasshyWispr keeps running in the tray. Right-click the tray icon to Show, or Quit to exit.";

export function shouldShowTrayCoachmark(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(TRAY_COACHMARK_STORAGE_KEY) !== "seen";
  } catch {
    return false;
  }
}

export function markTrayCoachmarkSeen(storage: Pick<Storage, "setItem">): void {
  try {
    storage.setItem(TRAY_COACHMARK_STORAGE_KEY, "seen");
  } catch {
    // Private-mode storage: coachmark may repeat; harmless.
  }
}

export interface TrayLifecycleDeps {
  isTauri: () => boolean;
  /** F-028: one-line hint surface (toast/notice). Absent = silent. */
  notify?: (message: string, isError?: boolean) => void;
  isTtsSetupRunning: () => boolean;
  isLocalSttDownloadActive: () => boolean;
  stopTtsSetupPolling: () => void;
  startTtsSetupPolling: () => void;
  pollTtsSetupStatusOnce: () => void;
  stopLocalSttDownloadStatusPolling: () => void;
  startLocalSttDownloadStatusPolling: () => void;
  pollLocalSttDownloadStatusOnce: (options: { quiet: boolean }) => void;
  hideLocalSttLoadOverlay: () => void;
  closeSelectionAssistantWindow: () => Promise<void>;
  syncFloatingIndicatorWindow: () => void;
  setMainWindowHiddenToTray: (hidden: boolean) => void;
  visibilityEvent: string;
}

let trayDeps!: TrayLifecycleDeps;

export function initTrayLifecycle(deps: TrayLifecycleDeps): void {
  trayDeps = deps;
}

export function stopNonEssentialUiPollingForTray(): void {
  trayDeps.stopTtsSetupPolling();
  trayDeps.stopLocalSttDownloadStatusPolling();
  trayDeps.hideLocalSttLoadOverlay();
}

export function resumeNonEssentialUiPollingAfterTray(): void {
  if (trayDeps.isTtsSetupRunning()) {
    trayDeps.startTtsSetupPolling();
    trayDeps.pollTtsSetupStatusOnce();
  }
  if (trayDeps.isLocalSttDownloadActive()) {
    trayDeps.startLocalSttDownloadStatusPolling();
    trayDeps.pollLocalSttDownloadStatusOnce({ quiet: true });
  }
}

export async function applyMainWindowTrayVisibility(hidden: boolean): Promise<void> {
  trayDeps.setMainWindowHiddenToTray(hidden);
  if (!hidden) {
    resumeNonEssentialUiPollingAfterTray();
    // Re-sync the dock so it reappears if showDockAlways is on or a session is active
    trayDeps.syncFloatingIndicatorWindow();
    return;
  }

  stopNonEssentialUiPollingForTray();
  await trayDeps.closeSelectionAssistantWindow();
  // F-028 close-to-tray discoverability: first hide explains Show/Quit once.
  // ponytail: if this needs richer UI than a notice line, add a settings
  // toggle via NEEDS->Agent 3 (close-to-tray vs quit) instead of growing this.
  try {
    if (typeof localStorage !== "undefined" && shouldShowTrayCoachmark(localStorage)) {
      markTrayCoachmarkSeen(localStorage);
      trayDeps.notify?.(TRAY_FIRST_HIDE_COACHMARK);
    }
  } catch {
    // Coachmark is best-effort; never break tray hide.
  }
  // Keep the floating dock alive when minimizing to tray — only close it
  // if the user explicitly disabled the dock via showFlowBar setting.
  // Previously this destroyed the dock window which made it disappear
  // and it was never re-created until the next recording session.
}

export async function initializeTrayBackgroundLifecycle(): Promise<void> {
  if (!trayDeps.isTauri()) {
    return;
  }

  await listen<{ hidden?: boolean }>(trayDeps.visibilityEvent, (event) => {
    void applyMainWindowTrayVisibility(Boolean(event.payload?.hidden));
  });

  try {
    const visible = await getCurrentWindow().isVisible();
    await applyMainWindowTrayVisibility(!visible);
  } catch {
    trayDeps.setMainWindowHiddenToTray(false);
  }
}
