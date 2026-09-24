/**
 * Settings persist payload-split tests — Phase 4b move boundary guard.
 *
 * performPersistSettings owns the native/local payload split:
 * native keeps the key only when rememberApiKey is on; desktop builds
 * additionally strip the key from the webview localStorage copy; web
 * builds persist the native payload shape as-is.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { SETTINGS_STORAGE_KEY } from "../constants";
import { defaultSettings } from "../state/settings-store";
import type { PersistedSettings } from "../types";
import {
  flushPendingSettings,
  performPersistSettings,
  persistSettings,
  resetPersistStateForTests,
} from "./settings-service";

function baseSettings(): PersistedSettings {
  return {
    ...defaultSettings(),
    rememberApiKey: true,
    apiKey: "sk-test-key",
  };
}

function readLocalPayload(): PersistedSettings {
  return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "{}") as PersistedSettings;
}

beforeEach(() => {
  localStorage.clear();
  resetPersistStateForTests();
});

describe("performPersistSettings payload split", () => {
  it("strips the key from the localStorage copy on desktop, keeps native copy", async () => {
    let nativePayload = "";
    await new Promise<void>((resolve) => {
      performPersistSettings(baseSettings(), {
        isTauri: true,
        saveNative: (payload: string) => {
          nativePayload = payload;
          return Promise.resolve();
        },
      });
      // persistSettings is synchronous through the direct path; the native
      // save promise settles on the next microtask.
      queueMicrotask(() => resolve());
    });

    expect(readLocalPayload().apiKey).toBe("");
    expect((JSON.parse(nativePayload) as PersistedSettings).apiKey).toBe("sk-test-key");
  });

  it("drops the key everywhere when rememberApiKey is off", async () => {
    let nativePayload: PersistedSettings | null = null;
    await new Promise<void>((resolve) => {
      performPersistSettings(
        { ...baseSettings(), rememberApiKey: false },
        {
          isTauri: true,
          saveNative: (payload: string) => {
            nativePayload = JSON.parse(payload) as PersistedSettings;
            return Promise.resolve();
          },
        },
      );
      queueMicrotask(() => resolve());
    });

    expect(readLocalPayload().apiKey).toBe("");
    expect(nativePayload?.apiKey ?? null).toBe("");
  });

  it("keeps the key in localStorage on web builds and skips native save", () => {
    let nativeCalls = 0;
    performPersistSettings(baseSettings(), {
      isTauri: false,
      saveNative: () => {
        nativeCalls += 1;
        return Promise.resolve();
      },
    });

    expect(readLocalPayload().apiKey).toBe("sk-test-key");
    expect(nativeCalls).toBe(0);
  });
});

describe("persistSettings debounce + flush", () => {
  it("writes through synchronously on first call and flush clears the trailer", () => {
    return new Promise<void>((resolve, reject) => {
      try {
        persistSettings({ ...baseSettings(), apiKey: "sk-first" }, { isTauri: false });
        expect((readLocalPayload().apiKey)).toBe("sk-first");

        persistSettings({ ...baseSettings(), apiKey: "sk-second" }, { isTauri: false });
        flushPendingSettings({ isTauri: false });

        window.setTimeout(() => {
          try {
            // The trailing write landed without a second native call path.
            expect(readLocalPayload().apiKey).toBe("sk-second");
            resolve();
          } catch (error) {
            reject(error);
          }
        }, 900);
      } catch (error) {
        reject(error);
      }
    });
  }, 5000);
});
