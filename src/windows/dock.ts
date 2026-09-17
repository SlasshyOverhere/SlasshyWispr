/**
 * Floating dock (voice indicator) window — Phase 5 shell decomposition.
 *
 * Owns shouldDisplayDock + resolvedDockTheme + publishDockState +
 * voiceIndicatorUrl + ensureVoiceIndicatorWindow + reportDockRuntimeError
 * + showVoiceIndicatorWindow + hideVoiceIndicatorWindow +
 * syncFloatingIndicatorWindow + primeCaptureReadiness + the dock-action
 * channel handler. Moved verbatim from main.tsx; shell seams (settings,
 * stage, layout, amplitude, hotkeys, command mode, mic prewarm, dock
 * position persist) arrive via initDock so this module never touches
 * main.tsx module globals.
 */
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DockLayout, DockPlacementBounds } from "../types";
import { asErrorMessage } from "../utils";

export interface DockDeps {
  getStage: () => string;
  getShowFlowBar: () => boolean;
  getShowDockAlways: () => boolean;
  getThemeMode: () => string;
  getCaptureMode: () => string;
  getHotkeyDisplay: () => string;
  isCommandModeArmed: () => boolean;
  isGlobalShortcutsActive: () => boolean;
  isMainWindowHiddenToTray: () => boolean;
  getAmplitude: () => number;
  isTauri: () => boolean;
  notify: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  getWindow: () => WebviewWindow | null;
  setWindow: (win: WebviewWindow | null) => void;
  getHideTimerId: () => number | null;
  setHideTimerId: (id: number | null) => void;
  getRuntimeErrorShown: () => boolean;
  setRuntimeErrorShown: (shown: boolean) => void;
  persistDockPosition: (win: WebviewWindow) => Promise<void>;
  persistLayout: (x: number, y: number) => void;
  resolveStartPosition: (dockWidth: number, dockHeight: number) => Promise<DockLayout>;
  canPreWarmMicrophone: () => Promise<boolean>;
  preWarmMicrophoneStream: (deviceId: string) => void;
  getMicrophoneDeviceId: () => string;
  handleDockMicToggle: () => void;
  systemThemeMatchesLight: () => boolean;
}

let dockDeps!: DockDeps;
let dockChannel: BroadcastChannel | null = null;

export function initDock(deps: DockDeps, channel: BroadcastChannel): void {
  dockDeps = deps;
  dockChannel = channel;
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const payload = event.data as { kind?: string; action?: string } | null;
    if (!payload || payload.kind !== "action") {
      return;
    }

    if (payload.action === "toggle-mic") {
      dockDeps.handleDockMicToggle();
    } else if (payload.action === "open-app") {
      void (async () => {
        const win = getCurrentWindow();
        await win.show();
        await win.unminimize();
        await win.setFocus();
      })();
    }
  };
}

export function shouldDisplayDock(): boolean {
  if (!dockDeps.getShowFlowBar()) {
    return false;
  }
  if (dockDeps.getShowDockAlways()) {
    return true;
  }
  const stage = dockDeps.getStage();
  return (
    stage === "recording" ||
    stage === "processing" ||
    stage === "speaking"
  );
}

export function resolvedDockTheme(): "light" | "dark" {
  const themeMode = dockDeps.getThemeMode();
  if (themeMode === "light") {
    return "light";
  }
  if (themeMode === "dark" || themeMode === "mono") {
    return "dark";
  }

  return dockDeps.systemThemeMatchesLight() ? "light" : "dark";
}

export function publishDockState(): void {
  try {
    dockChannel?.postMessage({
      kind: "state",
      stage: dockDeps.getStage(),
      visible: shouldDisplayDock(),
      mainWindowHiddenToTray: dockDeps.isMainWindowHiddenToTray(),
      theme: resolvedDockTheme(),
      amplitude: dockDeps.getAmplitude(),
      captureMode: dockDeps.getCaptureMode(),
      hotkey: dockDeps.getHotkeyDisplay(),
      showFlowBar: dockDeps.getShowFlowBar(),
      commandModeArmed: dockDeps.isCommandModeArmed(),
      globalShortcutsActive: dockDeps.isGlobalShortcutsActive(),
    });
  } catch {
    // Ignore post errors to keep main flow resilient.
  }
}

export function voiceIndicatorUrl(): string {
  if (window.location.origin.startsWith("http")) {
    return `${window.location.origin}/voice-indicator.html`;
  }
  return "voice-indicator.html";
}

export async function ensureVoiceIndicatorWindow(): Promise<WebviewWindow> {
  const current = dockDeps.getWindow();
  if (current) {
    return current;
  }

  const existing = await WebviewWindow.getByLabel("voice_indicator");
  if (existing) {
    await dockDeps.persistDockPosition(existing);
    dockDeps.setWindow(existing);
    return existing;
  }

  const dockWidth = 160;
  const dockHeight = 140;
  const dockPosition = await dockDeps.resolveStartPosition(dockWidth, dockHeight);

  const created = new WebviewWindow("voice_indicator", {
    title: "SlasshyWispr Voice Indicator",
    url: voiceIndicatorUrl(),
    width: dockWidth,
    height: dockHeight,
    x: dockPosition.x,
    y: dockPosition.y,
    minWidth: dockWidth,
    minHeight: dockHeight,
    maxWidth: dockWidth,
    maxHeight: dockHeight,
    resizable: false,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    visible: false,
    focus: false,
  });

  created.once("tauri://destroyed", () => {
    dockDeps.setWindow(null);
  });

  const creationReady = new Promise<void>((resolve, reject) => {
    let settled = false;

    const finishResolve = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const finishReject = (reason: unknown): void => {
      if (settled) return;
      settled = true;
      reject(new Error(asErrorMessage(reason)));
    };

    created.once("tauri://created", () => {
      finishResolve();
    });

    created.once("tauri://error", (event) => {
      const payload = (event as { payload?: unknown }).payload ?? "unknown error";
      finishReject(payload);
    });

    // In some environments the creation event can race quickly, so this avoids a dead wait.
    window.setTimeout(() => {
      finishResolve();
    }, 900);
  });

  try {
    await creationReady;
  } catch (error) {
    reportDockRuntimeError(
      `Floating dock window failed to initialize: ${asErrorMessage(error)}`,
    );
    throw error;
  }

  try {
    await created.onMoved(({ payload }) => {
      dockDeps.persistLayout(payload.x, payload.y);
    });
  } catch {
    // Keep dock usable even if move/resize listeners are unavailable.
  }

  dockDeps.setWindow(created);
  return created;
}

export function reportDockRuntimeError(message: string): void {
  if (!dockDeps.getRuntimeErrorShown()) {
    dockDeps.notify(message, true);
    dockDeps.setRuntimeErrorShown(true);
  }
  console.error(message);
}

export async function showVoiceIndicatorWindow(): Promise<boolean> {
  if (dockDeps.getHideTimerId() !== null) {
    window.clearTimeout(dockDeps.getHideTimerId() as number);
    dockDeps.setHideTimerId(null);
  }

  try {
    const wasMissing = !dockDeps.getWindow();
    const win = await ensureVoiceIndicatorWindow();
    await win.show();
    dockDeps.setRuntimeErrorShown(false);
    publishDockState();
    // ponytail: re-publish after 300ms in case the dock's onmessage listener
    // wasn't attached yet when the first message fired. Covers the race where
    // the dock window is shown but the BroadcastChannel subscriber in
    // voice-indicator.html hasn't been set up yet.
    setTimeout(() => publishDockState(), 300);
    return wasMissing;
  } catch (error) {
    reportDockRuntimeError(`Unable to show floating dock: ${asErrorMessage(error)}`);
    return false;
  }
}

export async function primeCaptureReadiness(deviceId: string, shouldPrimeDock: boolean): Promise<void> {
  if (await dockDeps.canPreWarmMicrophone()) {
    dockDeps.preWarmMicrophoneStream(deviceId);
  }

  if (shouldPrimeDock && dockDeps.isTauri() && !dockDeps.getWindow()) {
    void ensureVoiceIndicatorWindow().catch((error) => {
      dockDeps.log(`[dock.prime] failed: ${asErrorMessage(error)}`);
    });
  }
}

export async function hideVoiceIndicatorWindow(): Promise<void> {
  if (dockDeps.getHideTimerId() !== null) {
    window.clearTimeout(dockDeps.getHideTimerId() as number);
    dockDeps.setHideTimerId(null);
  }

  const win = dockDeps.getWindow();
  if (!win) {
    return;
  }

  try {
    await dockDeps.persistDockPosition(win);
    await win.hide();
  } catch (error) {
    reportDockRuntimeError(`Unable to hide floating dock: ${asErrorMessage(error)}`);
  }
}

export async function syncFloatingIndicatorWindow(): Promise<void> {
  publishDockState();
  const shouldShow = shouldDisplayDock();

  if (shouldShow) {
    // Cancel any pending hide timer before showing — prevents the race where a
    // hide timer is already ticking and this show path is followed by a quick
    // re-entry that hits the early return below and lets the stale hide fire.
    if (dockDeps.getHideTimerId() !== null) {
      window.clearTimeout(dockDeps.getHideTimerId() as number);
      dockDeps.setHideTimerId(null);
    }
    const wasMissing = await showVoiceIndicatorWindow();
    // If the dock window was just (re)created, the BroadcastChannel subscriber
    // in voice-indicator.html may not have been wired yet when the pre-show
    // publishDockState() above fired. Re-publish to guarantee it lands on a
    // live listener; the listener can still drop messages it hasn't bound yet
    // (e.g. destroyed-and-reborn dock), so publish again shortly after to
    // cover that race.
    if (wasMissing) {
      publishDockState();
      window.setTimeout(() => publishDockState(), 60);
    }
    return;
  }

  if (dockDeps.getHideTimerId() !== null) {
    return;
  }

  dockDeps.setHideTimerId(window.setTimeout(() => {
    dockDeps.setHideTimerId(null);
    void hideVoiceIndicatorWindow();
  }, 220));
}

export type { DockLayout, DockPlacementBounds };
