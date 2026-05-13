import { describe, it, expect } from "bun:test";
import {
  APP_UPDATE_LAST_CHECKED_AT_STORAGE_KEY,
  APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY,
  APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY,
} from "./constants";

describe("update constants", () => {
  it("APP_UPDATE_LAST_CHECKED_AT_STORAGE_KEY has the correct format", () => {
    expect(APP_UPDATE_LAST_CHECKED_AT_STORAGE_KEY).toStartWith("slasshy-wispr-");
    expect(APP_UPDATE_LAST_CHECKED_AT_STORAGE_KEY).toEndWith("-v1");
  });

  it("APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY has the correct format", () => {
    expect(APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY).toStartWith("slasshy-wispr-");
    expect(APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY).toEndWith("-v1");
  });

  it("APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY has the correct format", () => {
    expect(APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY).toStartWith("slasshy-wispr-");
    expect(APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY).toEndWith("-v1");
  });

  it("all three keys are distinct", () => {
    const keys = [
      APP_UPDATE_LAST_CHECKED_AT_STORAGE_KEY,
      APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY,
      APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY,
    ];
    expect(new Set(keys).size).toBe(3);
  });
});

describe("AppUpdateCheckResponse type contract", () => {
  it("can represent an available update", () => {
    const response: import("./types").AppUpdateCheckResponse = {
      currentVersion: "1.0.2",
      latestVersion: "1.0.3",
      available: true,
      releaseName: "v1.0.3",
      releaseNotes: "Bug fixes",
      publishedAt: "2026-05-13T00:00:00Z",
      releaseUrl: "https://github.com/SlasshyOverhere/SlasshyWispr/releases/tag/v1.0.3",
      installerDownloadUrl: "https://github.com/.../SlasshyWispr_1.0.3_x64-setup.exe",
      installerAssetName: "SlasshyWispr_1.0.3_x64-setup.exe",
      expectedSha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    };
    expect(response.available).toBe(true);
    expect(response.latestVersion).toBe("1.0.3");
    expect(response.expectedSha256).toHaveLength(64);
  });

  it("can represent 'no update available'", () => {
    const response: import("./types").AppUpdateCheckResponse = {
      currentVersion: "1.0.3",
      latestVersion: "1.0.3",
      available: false,
      releaseName: "",
      releaseNotes: "",
      publishedAt: "",
      releaseUrl: "",
      installerDownloadUrl: "",
      installerAssetName: "",
      expectedSha256: "",
    };
    expect(response.available).toBe(false);
    expect(response.installerDownloadUrl).toBe("");
    expect(response.expectedSha256).toBe("");
  });

  it("serializes to camelCase JSON as expected from Rust", () => {
    const json = JSON.stringify({
      currentVersion: "1.0.2",
      latestVersion: "1.0.3",
      available: true,
      releaseName: "v1.0.3",
      releaseNotes: "fixes",
      publishedAt: "2026-05-13T00:00:00Z",
      releaseUrl: "https://github.com/...",
      installerDownloadUrl: "https://github.com/...exe",
      installerAssetName: "app.exe",
      expectedSha256: "abc",
    });
    const parsed = JSON.parse(json) as import("./types").AppUpdateCheckResponse;
    expect(parsed.currentVersion).toBe("1.0.2");
    expect(parsed.expectedSha256).toBe("abc");
  });
});

describe("InstallAppUpdateRequest type contract", () => {
  it("includes optional expectedSha256", () => {
    const request: import("./types").InstallAppUpdateRequest = {
      downloadUrl: "https://github.com/...exe",
      assetName: "app.exe",
      silent: true,
      expectedSha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    };
    expect(request.downloadUrl).toBeTruthy();
    expect(request.expectedSha256).toHaveLength(64);
  });

  it("works without optional fields", () => {
    const request: import("./types").InstallAppUpdateRequest = {
      downloadUrl: "https://github.com/...exe",
    };
    expect(request.assetName).toBeUndefined();
    expect(request.silent).toBeUndefined();
    expect(request.expectedSha256).toBeUndefined();
  });
});

describe("AppUpdateInstallProgressEvent type contract", () => {
  it("can represent a download progress event", () => {
    const event: import("./types").AppUpdateInstallProgressEvent = {
      stage: "downloading",
      message: "Downloading...",
      downloadedBytes: 5000000,
      totalBytes: 10000000,
      progressPercent: 50.0,
      completed: false,
      success: false,
    };
    expect(event.stage).toBe("downloading");
    expect(event.progressPercent).toBeCloseTo(50.0, 1);
    expect(event.completed).toBe(false);
  });

  it("can represent a completed install event", () => {
    const event: import("./types").AppUpdateInstallProgressEvent = {
      stage: "installing",
      message: "Installer launched.",
      downloadedBytes: 10000000,
      totalBytes: 10000000,
      progressPercent: 100.0,
      completed: true,
      success: true,
    };
    expect(event.stage).toBe("installing");
    expect(event.completed).toBe(true);
    expect(event.success).toBe(true);
  });

  it("can represent an error event", () => {
    const event: import("./types").AppUpdateInstallProgressEvent = {
      stage: "error",
      message: "Download failed",
      downloadedBytes: 0,
      totalBytes: 0,
      progressPercent: 0,
      completed: true,
      success: false,
    };
    expect(event.stage).toBe("error");
    expect(event.success).toBe(false);
    expect(event.completed).toBe(true);
  });
});
