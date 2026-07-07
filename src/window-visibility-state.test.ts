import { describe, expect, test } from "bun:test";

// Mirror of src-tauri/src/lib.rs WindowVisibilityState & WindowRect (camelCase JSON).
interface WindowRect {
  positionX: number;
  positionY: number;
  width: number;
  height: number;
}

interface WindowVisibilityState {
  hidden: boolean;
  lastRect: WindowRect | null;
}

function defaultState(): WindowVisibilityState {
  return { hidden: false, lastRect: null };
}

function toJson(s: WindowVisibilityState): string {
  return JSON.stringify(s);
}

function fromJson(value: string): WindowVisibilityState {
  return JSON.parse(value) as WindowVisibilityState;
}

describe("WindowVisibilityState round-trip", () => {
  test("default state serialises to camelCase JSON", () => {
    expect(toJson(defaultState())).toBe('{"hidden":false,"lastRect":null}');
  });

  test("hidden state round-trips losslessly", () => {
    const s: WindowVisibilityState = {
      hidden: true,
      lastRect: { positionX: 100, positionY: 200, width: 1280, height: 832 },
    };
    expect(fromJson(toJson(s))).toEqual(s);
  });

  test("rect with negative position (off-screen monitor) round-trips", () => {
    const s: WindowVisibilityState = {
      hidden: true,
      lastRect: { positionX: -1920, positionY: 100, width: 1280, height: 832 },
    };
    expect(fromJson(toJson(s))).toEqual(s);
  });

  test("rect at very large coordinates round-trips", () => {
    const s: WindowVisibilityState = {
      hidden: false,
      lastRect: { positionX: 8000, positionY: 8000, width: 1920, height: 1080 },
    };
    expect(fromJson(toJson(s))).toEqual(s);
  });

  test("fromJson rejects malformed payload", () => {
    expect(() => fromJson("not-json")).toThrow();
  });

  test("fromJson on partial shape (missing field) does not throw — Rust serde owns field validation; this confirms the JS wire format is permissive", () => {
    const bad = JSON.stringify({
      hidden: false,
      lastRect: { positionY: 1, width: 1, height: 1 },
    });
    // Documenting: at the JS wire layer, partial objects pass. Rust serde_json is
    // what enforces field completeness on the backend and would reject this.
    expect(() => fromJson(bad)).not.toThrow();
  });
});
