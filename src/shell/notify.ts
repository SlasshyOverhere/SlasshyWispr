/**
 * Desktop notice helper — Phase 5 shell decomposition.
 *
 * Owns the Notification-permission flag plus showDesktopNotice (in-app
 * notice + state-machine failure transition + log + one-shot OS
 * notification request). Moved verbatim from main.tsx's
 * showMissingApiKeyNotice tail; the message/transition stay with the
 * caller via deps so this module never touches main.tsx module globals.
 */

export type NoticeTransition =
  | { type: "recording-failed"; reason: string };

export interface DesktopNoticeDeps {
  setNotice: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  transition: (event: NoticeTransition) => void;
}

let noticeDeps!: DesktopNoticeDeps;
let notificationPermissionRequested = false;

export function initDesktopNotice(deps: DesktopNoticeDeps): void {
  noticeDeps = deps;
}

export function isNotificationPermissionRequested(): boolean {
  return notificationPermissionRequested;
}

export function setNotificationPermissionRequested(requested: boolean): void {
  notificationPermissionRequested = requested;
}

export function showDesktopNotice(
  message: string,
  options: { failureReason: string; logSource: string },
): void {
  noticeDeps.setNotice(message, true);
  noticeDeps.transition({ type: "recording-failed", reason: options.failureReason });
  noticeDeps.log(`[record.start.blocked] missing-api-key notice source=${options.logSource}`);

  if (typeof Notification === "undefined") {
    return;
  }

  if (Notification.permission === "granted") {
    try {
      new Notification("SlasshyWispr", { body: message });
    } catch {
      // Ignore notification failures; notice is still shown in-app.
    }
    return;
  }

  if (Notification.permission !== "default" || notificationPermissionRequested) {
    return;
  }

  notificationPermissionRequested = true;
  void Notification.requestPermission()
    .then((permission) => {
      if (permission !== "granted") {
        return;
      }
      try {
        new Notification("SlasshyWispr", { body: message });
      } catch {
        // Ignore notification failures; notice is still shown in-app.
      }
    })
    .catch(() => {
      // Ignore notification permission errors.
    });
}

export const MISSING_API_KEY_MESSAGE =
  "Recording blocked: API key is missing for online mode. Add API key in Settings > Models > Online provider.";
