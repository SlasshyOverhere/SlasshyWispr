/**
 * Backend-owned STT timeout bounds.
 *
 * The pane's min/max and the stored-value clamp both read these, so the tests
 * that matter are: the pre-IPC fallback, adopting the backend's answer, and
 * refusing a malformed answer rather than widening the range.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  refreshSttTimeoutBounds,
  resetSttTimeoutBoundsForTests,
  setSttTimeoutBounds,
  sttTimeoutBounds,
  subscribeSttTimeoutBounds,
} from "./stt-timeout-bounds";

describe("stt timeout bounds", () => {
  beforeEach(() => {
    resetSttTimeoutBoundsForTests();
  });

  it("serves a fallback before bootstrap reaches the backend", () => {
    // Settings load synchronously at boot, so the first read predates any IPC.
    const bounds = sttTimeoutBounds();
    expect(bounds.minSeconds).toBeGreaterThan(0);
    expect(bounds.maxSeconds).toBeGreaterThan(bounds.minSeconds);
    expect(bounds.defaultSeconds).toBeGreaterThanOrEqual(bounds.minSeconds);
    expect(bounds.defaultSeconds).toBeLessThanOrEqual(bounds.maxSeconds);
  });

  it("adopts the backend answer", async () => {
    await refreshSttTimeoutBounds(async () => ({
      defaultSeconds: 45,
      minSeconds: 5,
      maxSeconds: 300,
    }));
    expect(sttTimeoutBounds()).toEqual({
      defaultSeconds: 45,
      minSeconds: 5,
      maxSeconds: 300,
    });
  });

  it("keeps the fallback when the backend cannot answer", async () => {
    const before = sttTimeoutBounds();
    await refreshSttTimeoutBounds(async () => {
      throw new Error("no backend");
    });
    expect(sttTimeoutBounds()).toEqual(before);
  });

  it("refuses a malformed answer instead of widening the range", () => {
    const before = sttTimeoutBounds();
    // Backwards range, non-numeric, and zero would each let the pane offer a
    // value the backend clamps away.
    setSttTimeoutBounds({ defaultSeconds: 60, minSeconds: 600, maxSeconds: 10 });
    expect(sttTimeoutBounds()).toEqual(before);
    setSttTimeoutBounds({
      defaultSeconds: Number.NaN,
      minSeconds: 10,
      maxSeconds: 600,
    });
    expect(sttTimeoutBounds()).toEqual(before);
    setSttTimeoutBounds({ defaultSeconds: 60, minSeconds: 0, maxSeconds: 600 });
    expect(sttTimeoutBounds()).toEqual(before);
  });

  it("clamps a default that falls outside the advertised range", () => {
    // A default the UI cannot represent would make the field show one number
    // and the backend enforce another.
    setSttTimeoutBounds({ defaultSeconds: 9999, minSeconds: 10, maxSeconds: 600 });
    expect(sttTimeoutBounds()).toEqual({
      defaultSeconds: 600,
      minSeconds: 10,
      maxSeconds: 600,
    });
  });

  it("notifies subscribers so a mounted pane re-renders with the real bounds", async () => {
    let notifications = 0;
    const unsubscribe = subscribeSttTimeoutBounds(() => {
      notifications += 1;
    });

    await refreshSttTimeoutBounds(async () => ({
      defaultSeconds: 90,
      minSeconds: 20,
      maxSeconds: 900,
    }));
    expect(notifications).toBe(1);

    unsubscribe();
    setSttTimeoutBounds({ defaultSeconds: 60, minSeconds: 10, maxSeconds: 600 });
    expect(notifications).toBe(1);
  });
});
