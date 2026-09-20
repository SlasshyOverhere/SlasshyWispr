/**
 * Shell diagnostics — Phase 5 shell decomposition.
 *
 * Owns setNotice/logClientEvent behind an injected NoticeDeps seam so
 * extracted shell modules can report without touching main.tsx globals.
 * Moved verbatim from main.tsx; the notice element is bound once at boot.
 *
 * setNotice replaces the slot immediately (live status). queueNotice is for
 * the other kind of message — rare, and each one needs to be read — and is
 * drained in order, with a dismiss control to move on early. See
 * notice-queue.ts for the ordering rules.
 */
import { logClientEvent as ipcLogClientEvent } from "../ipc/client";
import { createNoticeQueue, type NoticeQueue, type NoticeSlotState } from "./notice-queue";

export const NOTICE_DWELL_MS = 6000;

export interface NoticeElements {
  notice: HTMLParagraphElement;
  dismiss: HTMLButtonElement;
}

export interface NoticeDeps {
  isTauri: () => boolean;
  /** Slot dwell for queued notices. Tests shorten it. */
  dwellMs?: number;
}

let noticeElements: NoticeElements | null = null;
let noticeDeps: NoticeDeps = { isTauri: () => false };
let noticeQueue: NoticeQueue | null = null;
let dismissHandler: (() => void) | null = null;
// The markup owns the placeholder, so read it once rather than restating it.
let idleNotice = "Ready.";

function renderNotice(state: NoticeSlotState): void {
  if (!noticeElements) {
    return;
  }
  const { entry, queued } = state;
  noticeElements.notice.textContent = entry ? entry.message : idleNotice;
  noticeElements.notice.dataset.tone = entry?.isError ? "error" : "normal";

  // Visibility rides on a dataset the JSX never declares, so a re-render of the
  // pane cannot reset it. React only re-applies attributes it owns.
  if (entry) {
    noticeElements.dismiss.dataset.available = "1";
  } else {
    delete noticeElements.dismiss.dataset.available;
  }
  noticeElements.dismiss.setAttribute(
    "aria-label",
    queued > 0 ? `Dismiss notice (${queued} more waiting)` : "Dismiss notice",
  );
}

export function initDiagnostics(elements: NoticeElements, deps: NoticeDeps): void {
  // Re-init must not stack listeners, or one click would dismiss two notices.
  if (dismissHandler && noticeElements) {
    noticeElements.dismiss.removeEventListener("click", dismissHandler);
  }

  idleNotice = elements.notice.textContent?.trim() || "Ready.";
  noticeElements = elements;
  noticeDeps = deps;
  noticeQueue = createNoticeQueue({
    render: renderNotice,
    schedule: (run, delayMs) => {
      setTimeout(run, delayMs);
    },
    dwellMs: deps.dwellMs ?? NOTICE_DWELL_MS,
  });

  delete elements.dismiss.dataset.available;
  dismissHandler = () => {
    noticeQueue?.dismiss();
  };
  elements.dismiss.addEventListener("click", dismissHandler);
}

export function setNotice(message: string, isError = false): void {
  noticeQueue?.present(message, isError);
}

export function queueNotice(message: string, isError = false): void {
  noticeQueue?.enqueue(message, isError);
}

export function logClientEvent(message: string): void {
  const line = message.trim();
  if (!line || !noticeDeps.isTauri()) {
    return;
  }

  void ipcLogClientEvent(line).catch(() => {
    // Ignore logging failures in UI flow.
  });
}
