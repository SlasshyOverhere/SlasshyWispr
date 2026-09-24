/**
 * Local-shortcuts move-boundary test — Phase 5 shell decomposition.
 *
 * Pins handleLocalKeydown branches (capture-active guard, settings-page
 * Escape, typing-element guard, Alt+digit page nav, Alt+letter side
 * buttons, PTT keydown dispatch, repeat guards) and handleLocalKeyup
 * (no-hold early return, release dispatch) plus handleLocalBlur
 * (non-PTT early return, hold clear with recording stop). Runs against
 * stub buttons and seam deps with stubbed document/window listeners.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  handleLocalBlur,
  handleLocalKeydown,
  handleLocalKeyup,
  initLocalShortcuts,
  wireHotkeyInputButtons,
  type LocalShortcutDeps,
} from "./local-shortcuts";
import type { MainPage } from "../types";

const listeners = new Map<string, Array<(event: never) => void>>();

// isTypingElement probes `instanceof HTMLElement`; bun test has no DOM.
{
  (globalThis as unknown as { HTMLElement?: unknown }).HTMLElement ??= class {};
}

{
  (globalThis as unknown as { document?: unknown }).document = {
    addEventListener(type: string, listener: (event: never) => void) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    querySelector: () => null,
  };
  (globalThis as unknown as { window?: unknown }).window ??= {};
  const w = globalThis as unknown as {
    window: { addEventListener?: (type: string, listener: (event: never) => void) => void };
  };
  const originalAdd = w.window.addEventListener;
  w.window.addEventListener = (type: string, listener: (event: never) => void) => {
    if (originalAdd) {
      originalAdd.call(w.window, type, listener);
      return;
    }
    const list = listeners.get(type) ?? [];
    list.push(listener);
    listeners.set(type, list);
  };
}

function fakeButton(): HTMLButtonElement & { clicks: number } {
  const btn = {
    clicks: 0,
    click() {
      btn.clicks += 1;
    },
  } as unknown as HTMLButtonElement & { clicks: number };
  return btn;
}

function fakeKeyEvent(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "",
    altKey: false,
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    repeat: false,
    target: null,
    preventDefault() {},
    ...overrides,
  } as unknown as KeyboardEvent;
}

function wireHarness(options: {
  captureMode?: string;
  commandMode?: boolean;
  stage?: string;
  hold?: boolean;
  holdCount?: number;
  settingsOpen?: boolean;
  bypass?: boolean;
  ignoreRecent?: boolean;
} = {}) {
  const buttons = {
    sidebarToggleLocalSttBtn: fakeButton(),
    openSettingsBtn: fakeButton(),
  };
  const fakeInput = () =>
    ({ addEventListener() {} }) as unknown as HTMLInputElement;
  const inputs = {
    hotkeyInput: fakeInput(),
    commandHotkeyInput: fakeInput(),
  };
  const calls: string[] = [];
  const logs: string[] = [];
  const pages: MainPage[] = [];
  let closed = 0;
  const deps: LocalShortcutDeps = {
    getSettings: () => ({
      captureMode: options.captureMode ?? "single-tap",
      commandMode: options.commandMode ?? false,
      commandHotkey: "Ctrl+Shift+Space",
      pushToTalkHotkey: "Ctrl+Space",
    }),
    getStage: () => options.stage ?? "idle",
    isSettingsOpen: () => options.settingsOpen ?? false,
    closeSettings: () => {
      closed += 1;
    },
    setActivePage: (page) => {
      pages.push(page);
    },
    handleLocalSttAdvisorEscape: () => false,
    engagePushToTalk: () => {
      calls.push("engage");
    },
    handleRecordToggle: () => {
      calls.push("toggle");
    },
    releasePushToTalk: () => {
      calls.push("release");
    },
    hasPushToTalkHold: () => options.hold ?? false,
    getPushToTalkHoldCount: () => options.holdCount ?? 0,
    clearPushToTalkHolds: () => {
      calls.push("clear");
    },
    stopRecording: () => {
      calls.push("stop");
    },
    shouldBlockAssistantInputFromForegroundApp: async () => false,
    toggleCommandModeArmed: () => {
      calls.push("command");
    },
    isCommandModeArmed: () => false,
    notify: () => {},
    log: (message) => {
      logs.push(message);
    },
    syncGuards: {
      shouldBypassLocalShortcutHandling: () => options.bypass ?? false,
      shouldIgnoreLocalShortcutFromRecentGlobal: () => options.ignoreRecent ?? false,
    },
  };
  initLocalShortcuts(buttons, deps);
  wireHotkeyInputButtons(inputs);
  return { buttons, calls, logs, pages, closed: () => closed };
}

beforeEach(() => {
  wireHarness();
});

describe("handleLocalKeydown", () => {
  it("navigates pages on Alt+digit and side buttons on Alt+letter", () => {
    const harness = wireHarness();
    handleLocalKeydown(fakeKeyEvent({ key: "3", altKey: true, target: null }));
    expect(harness.pages).toEqual(["analytics"]);
    handleLocalKeydown(fakeKeyEvent({ key: "s", altKey: true, target: null }));
    expect(harness.buttons.openSettingsBtn.clicks).toBe(1);
  });

  it("leaves the settings page on Escape", () => {
    const harness = wireHarness({ settingsOpen: true });
    handleLocalKeydown(fakeKeyEvent({ key: "Escape", target: null }));
    expect(harness.closed()).toBe(1);
  });

  it("ignores typing targets", () => {
    const harness = wireHarness();
    const input = { tagName: "INPUT" } as unknown as EventTarget;
    handleLocalKeydown(fakeKeyEvent({ key: "x", target: input }));
    expect(harness.calls.length).toBe(0);
  });

  it("toggles recording in single-tap mode and ignores repeats", () => {
    const harness = wireHarness({ captureMode: "single-tap" });
    handleLocalKeydown(
      fakeKeyEvent({ key: " ", ctrlKey: true, target: null } as Partial<KeyboardEvent>),
    );
    expect(harness.calls).toContain("toggle");
    const repeats = harness.calls.length;
    handleLocalKeydown(
      fakeKeyEvent({ key: " ", ctrlKey: true, repeat: true, target: null } as Partial<KeyboardEvent>),
    );
    expect(harness.calls.length).toBe(repeats);
  });

  it("engages push-to-talk in PTT mode", () => {
    const harness = wireHarness({ captureMode: "push-to-talk" });
    handleLocalKeydown(
      fakeKeyEvent({ key: " ", ctrlKey: true, target: null } as Partial<KeyboardEvent>),
    );
    expect(harness.calls).toContain("engage");
  });
});

describe("handleLocalKeyup", () => {
  it("returns early with no hold and releases on matching keyup", () => {
    const idle = wireHarness({ hold: false });
    handleLocalKeyup(fakeKeyEvent({ key: " ", ctrlKey: true }));
    expect(idle.calls.length).toBe(0);
    const held = wireHarness({ hold: true });
    handleLocalKeyup(fakeKeyEvent({ key: " ", ctrlKey: true }));
    expect(held.calls).toContain("release");
  });
});

describe("handleLocalBlur", () => {
  it("clears holds and stops recording when blurred mid-recording", () => {
    const harness = wireHarness({ captureMode: "push-to-talk", holdCount: 1, stage: "recording" });
    handleLocalBlur();
    expect(harness.calls).toEqual(["clear", "stop"]);
  });

  it("does nothing outside PTT mode", () => {
    const harness = wireHarness({ captureMode: "single-tap", holdCount: 1 });
    handleLocalBlur();
    expect(harness.calls.length).toBe(0);
  });
});
