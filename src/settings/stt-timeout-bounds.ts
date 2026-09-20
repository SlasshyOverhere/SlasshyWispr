/**
 * STT request-timeout bounds — backend-owned bounds shared with the settings UI.
 *
 * The backend enforces the clamp on every transcription and answers
 * `sttTimeoutBounds` over IPC, so the pane's range and the stored-value clamp
 * cannot drift from what the backend will actually honour.
 *
 * The fallback below covers only the window before that answer arrives, and the
 * browser dev build, which has no backend. Settings load synchronously at boot
 * (main.tsx), so the first read happens before any IPC answer can exist.
 */
import type { SttTimeoutBoundsResponse } from "../types";

const FALLBACK_BOUNDS: SttTimeoutBoundsResponse = {
  defaultSeconds: 60,
  minSeconds: 10,
  maxSeconds: 600,
};

let bounds: SttTimeoutBoundsResponse = FALLBACK_BOUNDS;
const listeners = new Set<() => void>();

export function sttTimeoutBounds(): SttTimeoutBoundsResponse {
  return bounds;
}

export function subscribeSttTimeoutBounds(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSttTimeoutBounds(next: SttTimeoutBoundsResponse): void {
  bounds = normalizeBounds(next);
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Adopt the backend's bounds. The fetch is a seam so this module stays free of
 * IPC imports and testable without a Tauri environment.
 *
 * A backend that cannot answer cannot clamp either, so the fallback stands
 * rather than the whole settings load failing.
 */
export async function refreshSttTimeoutBounds(
  load: () => Promise<SttTimeoutBoundsResponse>,
): Promise<void> {
  try {
    setSttTimeoutBounds(await load());
  } catch {
    // Keep the fallback bounds.
  }
}

/** A malformed answer must not widen the range the pane offers. */
function normalizeBounds(
  next: Partial<SttTimeoutBoundsResponse> | null | undefined,
): SttTimeoutBoundsResponse {
  const defaultSeconds = Number(next?.defaultSeconds);
  const minSeconds = Number(next?.minSeconds);
  const maxSeconds = Number(next?.maxSeconds);
  const usable = [defaultSeconds, minSeconds, maxSeconds].every(
    (value) => Number.isFinite(value) && value > 0,
  );
  if (!usable || minSeconds > maxSeconds) {
    return FALLBACK_BOUNDS;
  }
  return {
    defaultSeconds: Math.min(Math.max(defaultSeconds, minSeconds), maxSeconds),
    minSeconds,
    maxSeconds,
  };
}

/** Test seam: drop back to the pre-IPC fallback. */
export function resetSttTimeoutBoundsForTests(): void {
  bounds = FALLBACK_BOUNDS;
  listeners.clear();
}
