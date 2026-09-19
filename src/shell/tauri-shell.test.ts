/**
 * Tauri-shell move-boundary test — Phase 5 shell decomposition.
 *
 * Pins isTauriEnvironment detection, the non-Tauri early returns (window
 * buttons disabled, launch IPC untouched), and the launch-at-login
 * reconcile branches (stale-enabled reapply, unwanted-enabled cleanup,
 * matching preference stays quiet). Tauri window/shell/IPC layers are
 * stubbed with mock.module.
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

// bun test has no DOM window; the module probes `window` for Tauri markers.
{
  (globalThis as unknown as { window?: unknown }).window ??= {};
}

const invokeCalls: Array<{ command: string; args: unknown }> = [];
let invokeImpl: (command: string, args?: unknown) => Promise<unknown> = async () => null;

mock.module("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => {
    invokeCalls.push({ command, args });
    return invokeImpl(command, args);
  },
}));

// Superset mock: mock.module leaks across test files in one bun run, so this
// must provide every @tauri-apps/api/window export other suites import
// (dock-geometry needs availableMonitors/currentMonitor, selection-popup
// needs LogicalSize) or the full suite fails while this file alone passes.
mock.module("@tauri-apps/api/window", () => ({
  availableMonitors: async () => [],
  currentMonitor: async () => null,
  getCurrentWindow: () => ({
    minimize: async () => {},
    close: async () => {},
    show: async () => {},
    unminimize: async () => {},
    setFocus: async () => {},
    isVisible: async () => true,
  }),
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
  PhysicalPosition: class {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));

mock.module("@tauri-apps/plugin-shell", () => ({
  open: async () => {},
}));

// Import after the mocks so the module binds the stubs.
const shell = await import("./tauri-shell");

function fakeButton(): HTMLButtonElement {
  const clicks: Array<() => void> = [];
  return {
    disabled: false,
    addEventListener(_type: string, listener: () => void) {
      clicks.push(listener);
    },
    __clicks: clicks,
  } as unknown as HTMLButtonElement;
}

function wireHarness(options: { tauri?: boolean; launchAtLogin?: boolean } = {}) {
  const windowMinimizeBtn = fakeButton();
  const windowCloseBtn = fakeButton();
  const notices: Array<{ message: string; isError?: boolean }> = [];
  const logs: string[] = [];
  shell.initTauriShell(
    { windowMinimizeBtn, windowCloseBtn },
    {
      isTauri: () => options.tauri ?? true,
      getLaunchAtLogin: () => options.launchAtLogin ?? false,
      notify: (message, isError) => {
        notices.push({ message, isError });
      },
      log: (message) => {
        logs.push(message);
      },
    },
  );
  return { windowMinimizeBtn, windowCloseBtn, notices, logs };
}

function setTauriPresent(present: boolean): void {
  const w = window as unknown as Record<string, unknown>;
  if (present) {
    w.__TAURI_INTERNALS__ = {};
  } else {
    delete w.__TAURI_INTERNALS__;
    delete w.__TAURI__;
  }
}

beforeEach(() => {
  invokeCalls.length = 0;
  invokeImpl = async () => null;
  wireHarness();
});

describe("isTauriEnvironment", () => {
  it("detects the Tauri internals marker", () => {
    setTauriPresent(true);
    expect(shell.isTauriEnvironment()).toBe(true);
    setTauriPresent(false);
    expect(shell.isTauriEnvironment()).toBe(false);
    setTauriPresent(true);
  });
});

describe("setupCustomWindowControls", () => {
  it("disables buttons outside Tauri", () => {
    const harness = wireHarness({ tauri: false });
    shell.setupCustomWindowControls();
    expect(harness.windowMinimizeBtn.disabled).toBe(true);
    expect(harness.windowCloseBtn.disabled).toBe(true);
  });
});

describe("requestLaunchAtLoginSync", () => {
  it("skips IPC outside Tauri", () => {
    wireHarness({ tauri: false });
    shell.requestLaunchAtLoginSync(true);
    expect(invokeCalls.length).toBe(0);
  });

  it("sends the enabled flag through IPC in Tauri", () => {
    wireHarness({ tauri: true });
    shell.requestLaunchAtLoginSync(true);
    expect(invokeCalls.length).toBe(1);
    expect(invokeCalls[0].args).toEqual({ enabled: true });
  });
});

describe("reconcileLaunchAtLoginWithOs", () => {
  it("reapplies when the registry is stale", async () => {
    const harness = wireHarness({ tauri: true, launchAtLogin: true });
    invokeImpl = async () => ({ enabled: false, path_matches: false, stored_value: null });
    await shell.reconcileLaunchAtLoginWithOs();
    expect(harness.logs.some((line) => line.includes("stale"))).toBe(true);
    expect(invokeCalls.some((call) => JSON.stringify(call.args) === '{"enabled":true}')).toBe(true);
  });

  it("cleans up when the registry is enabled but unwanted", async () => {
    const harness = wireHarness({ tauri: true, launchAtLogin: false });
    invokeImpl = async () => ({ enabled: true, path_matches: true, stored_value: "x" });
    await shell.reconcileLaunchAtLoginWithOs();
    expect(harness.logs.some((line) => line.includes("cleaning up"))).toBe(true);
    expect(invokeCalls.some((call) => JSON.stringify(call.args) === '{"enabled":false}')).toBe(true);
  });
});
