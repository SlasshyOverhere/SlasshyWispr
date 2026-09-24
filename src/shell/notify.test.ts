/**
 * Desktop-notice move-boundary test — Phase 5 shell decomposition.
 *
 * Pins showDesktopNotice: in-app notice + failure transition + log line,
 * early return without Notification, granted-permission OS notify, and
 * the one-shot permission-request flag.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  MISSING_API_KEY_MESSAGE,
  initDesktopNotice,
  isNotificationPermissionRequested,
  setNotificationPermissionRequested,
  showDesktopNotice,
} from "./notify";

function wireHarness() {
  const notices: Array<{ message: string; isError?: boolean }> = [];
  const logs: string[] = [];
  const transitions: unknown[] = [];
  initDesktopNotice({
    setNotice: (message, isError) => {
      notices.push({ message, isError });
    },
    log: (message) => {
      logs.push(message);
    },
    transition: (event) => {
      transitions.push(event);
    },
  });
  setNotificationPermissionRequested(false);
  return { notices, logs, transitions };
}

function stubNotification(permission: string, requestResult = "granted") {
  const created: Array<{ title: string; body: string }> = [];
  (globalThis as unknown as { Notification?: unknown }).Notification = class {
    static permission = permission;
    static requestPermission = async () => requestResult;
    constructor(
      public title: string,
      public options?: { body?: string },
    ) {
      created.push({ title, body: options?.body ?? "" });
    }
  };
  return created;
}

function clearNotification() {
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
}

beforeEach(() => {
  wireHarness();
  clearNotification();
});

describe("showDesktopNotice", () => {
  it("notices, transitions, and logs before touching Notification", () => {
    const harness = wireHarness();
    showDesktopNotice(MISSING_API_KEY_MESSAGE, {
      failureReason: "Missing API key for online runtime.",
      logSource: "record-start",
    });
    expect(harness.notices).toEqual([{ message: MISSING_API_KEY_MESSAGE, isError: true }]);
    expect(harness.transitions).toEqual([
      { type: "recording-failed", reason: "Missing API key for online runtime." },
    ]);
    expect(harness.logs).toEqual([
      "[record.start.blocked] missing-api-key notice source=record-start",
    ]);
  });

  it("returns early when Notification is undefined", () => {
    clearNotification();
    wireHarness();
    showDesktopNotice("m", { failureReason: "r", logSource: "s" });
    expect(isNotificationPermissionRequested()).toBe(false);
  });

  it("notifies immediately when permission is granted", () => {
    const created = stubNotification("granted");
    wireHarness();
    showDesktopNotice("hello", { failureReason: "r", logSource: "s" });
    expect(created).toEqual([{ title: "SlasshyWispr", body: "hello" }]);
    expect(isNotificationPermissionRequested()).toBe(false);
  });

  it("requests permission exactly once", async () => {
    stubNotification("default");
    wireHarness();
    showDesktopNotice("hello", { failureReason: "r", logSource: "s" });
    expect(isNotificationPermissionRequested()).toBe(true);
    await Promise.resolve();
    showDesktopNotice("hello", { failureReason: "r", logSource: "s" });
    expect(isNotificationPermissionRequested()).toBe(true);
  });

  it("pins the missing-API-key message", () => {
    expect(MISSING_API_KEY_MESSAGE).toContain("API key is missing for online mode");
  });
});
