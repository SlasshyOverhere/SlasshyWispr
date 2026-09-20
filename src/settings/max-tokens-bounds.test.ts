/**
 * Backend-owned max-token bounds.
 *
 * The pane's min/max and the stored-value clamp both read these, so the tests
 * that matter are: the pre-IPC fallback, adopting the backend's answer, and
 * refusing a malformed answer rather than widening the range.
 */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  maxTokensBounds,
  refreshMaxTokensBounds,
  resetMaxTokensBoundsForTests,
  setMaxTokensBounds,
  subscribeMaxTokensBounds,
} from "./max-tokens-bounds";

describe("max tokens bounds", () => {
  beforeEach(() => {
    resetMaxTokensBoundsForTests();
  });

  it("serves a fallback before bootstrap reaches the backend", () => {
    // Settings load synchronously at boot, so the first read predates any IPC.
    const bounds = maxTokensBounds();
    expect(bounds.minTokens).toBeGreaterThan(0);
    expect(bounds.maxTokens).toBeGreaterThan(bounds.minTokens);
    expect(bounds.defaultTokens).toBeGreaterThanOrEqual(bounds.minTokens);
    expect(bounds.defaultTokens).toBeLessThanOrEqual(bounds.maxTokens);
  });

  it("adopts the backend answer", async () => {
    await refreshMaxTokensBounds(async () => ({
      defaultTokens: 512,
      minTokens: 128,
      maxTokens: 2048,
    }));
    expect(maxTokensBounds()).toEqual({
      defaultTokens: 512,
      minTokens: 128,
      maxTokens: 2048,
    });
  });

  it("keeps the fallback when the backend cannot answer", async () => {
    const before = maxTokensBounds();
    await refreshMaxTokensBounds(async () => {
      throw new Error("no backend");
    });
    expect(maxTokensBounds()).toEqual(before);
  });

  it("refuses a malformed answer instead of widening the range", () => {
    const before = maxTokensBounds();
    // Backwards range, non-numeric, and zero would each let the pane offer a
    // value the backend clamps away.
    setMaxTokensBounds({ defaultTokens: 320, minTokens: 1024, maxTokens: 64 });
    expect(maxTokensBounds()).toEqual(before);
    setMaxTokensBounds({ defaultTokens: Number.NaN, minTokens: 64, maxTokens: 1024 });
    expect(maxTokensBounds()).toEqual(before);
    setMaxTokensBounds({ defaultTokens: 320, minTokens: 0, maxTokens: 1024 });
    expect(maxTokensBounds()).toEqual(before);
  });

  it("refuses a fractional bound the pane could not step to", () => {
    // The input steps by 16, so a fractional token count is not a value the UI
    // can represent and the field would show one number and send another.
    const before = maxTokensBounds();
    setMaxTokensBounds({ defaultTokens: 320, minTokens: 64.5, maxTokens: 1024 });
    expect(maxTokensBounds()).toEqual(before);
  });

  it("clamps a default that falls outside the advertised range", () => {
    setMaxTokensBounds({ defaultTokens: 99999, minTokens: 64, maxTokens: 1024 });
    expect(maxTokensBounds()).toEqual({
      defaultTokens: 1024,
      minTokens: 64,
      maxTokens: 1024,
    });
  });

  it("notifies subscribers so a mounted pane re-renders with the real bounds", async () => {
    let notifications = 0;
    const unsubscribe = subscribeMaxTokensBounds(() => {
      notifications += 1;
    });

    await refreshMaxTokensBounds(async () => ({
      defaultTokens: 512,
      minTokens: 128,
      maxTokens: 2048,
    }));
    expect(notifications).toBe(1);

    unsubscribe();
    setMaxTokensBounds({ defaultTokens: 320, minTokens: 64, maxTokens: 1024 });
    expect(notifications).toBe(1);
  });
});
