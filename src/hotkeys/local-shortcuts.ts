/**
 * Local keyboard shortcuts — Phase 5 shell decomposition.
 *
 * Owns the document keydown/keyup handlers (accessibility Alt+letter nav,
 * Alt+digit page nav, command-mode keydown, push-to-talk keydown/keyup)
 * plus the window blur PTT-hold cleanup. Moved verbatim from main.tsx;
 * shell seams (settings reads, side buttons, capture/dispatch services,
 * notice/log, page nav, advisor escape, capture guards) arrive via
 * initLocalShortcuts so this module never touches main.tsx module
 * globals.
 */
import type { MainPage } from "../types";
import { boolFlag } from "../utils";
import {
  isHotkeyReleaseEvent,
  isTypingElement,
  matchesHotkey,
  normalizeShortcutToken,
  parseHotkey,
  toGlobalShortcutString,
} from "./hotkey-service";
import {
  beginCommandHotkeyCapture,
  beginHotkeyCapture,
  cancelCommandHotkeyCapture,
  cancelHotkeyCapture,
  handleCommandHotkeyCaptureKeydown,
  handleCommandHotkeyCaptureKeyup,
  handleHotkeyCaptureKeydown,
  handleHotkeyCaptureKeyup,
  isCommandHotkeyCaptureActive,
  isHotkeyCaptureActive,
} from "./hotkey-capture";
export interface LocalShortcutSyncGuards {
  shouldBypassLocalShortcutHandling: (shortcutToken: string) => boolean;
  shouldIgnoreLocalShortcutFromRecentGlobal: (
    shortcutToken: string,
    state: "pressed" | "released",
  ) => boolean;
}

export interface LocalShortcutButtons {
  toggleSidebarBtn: HTMLButtonElement;
  sidebarToggleLocalSttBtn: HTMLButtonElement;
  openSettingsBtn: HTMLButtonElement;
}

export interface LocalShortcutDeps {
  getSettings: () => {
    captureMode: string;
    commandMode: boolean;
    commandHotkey: string;
    pushToTalkHotkey: string;
  };
  getStage: () => string;
  isSettingsOverlayOpen: () => boolean;
  closeSettings: () => void;
  setActivePage: (page: MainPage) => void;
  handleLocalSttAdvisorEscape: () => boolean;
  engagePushToTalk: (source: "hotkey") => void;
  handleRecordToggle: () => void;
  releasePushToTalk: (source: "hotkey") => void;
  hasPushToTalkHold: (source: "hotkey") => boolean;
  getPushToTalkHoldCount: () => number;
  clearPushToTalkHolds: () => void;
  stopRecording: () => void;
  shouldBlockAssistantInputFromForegroundApp: () => Promise<boolean>;
  toggleCommandModeArmed: () => void;
  isCommandModeArmed: () => boolean;
  notify: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  syncGuards: LocalShortcutSyncGuards;
}

let shortcutButtons!: LocalShortcutButtons;
let shortcutDeps!: LocalShortcutDeps;

export function initLocalShortcuts(
  buttons: LocalShortcutButtons,
  deps: LocalShortcutDeps,
): void {
  shortcutButtons = buttons;
  shortcutDeps = deps;

  document.addEventListener("keydown", handleLocalKeydown);
  document.addEventListener("keyup", handleLocalKeyup);
  window.addEventListener("blur", handleLocalBlur);
}

export function handleLocalKeydown(event: KeyboardEvent): void {
  if (isHotkeyCaptureActive()) {
    handleHotkeyCaptureKeydown(event);
    return;
  }
  if (isCommandHotkeyCaptureActive()) {
    handleCommandHotkeyCaptureKeydown(event);
    return;
  }

  if (event.key === "Escape" && shortcutDeps.handleLocalSttAdvisorEscape()) {
    return;
  }

  if (event.key === "Escape" && shortcutDeps.isSettingsOverlayOpen()) {
    shortcutDeps.closeSettings();
    return;
  }

  if (isTypingElement(event.target)) {
    return;
  }

  if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
    const digit = event.key;
    if (digit >= "1" && digit <= "6") {
      const pageIndex = parseInt(digit, 10) - 1;
      const pages: MainPage[] = ["home", "history", "dictionary", "snippets", "notes", "analytics"];
      const page = pages[pageIndex];
      if (page) {
        event.preventDefault();
        shortcutDeps.setActivePage(page);
        return;
      }
    }

    if (event.key === "b" || event.key === "B") {
      event.preventDefault();
      shortcutButtons.toggleSidebarBtn.click();
      return;
    }

    if (event.key === "d" || event.key === "D") {
      event.preventDefault();
      shortcutButtons.sidebarToggleLocalSttBtn.click();
      return;
    }

    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      shortcutButtons.openSettingsBtn.click();
      return;
    }
  }

  const settings = shortcutDeps.getSettings();
  const commandHotkey = parseHotkey(settings.commandHotkey);
  if (settings.commandMode && commandHotkey && matchesHotkey(event, commandHotkey)) {
    const commandShortcutToken = normalizeShortcutToken(toGlobalShortcutString(commandHotkey));
    shortcutDeps.log(
      `[hotkey.local.command] keydown shortcut=${commandShortcutToken} repeat=${boolFlag(
        event.repeat,
      )}`,
    );
    if (shortcutDeps.syncGuards.shouldBypassLocalShortcutHandling(commandShortcutToken)) {
      return;
    }
    if (shortcutDeps.syncGuards.shouldIgnoreLocalShortcutFromRecentGlobal(commandShortcutToken, "pressed")) {
      return;
    }
    if (event.repeat) {
      shortcutDeps.log("[hotkey.local.command] ignored repeated keydown");
      return;
    }
    event.preventDefault();
    void (async () => {
      if (await shortcutDeps.shouldBlockAssistantInputFromForegroundApp()) {
        shortcutDeps.log("[hotkey.local.command] blocked by foreground app policy");
        return;
      }
      shortcutDeps.toggleCommandModeArmed();
      shortcutDeps.log(`[hotkey.local.command] toggled commandModeArmed=${boolFlag(shortcutDeps.isCommandModeArmed())}`);
    })();
    return;
  }

  const parsed = parseHotkey(settings.pushToTalkHotkey);
  if (!parsed || !matchesHotkey(event, parsed)) {
    return;
  }
  const pushShortcutToken = normalizeShortcutToken(toGlobalShortcutString(parsed));
  shortcutDeps.log(
    `[hotkey.local.push] keydown shortcut=${pushShortcutToken} capture=${settings.captureMode} repeat=${boolFlag(
      event.repeat,
    )}`,
  );
  if (shortcutDeps.syncGuards.shouldBypassLocalShortcutHandling(pushShortcutToken)) {
    return;
  }
  if (shortcutDeps.syncGuards.shouldIgnoreLocalShortcutFromRecentGlobal(pushShortcutToken, "pressed")) {
    return;
  }

  if (settings.captureMode === "push-to-talk") {
    if (event.repeat) {
      shortcutDeps.log("[hotkey.local.push] ignored repeated keydown in push-to-talk mode");
      return;
    }

    event.preventDefault();
    void shortcutDeps.engagePushToTalk("hotkey");
    return;
  }

  if (event.repeat) {
    shortcutDeps.log("[hotkey.local.push] ignored repeated keydown in single-tap mode");
    return;
  }

  event.preventDefault();
  void shortcutDeps.handleRecordToggle();
}

export function handleLocalKeyup(event: KeyboardEvent): void {
  if (isHotkeyCaptureActive()) {
    handleHotkeyCaptureKeyup(event);
    return;
  }
  if (isCommandHotkeyCaptureActive()) {
    handleCommandHotkeyCaptureKeyup(event);
    return;
  }

  if (!shortcutDeps.hasPushToTalkHold("hotkey")) {
    return;
  }

  const settings = shortcutDeps.getSettings();
  const parsed = parseHotkey(settings.pushToTalkHotkey);
  if (!parsed || !isHotkeyReleaseEvent(event, parsed)) {
    return;
  }
  const pushShortcutToken = normalizeShortcutToken(toGlobalShortcutString(parsed));
  shortcutDeps.log(
    `[hotkey.local.push] keyup shortcut=${pushShortcutToken} capture=${settings.captureMode}`,
  );
  if (shortcutDeps.syncGuards.shouldBypassLocalShortcutHandling(pushShortcutToken)) {
    return;
  }
  if (shortcutDeps.syncGuards.shouldIgnoreLocalShortcutFromRecentGlobal(pushShortcutToken, "released")) {
    return;
  }

  event.preventDefault();
  shortcutDeps.releasePushToTalk("hotkey");
}

export function handleLocalBlur(): void {
  const settings = shortcutDeps.getSettings();
  if (settings.captureMode !== "push-to-talk") {
    return;
  }

  if (shortcutDeps.getPushToTalkHoldCount() === 0) {
    return;
  }

  shortcutDeps.log(
    `[record.ptt.blur] clearing holds=${shortcutDeps.getPushToTalkHoldCount()} stage=${shortcutDeps.getStage()}`,
  );
  shortcutDeps.clearPushToTalkHolds();
  if (shortcutDeps.getStage() === "recording") {
    shortcutDeps.log("[record.ptt.blur] window blurred during recording -> stopRecording()");
    shortcutDeps.stopRecording();
  }
}

export function wireHotkeyInputButtons(
  inputs: { hotkeyInput: HTMLInputElement; commandHotkeyInput: HTMLInputElement },
): void {
  inputs.hotkeyInput.addEventListener("focus", () => {
    beginHotkeyCapture();
  });

  inputs.hotkeyInput.addEventListener("click", () => {
    beginHotkeyCapture();
  });

  inputs.hotkeyInput.addEventListener("blur", () => {
    if (isHotkeyCaptureActive()) {
      cancelHotkeyCapture();
    }
  });

  inputs.commandHotkeyInput.addEventListener("focus", () => {
    beginCommandHotkeyCapture();
  });

  inputs.commandHotkeyInput.addEventListener("click", () => {
    beginCommandHotkeyCapture();
  });

  inputs.commandHotkeyInput.addEventListener("blur", () => {
    if (isCommandHotkeyCaptureActive()) {
      cancelCommandHotkeyCapture();
    }
  });
}
