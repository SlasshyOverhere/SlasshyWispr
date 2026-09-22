/**
 * Tauri shell helpers — Phase 5 shell decomposition.
 *
 * Owns the Tauri-environment shell seams: isTauriEnvironment,
 * openInSystemBrowser, setupCustomWindowControls, requestLaunchAtLoginSync,
 * reconcileLaunchAtLoginWithOs, requestShellIntegrationSync,
 * reconcileShellIntegrationWithOs, and the descriptions for the corrections
 * those reconciles report. Moved verbatim from main.tsx; window
 * buttons, launch-at-login preference, and shell seams (open-external,
 * window control, launch IPC, notice, log) arrive via initTauriShell so
 * this module never touches main.tsx module globals.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";
import {
  configureLaunchAtLogin as ipcConfigureLaunchAtLogin,
  configureShellIntegration as ipcConfigureShellIntegration,
  launchAtLoginStatus as ipcLaunchAtLoginStatus,
  shellIntegrationStatus as ipcShellIntegrationStatus,
} from "../ipc/client";
import { asErrorMessage } from "../utils";

export interface TauriShellElements {
  windowMinimizeBtn: HTMLButtonElement;
  windowCloseBtn: HTMLButtonElement;
}

export interface TauriShellDeps {
  isTauri: () => boolean;
  getLaunchAtLogin: () => boolean;
  getShellIntegration: () => boolean;
  notify: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
}

let shellElements!: TauriShellElements;
let shellDeps!: TauriShellDeps;
let launchAtLoginSyncNonce = 0;
let shellIntegrationSyncNonce = 0;

export function initTauriShell(
  elements: TauriShellElements,
  deps: TauriShellDeps,
): void {
  shellElements = elements;
  shellDeps = deps;
}

export function isTauriEnvironment(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

export function openInSystemBrowser(url: string): void {
  void openExternalUrl(url).catch((error: unknown) => {
    shellDeps.log(`[shell] failed to open link: ${asErrorMessage(error)}`);
  });
}

export function setupCustomWindowControls(): void {
  if (!shellDeps.isTauri()) {
    shellElements.windowMinimizeBtn.disabled = true;
    shellElements.windowCloseBtn.disabled = true;
    return;
  }

  const appWindow = getCurrentWindow();

  shellElements.windowMinimizeBtn.addEventListener("click", () => {
    void appWindow.minimize().catch((error) => {
      shellDeps.log(`[shell] minimize failed: ${asErrorMessage(error)}`);
    });
  });

  shellElements.windowCloseBtn.addEventListener("click", () => {
    void appWindow.close().catch((error) => {
      shellDeps.log(`[shell] close failed: ${asErrorMessage(error)}`);
    });
  });
}

export function requestLaunchAtLoginSync(enabled: boolean): void {
  if (!shellDeps.isTauri()) {
    return;
  }

  const syncNonce = ++launchAtLoginSyncNonce;
  void ipcConfigureLaunchAtLogin(enabled).catch((error) => {
    if (syncNonce !== launchAtLoginSyncNonce) {
      return;
    }
    shellDeps.notify(`Launch-at-login update failed: ${asErrorMessage(error)}`, true);
  });
}

export interface LaunchAtLoginCorrection {
  action: "reapplied" | "removed";
  /** What the OS registry held before the repair. */
  storedValue: string | null;
}

export async function reconcileLaunchAtLoginWithOs(): Promise<LaunchAtLoginCorrection | null> {
  if (!shellDeps.isTauri()) {
    return null;
  }
  try {
    const status = await ipcLaunchAtLoginStatus();
    const wanted = shellDeps.getLaunchAtLogin();
    if (wanted && (!status.enabled || !status.path_matches)) {
      shellDeps.log(
        `[startup] launch-at-login registry stale — reapplying wanted=${wanted} stored=${
          status.stored_value ?? "<missing>"
        }`,
      );
      requestLaunchAtLoginSync(true);
      return { action: "reapplied", storedValue: status.stored_value ?? null };
    }
    if (!wanted && status.enabled) {
      shellDeps.log(
        `[startup] launch-at-login registry still enabled despite preference=false; cleaning up`,
      );
      requestLaunchAtLoginSync(false);
      return { action: "removed", storedValue: status.stored_value ?? null };
    }
  } catch (error) {
    shellDeps.log(`[startup] launch-at-login reconcile skipped: ${asErrorMessage(error)}`);
  }
  return null;
}

/** Copy lives here, not at the call site: only this module knows what was wrong. */
export function describeLaunchAtLoginCorrection(correction: LaunchAtLoginCorrection): string {
  if (correction.action === "reapplied") {
    const stored = correction.storedValue
      ? `"${correction.storedValue}"`
      : "a path that no longer exists";
    return `Launch at login was still pointing at ${stored}, so it has been re-applied. Change it in Settings > General.`;
  }
  return "Launch at login was still registered with Windows after being turned off, so it has been removed. Change it in Settings > General.";
}

export function requestShellIntegrationSync(enabled: boolean): void {
  if (!shellDeps.isTauri()) {
    return;
  }

  const syncNonce = ++shellIntegrationSyncNonce;
  void ipcConfigureShellIntegration(enabled).catch((error) => {
    if (syncNonce !== shellIntegrationSyncNonce) {
      return;
    }
    shellDeps.notify(`Explorer menu update failed: ${asErrorMessage(error)}`, true);
  });
}

export interface ShellIntegrationCorrection {
  action: "registered" | "removed";
}

/**
 * Explorer verbs store the executable path literally, so an update that moves
 * or reinstalls the binary leaves them pointing at a path that no longer runs.
 * Re-register when the preference is on but the stored path does not match.
 */
export async function reconcileShellIntegrationWithOs(): Promise<ShellIntegrationCorrection | null> {
  if (!shellDeps.isTauri()) {
    return null;
  }
  try {
    const registered = await ipcShellIntegrationStatus();
    const wanted = shellDeps.getShellIntegration();

    if (wanted && !registered) {
      shellDeps.log("[startup] Explorer verbs stale or missing — reapplying");
      requestShellIntegrationSync(true);
      return { action: "registered" };
    }
    if (!wanted && registered) {
      shellDeps.log("[startup] Explorer verbs registered despite preference=false; cleaning up");
      requestShellIntegrationSync(false);
      return { action: "removed" };
    }
  } catch (error) {
    shellDeps.log(`[startup] shell integration reconcile skipped: ${asErrorMessage(error)}`);
  }
  return null;
}

export function describeShellIntegrationCorrection(correction: ShellIntegrationCorrection): string {
  if (correction.action === "registered") {
    return "The Explorer menu was pointing at an older install, so it has been re-registered. Change it in Settings > General.";
  }
  return "The right-click transcription menu was still registered after being turned off, so it has been removed. Change it in Settings > General.";
}
