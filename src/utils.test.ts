import { describe, it, expect } from "bun:test";
import {
  buildAgentOperatingCorePrompt,
  captureModeLabel,
  type CaptureMode,
  normalizeDictationLanguageCode,
  normalizeDictationLanguageAllowList,
} from "./utils";

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

describe("buildAgentOperatingCorePrompt", () => {
  it("should include the agent name in the prompt", () => {
    const agentName = "TestAgent";
    const prompt = buildAgentOperatingCorePrompt(agentName);
    expect(prompt).toContain(`You are "${agentName}"`);
  });

  it("should include MODE 1: CLEANUP instructions", () => {
    const prompt = buildAgentOperatingCorePrompt("Agent");
    expect(prompt).toContain("MODE 1: CLEANUP (default)");
    expect(prompt).toContain("Clean transcription errors");
  });

  it("should include MODE 2: AGENT instructions", () => {
    const prompt = buildAgentOperatingCorePrompt("Agent");
    expect(prompt).toContain("MODE 2: AGENT");
    expect(prompt).toContain("Activate when directly addressed by name");
  });

  it("should handle different agent names", () => {
    const agentName1 = "Alice";
    const prompt1 = buildAgentOperatingCorePrompt(agentName1);
    expect(prompt1).toContain(`You are "${agentName1}"`);

    const agentName2 = "Bob";
    const prompt2 = buildAgentOperatingCorePrompt(agentName2);
    expect(prompt2).toContain(`You are "${agentName2}"`);
  });
});


describe("normalizeDictationLanguageCode", () => {
  it("should handle valid inputs", () => {
    expect(normalizeDictationLanguageCode("en")).toBe("en");
    expect(normalizeDictationLanguageCode("en-US")).toBe("en");
    expect(normalizeDictationLanguageCode("EN_US")).toBe("en");
  });

  it("should handle invalid inputs", () => {
    expect(normalizeDictationLanguageCode(null)).toBe("");
    expect(normalizeDictationLanguageCode(undefined)).toBe("");
    expect(normalizeDictationLanguageCode("")).toBe("");
    expect(normalizeDictationLanguageCode("invalid")).toBe("");
  });
});

describe("normalizeDictationLanguageAllowList", () => {
  it("should handle valid string inputs", () => {
    expect(normalizeDictationLanguageAllowList("en,es,fr")).toEqual(["en", "es", "fr"]);
    expect(normalizeDictationLanguageAllowList("en-US, es_ES")).toEqual(["en", "es"]);
  });

  it("should deduplicate string inputs", () => {
    expect(normalizeDictationLanguageAllowList("en, en-US, es")).toEqual(["en", "es"]);
  });

  it("should handle valid array inputs", () => {
    expect(normalizeDictationLanguageAllowList(["en", "es", "fr"])).toEqual(["en", "es", "fr"]);
    expect(normalizeDictationLanguageAllowList(["en-US", "es_ES"])).toEqual(["en", "es"]);
  });

  it("should deduplicate array inputs", () => {
    expect(normalizeDictationLanguageAllowList(["en", "en-US", "es"])).toEqual(["en", "es"]);
  });

  it("should handle invalid inputs", () => {
    expect(normalizeDictationLanguageAllowList(null)).toEqual([]);
    expect(normalizeDictationLanguageAllowList(undefined)).toEqual([]);
    expect(normalizeDictationLanguageAllowList("")).toEqual([]);
    expect(normalizeDictationLanguageAllowList("invalid")).toEqual([]);
    expect(normalizeDictationLanguageAllowList(["invalid"])).toEqual([]);
  });
});
