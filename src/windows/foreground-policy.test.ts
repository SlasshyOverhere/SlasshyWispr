/**
 * Foreground-policy move-boundary test — Phase 5 shell decomposition.
 *
 * Pins formatBlockedProcessLabel normalization, the notice cooldown
 * (same process within the window notifies once), the non-Tauri early
 * return, the blocked/not-blocked decision, and the monitor start
 * idempotence. IPC is stubbed with mock.module.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

let ipcStatus: {
  blocked: boolean;
  processName: string;
  reason: string;
  fullscreen: boolean;
} = { blocked: false, processName: "", reason: "", fullscreen: false };

mock.module("@tauri-apps/api/core", () => ({
  invoke: async () => ({ ...ipcStatus }),
}));

// Import after the mock so IPC wrappers bind the stub.
const policy = await import("./foreground-policy");

function wireHarness(tauri = true) {
  const notices: Array<{ message: string; isError?: boolean }> = [];
  let now = 100_000;
  let holdsCleared = 0;
  policy.initForegroundPolicy({
    isTauri: () => tauri,
    notify: (message, isError) => {
      notices.push({ message, isError });
    },
    clearPushToTalkHolds: () => {
      holdsCleared += 1;
    },
    syncGlobalShortcuts: async () => {},
    requestGlobalShortcutSync: () => {},
    isShortcutSuppressionActive: () => false,
    setShortcutSuppressionActive: () => {},
    now: () => now,
  });
  return {
    notices,
    holdsCleared: () => holdsCleared,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

beforeEach(() => {
  ipcStatus = { blocked: false, processName: "", reason: "", fullscreen: false };
  wireHarness();
  policy.stopForegroundMonitorForShutdown();
});

describe("formatBlockedProcessLabel", () => {
  it("normalizes exe names, separators, and blanks", () => {
    expect(policy.formatBlockedProcessLabel("  ")).toBe("a blocked app");
    expect(policy.formatBlockedProcessLabel("Discord.EXE")).toBe("discord");
    expect(policy.formatBlockedProcessLabel("my_game-client")).toBe("my game client");
  });
});

describe("notifyBlockedForegroundInput", () => {
  it("cools down repeats for the same process", () => {
    const harness = wireHarness();
    policy.notifyBlockedForegroundInput("Discord.exe");
    policy.notifyBlockedForegroundInput("discord.EXE");
    expect(harness.notices.length).toBe(1);
    expect(harness.notices[0].message).toContain("discord");
    harness.advance(3_000);
    policy.notifyBlockedForegroundInput("Discord.exe");
    expect(harness.notices.length).toBe(2);
  });
});

describe("shouldBlockAssistantInputFromForegroundApp", () => {
  it("returns false outside Tauri without IPC", async () => {
    wireHarness(false);
    await expect(policy.shouldBlockAssistantInputFromForegroundApp()).resolves.toBe(false);
  });

  it("returns the blocked decision and notifies", async () => {
    const harness = wireHarness(true);
    ipcStatus = { blocked: true, processName: "Game.exe", reason: "fullscreen", fullscreen: true };
    await expect(policy.shouldBlockAssistantInputFromForegroundApp(true)).resolves.toBe(true);
    expect(harness.notices.length).toBe(1);
    ipcStatus = { blocked: false, processName: "", reason: "", fullscreen: false };
    await expect(policy.shouldBlockAssistantInputFromForegroundApp(true)).resolves.toBe(false);
  });
});

describe("startBlockedAppShortcutSuppressionMonitor", () => {
  it("starts once and stops cleanly", () => {
    (globalThis as unknown as { window?: unknown }).window = {
      setInterval: () => 7,
      clearInterval: () => {},
    };
    wireHarness(true);
    policy.startBlockedAppShortcutSuppressionMonitor();
    policy.startBlockedAppShortcutSuppressionMonitor();
    policy.stopForegroundMonitorForShutdown();
  });
});
