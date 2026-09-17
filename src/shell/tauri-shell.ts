/**
 * Tauri shell helpers — Phase 5 shell decomposition.
 *
 * Owns the Tauri-environment shell seams: isTauriEnvironment,
 * openInSystemBrowser, setupCustomWindowControls, requestLaunchAtLoginSync,
 * and reconcileLaunchAtLoginWithOs. Moved verbatim from main.tsx; window
 * buttons, launch-at-login preference, and shell seams (open-external,
 * window control, launch IPC, notice, log) arrive via initTauriShell so
 * this module never touches main.tsx module globals.
 */
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";
import {
  configureLaunchAtLogin as ipcConfigureLaunchAtLogin,
  launchAtLoginStatus as ipcLaunchAtLoginStatus,
} from "../ipc/client";
import { asErrorMessage } from "../utils";

export interface TauriShellElements {
  windowMinimizeBtn: HTMLButtonElement;
  windowCloseBtn: HTMLButtonElement;
}

export interface TauriShellDeps {
  isTauri: () => boolean;
  getLaunchAtLogin: () => boolean;
  notify: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
}

let shellElements!: TauriShellElements;
let shellDeps!: TauriShellDeps;
let launchAtLoginSyncNonce = 0;

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
    shellDeps.notify(`Failed to open link: ${asErrorMessage(error)}`, true);
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
      shellDeps.notify(`Minimize failed: ${asErrorMessage(error)}`, true);
    });
  });

  shellElements.windowCloseBtn.addEventListener("click", () => {
    void appWindow.close().catch((error) => {
      shellDeps.notify(`Close failed: ${asErrorMessage(error)}`, true);
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

export async function reconcileLaunchAtLoginWithOs(): Promise<void> {
  if (!shellDeps.isTauri()) {
    return;
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
    } else if (!wanted && status.enabled) {
      shellDeps.log(
        `[startup] launch-at-login registry still enabled despite preference=false; cleaning up`,
      );
      requestLaunchAtLoginSync(false);
    }
  } catch (error) {
    shellDeps.log(`[startup] launch-at-login reconcile skipped: ${asErrorMessage(error)}`);
  }
}
