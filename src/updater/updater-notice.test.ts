/**
 * The update notice the user is supposed to see.
 *
 * Two ways this went wrong before, both silently: the message was written to
 * the self-replacing status line (so the next status wiped it) and it was
 * raised into an area that only existed inside a settings pane. Neither
 * failure threw, so what the user saw was simply nothing. This pins the
 * observable behaviour — a sticky notice that carries an action — so a
 * regression is a failed assertion instead of a missing toast.
 */
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY } from "../constants";
import type { AppUpdateCheckResponse } from "../types";
import type { UpdateSource } from "./updater-flow";

// The flow's Tauri event import is not resolvable under bun, so the module is
// stubbed and imported dynamically — a static import would evaluate it first.
mock.module("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
const { initUpdaterFlow, notifyAppUpdateAvailable } = await import("./updater-flow");

const store = new Map<string, string>();

function installGlobals(): void {
  store.clear();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  // No Notification in this environment: the in-app notice is the whole surface.
  (globalThis as unknown as { Notification: unknown }).Notification = undefined;
}

interface Raised {
  message: string;
  label: string;
  openSettingsReasons: string[];
}

function wireFlow(): Raised {
  const raised: Raised = { message: "", label: "", openSettingsReasons: [] };
  const button = {} as HTMLButtonElement;
  initUpdaterFlow(
    {
      checkUpdatesBtn: button,
      installUpdateBtn: button,
      skipUpdateVersionBtn: button,
      snoozeUpdateBtn: button,
    },
    {
      isTauri: () => true,
      queueUpdateNotice: (message, action) => {
        raised.message = message;
        raised.label = action.label;
        action.run();
      },
      log: () => {},
      openUpdateSettings: (reason) => raised.openSettingsReasons.push(reason),
      confirmInstall: async () => false,
      getNotificationPermissionRequested: () => true,
      setNotificationPermissionRequested: () => {},
    },
  );
  return raised;
}

function update(version: string): AppUpdateCheckResponse {
  return {
    available: true,
    latestVersion: version,
    currentVersion: "1.0.0",
    releaseNotes: "",
    releaseUrl: "",
    publishedAt: "",
    installerDownloadUrl: "",
    installerAssetName: "",
    expectedSha256: "",
  } as AppUpdateCheckResponse;
}

function notify(raised: Raised, version: string, source: UpdateSource = "startup"): void {
  raised.message = "";
  raised.label = "";
  raised.openSettingsReasons.length = 0;
  notifyAppUpdateAvailable(update(version), source);
}

describe("update available notice", () => {
  let raised: Raised;

  beforeEach(() => {
    installGlobals();
    raised = wireFlow();
  });

  // Notification suppression is per version and per session, so each case uses
  // a version of its own rather than resetting state that exists on purpose.
  it("names the version it is offering", () => {
    notify(raised, "2.0.1");

    expect(raised.message).toBe("Update 2.0.1 is available.");
  });

  it("offers an action instead of prose telling the user where to go", () => {
    notify(raised, "2.0.2");

    expect(raised.label).toBe("Open Updates");
    expect(raised.openSettingsReasons).toEqual(["update-notice-startup"]);
  });

  it("ignores an update with no version to name", () => {
    notify(raised, "   ");

    expect(raised.message).toBe("");
  });

  it("raises one notice per version per session", () => {
    let count = 0;
    const button = {} as HTMLButtonElement;
    initUpdaterFlow(
      {
        checkUpdatesBtn: button,
        installUpdateBtn: button,
        skipUpdateVersionBtn: button,
        snoozeUpdateBtn: button,
      },
      {
        isTauri: () => true,
        queueUpdateNotice: () => {
          count += 1;
        },
        log: () => {},
        openUpdateSettings: () => {},
        confirmInstall: async () => false,
        getNotificationPermissionRequested: () => true,
        setNotificationPermissionRequested: () => {},
      },
    );

    notifyAppUpdateAvailable(update("3.0.1"), "startup");
    notifyAppUpdateAvailable(update("3.0.1"), "interval");
    notifyAppUpdateAvailable(update("3.0.2"), "interval");

    expect(count).toBe(2);
  });

  it("stays quiet for a version the user chose to skip", () => {
    store.set(APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY, "4.0.1");

    notify(raised, "4.0.1");

    expect(raised.message).toBe("");
  });
});
