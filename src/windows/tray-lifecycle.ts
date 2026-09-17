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

export interface TrayLifecycleDeps {
  isTauri: () => boolean;
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
