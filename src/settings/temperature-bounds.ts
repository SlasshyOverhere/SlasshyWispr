/**
 * Assistant sampling-temperature bounds — backend-owned, shared with the settings UI.
 *
 * The backend clamps the temperature on every request and answers
 * `temperatureBounds` over IPC, so the pane's slider range, the stored-value
 * clamp and the validation the backend accepts cannot drift from each other.
 * Before this, TypeScript allowed 0-1.2 while the backend validator accepted up
 * to 2, and only the coerce-on-load kept them from disagreeing.
 *
 * The fallback covers only the window before that answer arrives.
 */
import type { TemperatureBoundsResponse } from "../types";
import { createBoundsStore } from "./bounds-store";

const FALLBACK_BOUNDS: TemperatureBoundsResponse = {
  defaultTemperature: 0.35,
  minTemperature: 0,
  maxTemperature: 1.2,
};

/** A malformed answer must not widen the range the pane offers. */
function normalizeBounds(next: unknown): TemperatureBoundsResponse | null {
  const candidate = next as Partial<TemperatureBoundsResponse> | null | undefined;
  const defaultTemperature = Number(candidate?.defaultTemperature);
  const minTemperature = Number(candidate?.minTemperature);
  const maxTemperature = Number(candidate?.maxTemperature);
  // Fractions are the point here, unlike the integer bounds, and a minimum of
  // zero is the bottom of the range rather than a missing value.
  const usable = [defaultTemperature, minTemperature, maxTemperature].every(Number.isFinite);
  if (!usable || minTemperature < 0 || minTemperature > maxTemperature) {
    return null;
  }
  return {
    defaultTemperature: Math.min(Math.max(defaultTemperature, minTemperature), maxTemperature),
    minTemperature,
    maxTemperature,
  };
}

const store = createBoundsStore<TemperatureBoundsResponse>(FALLBACK_BOUNDS, normalizeBounds);

export const temperatureBounds = store.read;
export const subscribeTemperatureBounds = store.subscribe;
export const setTemperatureBounds = store.set;
export const refreshTemperatureBounds = store.refresh;
export const resetTemperatureBoundsForTests = store.reset;
