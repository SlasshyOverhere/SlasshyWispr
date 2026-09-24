/**
 * Settings persist hub — Phase 4b split from settings-service.
 *
 * Owns: debounced persist, native/local payload split, reporter seam.
 */
import type { PersistedSettings } from "../types";
import { SETTINGS_STORAGE_KEY } from "../constants";
import {
  logClientEvent as ipcLogClientEvent,
  savePersistedLocalSettings as ipcSavePersistedLocalSettings,
} from "../ipc/client";
import { asErrorMessage, boolFlag } from "../utils";
import { buildShortcutSyncSignature, summarizeSettingsForDiagnostics } from "./settings-signatures";

let persistSettingsTimer: number | null = null;
let pendingSettingsToPersist: PersistedSettings | null = null;
let lastPersistDiagnosticsSignature = "";
let reportPersistError: ((message: string) => void) | null = null;

export function setPersistErrorReporter(
  reporter: ((message: string) => void) | null,
): void {
  reportPersistError = reporter;
}

export function flushPendingSettings(opts?: PersistOptions): void {
  if (persistSettingsTimer !== null) {
    window.clearTimeout(persistSettingsTimer);
    persistSettingsTimer = null;
  }
  if (pendingSettingsToPersist) {
    performPersistSettings(pendingSettingsToPersist, opts);
    pendingSettingsToPersist = null;
  }
}

export function persistSettings(next: PersistedSettings, opts?: PersistOptions): void {
  pendingSettingsToPersist = next;
  if (persistSettingsTimer === null) {
    performPersistSettings(next, opts);
    pendingSettingsToPersist = null;
  } else {
    window.clearTimeout(persistSettingsTimer);
  }

  persistSettingsTimer = window.setTimeout(() => {
    persistSettingsTimer = null;
    if (pendingSettingsToPersist) {
      performPersistSettings(pendingSettingsToPersist, opts);
      pendingSettingsToPersist = null;
    }
  }, 800);
}

export interface PersistOptions {
  isTauri?: boolean;
  saveNative?: (payload: string) => Promise<unknown>;
}

export function performPersistSettings(next: PersistedSettings, opts?: PersistOptions): void {
  // ponytail: isTauri/saveNative are seams for the persist unit test only.
  // Ceiling: full DI of the Tauri boundary. Upgrade when Phase 5 extracts
  // other persist call sites needing a fake native layer.
  const isTauri =
    opts?.isTauri ?? ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
  const nativePayload: PersistedSettings = {
    ...next,
    apiKey: next.rememberApiKey ? next.apiKey : "",
  };

  const localPayload: PersistedSettings = isTauri
    ? {
        ...nativePayload,
        // Keep API keys out of webview localStorage in desktop builds.
        apiKey: "",
      }
    : nativePayload;
  const serializedLocal = JSON.stringify(localPayload);
  localStorage.setItem(SETTINGS_STORAGE_KEY, serializedLocal);
  const diagnosticsSignature = [
    next.captureMode,
    next.sttRuntimeMode,
    next.aiRuntimeMode,
    boolFlag(next.rememberApiKey),
    boolFlag(next.apiKey.trim().length > 0),
    buildShortcutSyncSignature(next),
  ].join("|");
  if (diagnosticsSignature !== lastPersistDiagnosticsSignature) {
    lastPersistDiagnosticsSignature = diagnosticsSignature;
    logPersistEvent(
      `[settings.persist] tauri=${boolFlag(isTauri)} ${summarizeSettingsForDiagnostics(
        next,
      )} nativeApiKeyPresent=${boolFlag(nativePayload.apiKey.trim().length > 0)} localApiKeyPresent=${boolFlag(
        localPayload.apiKey.trim().length > 0,
      )}`,
    );
  }

  if (!isTauri) {
    return;
  }

  const serializedNative = JSON.stringify(nativePayload);
  logPersistEvent(
    `[settings.persist.native] payloadBytes=${serializedNative.length} remember=${boolFlag(
      nativePayload.rememberApiKey,
    )} apiKeyPresent=${boolFlag(nativePayload.apiKey.trim().length > 0)}`,
  );
  const saveNative = opts?.saveNative ?? ipcSavePersistedLocalSettings;
  void saveNative(serializedNative).catch((error) => {
    reportPersistError?.(
      `Unable to securely save settings: ${asErrorMessage(error)}. Check keyring access and try again.`,
    );
    logPersistEvent(`[settings.persist.native] failed: ${asErrorMessage(error)}`);
    console.warn(`[settings] failed to persist local settings: ${asErrorMessage(error)}`);
  });
}

function logPersistEvent(message: string): void {
  const line = message.trim();
  if (!line || !("__TAURI_INTERNALS__" in window || "__TAURI__" in window)) {
    return;
  }

  void ipcLogClientEvent(line).catch(() => {
    // Ignore logging failures in UI flow.
  });
}

export function resetPersistStateForTests(): void {
  pendingSettingsToPersist = null;
  lastPersistDiagnosticsSignature = "";
  reportPersistError = null;
  if (persistSettingsTimer !== null) {
    window.clearTimeout(persistSettingsTimer);
    persistSettingsTimer = null;
  }
}
