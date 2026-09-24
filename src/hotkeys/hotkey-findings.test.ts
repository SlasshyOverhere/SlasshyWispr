import { describe, expect, it, mock } from "bun:test";

let registerBehavior: "ok" | "fail" = "ok";
let holdActive = false;

mock.module("@tauri-apps/plugin-global-shortcut", () => ({
  register: async () => {
    if (registerBehavior === "fail") {
      throw new Error("denied");
    }
  },
  unregisterAll: async () => {},
}));

const sync = await import("./hotkey-sync");
import { emitHotkeyIntent } from "./global-shortcut-dispatch";
import { isHotkeyReleaseEvent, parseHotkey } from "./hotkey-service";
import { defaultSettings } from "../state/settings-store";
import type { PersistedSettings } from "../types";

function settings(overrides: Record<string, unknown> = {}): PersistedSettings {
  return {
    ...defaultSettings(),
    pushToTalkHotkey: "Ctrl+Space",
    commandHotkey: "Ctrl+Shift+Space",
    captureMode: "push-to-talk",
    commandMode: false,
    ...overrides,
  } as unknown as PersistedSettings;
}

function wire() {
  const logs: string[] = [];
  const notices: string[] = [];
  sync.initHotkeySync({
    isTauri: () => true,
    isHoldActive: () => holdActive,
    getSettings: () => settings(),
    notify: (message) => {
      notices.push(message);
    },
    log: (message) => {
      logs.push(message);
    },
    publishDockState: () => {},
    onShortcutEvent: () => {},
  });
  return { logs, notices };
}

function fakeKeyEvent(key: string): KeyboardEvent {
  return { key } as unknown as KeyboardEvent;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("F-007 release requires the main key", () => {
  it("modifier-tap does not release a Ctrl+Space hold", () => {
    const hotkey = parseHotkey("Ctrl+Space");
    expect(hotkey).not.toBeNull();
    expect(isHotkeyReleaseEvent(fakeKeyEvent("Control"), hotkey!)).toBe(false);
    expect(isHotkeyReleaseEvent(fakeKeyEvent("Shift"), hotkey!)).toBe(false);
    expect(isHotkeyReleaseEvent(fakeKeyEvent(" "), hotkey!)).toBe(true);
  });

  it("modifier-tap does not release a Ctrl+Shift+Space hold", () => {
    const hotkey = parseHotkey("Ctrl+Shift+Space");
    expect(hotkey).not.toBeNull();
    expect(isHotkeyReleaseEvent(fakeKeyEvent("Control"), hotkey!)).toBe(false);
    expect(isHotkeyReleaseEvent(fakeKeyEvent("Shift"), hotkey!)).toBe(false);
  });
});

describe("F-007 remap deferred mid-hold", () => {
  it("parks the remap while held and applies it on release", async () => {
    wire();
    holdActive = true;
    registerBehavior = "ok";
    await sync.syncGlobalShortcuts();
    expect(sync.hasPendingRemap()).toBe(true);

    holdActive = false;
    expect(sync.drainPendingRemap()).toBe(true);
    await sleep(20);
    expect(sync.hasPendingRemap()).toBe(false);
    expect(sync.isGlobalShortcutsActive()).toBe(true);
  });
});

describe("F-007 suppress-local only while globally registered", () => {
  it("falls back to local hotkeys on sync failure, suppresses on success", async () => {
    wire();
    holdActive = false;

    registerBehavior = "fail";
    await sync.syncGlobalShortcuts(true);
    expect(sync.isGlobalShortcutsActive()).toBe(false);
    expect(sync.shouldBypassLocalShortcutHandling("ctrl+space")).toBe(false);

    registerBehavior = "ok";
    await sync.syncGlobalShortcuts(true);
    expect(sync.isGlobalShortcutsActive()).toBe(true);
    expect(sync.shouldBypassLocalShortcutHandling("ctrl+space")).toBe(true);
  });
});

describe("F-018 echo dedupe + conflict warnings", () => {
  it("dedups the 180ms echo and the local-first straddle", async () => {
    wire();
    holdActive = false;
    registerBehavior = "ok";
    await sync.syncGlobalShortcuts(true);
    expect(sync.isGlobalShortcutsActive()).toBe(true);

    sync.markGlobalShortcutHandled("ctrl+space", "pressed");
    expect(sync.shouldIgnoreLocalShortcutFromRecentGlobal("ctrl+space", "pressed")).toBe(true);

    // Local fired first, global echo arrives just after: still swallowed.
    sync.noteLocalShortcutPressed("ctrl+alt+space");
    expect(sync.shouldIgnoreLocalShortcutFromRecentGlobal("ctrl+alt+space", "pressed")).toBe(true);
  });

  it("warns on Ctrl+Space / Ctrl+Shift+Space, stays quiet otherwise", () => {
    expect(sync.hotkeyConflictWarning("Ctrl+Space")).not.toBe("");
    expect(sync.hotkeyConflictWarning("ctrl+shift+space")).not.toBe("");
    expect(sync.hotkeyConflictWarning("Ctrl+Alt+Space")).toBe("");
  });
});

describe("F-interface hotkey intent events", () => {
  it("emitHotkeyIntent is a safe no-op outside the DOM", () => {
    expect(() => emitHotkeyIntent({ type: "record-toggle", source: "hotkey" })).not.toThrow();
    expect(() => emitHotkeyIntent({ type: "ptt-release", source: "hotkey" })).not.toThrow();
  });
});
