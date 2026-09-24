/**
 * Backend-owned temperature bounds.
 *
 * The pane's slider range and the stored-value clamp both read these, so the
 * tests that matter are: the pre-IPC fallback, adopting the backend's answer,
 * and refusing a malformed answer rather than widening the range.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  refreshTemperatureBounds,
  resetTemperatureBoundsForTests,
  setTemperatureBounds,
  subscribeTemperatureBounds,
  temperatureBounds,
} from "./temperature-bounds";

describe("temperature bounds", () => {
  beforeEach(() => {
    resetTemperatureBoundsForTests();
  });

  it("serves a fallback before bootstrap reaches the backend", () => {
    // Settings load synchronously at boot, so the first read predates any IPC.
    const bounds = temperatureBounds();
    expect(bounds.minTemperature).toBeGreaterThanOrEqual(0);
    expect(bounds.maxTemperature).toBeGreaterThan(bounds.minTemperature);
    expect(bounds.defaultTemperature).toBeGreaterThanOrEqual(bounds.minTemperature);
    expect(bounds.defaultTemperature).toBeLessThanOrEqual(bounds.maxTemperature);
  });

  it("adopts the backend answer", async () => {
    await refreshTemperatureBounds(async () => ({
      defaultTemperature: 0.7,
      minTemperature: 0.1,
      maxTemperature: 1.5,
    }));
    expect(temperatureBounds()).toEqual({
      defaultTemperature: 0.7,
      minTemperature: 0.1,
      maxTemperature: 1.5,
    });
  });

  it("keeps the fallback when the backend cannot answer", async () => {
    const before = temperatureBounds();
    await refreshTemperatureBounds(async () => {
      throw new Error("no backend");
    });
    expect(temperatureBounds()).toEqual(before);
  });

  it("accepts a minimum of zero and fractions, unlike the integer bounds", () => {
    // Zero is the bottom of the temperature range, not a missing value, and the
    // slider steps in fractions — both would be rejected by an integer test.
    setTemperatureBounds({ defaultTemperature: 0.35, minTemperature: 0, maxTemperature: 1.2 });
    expect(temperatureBounds()).toEqual({
      defaultTemperature: 0.35,
      minTemperature: 0,
      maxTemperature: 1.2,
    });
  });

  it("refuses a malformed answer instead of widening the range", () => {
    const before = temperatureBounds();
    setTemperatureBounds({ defaultTemperature: 0.35, minTemperature: 1.2, maxTemperature: 0 });
    expect(temperatureBounds()).toEqual(before);
    setTemperatureBounds({
      defaultTemperature: Number.NaN,
      minTemperature: 0,
      maxTemperature: 1.2,
    });
    expect(temperatureBounds()).toEqual(before);
    setTemperatureBounds({ defaultTemperature: 0.35, minTemperature: -1, maxTemperature: 1.2 });
    expect(temperatureBounds()).toEqual(before);
  });

  it("clamps a default that falls outside the advertised range", () => {
    setTemperatureBounds({ defaultTemperature: 99, minTemperature: 0, maxTemperature: 1.2 });
    expect(temperatureBounds()).toEqual({
      defaultTemperature: 1.2,
      minTemperature: 0,
      maxTemperature: 1.2,
    });
  });

  it("notifies subscribers so a mounted pane re-renders with the real bounds", async () => {
    let notifications = 0;
    const unsubscribe = subscribeTemperatureBounds(() => {
      notifications += 1;
    });

    await refreshTemperatureBounds(async () => ({
      defaultTemperature: 0.7,
      minTemperature: 0.2,
      maxTemperature: 1.5,
    }));
    expect(notifications).toBe(1);

    unsubscribe();
    setTemperatureBounds({ defaultTemperature: 0.35, minTemperature: 0, maxTemperature: 1.2 });
    expect(notifications).toBe(1);
  });
});
