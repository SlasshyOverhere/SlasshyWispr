/**
 * Global shortcut dispatch — Phase 5 shell decomposition.
 *
 * Owns handleGlobalShortcutEvent: capture-UI guard, pressed/released
 * state parsing, push-shortcut branch (API-key gate, PTT vs single-tap
 * dispatch, hold release) and command-shortcut branch (foreground-policy
 * gate, command-mode toggle). Moved verbatim from main.tsx; shell seams
 * (settings reads, form read, capture/dispatch services, notice/log)
 * arrive via initGlobalShortcutDispatch so this module never touches
 * main.tsx module globals.
 */
import type { ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import type { PersistedSettings } from "../types";
import { boolFlag } from "../utils";
import { normalizeShortcutToken } from "./hotkey-service";

export interface GlobalShortcutDispatchDeps {
  getSettings: () => PersistedSettings;
  isCaptureActive: () => boolean;
  getNormalizedShortcuts: () => { push: string; command: string };
  markHandled: (shortcutToken: string, state: "pressed" | "released") => void;
  readActiveSettings: () => PersistedSettings;
  isApiKeyMissingForOnlineRuntime: (activeSettings: PersistedSettings) => boolean;
  showApiKeyMissingNotice: () => void;
  hasPushToTalkHold: (source: "hotkey") => boolean;
  getPushToTalkHoldCount: () => number;
  engagePushToTalk: (source: "hotkey") => void;
  handleRecordToggle: () => void;
  releasePushToTalk: (source: "hotkey") => void;
  shouldBlockAssistantInputFromForegroundApp: () => Promise<boolean>;
  toggleCommandModeArmed: () => void;
  isCommandModeArmed: () => boolean;
  log: (message: string) => void;
}

let dispatchDeps!: GlobalShortcutDispatchDeps;

// F-007/F-interface: hotkey intents are ALSO broadcast as DOM events so Agent 3
// wiring (main.tsx) + Agent 2 controller can consume them without this module
// touching main.tsx globals or calling Rust paste directly (never do that here).
export type HotkeyIntentEvent =
  | { type: "record-toggle"; source: "hotkey" }
  | { type: "ptt-engage"; source: "hotkey" }
  | { type: "ptt-release"; source: "hotkey" };

export function emitHotkeyIntent(intent: HotkeyIntentEvent): void {
  try {
    window.dispatchEvent(new CustomEvent(`slasshywispr:${intent.type}`, { detail: intent }));
  } catch {
    // Non-DOM test envs: no-op.
  }
}

export function initGlobalShortcutDispatch(deps: GlobalShortcutDispatchDeps): void {
  dispatchDeps = deps;
}

export function handleGlobalShortcutEvent(event: ShortcutEvent): void {
  dispatchDeps.log(
    `[hotkey.global.event] shortcut=${event.shortcut || "-"} state=${String(
      (event as { state?: unknown }).state ?? "",
    )}`,
  );
  if (dispatchDeps.isCaptureActive()) {
    dispatchDeps.log("[hotkey.global.event] ignored because hotkey capture UI is active");
    return;
  }

  const rawState = String((event as { state?: unknown }).state ?? "")
    .trim()
    .toLowerCase();
  const pressed = rawState === "pressed";
  const released = rawState === "released";
  if (!pressed && !released) {
    dispatchDeps.log(`[hotkey.global.event] ignored because state="${rawState}" is unsupported`);
    return;
  }

  const settings = dispatchDeps.getSettings();
  const shortcut = normalizeShortcutToken(event.shortcut);
  const { push: pushShortcut, command: commandShortcut } = dispatchDeps.getNormalizedShortcuts();
  dispatchDeps.log(
    `[hotkey.global.event] normalized shortcut=${shortcut || "-"} push=${
      pushShortcut || "-"
    } command=${commandShortcut || "-"} capture=${settings.captureMode}`,
  );

  if (pushShortcut && shortcut === pushShortcut) {
    if (pressed) {
      dispatchDeps.markHandled(shortcut, "pressed");
      dispatchDeps.log(
        `[hotkey.global.push] pressed capture=${settings.captureMode} holdCount=${dispatchDeps.getPushToTalkHoldCount()}`,
      );
      const activeSettings = dispatchDeps.readActiveSettings();
      if (dispatchDeps.isApiKeyMissingForOnlineRuntime(activeSettings)) {
        dispatchDeps.log(
          "[hotkey.global.push] blocked before reveal because API key is missing for online runtime",
        );
        dispatchDeps.showApiKeyMissingNotice();
        return;
      }
      if (settings.captureMode === "push-to-talk") {
        if (dispatchDeps.hasPushToTalkHold("hotkey")) {
          dispatchDeps.log("[hotkey.global.push] ignored repeated press because hold is already active");
          return;
        }
        emitHotkeyIntent({ type: "ptt-engage", source: "hotkey" });
        void dispatchDeps.engagePushToTalk("hotkey");
      } else {
        emitHotkeyIntent({ type: "record-toggle", source: "hotkey" });
        void dispatchDeps.handleRecordToggle();
      }
    }
    if (released && (settings.captureMode === "push-to-talk" || dispatchDeps.hasPushToTalkHold("hotkey"))) {
      dispatchDeps.markHandled(shortcut, "released");
      dispatchDeps.log("[hotkey.global.push] released -> release push-to-talk hold");
      emitHotkeyIntent({ type: "ptt-release", source: "hotkey" });
      dispatchDeps.releasePushToTalk("hotkey");
    }
    return;
  }

  if (
    commandShortcut &&
    shortcut === commandShortcut &&
    pressed
  ) {
    dispatchDeps.markHandled(shortcut, "pressed");
    dispatchDeps.log("[hotkey.global.command] pressed -> toggling command mode");
    void (async () => {
      if (await dispatchDeps.shouldBlockAssistantInputFromForegroundApp()) {
        dispatchDeps.log("[hotkey.global.command] blocked by foreground app policy");
        return;
      }
      dispatchDeps.toggleCommandModeArmed();
      dispatchDeps.log(`[hotkey.global.command] toggled commandModeArmed=${boolFlag(dispatchDeps.isCommandModeArmed())}`);
    })();
    return;
  }

  dispatchDeps.log("[hotkey.global.event] no handler matched the incoming shortcut");
}
