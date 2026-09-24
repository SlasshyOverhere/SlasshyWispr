/**
 * Storage JSON guard test (F-035).
 *
 * Pins parseJson: valid JSON round-trips, missing key returns the fallback,
 * and a corrupt payload is quarantined to `<key>.corrupt-<ts>.bak` instead of
 * being silently dropped.
 */
import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { parseJson, parseJsonText } from "./storage";

const KEY = "slasshywispr-test-key";

const originalLocalStorage = (globalThis as unknown as { localStorage?: unknown }).localStorage;

/** Minimal complete Storage stub — other test files in the same run rely on
    `clear`/`key`/`length` being present on the global. */
function installStorageStub(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  return store;
}

let store: Map<string, string>;

beforeEach(() => {
  store = installStorageStub();
});

afterAll(() => {
  // Restore the global so later test files see the real (or absent) storage.
  (globalThis as unknown as { localStorage: unknown }).localStorage = originalLocalStorage;
});

describe("parseJson", () => {
  it("returns parsed JSON for a valid payload", () => {
    store.set(KEY, JSON.stringify({ sessions: 3 }));
    expect(parseJson<{ sessions: number }>(KEY, { sessions: 0 })).toEqual({ sessions: 3 });
  });

  it("returns the fallback when the key is absent", () => {
    expect(parseJson<number[]>(KEY, [])).toEqual([]);
  });

  it("quarantines a corrupt payload and clears the live key", () => {
    store.set(KEY, "{not json");
    expect(parseJson<number[]>(KEY, [])).toEqual([]);

    expect(store.has(KEY)).toBe(false);
    const quarantined = [...store.keys()].filter((key) => key.startsWith(`${KEY}.corrupt-`));
    expect(quarantined.length).toBe(1);
    expect(store.get(quarantined[0])).toBe("{not json");
  });
});

describe("parseJsonText", () => {
  it("returns parsed JSON for a valid payload", () => {
    expect(parseJsonText<{ a: number }>('{"a":1}', { a: 0 })).toEqual({ a: 1 });
  });

  it("returns the fallback for an absent or unparseable payload", () => {
    expect(parseJsonText<number[]>(null, [])).toEqual([]);
    expect(parseJsonText<number[]>("", [])).toEqual([]);
    expect(parseJsonText<number[]>("{not json", [])).toEqual([]);
  });

  it("leaves storage alone — the caller owns the key", () => {
    store.set(KEY, "{not json");
    expect(parseJsonText<number[]>(store.get(KEY), [])).toEqual([]);
    expect(store.has(KEY)).toBe(true);
    expect([...store.keys()].some((key) => key.startsWith(`${KEY}.corrupt-`))).toBe(false);
  });
});