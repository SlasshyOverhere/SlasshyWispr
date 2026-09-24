/**
 * Settings hydrate tests — Phase 4f move boundary guard.
 *
 * hydrateSettingsFromNativeStorage owns the native -> localStorage ->
 * loadSettings -> apply -> onChanged chain. Fake deps pin the chain
 * without a Tauri runtime.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { SETTINGS_STORAGE_KEY } from "../constants";
import { defaultSettings } from "../state/settings-store";
import type { PersistedSettings } from "../types";
import {
  hydrateSettingsFromNativeStorage,
  type SettingsHydrateDeps,
} from "./settings-service";

function baseDeps(overrides: Partial<SettingsHydrateDeps> = {}): SettingsHydrateDeps {
  return {
    isTauri: () => true,
    loadNative: () => Promise.resolve(""),
    log: () => {},
    warn: () => {},
    applyAll: () => {},
    onChanged: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("hydrateSettingsFromNativeStorage", () => {
  it("skips outside Tauri without touching storage", async () => {
    let loads = 0;
    const result = await hydrateSettingsFromNativeStorage(
      baseDeps({
        isTauri: () => false,
        loadNative: () => {
          loads += 1;
          return Promise.resolve("{}");
        },
      }),
    );

    expect(result).toBeNull();
    expect(loads).toBe(0);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("leaves storage alone on empty payload", async () => {
    const result = await hydrateSettingsFromNativeStorage(baseDeps());
    expect(result).toBeNull();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
  });

  it("rejects non-object payloads", async () => {
    const warnings: string[] = [];
    const result = await hydrateSettingsFromNativeStorage(
      baseDeps({
        loadNative: () => Promise.resolve("[1,2,3]"),
        warn: (message) => warnings.push(message),
      }),
    );

    expect(result).toBeNull();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull();
    expect(warnings.length).toBe(0);
  });

  it("persists, loads, applies, and notifies on valid payload", async () => {
    const stored = { ...defaultSettings(), assistantName: "Nova" };
    let applied: PersistedSettings | null = null;
    let changed = 0;
    const result = await hydrateSettingsFromNativeStorage(
      baseDeps({
        loadNative: () => Promise.resolve(JSON.stringify(stored)),
        applyAll: (next) => {
          applied = next;
        },
        onChanged: () => {
          changed += 1;
        },
      }),
    );

    expect(result?.assistantName).toBe("Nova");
    expect(applied?.assistantName).toBe("Nova");
    expect(changed).toBe(1);
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toContain("Nova");
  });

  it("keeps the API key out of localStorage while still applying it", async () => {
    const stored = {
      ...defaultSettings(),
      rememberApiKey: true,
      apiKey: "sk-live-secret",
      apiKeyEncrypted: "dpapi-blob",
    };
    let applied: PersistedSettings | null = null;
    const result = await hydrateSettingsFromNativeStorage(
      baseDeps({
        loadNative: () => Promise.resolve(JSON.stringify(stored)),
        applyAll: (next) => {
          applied = next;
        },
      }),
    );

    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("sk-live-secret");
    expect(raw).not.toContain("dpapi-blob");
    expect(JSON.parse(raw).apiKey).toBeUndefined();
    expect(result?.apiKey).toBe("sk-live-secret");
    expect(applied?.apiKey).toBe("sk-live-secret");
  });
});
