/**
 * Pipeline system-prompt builder — Phase 5 shell decomposition.
 *
 * Owns buildEffectiveSystemPrompt + styleProfileInstruction. Moved verbatim
 * from main.tsx; the recent-turns read arrives via initPipelinePrompt so
 * this module never touches main.tsx module globals.
 */
import { DEFAULT_ASSISTANT_NAME } from "../constants";
import type { PersistedSettings, StyleProfile } from "../types";
import { buildAgentOperatingCorePrompt } from "../utils";

export interface RecentTurn {
  speaker: string;
  content: string;
}

let getRecentTurns: () => readonly RecentTurn[] = () => [];

export function initPipelinePrompt(deps: {
  getRecentTurns: () => readonly RecentTurn[];
}): void {
  getRecentTurns = deps.getRecentTurns;
}

export function buildEffectiveSystemPrompt(activeSettings: PersistedSettings, commandMode: boolean): string {
  const agentName = activeSettings.assistantName.trim() || DEFAULT_ASSISTANT_NAME;
  const parts = [buildAgentOperatingCorePrompt(agentName)];
  const customPrompt = activeSettings.systemPrompt.trim();
  if (customPrompt) {
    parts.push(`Custom user instructions:\n${customPrompt}`);
  }
  parts.push(styleProfileInstruction(activeSettings.styleProfile));

  const recentTurns = getRecentTurns();
  if (activeSettings.contextAwareness && recentTurns.length > 0) {
    const contextLines = recentTurns
      .slice(0, 6)
      .reverse()
      .map((turn) => `${turn.speaker}: ${turn.content}`)
      .join("\n");
    parts.push(`Recent context:\n${contextLines}`);
  }

  if (commandMode) {
    parts.push(
      "Command mode is armed for this turn. Prioritize direct action on user intent instead of conversational filler.",
    );
  }

  return parts.filter(Boolean).join("\n\n");
}

export function styleProfileInstruction(style: StyleProfile): string {
  if (style === "professional") {
    return "Style: professional and polished.";
  }
  if (style === "casual") {
    return "Style: casual and conversational.";
  }
  if (style === "concise") {
    return "Style: concise and high-signal.";
  }
  if (style === "developer") {
    return "Style: developer-focused with precise technical terminology.";
  }
  return "Style: adapt tone based on the request context.";
}
