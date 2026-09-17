/**
 * Dock-geometry move-boundary test — Phase 5 shell decomposition.
 *
 * Pins the pure geometry helpers moved to windows/dock-geometry:
 * clampDockAxis edge cases, monitorWorkArea fallback, and
 * resolveDockStartPosition with stubbed Tauri monitor APIs
 * (persisted layout, clamped bounds, no-monitor fallback).
 */
import { describe, it, expect, mock, beforeEach } from "bun:test";

mock.module("@tauri-apps/api/window", () => ({
  availableMonitors: async () => (globalThis as never as { __monitors: unknown[] }).__monitors ?? [],
  currentMonitor: async () => (globalThis as never as { __current: unknown }).__current ?? null,
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

// Import after the mock.
const geometry = await import("./dock-geometry");

function wireHarness(layout: { x: number; y: number } | null = null) {
  geometry.initDockGeometry({
    getPersistedLayout: () => layout,
  });
}

beforeEach(() => {
  wireHarness(null);
  (globalThis as never as { __monitors?: unknown }).__monitors = [];
  (globalThis as never as { __current?: unknown }).__current = null;
  (globalThis as unknown as { window?: unknown }).window = {
    screen: { availWidth: 1920, availHeight: 1080 },
  };
});

describe("clampDockAxis", () => {
  it("clamps, rounds, and guards NaN and inverted ranges", () => {
    expect(geometry.clampDockAxis(5.6, 0, 10)).toBe(6);
    expect(geometry.clampDockAxis(-5, 0, 10)).toBe(0);
    expect(geometry.clampDockAxis(99, 0, 10)).toBe(10);
    expect(geometry.clampDockAxis(NaN, 3, 10)).toBe(3);
    expect(geometry.clampDockAxis(5, 10, 2)).toBe(10);
  });
});

describe("monitorWorkArea", () => {
  it("prefers workArea and falls back to position/size", () => {
    const withWorkArea = {
      position: { x: 0, y: 0 },
      size: { width: 100, height: 100 },
      workArea: { position: { x: 5, y: 5 }, size: { width: 90, height: 90 } },
    };
    expect(geometry.monitorWorkArea(withWorkArea as never)).toEqual({
      x: 5,
      y: 5,
      width: 90,
      height: 90,
    });
    const bare = {
      position: { x: 1.6, y: 2.4 },
      size: { width: 100, height: 50 },
    };
    expect(geometry.monitorWorkArea(bare as never)).toEqual({
      x: 2,
      y: 2,
      width: 100,
      height: 50,
    });
  });
});

describe("resolveDockStartPosition", () => {
  it("uses the persisted layout clamped to monitor bounds", async () => {
    (globalThis as never as { __monitors?: unknown }).__monitors = [
      {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
        workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1040 } },
      },
    ];
    wireHarness({ x: 5000, y: 10 });
    const pos = await geometry.resolveDockStartPosition(160, 140);
    expect(pos.x).toBeLessThanOrEqual(1760);
    expect(pos.y).toBe(10);
  });

  it("falls back to screen metrics with no monitors", async () => {
    wireHarness(null);
    const pos = await geometry.resolveDockStartPosition(160, 140);
    expect(pos).toEqual({ x: 1920 - 160 - 18, y: 1080 - 140 - 18 });
  });

  it("resolves placement bounds across monitors", async () => {
    (globalThis as never as { __monitors?: unknown }).__monitors = [
      {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1080 },
      },
    ];
    const bounds = await geometry.resolveDockPlacementBounds(160, 140);
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 1760, maxY: 940 });
    (globalThis as never as { __monitors?: unknown }).__monitors = [];
    expect(await geometry.resolveDockPlacementBounds(160, 140)).toBeNull();
  });
});
