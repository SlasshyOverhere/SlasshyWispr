/**
 * Updater check/install flow — Phase 5 shell decomposition.
 *
 * Owns the update state machine: check, install, progress events,
 * notify, auto-check scheduling, and button sync. Moved verbatim from
 * main.tsx; shell seams (tauri probe, ipc, view, confirm, settings
 * panes, storage helpers, diagnostics) arrive via initUpdaterFlow so
 * this module never touches main.tsx module globals.
 */
import { listen } from "@tauri-apps/api/event";
import {
  APP_UPDATE_LAST_CHECKED_AT_STORAGE_KEY,
  APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY,
} from "../constants";
import {
  checkForAppUpdate as ipcCheckForAppUpdate,
  downloadAndInstallAppUpdate as ipcDownloadAndInstallAppUpdate,
} from "../ipc/client";
import type {
  AppUpdateCheckResponse,
  AppUpdateInstallProgressEvent,
  InstallAppUpdateRequest,
} from "../types";
import { asErrorMessage } from "../utils";
import {
  APP_UPDATE_CHECK_INTERVAL_MS,
  isUpdateSnoozed,
  msUntilNextAutomaticUpdateCheck,
  readAppUpdateAutoCheckEnabled,
  shouldRunStartupUpdateCheck,
} from "./updater-client";
import {
  applyUpdateCheckResultView,
  refreshUpdateLastCheckedText,
  setUpdateInstallProgress,
  setUpdaterStatus,
  showManualDownloadFallback,
  syncUpdaterButtonsView,
} from "./updater-view";

export type UpdateSource = "startup" | "interval" | "manual";

export interface UpdaterFlowDeps {
  isTauri: () => boolean;
  notify: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  openUpdateSettings: (reason: string) => void;
  confirmInstall: (version: string) => Promise<boolean>;
  getNotificationPermissionRequested: () => boolean;
  setNotificationPermissionRequested: (requested: boolean) => void;
}

export interface UpdaterButtonElements {
  checkUpdatesBtn: HTMLButtonElement;
  installUpdateBtn: HTMLButtonElement;
  skipUpdateVersionBtn: HTMLButtonElement;
  snoozeUpdateBtn: HTMLButtonElement;
}

let flowButtons!: UpdaterButtonElements;
let flowDeps!: UpdaterFlowDeps;

let updateCheckInFlight = false;
let updateInstallInFlight = false;
let cachedUpdateResult: AppUpdateCheckResponse | null = null;
let updateAutoCheckTimerId: number | null = null;
let updateAutoCheckTimeoutId: number | null = null;
let updateInstallProgressUnlisten: (() => void) | null = null;

const UPDATE_INSTALL_PROGRESS_EVENT = "slasshy://update-install-progress";

export function initUpdaterFlow(elements: UpdaterButtonElements, deps: UpdaterFlowDeps): void {
  flowButtons = elements;
  flowDeps = deps;
}

const notifiedVersionsThisSession = new Set<string>();

export function getCachedUpdateResult(): AppUpdateCheckResponse | null {
  return cachedUpdateResult;
}

export function syncUpdaterButtons(): void {
  syncUpdaterButtonsView(flowButtons, {
    isTauri: flowDeps.isTauri(),
    checkInFlight: updateCheckInFlight,
    installInFlight: updateInstallInFlight,
    result: cachedUpdateResult,
  });
}

export function openUpdateSettings(reason: string): void {
  flowDeps.openUpdateSettings(reason);
}

export function notifyAppUpdateAvailable(result: AppUpdateCheckResponse, source: UpdateSource): void {
  const version = result.latestVersion.trim();
  if (!version) {
    return;
  }

  // Check localStorage skip before in-memory dedup — user explicitly skipped this version
  if (localStorage.getItem(APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY) === version) {
    return;
  }

  // Use in-memory set per session so on restart the user is re-notified
  // if the update is still pending. Persisting this across restarts caused
  // silent suppression after a failed install.
  if (notifiedVersionsThisSession.has(version)) {
    return;
  }

  if (isUpdateSnoozed()) {
    return;
  }

  notifiedVersionsThisSession.add(version);
  const message = `Update ${version} is available. Open Updates to download and install it.`;
  flowDeps.notify(message);

  if (typeof Notification === "undefined") {
    return;
  }

  const showNotification = (): void => {
    try {
      const notification = new Notification("SlasshyWispr update available", {
        body: message,
      });
      notification.onclick = () => {
        window.focus();
        openUpdateSettings(`update-notification-${source}`);
      };
    } catch {
      // Ignore notification failures; in-app notice remains visible.
    }
  };

  if (Notification.permission === "granted") {
    showNotification();
    return;
  }

  if (Notification.permission !== "default" || flowDeps.getNotificationPermissionRequested()) {
    return;
  }

  flowDeps.setNotificationPermissionRequested(true);
  void Notification.requestPermission()
    .then((permission) => {
      if (permission === "granted") {
        showNotification();
      }
    })
    .catch(() => {
      // Ignore notification permission errors.
    });
}

function applyUpdateCheckResult(result: AppUpdateCheckResponse, silent: boolean): void {
  applyUpdateCheckResultView(result, silent);
  syncUpdaterButtons();
}

export async function handleCheckForUpdates(options?: {
  silent?: boolean;
  source?: "manual" | "startup" | "interval";
}): Promise<void> {
  if (!flowDeps.isTauri() || updateCheckInFlight) {
    return;
  }

  const silent = options?.silent ?? false;

  if (silent && isUpdateSnoozed()) {
    return;
  }

  const source = options?.source ?? "manual";
  updateCheckInFlight = true;
  syncUpdaterButtons();
  if (!silent) {
    setUpdaterStatus("processing", "Checking GitHub release channel...");
  }

  try {
    const result = await ipcCheckForAppUpdate();
    cachedUpdateResult = result;
    localStorage.setItem(APP_UPDATE_LAST_CHECKED_AT_STORAGE_KEY, String(Date.now()));
    refreshUpdateLastCheckedText();
    applyUpdateCheckResult(result, silent);
    if (result.available) {
      notifyAppUpdateAvailable(result, source);
    }
  } catch (error) {
    showManualDownloadFallback(`Update check failed: ${asErrorMessage(error)}`);
  } finally {
    updateCheckInFlight = false;
    syncUpdaterButtons();
  }
}

export async function handleInstallUpdate(): Promise<void> {
  if (!flowDeps.isTauri()) {
    return;
  }

  if (!cachedUpdateResult || !cachedUpdateResult.available || !cachedUpdateResult.installerDownloadUrl) {
    showManualDownloadFallback("No update package is ready.");
    return;
  }

  const request: InstallAppUpdateRequest = {
    downloadUrl: cachedUpdateResult.installerDownloadUrl,
    assetName: cachedUpdateResult.installerAssetName || undefined,
    silent: true,
    expectedSha256: cachedUpdateResult.expectedSha256 || undefined,
  };

  const targetVersion = cachedUpdateResult.latestVersion || "the available update";
  const confirmed = await flowDeps.confirmInstall(targetVersion);
  if (!confirmed) {
    return;
  }

  updateInstallInFlight = true;
  syncUpdaterButtons();
  setUpdateInstallProgress(0, "Preparing update download...", "", true);
  setUpdaterStatus("processing", "Downloading update installer...");

  try {
    await ipcDownloadAndInstallAppUpdate(request);
    setUpdaterStatus("processing", "Installer started. The app will close now.");
  } catch (error) {
    updateInstallInFlight = false;
    showManualDownloadFallback(`Installer launch failed: ${asErrorMessage(error)}`);
    syncUpdaterButtons();
  }
}

export function handleUpdateInstallProgressEvent(payload: AppUpdateInstallProgressEvent): void {
  const totalBytes = payload.totalBytes > 0 ? payload.totalBytes : payload.downloadedBytes;
  const detail =
    totalBytes > 0
      ? `(${formatBytes(payload.downloadedBytes)} / ${formatBytes(totalBytes)})`
      : payload.downloadedBytes > 0
        ? `(${formatBytes(payload.downloadedBytes)})`
        : "";

  if (payload.stage === "error") {
    updateInstallInFlight = false;
    setUpdateInstallProgress(payload.progressPercent, payload.message, detail, true);
    showManualDownloadFallback(payload.message);
    // Reset the "last checked" timestamp so the next startup re-checks immediately,
    // and clear in-session notification suppression so user gets re-notified.
    localStorage.removeItem(APP_UPDATE_LAST_CHECKED_AT_STORAGE_KEY);
    notifiedVersionsThisSession.clear();
    refreshUpdateLastCheckedText();
    syncUpdaterButtons();
    return;
  }

  if (payload.stage === "starting" || payload.stage === "downloading" || payload.stage === "downloaded") {
    updateInstallInFlight = true;
    setUpdateInstallProgress(payload.progressPercent, payload.message, detail, true);
    setUpdaterStatus("processing", payload.message);
    syncUpdaterButtons();
    return;
  }

  if (payload.stage === "installing") {
    setUpdateInstallProgress(100, payload.message, "", true);
    setUpdaterStatus("processing", payload.message);
    syncUpdaterButtons();
  }
}

export async function registerUpdateInstallProgressListener(): Promise<void> {
  if (!flowDeps.isTauri() || updateInstallProgressUnlisten) {
    return;
  }

  updateInstallProgressUnlisten = await listen<AppUpdateInstallProgressEvent>(
    UPDATE_INSTALL_PROGRESS_EVENT,
    (event) => {
      handleUpdateInstallProgressEvent(event.payload);
    },
  );
}

export function startAutomaticUpdateChecks(): void {
  if (!flowDeps.isTauri()) {
    return;
  }

  if (updateAutoCheckTimerId !== null) {
    window.clearInterval(updateAutoCheckTimerId);
    updateAutoCheckTimerId = null;
  }
  if (updateAutoCheckTimeoutId !== null) {
    window.clearTimeout(updateAutoCheckTimeoutId);
    updateAutoCheckTimeoutId = null;
  }

  if (!readAppUpdateAutoCheckEnabled()) {
    return;
  }

  const dueInMs = msUntilNextAutomaticUpdateCheck();
  if (dueInMs <= 0 || shouldRunStartupUpdateCheck()) {
    void handleCheckForUpdates({ silent: true, source: "startup" });
    updateAutoCheckTimerId = window.setInterval(() => {
      void handleCheckForUpdates({ silent: true, source: "interval" });
    }, APP_UPDATE_CHECK_INTERVAL_MS);
    return;
  }

  updateAutoCheckTimeoutId = window.setTimeout(() => {
    updateAutoCheckTimeoutId = null;
    void handleCheckForUpdates({ silent: true, source: "interval" });
    updateAutoCheckTimerId = window.setInterval(() => {
      void handleCheckForUpdates({ silent: true, source: "interval" });
    }, APP_UPDATE_CHECK_INTERVAL_MS);
  }, dueInMs);
}

export function stopAutomaticUpdateChecks(): void {
  if (updateAutoCheckTimerId !== null) {
    window.clearInterval(updateAutoCheckTimerId);
    updateAutoCheckTimerId = null;
  }
  if (updateAutoCheckTimeoutId !== null) {
    window.clearTimeout(updateAutoCheckTimeoutId);
    updateAutoCheckTimeoutId = null;
  }
  if (updateInstallProgressUnlisten) {
    updateInstallProgressUnlisten();
    updateInstallProgressUnlisten = null;
  }
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex <= 1 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}
