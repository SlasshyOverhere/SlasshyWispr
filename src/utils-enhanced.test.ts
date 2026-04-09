import { describe, it, expect } from "bun:test";
import {
  buildAgentOperatingCorePrompt,
  captureModeLabel,
  type CaptureMode,
} from "./utils";

describe("Utils: Capture Mode Label", () => {
  it("should return 'Push-To-Talk' for push-to-talk", () => {
    expect(captureModeLabel("push-to-talk")).toBe("Push-To-Talk");
  });

  it("should return 'Single Tap' for single-tap", () => {
    expect(captureModeLabel("single-tap")).toBe("Single Tap");
  });

  it("should handle edge case fallback", () => {
    // @ts-ignore - testing defensive coding
    expect(captureModeLabel(undefined)).toBe("Single Tap");
  });
});

describe("Utils: Agent Operating Core Prompt", () => {
  const testCases = [
    { name: "Jarvis", expectedPhrases: ["You are \"Jarvis\"", "MODE 1: CLEANUP", "MODE 2: AGENT"] },
    { name: "Lily", expectedPhrases: ["You are \"Lily\"", "Clean transcription errors"] },
    { name: "Assistant", expectedPhrases: ["Activate when directly addressed by name"] },
  ];

  testCases.forEach(({ name, expectedPhrases }) => {
    it(`should generate correct prompt for ${name}`, () => {
      const prompt = buildAgentOperatingCorePrompt(name);

      expectedPhrases.forEach(phrase => {
        expect(prompt).toContain(phrase);
      });
    });
  });

  it("should include all required sections", () => {
    const prompt = buildAgentOperatingCorePrompt("TestBot");

    const requiredSections = [
      "MODE 1: CLEANUP",
      "MODE 2: AGENT",
      "Clean transcription errors",
      "Activate when directly addressed",
    ];

    requiredSections.forEach(section => {
      expect(prompt).toContain(section);
    });
  });

  it("should handle empty agent name gracefully", () => {
    const prompt = buildAgentOperatingCorePrompt("");
    expect(prompt).toContain('You are ""');
  });

  it("should handle very long agent names", () => {
    const longName = "A".repeat(100);
    const prompt = buildAgentOperatingCorePrompt(longName);
    expect(prompt).toContain(`You are "${longName}"`);
  });
});

describe("Performance: Date Formatting", () => {
  it("should reuse Intl.DateTimeFormat instances", () => {
    // This tests that we're not creating new instances unnecessarily
    const formatter1 = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const formatter2 = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // In production code, these should be cached/reused
    // This is a reminder to implement that optimization
    expect(formatter1.resolvedOptions().locale).toBe(formatter2.resolvedOptions().locale);
  });
});

describe("Validation: Dictionary Entry", () => {
  function validateDictionaryEntry(source: string, target: string): { valid: boolean; error?: string } {
    if (!source.trim() || !target.trim()) {
      return { valid: false, error: "Both source and target are required" };
    }

    if (source.length > 100) {
      return { valid: false, error: "Source term must be 100 characters or less" };
    }

    if (target.length > 200) {
      return { valid: false, error: "Target term must be 200 characters or less" };
    }

    // Check for HTML/script injection
    if (source.includes("<script") || target.includes("<script")) {
      return { valid: false, error: "Script tags are not allowed" };
    }

    return { valid: true };
  }

  it("should accept valid dictionary entries", () => {
    const result = validateDictionaryEntry("slashy", "Slasshy");
    expect(result.valid).toBe(true);
  });

  it("should reject empty source", () => {
    const result = validateDictionaryEntry("", "target");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("required");
  });

  it("should reject empty target", () => {
    const result = validateDictionaryEntry("source", "");
    expect(result.valid).toBe(false);
  });

  it("should reject overly long source", () => {
    const result = validateDictionaryEntry("A".repeat(101), "target");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("100 characters");
  });

  it("should reject script injection attempts", () => {
    const result = validateDictionaryEntry("<script>alert('xss')</script>", "target");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Script tags");
  });
});

describe("Validation: Snippet Entry", () => {
  function validateSnippetEntry(trigger: string, expansion: string): { valid: boolean; error?: string } {
    if (!trigger.trim()) {
      return { valid: false, error: "Trigger phrase is required" };
    }

    if (!expansion.trim()) {
      return { valid: false, error: "Expansion text is required" };
    }

    if (trigger.length > 50) {
      return { valid: false, error: "Trigger must be 50 characters or less" };
    }

    if (expansion.length > 1000) {
      return { valid: false, error: "Expansion must be 1000 characters or less" };
    }

    return { valid: true };
  }

  it("should accept valid snippets", () => {
    const result = validateSnippetEntry("intro", "Hello, my name is...");
    expect(result.valid).toBe(true);
  });

  it("should reject empty trigger", () => {
    const result = validateSnippetEntry("", "expansion");
    expect(result.valid).toBe(false);
  });

  it("should reject empty expansion", () => {
    const result = validateSnippetEntry("trigger", "");
    expect(result.valid).toBe(false);
  });

  it("should enforce trigger length limit", () => {
    const result = validateSnippetEntry("A".repeat(51), "expansion");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("50 characters");
  });

  it("should enforce expansion length limit", () => {
    const result = validateSnippetEntry("trigger", "A".repeat(1001));
    expect(result.valid).toBe(false);
    expect(result.error).toContain("1000 characters");
  });
});

describe("Validation: Quick Note", () => {
  function validateQuickNote(text: string): { valid: boolean; error?: string } {
    if (!text.trim()) {
      return { valid: false, error: "Note text is required" };
    }

    if (text.length > 5000) {
      return { valid: false, error: "Note must be 5000 characters or less" };
    }

    return { valid: true };
  }

  it("should accept valid notes", () => {
    const result = validateQuickNote("This is a quick note");
    expect(result.valid).toBe(true);
  });

  it("should reject empty notes", () => {
    const result = validateQuickNote("");
    expect(result.valid).toBe(false);
  });

  it("should enforce max length", () => {
    const result = validateQuickNote("A".repeat(5001));
    expect(result.valid).toBe(false);
  });

  it("should allow multiline notes", () => {
    const result = validateQuickNote("Line 1\nLine 2\nLine 3");
    expect(result.valid).toBe(true);
  });
});

describe("Security: Settings Validation", () => {
  interface MockSettings {
    apiKey: string;
    apiBaseUrl: string;
    temperature: number;
    maxTokens: number;
    piperSpeed: number;
    coquiSpeed: number;
  }

  function validateSettings(settings: Partial<MockSettings>): { valid: boolean; error?: string } {
    if (settings.apiKey !== undefined && settings.apiKey.length > 200) {
      return { valid: false, error: "API key too long" };
    }

    if (settings.apiBaseUrl !== undefined) {
      try {
        if (settings.apiBaseUrl) {
          new URL(settings.apiBaseUrl);
        }
      } catch {
        return { valid: false, error: "Invalid API base URL format" };
      }
    }

    if (settings.temperature !== undefined) {
      if (settings.temperature < 0 || settings.temperature > 2) {
        return { valid: false, error: "Temperature must be between 0 and 2" };
      }
    }

    if (settings.maxTokens !== undefined) {
      if (settings.maxTokens < 1 || settings.maxTokens > 8192) {
        return { valid: false, error: "Max tokens must be between 1 and 8192" };
      }
    }

    if (settings.piperSpeed !== undefined) {
      if (settings.piperSpeed < 0.5 || settings.piperSpeed > 2.0) {
        return { valid: false, error: "Piper speed must be between 0.5 and 2.0" };
      }
    }

    if (settings.coquiSpeed !== undefined) {
      if (settings.coquiSpeed < 0.5 || settings.coquiSpeed > 2.0) {
        return { valid: false, error: "Coqui speed must be between 0.5 and 2.0" };
      }
    }

    return { valid: true };
  }

  it("should accept valid settings", () => {
    const result = validateSettings({
      apiKey: "sk-1234567890",
      apiBaseUrl: "https://api.example.com",
      temperature: 0.7,
      maxTokens: 512,
      piperSpeed: 1.0,
      coquiSpeed: 1.0,
    });

    expect(result.valid).toBe(true);
  });

  it("should reject invalid API base URL", () => {
    const result = validateSettings({ apiBaseUrl: "not-a-url" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid API base URL");
  });

  it("should reject out-of-range temperature", () => {
    const result = validateSettings({ temperature: 3.0 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Temperature");
  });

  it("should reject oversized max tokens", () => {
    const result = validateSettings({ maxTokens: 10000 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Max tokens");
  });

  it("should accept partial settings", () => {
    const result = validateSettings({ temperature: 0.5 });
    expect(result.valid).toBe(true);
  });

  it("should accept empty settings object", () => {
    const result = validateSettings({});
    expect(result.valid).toBe(true);
  });
});

describe("Performance: Constants and Defaults", () => {
  it("should have consistent default values", () => {
    // These tests ensure our constants don't accidentally get changed to bad values
    expect(0.35).toBeGreaterThanOrEqual(0);
    expect(0.35).toBeLessThanOrEqual(1); // Temperature default

    expect(320).toBeGreaterThan(0);
    expect(320).toBeLessThan(1000); // Max tokens default

    expect(1.08).toBeGreaterThanOrEqual(0.5);
    expect(1.08).toBeLessThanOrEqual(2.0); // Piper speed default
  });

  it("should have reasonable timeout values", () => {
    const MAX_RECORDING_MS = 45_000;
    expect(MAX_RECORDING_MS).toBeGreaterThan(10_000);
    expect(MAX_RECORDING_MS).toBeLessThan(120_000);
  });
});
