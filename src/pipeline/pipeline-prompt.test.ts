/**
 * Pipeline prompt move-boundary test — Phase 5 shell decomposition.
 *
 * Pins buildEffectiveSystemPrompt part ordering (agent core, custom
 * instructions, style, recent context reversed capped at 6, command-mode
 * line) and the styleProfileInstruction matrix so the move from main.tsx
 * cannot silently shift the prompt wire shape.
 */
import { describe, it, expect } from "bun:test";
import { defaultSettings } from "../state/settings-store";
import {
  buildEffectiveSystemPrompt,
  initPipelinePrompt,
  styleProfileInstruction,
} from "./pipeline-prompt";

initPipelinePrompt({
  getRecentTurns: () => [
    { speaker: "You", content: "first" },
    { speaker: "SlasshyWispr", content: "second" },
  ],
});

describe("buildEffectiveSystemPrompt", () => {
  it("orders agent core, custom instructions, style, context, command line", () => {
    const output = buildEffectiveSystemPrompt(
      {
        ...defaultSettings,
        assistantName: "Nova",
        systemPrompt: "Be brief.",
        styleProfile: "concise",
        contextAwareness: true,
      },
      true,
    );
    const sections = output.split("\n\n");
    expect(sections[0].startsWith('You are "Nova"')).toBe(true);
    expect(sections[1]).toBe("Custom user instructions:\nBe brief.");
    expect(sections[2]).toBe("Style: concise and high-signal.");
    expect(sections[3]).toBe("Recent context:\nSlasshyWispr: second\nYou: first");
    expect(sections[4].startsWith("Command mode is armed")).toBe(true);
  });

  it("omits empty custom prompt, context, and command line", () => {
    const output = buildEffectiveSystemPrompt(
      { ...defaultSettings, assistantName: "", systemPrompt: "", contextAwareness: false },
      false,
    );
    expect(output).not.toContain("Custom user instructions");
    expect(output).not.toContain("Recent context");
    expect(output).not.toContain("Command mode");
  });
});

describe("styleProfileInstruction", () => {
  it("covers the profile matrix", () => {
    expect(styleProfileInstruction("professional")).toBe("Style: professional and polished.");
    expect(styleProfileInstruction("casual")).toBe("Style: casual and conversational.");
    expect(styleProfileInstruction("concise")).toBe("Style: concise and high-signal.");
    expect(styleProfileInstruction("developer")).toContain("developer-focused");
    expect(styleProfileInstruction("adaptive")).toBe("Style: adapt tone based on the request context.");
  });
});
