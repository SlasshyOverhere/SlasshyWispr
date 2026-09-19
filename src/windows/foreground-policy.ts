/**
 * Foreground input-block policy — Phase 5 shell decomposition.
 *
 * Owns fetchForegroundInputBlockStatus + formatBlockedProcessLabel +
 * notifyBlockedForegroundInput + shouldBlockAssistantInputFromForegroundApp
 * + refreshBlockedAppShortcutSuppression +
 * startBlockedAppShortcutSuppressionMonitor. Moved verbatim from main.tsx;
 * the status cache, notice cooldown, and monitor timer live here, and
 * shell seams (Tauri probe, IPC status, settings-free notices, PTT
 * clearing, shortcut sync) arrive via initForegroundPolicy so this module
 * never touches main.tsx module globals.
 */
import {
  BLOCKED_INPUT_NOTICE_COOLDOWN_MS,
  FOREGROUND_BLOCK_CHECK_CACHE_MS,
} from "../constants";
import { getForegroundInputBlockStatus as ipcGetForegroundInputBlockStatus } from "../ipc/client";
import type { ForegroundInputBlockStatus } from "../types";

export interface ForegroundPolicyDeps {
  isTauri: () => boolean;
  notify: (message: string, isError?: boolean) => void;
  clearPushToTalkHolds: () => void;
  syncGlobalShortcuts: (force: boolean) => Promise<void>;
  requestGlobalShortcutSync: (force: boolean) => void;
  isShortcutSuppressionActive: () => boolean;
  setShortcutSuppressionActive: (active: boolean) => void;
  now: () => number;
}

let policyDeps!: ForegroundPolicyDeps;
let foregroundBlockStatusCache: ForegroundInputBlockStatus = {
  blocked: false,
  processName: "",
  reason: "",
  fullscreen: false,
};
let foregroundBlockCheckedAt = 0;
let foregroundBlockCheckInFlight: Promise<ForegroundInputBlockStatus> | null = null;
let lastBlockedInputNoticeAt = 0;
let lastBlockedInputProcess = "";
let foregroundBlockMonitorId: number | null = null;
let foregroundBlockMonitorInFlight = false;

const ENABLE_FOREGROUND_SHORTCUT_SUPPRESSION = true;

export function initForegroundPolicy(deps: ForegroundPolicyDeps): void {
  policyDeps = deps;
}

export function stopForegroundMonitorForShutdown(): void {
  if (foregroundBlockMonitorId !== null) {
    window.clearInterval(foregroundBlockMonitorId);
    foregroundBlockMonitorId = null;
  }
}

export async function fetchForegroundInputBlockStatus(force = false): Promise<ForegroundInputBlockStatus> {
  if (!ENABLE_FOREGROUND_SHORTCUT_SUPPRESSION) {
    const fallback: ForegroundInputBlockStatus = {
      blocked: false,
      processName: "",
      reason: "",
      fullscreen: false,
    };
    foregroundBlockStatusCache = fallback;
    foregroundBlockCheckedAt = policyDeps.now();
    return fallback;
  }

  if (!policyDeps.isTauri()) {
    return { blocked: false, processName: "", reason: "", fullscreen: false };
  }

  const now = policyDeps.now();
  if (!force && now - foregroundBlockCheckedAt <= FOREGROUND_BLOCK_CHECK_CACHE_MS) {
    return foregroundBlockStatusCache;
  }

  if (
    !force &&
    foregroundBlockMonitorId !== null &&
    foregroundBlockCheckedAt > 0 &&
    now - foregroundBlockCheckedAt <= 1_500
  ) {
    void refreshBlockedAppShortcutSuppression();
    return foregroundBlockStatusCache;
  }

  if (foregroundBlockCheckInFlight) {
    return foregroundBlockCheckInFlight;
  }

  foregroundBlockCheckInFlight = (async () => {
    try {
      const status = await ipcGetForegroundInputBlockStatus();
      const next: ForegroundInputBlockStatus = {
        blocked: Boolean(status?.blocked),
        processName: String(status?.processName ?? "").trim().toLowerCase(),
        reason: String(status?.reason ?? "").trim().toLowerCase(),
        fullscreen: Boolean(status?.fullscreen),
      };
      foregroundBlockStatusCache = next;
      foregroundBlockCheckedAt = policyDeps.now();
      return next;
    } catch {
      const fallback: ForegroundInputBlockStatus = {
        blocked: false,
        processName: "",
        reason: "",
        fullscreen: false,
      };
      foregroundBlockStatusCache = fallback;
      foregroundBlockCheckedAt = policyDeps.now();
      return fallback;
    } finally {
      foregroundBlockCheckInFlight = null;
    }
  })();

  return foregroundBlockCheckInFlight;
}

export function formatBlockedProcessLabel(processName: string): string {
  const normalized = processName.trim().toLowerCase();
  if (!normalized) {
    return "a blocked app";
  }

  const base = normalized.endsWith(".exe") ? normalized.slice(0, -4) : normalized;
  return base.replace(/[-_]+/g, " ");
}

export function notifyBlockedForegroundInput(processName: string): void {
  const now = policyDeps.now();
  const normalized = processName.trim().toLowerCase();
  if (
    normalized === lastBlockedInputProcess &&
    now - lastBlockedInputNoticeAt < BLOCKED_INPUT_NOTICE_COOLDOWN_MS
  ) {
    return;
  }

  lastBlockedInputProcess = normalized;
  lastBlockedInputNoticeAt = now;
  policyDeps.notify(`Assistant input blocked while ${formatBlockedProcessLabel(processName)} is focused.`);
}

export async function shouldBlockAssistantInputFromForegroundApp(force = false): Promise<boolean> {
  if (!ENABLE_FOREGROUND_SHORTCUT_SUPPRESSION) {
    return false;
  }

  const status = await fetchForegroundInputBlockStatus(force);
  if (!status.blocked) {
    return false;
  }

  notifyBlockedForegroundInput(status.processName);
  return true;
}

export async function refreshBlockedAppShortcutSuppression(): Promise<void> {
  if (!policyDeps.isTauri() || foregroundBlockMonitorInFlight) {
    return;
  }

  foregroundBlockMonitorInFlight = true;
  try {
    const status = await fetchForegroundInputBlockStatus(true);
    const shouldSuppress = status.blocked;
    if (shouldSuppress === policyDeps.isShortcutSuppressionActive()) {
      return;
    }

    policyDeps.setShortcutSuppressionActive(shouldSuppress);
    if (shouldSuppress) {
      policyDeps.clearPushToTalkHolds();
      await policyDeps.syncGlobalShortcuts(true);
      return;
    }

    policyDeps.requestGlobalShortcutSync(true);
  } finally {
    foregroundBlockMonitorInFlight = false;
  }
}

export function startBlockedAppShortcutSuppressionMonitor(): void {
  if (!ENABLE_FOREGROUND_SHORTCUT_SUPPRESSION) {
    return;
  }

  if (!policyDeps.isTauri() || foregroundBlockMonitorId !== null) {
    return;
  }

  foregroundBlockMonitorId = window.setInterval(() => {
    void refreshBlockedAppShortcutSuppression();
  }, 1200);

  void refreshBlockedAppShortcutSuppression();
}
