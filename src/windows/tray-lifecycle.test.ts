/**
 * Tray-lifecycle move-boundary test — Phase 5 shell decomposition.
 *
 * Pins applyMainWindowTrayVisibility branching (show resumes polling
 * and syncs the dock; hide stops polling and closes the popup),
 * resume/stop polling guards (TTS/STT flags), and the non-Tauri early
 * return of initializeTrayBackgroundLifecycle. Tauri event/window APIs
 * are stubbed with mock.module.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

mock.module("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isVisible: async () => true,
  }),
}));

// Import after the mocks.
const tray = await import("./tray-lifecycle");

function wireHarness(options: {
  tauri?: boolean;
  ttsRunning?: boolean;
  sttActive?: boolean;
  visible?: boolean;
} = {}) {
  const calls: string[] = [];
  let trayHidden = false;
  tray.initTrayLifecycle({
    isTauri: () => options.tauri ?? true,
    isTtsSetupRunning: () => options.ttsRunning ?? false,
    isLocalSttDownloadActive: () => options.sttActive ?? false,
    stopTtsSetupPolling: () => {
      calls.push("stop-tts");
    },
    startTtsSetupPolling: () => {
      calls.push("start-tts");
    },
    pollTtsSetupStatusOnce: () => {
      calls.push("poll-tts");
    },
    stopLocalSttDownloadStatusPolling: () => {
      calls.push("stop-stt");
    },
    startLocalSttDownloadStatusPolling: () => {
      calls.push("start-stt");
    },
    pollLocalSttDownloadStatusOnce: () => {
      calls.push("poll-stt");
    },
    hideLocalSttLoadOverlay: () => {
      calls.push("hide-overlay");
    },
    closeSelectionAssistantWindow: async () => {
      calls.push("close-popup");
    },
    syncFloatingIndicatorWindow: () => {
      calls.push("sync-dock");
    },
    setMainWindowHiddenToTray: (hidden) => {
      trayHidden = hidden;
    },
    visibilityEvent: "test-visibility",
  });
  void options.visible;
  return { calls, isTrayHidden: () => trayHidden };
}

beforeEach(() => {
  wireHarness();
});

describe("applyMainWindowTrayVisibility", () => {
  it("resumes polling and syncs the dock when shown", async () => {
    const harness = wireHarness({ ttsRunning: true, sttActive: true });
    await tray.applyMainWindowTrayVisibility(false);
    expect(harness.isTrayHidden()).toBe(false);
    expect(harness.calls).toEqual([
      "start-tts",
      "poll-tts",
      "start-stt",
      "poll-stt",
      "sync-dock",
    ]);
  });

  it("stops polling and closes the popup when hidden", async () => {
    const harness = wireHarness();
    await tray.applyMainWindowTrayVisibility(true);
    expect(harness.isTrayHidden()).toBe(true);
    expect(harness.calls).toEqual(["stop-tts", "stop-stt", "hide-overlay", "close-popup"]);
  });
});

describe("resume/stop polling guards", () => {
  it("skips polling starts when nothing is running", async () => {
    const harness = wireHarness();
    tray.resumeNonEssentialUiPollingAfterTray();
    expect(harness.calls).toEqual([]);
    tray.stopNonEssentialUiPollingForTray();
    expect(harness.calls).toEqual(["stop-tts", "stop-stt", "hide-overlay"]);
  });
});

describe("initializeTrayBackgroundLifecycle", () => {
  it("returns early outside Tauri", async () => {
    wireHarness({ tauri: false });
    await expect(tray.initializeTrayBackgroundLifecycle()).resolves.toBeUndefined();
  });

  it("syncs visibility from the current window when visible", async () => {
    const harness = wireHarness({ tauri: true });
    await tray.initializeTrayBackgroundLifecycle();
    expect(harness.isTrayHidden()).toBe(false);
    expect(harness.calls).toContain("sync-dock");
  });
});
