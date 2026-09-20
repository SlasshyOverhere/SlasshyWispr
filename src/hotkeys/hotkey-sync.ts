/**
 * Global shortcut sync - Phase 5 shell decomposition.
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
  /** F-007: true while a PTT hold is active; used to defer remaps mid-hold. */
  isHoldActive?: () => boolean;
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
// F-007: remap requested while a PTT hold is active is parked here and applied
// on release (see noteRemapRequestedDuringHold / drainPendingRemap below).
let pendingRemapSignature = "";
// F-007: when global registration fails we keep local (in-app) hotkeys working
// as the fallback. suppressLocal is true only while globally registered.
let suppressLocalHandling = false;
// F-018: anti-echo straddle window. A local keydown that lands within
// STRADDLE_MS *before* the global event arrives is also swallowed, covering
// the race where local fires first (global "released" echo arrives late).
const LOCAL_DEDUP_MS = 180;
const STRADDLE_MS = 60;
const recentLocalPressAt = new Map<string, number>();

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

  // F-007: never re-register mid-hold - unregisterAll would kill the active
  // PTT press. Park the request; the release path drains it via drainPendingRemap.
  if (syncDeps.isHoldActive?.() && !force) {
    pendingRemapSignature = buildShortcutSyncSignature(settings);
    syncDeps.log("[hotkey.sync.defer] remap requested mid-hold; parked until release");
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
    suppressLocalHandling = true; // F-007: global owns delivery; local stays quiet
    syncDeps.publishDockState();
    syncDeps.log(
      `[hotkey.sync.success] registered=${shortcuts.join(",")} signature=${registeredShortcutSignature}`,
    );
  } catch (error) {
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    suppressLocalHandling = false; // F-007: global failed -> local stays LIVE
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
  // F-007: suppress-local ONLY while globally registered. On sync failure
  // suppressLocalHandling is false so in-app hotkeys keep working (fallback).
  if (!globalShortcutsActive || !suppressLocalHandling || !shortcutToken) {
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

/** F-018: record a local keydown so a global event arriving just after still dedups. */
export function noteLocalShortcutPressed(shortcutToken: string): void {
  if (shortcutToken) recentLocalPressAt.set(shortcutToken, Date.now());
}

export function shouldIgnoreLocalShortcutFromRecentGlobal(
  shortcutToken: string,
  state: "pressed" | "released",
): boolean {
  if (!globalShortcutsActive) {
    return false;
  }

  if (lastGlobalShortcutState !== state || lastGlobalShortcutToken !== shortcutToken) {
    // F-018 straddle: local fired first, global echo arrives just after.
    if (state === "pressed") {
      const at = recentLocalPressAt.get(shortcutToken) ?? 0;
      const elapsed = Date.now() - at;
      if (elapsed >= 0 && elapsed <= STRADDLE_MS + LOCAL_DEDUP_MS) {
        recentLocalPressAt.delete(shortcutToken);
        return true;
      }
    }
    return false;
  }

  const elapsed = Date.now() - lastGlobalShortcutHandledAt;
  const shouldIgnore = elapsed >= 0 && elapsed <= LOCAL_DEDUP_MS;
  if (shouldIgnore) {
    syncDeps.log(
      `[hotkey.local.dedupe] ignored state=${state} shortcut=${shortcutToken} elapsedMs=${elapsed}`,
    );
  }
  return shouldIgnore;
}

/** F-007: parked remap drains on PTT release. Returns true when a sync was queued. */
export function drainPendingRemap(): boolean {
  if (!pendingRemapSignature) return false;
  pendingRemapSignature = "";
  syncDeps.log("[hotkey.sync.drain] applying remap parked during hold");
  requestGlobalShortcutSync();
  return true;
}

export function hasPendingRemap(): boolean {
  return pendingRemapSignature !== "";
}

// F-018: Ctrl+Space / Ctrl+Shift+Space collide with IME / VS Code / browsers.
// constants.ts is READ-ONLY, so the warning text lives here.
const CONFLICT_HOTKEYS = new Set(["ctrl+space", "ctrl+shift+space"]);

export function hotkeyConflictWarning(shortcutToken: string): string {
  const normalized = normalizeShortcutToken(shortcutToken);
  if (!CONFLICT_HOTKEYS.has(normalized)) return "";
  return (
    `"${normalized}" often collides with IME / editor shortcuts ` +
    `(VS Code autocomplete, browser focus). Prefer Ctrl+Alt+Space if you see double-fires.`
  );
}
