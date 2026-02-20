import { describe, it, expect } from "bun:test";
import { captureModeLabel, type CaptureMode } from "./utils";

describe("captureModeLabel", () => {
  it("should return 'Push-To-Talk' for 'push-to-talk' mode", () => {
    const mode: CaptureMode = "push-to-talk";
    expect(captureModeLabel(mode)).toBe("Push-To-Talk");
  });

  it("should return 'Single Tap' for 'single-tap' mode", () => {
    const mode: CaptureMode = "single-tap";
    expect(captureModeLabel(mode)).toBe("Single Tap");
  });

  it("should return 'Single Tap' for any other value (as per current implementation fallback)", () => {
    // @ts-ignore - testing fallback behavior for non-CaptureMode inputs if any
    expect(captureModeLabel("invalid" as CaptureMode)).toBe("Single Tap");
  });
});
