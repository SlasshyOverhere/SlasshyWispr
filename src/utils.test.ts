import { describe, it, expect } from "bun:test";
import { buildAgentOperatingCorePrompt } from "./utils";

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
