/**
 * Command-mode move-boundary test — Phase 5 shell decomposition.
 *
 * Pins captureSelectedTextForRewrite (non-Tauri empty, IPC value,
 * silent vs noisy failure), primeSelectionSnapshot (trim/empty/log),
 * and the armed toggle lifecycle (notices, snapshot clear, dock
 * publish on set/reset).
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  captureSelectedTextForRewrite,
  getCommandSelectionSnapshot,
  initCommandMode,
  isCommandModeArmed,
  primeSelectionSnapshotForCommandMode,
  resetCommandMode,
  setCommandModeArmed,
  setCommandSelectionSnapshot,
  toggleCommandModeArmed,
} from "./command-mode";

function wireHarness(options: {
  tauri?: boolean;
  captured?: string | null;
  fail?: boolean;
} = {}) {
  const notices: Array<{ message: string; isError?: boolean }> = [];
  const logs: string[] = [];
  let publishes = 0;
  initCommandMode({
    isTauri: () => options.tauri ?? true,
    captureSelectedText: async () => {
      if (options.fail) {
        throw new Error("no selection");
      }
      return options.captured ?? null;
    },
    setNotice: (message, isError) => {
      notices.push({ message, isError });
    },
    log: (message) => {
      logs.push(message);
    },
    publishDockState: () => {
      publishes += 1;
    },
  });
  resetCommandMode();
  return { notices, logs, publishes: () => publishes };
}

beforeEach(() => {
  wireHarness();
});

describe("captureSelectedTextForRewrite", () => {
  it("returns empty outside Tauri without calling IPC", async () => {
    let calls = 0;
    initCommandMode({
      isTauri: () => false,
      captureSelectedText: async () => {
        calls += 1;
        return "x";
      },
      setNotice: () => {},
      log: () => {},
      publishDockState: () => {},
    });
    await expect(captureSelectedTextForRewrite()).resolves.toBe("");
    expect(calls).toBe(0);
  });

  it("stringifies IPC values and notices only when noisy", async () => {
    wireHarness({ captured: "  hello  " });
    await expect(captureSelectedTextForRewrite()).resolves.toBe("  hello  ");

    const noisy = wireHarness({ fail: true });
    await expect(captureSelectedTextForRewrite()).resolves.toBe("");
    expect(noisy.notices).toEqual([
      { message: "Unable to capture selected text: no selection", isError: true },
    ]);

    const silent = wireHarness({ fail: true });
    await expect(captureSelectedTextForRewrite({ silent: true })).resolves.toBe("");
    expect(silent.notices).toEqual([]);
  });
});

describe("primeSelectionSnapshotForCommandMode", () => {
  it("trims, stores, and logs nonzero selections", async () => {
    const harness = wireHarness({ captured: "  rewrite me  " });
    await primeSelectionSnapshotForCommandMode();
    expect(getCommandSelectionSnapshot()).toBe("rewrite me");
    expect(harness.logs).toEqual(["selection.prime chars=10"]);
  });

  it("stores null for empty selections without logging", async () => {
    const harness = wireHarness({ captured: "   " });
    await primeSelectionSnapshotForCommandMode();
    expect(getCommandSelectionSnapshot()).toBeNull();
    expect(harness.logs).toEqual([]);
  });
});

describe("armed lifecycle", () => {
  it("toggles armed state with notices and snapshot clear", () => {
    const harness = wireHarness({ captured: null });
    expect(isCommandModeArmed()).toBe(false);
    toggleCommandModeArmed();
    expect(isCommandModeArmed()).toBe(true);
    expect(harness.notices[0]).toEqual({
      message: "Command mode armed for the next dictation.",
      isError: undefined,
    });
    setCommandSelectionSnapshot("stale");
    toggleCommandModeArmed();
    expect(isCommandModeArmed()).toBe(false);
    expect(getCommandSelectionSnapshot()).toBeNull();
    expect(harness.notices[1]).toEqual({
      message: "Command mode disabled for the next dictation.",
      isError: undefined,
    });
  });

  it("resetCommandMode clears and publishes", () => {
    const harness = wireHarness();
    const before = harness.publishes();
    setCommandModeArmed(true);
    setCommandSelectionSnapshot("x");
    resetCommandMode();
    expect(isCommandModeArmed()).toBe(false);
    expect(getCommandSelectionSnapshot()).toBeNull();
    expect(harness.publishes()).toBeGreaterThan(before);
  });
});
