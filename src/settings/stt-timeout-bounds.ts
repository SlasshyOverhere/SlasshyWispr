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
import { createBoundsStore } from "./bounds-store";

const FALLBACK_BOUNDS: SttTimeoutBoundsResponse = {
  defaultSeconds: 60,
  minSeconds: 10,
  maxSeconds: 600,
};

/** A malformed answer must not widen the range the pane offers. */
function normalizeBounds(next: unknown): SttTimeoutBoundsResponse | null {
  const candidate = next as Partial<SttTimeoutBoundsResponse> | null | undefined;
  const defaultSeconds = Number(candidate?.defaultSeconds);
  const minSeconds = Number(candidate?.minSeconds);
  const maxSeconds = Number(candidate?.maxSeconds);
  const usable = [defaultSeconds, minSeconds, maxSeconds].every(
    (value) => Number.isFinite(value) && value > 0,
  );
  if (!usable || minSeconds > maxSeconds) {
    return null;
  }
  return {
    defaultSeconds: Math.min(Math.max(defaultSeconds, minSeconds), maxSeconds),
    minSeconds,
    maxSeconds,
  };
}

const store = createBoundsStore<SttTimeoutBoundsResponse>(FALLBACK_BOUNDS, normalizeBounds);

export const sttTimeoutBounds = store.read;
export const subscribeSttTimeoutBounds = store.subscribe;
export const setSttTimeoutBounds = store.set;
export const refreshSttTimeoutBounds = store.refresh;
export const resetSttTimeoutBoundsForTests = store.reset;
