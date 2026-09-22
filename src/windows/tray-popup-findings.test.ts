import { describe, expect, it, mock, beforeEach } from "bun:test";

mock.module("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

mock.module("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel = async () => null;
  },
}));

mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isVisible: async () => true,
  }),
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
  availableMonitors: async () => [],
  currentMonitor: async () => null,
}));

const tray = await import("./tray-lifecycle");
const popup = await import("./selection-popup");
const geometry = await import("./dock-geometry");
import type { SelectionPopupPayload } from "../types";

// In-memory localStorage: bun has none, and the coachmark guards typeof.
const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => memStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memStore.set(key, value);
  },
  removeItem: (key: string) => {
    memStore.delete(key);
  },
};

function wireTray() {
  const calls: string[] = [];
  const notices: string[] = [];
  let trayHidden = false;
  tray.initTrayLifecycle({
    isTauri: () => true,
    notify: (message) => {
      notices.push(message);
    },
    isTtsSetupRunning: () => false,
    isLocalSttDownloadActive: () => false,
    stopTtsSetupPolling: () => {
      calls.push("stop-tts");
    },
    startTtsSetupPolling: () => {},
    pollTtsSetupStatusOnce: () => {},
    stopLocalSttDownloadStatusPolling: () => {
      calls.push("stop-stt");
    },
    startLocalSttDownloadStatusPolling: () => {},
    pollLocalSttDownloadStatusOnce: () => {},
    hideLocalSttLoadOverlay: () => {},
    closeSelectionAssistantWindow: async () => {
      calls.push("close-popup");
    },
    syncFloatingIndicatorWindow: () => {},
    setMainWindowHiddenToTray: (hidden) => {
      trayHidden = hidden;
    },
    visibilityEvent: "test-visibility",
  });
  return { calls, notices, isTrayHidden: () => trayHidden };
}

function fakePayload(token = 1, text = "hello"): SelectionPopupPayload {
  return { token, mode: "rewrite", title: "Rewrite Result", text, audioBase64: "" };
}

function wirePopup() {
  const posted: unknown[] = [];
  const copied: string[] = [];
  let latest: SelectionPopupPayload | null = null;
  const channel = {
    postMessage(message: unknown) {
      posted.push(message);
    },
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
  };
  popup.initSelectionPopup(
    {
      isTauri: () => false,
      notify: () => {},
      log: () => {},
      copyResult: (text) => {
        copied.push(text);
      },
      replaceSelection: async () => true,
      getWindow: () => null,
      setWindow: () => {},
      getLatestPayload: () => latest,
      setLatestPayload: (payload) => {
        latest = payload;
      },
      nextToken: () => 7,
      // Agent 2 stale-token rule stand-in: only token 5 is the live generation.
      isTokenStale: (token) => token !== 5,
    },
    channel as unknown as BroadcastChannel,
  );
  return {
    posted,
    copied,
    getLatest: () => latest,
    send: (action: string) => {
      channel.onmessage?.({ data: { kind: "action", action } } as MessageEvent<unknown>);
    },
  };
}

beforeEach(() => {
  memStore.clear();
  wireTray();
  wirePopup();
});

describe("F-028 first-hide coachmark", () => {
  it("shows once, then never again", async () => {
    const harness = wireTray();
    await tray.applyMainWindowTrayVisibility(true);
    expect(harness.isTrayHidden()).toBe(true);
    expect(harness.notices.length).toBe(1);
    expect(harness.notices[0]).toContain("tray");

    await tray.applyMainWindowTrayVisibility(true);
    expect(harness.notices.length).toBe(1);
  });

  it("pure helpers gate on storage", () => {
    const fresh = new Map<string, string>();
    const storage = {
      getItem: (key: string) => fresh.get(key) ?? null,
      setItem: (key: string, value: string) => {
        fresh.set(key, value);
      },
    };
    expect(tray.shouldShowTrayCoachmark(storage)).toBe(true);
    tray.markTrayCoachmarkSeen(storage);
    expect(tray.shouldShowTrayCoachmark(storage)).toBe(false);
  });
});

describe("F-030 stale popup token is a no-op", () => {
  it("stale show never stores, fresh show stores", async () => {
    const harness = wirePopup();
    expect(await popup.showSelectionAssistantPopup(fakePayload(3))).toBe(false);
    expect(harness.getLatest()).toBeNull();

    await popup.showSelectionAssistantPopup(fakePayload(5));
    expect(harness.getLatest()).toEqual(fakePayload(5));
  });

  it("stale copy-result does not copy", () => {
    const harness = wirePopup();
    popup.setLatestSelectionPopupPayload(fakePayload(3));
    harness.send("copy-result");
    expect(harness.copied).toEqual([]);

    popup.setLatestSelectionPopupPayload(fakePayload(5));
    harness.send("copy-result");
    expect(harness.copied).toEqual([fakePayload(5).text]);
  });
});

describe("F-030 popup a11y + focus trap math", () => {
  it("exposes dialog semantics", () => {
    expect(popup.selectionPopupA11yAttributes(fakePayload(5))).toEqual({
      role: "dialog",
      ariaModal: "true",
      ariaLabel: "Rewrite Result",
    });
  });

  it("trap math wraps both directions", () => {
    expect(popup.trapFocusNextIndex(0, false, 3)).toBe(1);
    expect(popup.trapFocusNextIndex(2, false, 3)).toBe(0);
    expect(popup.trapFocusNextIndex(0, true, 3)).toBe(2);
    expect(popup.trapFocusNextIndex(0, false, 0)).toBe(0);
  });
});

describe("F-026 window floor + breakpoints", () => {
  it("declares the 780x600 window and the compact breakpoint", () => {
    expect(geometry.MAIN_WINDOW_MIN_SIZE).toEqual({ width: 780, height: 600 });
    expect(geometry.dockCompactForViewport(1000)).toBe(true);
    expect(geometry.dockCompactForViewport(1366)).toBe(false);
    expect(geometry.dockCompactForViewport(Number.NaN)).toBe(false);
  });

  it("reduced-motion probe defaults to motion allowed without matchMedia", () => {
    expect(geometry.prefersReducedMotion()).toBe(false);
  });
});
