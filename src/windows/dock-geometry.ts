/**
 * Dock placement geometry — Phase 5 shell decomposition.
 *
 * Owns clampDockAxis + monitorWorkArea + resolveDockPlacementBounds +
 * resolveDefaultDockPosition + resolveDockStartPosition. Moved verbatim
 * from main.tsx; the persisted layout arrives via accessors so this
 * module never touches main.tsx module globals. Pure monitor math plus
 * Tauri monitor queries; no DOM, no windows.
 */
import {
  availableMonitors,
  currentMonitor,
  type Monitor,
} from "@tauri-apps/api/window";
import type { DockLayout, DockPlacementBounds } from "../types";

export interface DockGeometryDeps {
  getPersistedLayout: () => DockLayout | null;
}

let geometryDeps!: DockGeometryDeps;

export function initDockGeometry(deps: DockGeometryDeps): void {
  geometryDeps = deps;
}

// F-026: main-window floor proposed for tauri.conf.json (coordinator approves;
// this module owns the TS-side constants + breakpoint so layout follows suit).
export const MAIN_WINDOW_MIN_SIZE = { width: 1024, height: 640 } as const;

// F-026: below this viewport width the dock-dependent layout goes compact.
export const DOCK_VIEWPORT_BREAKPOINT = 1100;

export function dockCompactForViewport(viewportWidth: number): boolean {
  if (!Number.isFinite(viewportWidth)) return false;
  return viewportWidth < DOCK_VIEWPORT_BREAKPOINT;
}

// F-030: single reduced-motion probe shared by dock + popup. Gated behind
// typeof guards so bun tests (no matchMedia) default to motion allowed.
export function prefersReducedMotion(): boolean {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function clampDockAxis(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return Math.round(min);
  }
  if (max < min) {
    return Math.round(min);
  }
  return Math.round(Math.min(Math.max(value, min), max));
}

export function monitorWorkArea(monitor: Monitor): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const area = monitor.workArea ?? {
    position: monitor.position,
    size: monitor.size,
  };

  return {
    x: Math.round(area.position.x),
    y: Math.round(area.position.y),
    width: Math.max(0, Math.round(area.size.width)),
    height: Math.max(0, Math.round(area.size.height)),
  };
}

export async function resolveDockPlacementBounds(
  dockWidth: number,
  dockHeight: number,
): Promise<DockPlacementBounds | null> {
  try {
    const monitors = await availableMonitors();
    if (monitors.length === 0) {
      return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const monitor of monitors) {
      const area = monitorWorkArea(monitor);
      const candidateMinX = area.x;
      const candidateMinY = area.y;
      const candidateMaxX = area.x + Math.max(0, area.width - dockWidth);
      const candidateMaxY = area.y + Math.max(0, area.height - dockHeight);

      minX = Math.min(minX, candidateMinX);
      minY = Math.min(minY, candidateMinY);
      maxX = Math.max(maxX, candidateMaxX);
      maxY = Math.max(maxY, candidateMaxY);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }

    return {
      minX: Math.round(minX),
      minY: Math.round(minY),
      maxX: Math.round(maxX),
      maxY: Math.round(maxY),
    };
  } catch {
    return null;
  }
}

export async function resolveDefaultDockPosition(dockWidth: number, dockHeight: number): Promise<DockLayout> {
  try {
    const monitor = await currentMonitor();
    if (monitor) {
      const area = monitorWorkArea(monitor);
      return {
        x: Math.round(area.x + Math.max(0, area.width - dockWidth - 18)),
        y: Math.round(area.y + Math.max(0, area.height - dockHeight - 18)),
      };
    }
  } catch {
    // Fall back to browser screen metrics.
  }

  return {
    x: Math.max(0, Math.round(window.screen.availWidth - dockWidth - 18)),
    y: Math.max(0, Math.round(window.screen.availHeight - dockHeight - 18)),
  };
}

export async function resolveDockStartPosition(dockWidth: number, dockHeight: number): Promise<DockLayout> {
  const fallback = await resolveDefaultDockPosition(dockWidth, dockHeight);
  const persisted = geometryDeps.getPersistedLayout();
  const rawX = persisted?.x ?? fallback.x;
  const rawY = persisted?.y ?? fallback.y;
  const bounds = await resolveDockPlacementBounds(dockWidth, dockHeight);

  if (!bounds) {
    return {
      x: Math.round(rawX),
      y: Math.round(rawY),
    };
  }

  return {
    x: clampDockAxis(rawX, bounds.minX, bounds.maxX),
    y: clampDockAxis(rawY, bounds.minY, bounds.maxY),
  };
}
