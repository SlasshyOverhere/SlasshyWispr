/**
 * Settings hydrate — Phase 4f split from settings-service.
 *
 * Owns: hydrateSettingsFromNativeStorage + deps seam.
 */
import type { PersistedSettings } from "../types";
import { SETTINGS_STORAGE_KEY } from "../constants";
import { loadSettings } from "../state/settings-store";
import { asErrorMessage, boolFlag } from "../utils";
import { summarizeSettingsForDiagnostics } from "./settings-signatures";

export interface SettingsHydrateDeps {
  isTauri: () => boolean;
  loadNative: () => Promise<string>;
  log: (message: string) => void;
  warn: (message: string) => void;
  applyAll: (next: PersistedSettings) => void;
  onChanged: () => void;
}

export async function hydrateSettingsFromNativeStorage(
  deps: SettingsHydrateDeps,
): Promise<PersistedSettings | null> {
  if (!deps.isTauri()) {
    deps.log("[settings.hydrate] skipped because app is not running in tauri");
    return null;
  }

  deps.log("[settings.hydrate] start");
  try {
    const raw = await deps.loadNative();
    const trimmed = raw.trim();
    deps.log(`[settings.hydrate] rawBytes=${raw.length} trimmedBytes=${trimmed.length}`);
    if (!trimmed) {
      deps.log("[settings.hydrate] empty payload; leaving local settings unchanged");
      return null;
    }

    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      deps.log("[settings.hydrate] payload is not a valid settings object");
      return null;
    }
    const parsedObject = parsed as Partial<PersistedSettings>;
    const parsedRemember = parsedObject.rememberApiKey === true;
    const parsedApiKeyPresent =
      typeof parsedObject.apiKey === "string" && parsedObject.apiKey.trim().length > 0;
    deps.log(
      `[settings.hydrate] parsed remember=${boolFlag(parsedRemember)} apiKeyPresent=${boolFlag(
        parsedApiKeyPresent,
      )}`,
    );

    // The native payload carries the resolved API key and the DPAPI fallback
    // blob. Writing it verbatim would put both in the webview's localStorage,
    // which is the one store performPersistSettings keeps them out of — so strip
    // them here and carry the key in memory only.
    const localPayload: Record<string, unknown> = { ...(parsed as Record<string, unknown>) };
    delete localPayload.apiKey;
    delete localPayload.apiKeyEncrypted;
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(localPayload));
    const hydrated = loadSettings();
    if (parsedRemember && parsedApiKeyPresent) {
      hydrated.apiKey = String(parsedObject.apiKey);
    }
    deps.applyAll(hydrated);
    deps.log(`[settings.hydrate] applied ${summarizeSettingsForDiagnostics(hydrated)}`);
    deps.onChanged();
    return hydrated;
  } catch (error) {
    deps.log(`[settings.hydrate] failed: ${asErrorMessage(error)}`);
    deps.warn(`[settings] failed to hydrate local settings: ${asErrorMessage(error)}`);
    return null;
  }
}
