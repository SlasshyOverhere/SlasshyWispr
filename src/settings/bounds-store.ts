/**
 * Backend-owned bounds, held on the frontend.
 *
 * The backend clamps every request, and answers with the bounds it clamps
 * against so the UI cannot offer or display a value the backend will change.
 * Each bounds set only supplies its fallback and how to validate an answer;
 * the policy — one fallback until the answer arrives, a malformed answer never
 * widening the range, subscribers notified on change — lives here once.
 */

export interface BoundsStore<T> {
  read: () => T;
  /** Adopt a value (normally the backend's answer), or the fallback if unusable. */
  set: (next: unknown) => void;
  subscribe: (listener: () => void) => () => void;
  /** A backend that cannot answer cannot clamp either, so the fallback stands. */
  refresh: (load: () => Promise<T>) => Promise<void>;
  /** Test seam: drop back to the pre-IPC fallback. */
  reset: () => void;
}

/**
 * `normalize` receives an untrusted value and returns the usable form, or null
 * when nothing about it can be trusted — never a widened range.
 */
export function createBoundsStore<T>(
  fallback: T,
  normalize: (next: unknown) => T | null,
): BoundsStore<T> {
  let current = fallback;
  const listeners = new Set<() => void>();

  function publish(next: T): void {
    current = next;
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    read: () => current,
    set: (next) => publish(normalize(next) ?? fallback),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh: async (load) => {
      try {
        publish(normalize(await load()) ?? fallback);
      } catch {
        // Keep the fallback.
      }
    },
    reset: () => {
      current = fallback;
      listeners.clear();
    },
  };
}
