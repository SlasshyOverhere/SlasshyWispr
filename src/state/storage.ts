/**
 * Canonical localStorage JSON helper.
 *
 * Single owner for safe JSON parsing. Storage keys remain owned by
 * `src/constants.ts` — import keys from there, parse with this.
 */
export function parseJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
