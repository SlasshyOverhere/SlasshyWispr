/**
 * Global shortcut sync — Phase 5 shell decomposition.
 *
 * Owns the global-shortcut registration state machine (active flags,
 * registered shortcuts/signature, last-handled dedup, sync
 * coalescing, blocked-app suppression flag). Moved verbatim from
 * main.tsx; shell seams (tauri probe, settings read, notice/log,
 * dock publish, shortcut event delivery) arrive via initHotkeySync so
 * this module never touches main.tsx module globals.
 */
import {
  register as registerGlobalShortcut,
  unregisterAll as unregisterAllGlobalShortcuts,
  type ShortcutEvent,
} from "@tauri-apps/plugin-global-shortcut";
import type { PersistedSettings } from "../types";
import { asErrorMessage, boolFlag } from "../utils";
import {
  buildShortcutSyncSignature,
  summarizeSettingsForDiagnostics,
} from "../settings/settings-signatures";
import {
  normalizeShortcutToken,
  parseHotkey,
  toGlobalShortcutString,
} from "./hotkey-service";

export interface HotkeySyncDeps {
  isTauri: () => boolean;
  getSettings: () => PersistedSettings;
  notify: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  publishDockState: () => void;
  onShortcutEvent: (event: ShortcutEvent) => void;
}

let syncDeps!: HotkeySyncDeps;

let globalShortcutsActive = false;
let shortcutsSuppressedByBlockedApp = false;
let registeredPushShortcut = "";
let registeredCommandShortcut = "";
let registeredShortcutSignature = "";
let lastGlobalShortcutToken = "";
let lastGlobalShortcutState: "pressed" | "released" | "" = "";
let lastGlobalShortcutHandledAt = 0;
let shortcutSyncInFlight: Promise<void> | null = null;
let shortcutSyncQueued = false;

export function initHotkeySync(deps: HotkeySyncDeps): void {
  syncDeps = deps;
}

export function isGlobalShortcutsActive(): boolean {
  return globalShortcutsActive;
}

export function getRegisteredPushShortcut(): string {
  return registeredPushShortcut;
}

export function getRegisteredCommandShortcut(): string {
  return registeredCommandShortcut;
}

export function getNormalizedRegisteredShortcuts(): { push: string; command: string } {
  return {
    push: normalizeShortcutToken(registeredPushShortcut),
    command: normalizeShortcutToken(registeredCommandShortcut),
  };
}

export function isShortcutSuppressionActive(): boolean {
  return shortcutsSuppressedByBlockedApp;
}

export function setShortcutSuppressionActive(suppressed: boolean): void {
  shortcutsSuppressedByBlockedApp = suppressed;
}

export function requestGlobalShortcutSync(force = false): void {
  syncDeps.log(
    `[hotkey.sync.request] force=${boolFlag(force)} inFlight=${boolFlag(
      Boolean(shortcutSyncInFlight),
    )} queued=${boolFlag(shortcutSyncQueued)} sig=${buildShortcutSyncSignature(syncDeps.getSettings())}`,
  );
  if (force) {
    registeredShortcutSignature = "";
  }

  if (shortcutSyncInFlight) {
    shortcutSyncQueued = true;
    syncDeps.log("[hotkey.sync.request] queued=1 because sync is already running");
    return;
  }

  shortcutSyncInFlight = syncGlobalShortcuts(force)
    .catch((error) => {
      syncDeps.log(`[hotkey.sync.error] ${asErrorMessage(error)}`);
      syncDeps.notify(`Global hotkey sync failed: ${asErrorMessage(error)}`, true);
    })
    .finally(() => {
      syncDeps.log(
        `[hotkey.sync.finally] queued=${boolFlag(shortcutSyncQueued)} active=${boolFlag(
          globalShortcutsActive,
        )} push=${registeredPushShortcut || "-"} command=${registeredCommandShortcut || "-"}`,
      );
      shortcutSyncInFlight = null;
      if (shortcutSyncQueued) {
        shortcutSyncQueued = false;
        syncDeps.log("[hotkey.sync.finally] draining queued sync request");
        requestGlobalShortcutSync();
      }
    });
}

export async function syncGlobalShortcuts(force = false): Promise<void> {
  const settings = syncDeps.getSettings();
  syncDeps.log(
    `[hotkey.sync.run] force=${boolFlag(force)} tauri=${boolFlag(
      syncDeps.isTauri(),
    )} suppressed=${boolFlag(shortcutsSuppressedByBlockedApp)} ${summarizeSettingsForDiagnostics(
      settings,
    )}`,
  );
  if (!syncDeps.isTauri()) {
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    syncDeps.publishDockState();
    syncDeps.log("[hotkey.sync.run] skipped because app is not running in tauri");
    return;
  }

  if (shortcutsSuppressedByBlockedApp) {
    if (globalShortcutsActive) {
      try {
        await unregisterAllGlobalShortcuts();
      } catch {
        // Ignore cleanup errors while blocked-app suppression is active.
      }
    }
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    syncDeps.publishDockState();
    syncDeps.log("[hotkey.sync.run] shortcuts disabled by blocked foreground app");
    return;
  }

  const pushSpec = parseHotkey(settings.pushToTalkHotkey);
  if (!pushSpec) {
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    syncDeps.publishDockState();
    syncDeps.log(
      `[hotkey.sync.run] skipped because push-to-talk hotkey is invalid: "${settings.pushToTalkHotkey}"`,
    );
    return;
  }

  const pushShortcut = toGlobalShortcutString(pushSpec);
  const shortcuts = [pushShortcut];
  let commandShortcut = "";

  if (settings.commandMode) {
    const commandSpec = parseHotkey(settings.commandHotkey);
    if (commandSpec) {
      const normalizedPush = normalizeShortcutToken(pushShortcut);
      const normalizedCommand = normalizeShortcutToken(toGlobalShortcutString(commandSpec));
      if (normalizedPush !== normalizedCommand) {
        commandShortcut = toGlobalShortcutString(commandSpec);
        shortcuts.push(commandShortcut);
      }
    }
  }

  const desiredSignature = [
    settings.captureMode,
    normalizeShortcutToken(pushShortcut),
    settings.commandMode ? "1" : "0",
    normalizeShortcutToken(commandShortcut),
  ].join("|");
  syncDeps.log(
    `[hotkey.sync.plan] push=${pushShortcut} command=${
      commandShortcut || "-"
    } desired=${desiredSignature} current=${registeredShortcutSignature || "-"}`,
  );

  if (!force && globalShortcutsActive && desiredSignature === registeredShortcutSignature) {
    syncDeps.log("[hotkey.sync.plan] skipped because registered shortcuts already match");
    return;
  }

  try {
    await unregisterAllGlobalShortcuts();
  } catch {
    // Ignore cleanup errors. We'll still try to register next.
  }

  try {
    await registerGlobalShortcut(shortcuts, syncDeps.onShortcutEvent);
    registeredPushShortcut = pushShortcut;
    registeredCommandShortcut = commandShortcut;
    registeredShortcutSignature = desiredSignature;
    globalShortcutsActive = true;
    syncDeps.publishDockState();
    syncDeps.log(
      `[hotkey.sync.success] registered=${shortcuts.join(",")} signature=${registeredShortcutSignature}`,
    );
  } catch (error) {
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    syncDeps.log(`[hotkey.sync.failure] ${asErrorMessage(error)}`);
    syncDeps.notify(`Global hotkeys unavailable. Using in-app hotkeys only: ${asErrorMessage(error)}`, true);
    syncDeps.publishDockState();
  }
}

export function markGlobalShortcutHandled(shortcutToken: string, state: "pressed" | "released"): void {
  lastGlobalShortcutToken = shortcutToken;
  lastGlobalShortcutState = state;
  lastGlobalShortcutHandledAt = Date.now();
}

export function shouldBypassLocalShortcutHandling(shortcutToken: string): boolean {
  if (!globalShortcutsActive || !shortcutToken) {
    return false;
  }

  const registeredPush = normalizeShortcutToken(registeredPushShortcut);
  const registeredCommand = normalizeShortcutToken(registeredCommandShortcut);
  const shouldBypass = shortcutToken === registeredPush || shortcutToken === registeredCommand;
  if (shouldBypass) {
    syncDeps.log(`[hotkey.local.bypass] delegated to global shortcut=${shortcutToken}`);
  }
  return shouldBypass;
}

export function shouldIgnoreLocalShortcutFromRecentGlobal(
  shortcutToken: string,
  state: "pressed" | "released",
): boolean {
  if (!globalShortcutsActive) {
    return false;
  }

  if (lastGlobalShortcutState !== state || lastGlobalShortcutToken !== shortcutToken) {
    return false;
  }

  const elapsed = Date.now() - lastGlobalShortcutHandledAt;
  const shouldIgnore = elapsed >= 0 && elapsed <= 180;
  if (shouldIgnore) {
    syncDeps.log(
      `[hotkey.local.dedupe] ignored state=${state} shortcut=${shortcutToken} elapsedMs=${elapsed}`,
    );
  }
  return shouldIgnore;
}
