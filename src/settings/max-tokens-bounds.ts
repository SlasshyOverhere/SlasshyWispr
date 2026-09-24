/**
 * Assistant reply-length bounds — backend-owned, shared with the settings UI.
 *
 * The backend clamps the token ceiling on every request and answers
 * `maxTokensBounds` over IPC, so the pane's input range and the stored-value
 * clamp cannot drift from what the backend will actually honour. Before this,
 * the frontend allowed up to 4096 while the backend clamped to 1024, so a
 * value in between displayed as the setting and was silently ignored.
 *
 * The fallback covers only the window before that answer arrives.
 */
import type { MaxTokensBoundsResponse } from "../types";
import { createBoundsStore } from "./bounds-store";

const FALLBACK_BOUNDS: MaxTokensBoundsResponse = {
  defaultTokens: 320,
  minTokens: 64,
  maxTokens: 1024,
};

/** A malformed answer must not widen the range the pane offers. */
function normalizeBounds(next: unknown): MaxTokensBoundsResponse | null {
  const candidate = next as Partial<MaxTokensBoundsResponse> | null | undefined;
  const defaultTokens = Number(candidate?.defaultTokens);
  const minTokens = Number(candidate?.minTokens);
  const maxTokens = Number(candidate?.maxTokens);
  const usable = [defaultTokens, minTokens, maxTokens].every(
    (value) => Number.isInteger(value) && value > 0,
  );
  if (!usable || minTokens > maxTokens) {
    return null;
  }
  return {
    defaultTokens: Math.min(Math.max(defaultTokens, minTokens), maxTokens),
    minTokens,
    maxTokens,
  };
}

const store = createBoundsStore<MaxTokensBoundsResponse>(FALLBACK_BOUNDS, normalizeBounds);

export const maxTokensBounds = store.read;
export const subscribeMaxTokensBounds = store.subscribe;
export const setMaxTokensBounds = store.set;
export const refreshMaxTokensBounds = store.refresh;
export const resetMaxTokensBoundsForTests = store.reset;
