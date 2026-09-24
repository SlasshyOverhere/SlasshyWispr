import type { SettingsPane } from "../types";

export interface SettingsSectionDefinition {
  id: string;
  title: string;
  description: string;
}

export const SETTINGS_SECTIONS = {
  general: [
    { id: "audio", title: "Audio & shortcuts", description: "Choose how dictation starts and what it listens to." },
    { id: "dictation", title: "Dictation", description: "Control language, transcript cleanup, and writing style." },
    { id: "assistant", title: "Assistant", description: "Wake the assistant, preserve context, and route replies." },
    { id: "appearance", title: "Appearance", description: "Choose the visual surface used throughout the app." },
    { id: "app-privacy", title: "App & privacy", description: "Control startup, dock behavior, Explorer access, and private sessions." },
    { id: "recordings", title: "Recordings", description: "Choose what audio stays on this machine." },
    { id: "sound", title: "Sound", description: "Preview and tune the cues played during dictation." },
  ],
  models: [
    { id: "runtime", title: "Runtime", description: "Choose where speech-to-text and AI rewriting run." },
    { id: "online-provider", title: "Online provider", description: "Connect a provider and choose the models it exposes." },
    { id: "local-ai", title: "Local AI", description: "Run AI rewriting through Ollama on this machine." },
    { id: "local-stt", title: "Local STT", description: "Install and manage the local transcription model." },
    { id: "voice", title: "Voice", description: "Set up Piper or a voice cloned from your recording." },
  ],
  pipeline: [
    { id: "controls", title: "Pipeline controls", description: "Tune request limits, prompting, and AI generation." },
    { id: "status", title: "Runtime status", description: "Inspect the current stage, latency, and voice preview." },
  ],
  "update-security": [
    { id: "updates", title: "Software updates", description: "Check, install, and verify SlasshyWispr releases." },
  ],
} as const satisfies Record<SettingsPane, readonly SettingsSectionDefinition[]>;

export type SettingsSection =
  (typeof SETTINGS_SECTIONS)[SettingsPane][number]["id"];

export type SettingsSectionMemory = Partial<Record<SettingsPane, SettingsSection>>;

export function findSettingsSection(
  pane: SettingsPane,
  value: string | undefined,
): SettingsSectionDefinition | null {
  return SETTINGS_SECTIONS[pane].find((section) => section.id === value) ?? null;
}

export function defaultSettingsSection(pane: SettingsPane): SettingsSection {
  return SETTINGS_SECTIONS[pane][0].id;
}

export function parseSettingsSectionMemory(raw: string | null): SettingsSectionMemory {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};

    const memory: SettingsSectionMemory = {};
    for (const pane of Object.keys(SETTINGS_SECTIONS) as SettingsPane[]) {
      const value = (parsed as Record<string, unknown>)[pane];
      if (typeof value === "string" && findSettingsSection(pane, value)) {
        memory[pane] = value as SettingsSection;
      }
    }
    return memory;
  } catch {
    return {};
  }
}
