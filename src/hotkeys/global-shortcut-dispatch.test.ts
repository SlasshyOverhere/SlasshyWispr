/**
 * Global-shortcut-dispatch move-boundary test — Phase 5 shell decomposition.
 *
 * Pins handleGlobalShortcutEvent branches: unsupported states ignored,
 * capture-active guard, push pressed (API-key gate, PTT engage vs
 * single-tap toggle, repeated-press dedup), push released (hold release),
 * command pressed (foreground-policy gate, mode toggle), and unmatched
 * shortcuts logged. Runs against stub deps.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  handleGlobalShortcutEvent,
  initGlobalShortcutDispatch,
} from "./global-shortcut-dispatch";
import type { ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { defaultSettings } from "../state/settings-store";

function fakeEvent(shortcut: string, state: string): ShortcutEvent {
  return { shortcut, state } as unknown as ShortcutEvent;
}

function wireHarness(options: {
  captureMode?: string;
  registeredPush?: string;
  registeredCommand?: string;
  captureActive?: boolean;
  hold?: boolean;
  apiKeyMissing?: boolean;
  blocked?: boolean;
} = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  let armed = false;
  initGlobalShortcutDispatch({
    getSettings: () => ({
      ...defaultSettings(),
      captureMode: (options.captureMode ?? "single-tap") as "single-tap",
    }),
    isCaptureActive: () => options.captureActive ?? false,
    getNormalizedShortcuts: () => ({
      push: options.registeredPush ?? "ctrl+space",
      command: options.registeredCommand ?? "ctrl+shift+space",
    }),
    markHandled: (_shortcut, state) => {
      calls.push(`handled:${state}`);
    },
    readActiveSettings: () => defaultSettings(),
    isApiKeyMissingForOnlineRuntime: () => options.apiKeyMissing ?? false,
    showApiKeyMissingNotice: () => {
      calls.push("api-key-notice");
    },
    hasPushToTalkHold: () => options.hold ?? false,
    getPushToTalkHoldCount: () => 0,
    engagePushToTalk: () => {
      calls.push("engage");
    },
    handleRecordToggle: () => {
      calls.push("toggle");
    },
    releasePushToTalk: () => {
      calls.push("release");
    },
    shouldBlockAssistantInputFromForegroundApp: async () => options.blocked ?? false,
    toggleCommandModeArmed: () => {
      armed = !armed;
      calls.push("command");
    },
    isCommandModeArmed: () => armed,
    log: (message) => {
      logs.push(message);
    },
  });
  return { calls, logs, isArmed: () => armed };
}

beforeEach(() => {
  wireHarness();
});

describe("handleGlobalShortcutEvent", () => {
  it("ignores unsupported states", () => {
    const harness = wireHarness();
    handleGlobalShortcutEvent(fakeEvent("ctrl+space", "held"));
    expect(harness.calls.length).toBe(0);
    expect(harness.logs.some((line) => line.includes("unsupported"))).toBe(true);
  });

  it("ignores events while capture UI is active", () => {
    const harness = wireHarness({ captureActive: true });
    handleGlobalShortcutEvent(fakeEvent("ctrl+space", "pressed"));
    expect(harness.calls.length).toBe(0);
    expect(harness.logs.some((line) => line.includes("capture UI"))).toBe(true);
  });

  it("blocks push pressed on missing API key", () => {
    const harness = wireHarness({ apiKeyMissing: true });
    handleGlobalShortcutEvent(fakeEvent("ctrl+space", "pressed"));
    expect(harness.calls).toContain("api-key-notice");
    expect(harness.calls).not.toContain("toggle");
  });

  it("toggles recording in single-tap mode; release fires only in PTT/hold", () => {
    const harness = wireHarness({ captureMode: "single-tap" });
    handleGlobalShortcutEvent(fakeEvent("ctrl+space", "pressed"));
    expect(harness.calls).toContain("toggle");
    // Verbatim from main.tsx: release is a no-op in single-tap with no hold.
    handleGlobalShortcutEvent(fakeEvent("ctrl+space", "released"));
    expect(harness.calls).not.toContain("release");
    const ptt = wireHarness({ captureMode: "push-to-talk" });
    handleGlobalShortcutEvent(fakeEvent("ctrl+space", "released"));
    expect(ptt.calls).toContain("release");
  });

  it("engages PTT in push-to-talk mode and dedups repeats", () => {
    const harness = wireHarness({ captureMode: "push-to-talk" });
    handleGlobalShortcutEvent(fakeEvent("ctrl+space", "pressed"));
    expect(harness.calls).toContain("engage");
    const held = wireHarness({ captureMode: "push-to-talk", hold: true });
    held.calls.length = 0;
    handleGlobalShortcutEvent(fakeEvent("ctrl+space", "pressed"));
    expect(held.calls).not.toContain("engage");
  });

  it("toggles command mode unless blocked by foreground policy", async () => {
    const harness = wireHarness();
    handleGlobalShortcutEvent(fakeEvent("ctrl+shift+space", "pressed"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.calls).toContain("command");
    expect(harness.isArmed()).toBe(true);
    const gated = wireHarness({ blocked: true });
    handleGlobalShortcutEvent(fakeEvent("ctrl+shift+space", "pressed"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gated.calls).not.toContain("command");
  });

  it("logs unmatched shortcuts", () => {
    const harness = wireHarness({ registeredPush: "ctrl+space" });
    handleGlobalShortcutEvent(fakeEvent("alt+f4", "pressed"));
    expect(harness.calls.length).toBe(0);
    expect(harness.logs.some((line) => line.includes("no handler matched"))).toBe(true);
  });
});
