/**
 * Shell diagnostics — Phase 5 shell decomposition.
 *
 * Owns setNotice/logClientEvent behind an injected NoticeDeps seam so
 * extracted shell modules can report without touching main.tsx globals.
 * Moved verbatim from main.tsx; the notice element is bound once at boot.
 *
 * setNotice replaces the slot immediately (live status). queueNotice is for
 * the other kind of message — rare, and each one needs to be read — and is
 * drained in order. See notice-queue.ts.
 */
import { logClientEvent as ipcLogClientEvent } from "../ipc/client";
import { createNoticeQueue, type NoticeQueue } from "./notice-queue";

export interface NoticeDeps {
  isTauri: () => boolean;
  /** Slot dwell for queued notices. Tests shorten it. */
  dwellMs?: number;
}

export const NOTICE_DWELL_MS = 6000;

let noticeElement: HTMLParagraphElement | null = null;
let noticeDeps: NoticeDeps = { isTauri: () => false };
let noticeQueue: NoticeQueue | null = null;

function renderNotice(message: string, isError: boolean): void {
  if (!noticeElement) {
    return;
  }
  noticeElement.textContent = message;
  noticeElement.dataset.tone = isError ? "error" : "normal";
}

export function initDiagnostics(element: HTMLParagraphElement, deps: NoticeDeps): void {
  noticeElement = element;
  noticeDeps = deps;
  noticeQueue = createNoticeQueue({
    render: (entry) => renderNotice(entry ? entry.message : "", entry?.isError ?? false),
    schedule: (run, delayMs) => {
      setTimeout(run, delayMs);
    },
    dwellMs: deps.dwellMs ?? NOTICE_DWELL_MS,
  });
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
