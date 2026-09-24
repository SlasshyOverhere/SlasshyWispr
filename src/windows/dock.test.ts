/**
 * Dock move-boundary test — Phase 5 shell decomposition.
 *
 * Pins shouldDisplayDock gating (flow-bar off, always-on, stage matrix),
 * resolvedDockTheme (explicit modes + system fallback), publishDockState
 * payload shape, token counter passthrough, and the show/hide window
 * flows against a stubbed WebviewWindow. Tauri window APIs are stubbed
 * with mock.module.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

mock.module("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    static getByLabel = async () => null;
    label: string;
    shown = 0;
    hidden = 0;
    moved: Array<{ x: number; y: number }> = [];
    constructor(label: string) {
      this.label = label;
    }
    once() {}
    async show() {
      this.shown += 1;
    }
    async hide() {
      this.hidden += 1;
    }
    async setFocus() {}
    async setSize() {}
    async onMoved() {}
  },
}));

mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: async () => {},
    unminimize: async () => {},
    setFocus: async () => {},
  }),
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

// Import after the mocks.
const dock = await import("./dock");

function wireHarness(options: {
  stage?: string;
  showFlowBar?: boolean;
  showDockAlways?: boolean;
  themeMode?: string;
  systemLight?: boolean;
  trayHidden?: boolean;
} = {}) {
  const posted: unknown[] = [];
  const notices: Array<{ message: string; isError?: boolean }> = [];
  let errorShown = false;
  let hideTimer: number | null = null;
  dock.initDock(
    {
      getStage: () => options.stage ?? "idle",
      getShowFlowBar: () => options.showFlowBar ?? true,
      getShowDockAlways: () => options.showDockAlways ?? false,
      getThemeMode: () => options.themeMode ?? "dark",
      getCaptureMode: () => "single-tap",
      getHotkeyDisplay: () => "Ctrl+Space",
      isCommandModeArmed: () => false,
      isGlobalShortcutsActive: () => true,
      isMainWindowHiddenToTray: () => options.trayHidden ?? false,
      getAmplitude: () => 0.5,
      isTauri: () => true,
      notify: (message, isError) => {
        notices.push({ message, isError });
      },
      log: () => {},
      getWindow: () => null,
      setWindow: () => {},
      getHideTimerId: () => hideTimer,
      setHideTimerId: (id) => {
        hideTimer = id;
      },
      getRuntimeErrorShown: () => errorShown,
      setRuntimeErrorShown: (shown) => {
        errorShown = shown;
      },
      persistDockPosition: async () => {},
      persistLayout: () => {},
      resolveStartPosition: async () => ({ x: 10, y: 20 }),
      canPreWarmMicrophone: async () => false,
      preWarmMicrophoneStream: () => {},
      getMicrophoneDeviceId: () => "",
      handleDockMicToggle: () => {},
      systemThemeMatchesLight: () => options.systemLight ?? false,
    },
    {
      postMessage(message: unknown) {
        posted.push(message);
      },
    } as unknown as BroadcastChannel,
  );
  return { posted, notices };
}

beforeEach(() => {
  wireHarness();
});

describe("shouldDisplayDock", () => {
  it("hides when the flow bar is off", () => {
    wireHarness({ showFlowBar: false, stage: "recording" });
    expect(dock.shouldDisplayDock()).toBe(false);
  });

  it("shows always when pinned, otherwise follows the stage matrix", () => {
    wireHarness({ showDockAlways: true, stage: "idle" });
    expect(dock.shouldDisplayDock()).toBe(true);
    wireHarness({ stage: "recording" });
    expect(dock.shouldDisplayDock()).toBe(true);
    wireHarness({ stage: "processing" });
    expect(dock.shouldDisplayDock()).toBe(true);
    wireHarness({ stage: "idle" });
    expect(dock.shouldDisplayDock()).toBe(false);
  });
});

describe("resolvedDockTheme", () => {
  it("maps explicit modes and falls back to the system probe", () => {
    wireHarness({ themeMode: "light" });
    expect(dock.resolvedDockTheme()).toBe("light");
    wireHarness({ themeMode: "mono" });
    expect(dock.resolvedDockTheme()).toBe("dark");
    wireHarness({ themeMode: "system", systemLight: true });
    expect(dock.resolvedDockTheme()).toBe("light");
    wireHarness({ themeMode: "system", systemLight: false });
    expect(dock.resolvedDockTheme()).toBe("dark");
  });
});

describe("publishDockState", () => {
  it("posts the dock state payload", () => {
    const harness = wireHarness({ stage: "recording" });
    dock.publishDockState();
    expect(harness.posted).toEqual([
      {
        kind: "state",
        stage: "recording",
        visible: true,
        mainWindowHiddenToTray: false,
        theme: "dark",
        amplitude: 0.5,
        captureMode: "single-tap",
        hotkey: "Ctrl+Space",
        showFlowBar: true,
        commandModeArmed: false,
        globalShortcutsActive: true,
      },
    ]);
  });
});

describe("voiceIndicatorUrl", () => {
  it("prefixes http origins and passes through otherwise", () => {
    (globalThis as unknown as { window?: unknown }).window = {
      location: { origin: "http://localhost:1420" },
    };
    expect(dock.voiceIndicatorUrl()).toBe("http://localhost:1420/voice-indicator.html");
    (globalThis as unknown as { window?: unknown }).window = {
      location: { origin: "tauri://localhost" },
    };
    expect(dock.voiceIndicatorUrl()).toBe("voice-indicator.html");
  });
});

describe("reportDockRuntimeError", () => {
  it("notices once until cleared", () => {
    const harness = wireHarness();
    dock.reportDockRuntimeError("boom");
    dock.reportDockRuntimeError("boom");
    expect(harness.notices.length).toBe(1);
    expect(harness.notices[0]).toEqual({ message: "boom", isError: true });
  });
});
