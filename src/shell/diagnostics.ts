/**
 * Shell diagnostics — Phase 5 shell decomposition.
 *
 * Owns setNotice/logClientEvent behind an injected NoticeDeps seam so
 * extracted shell modules can report without touching main.tsx globals.
 * Moved verbatim from main.tsx; the notice element is bound once at boot.
 */
import { logClientEvent as ipcLogClientEvent } from "../ipc/client";

export interface NoticeDeps {
  isTauri: () => boolean;
}

let noticeElement: HTMLParagraphElement | null = null;
let noticeDeps: NoticeDeps = { isTauri: () => false };

export function initDiagnostics(element: HTMLParagraphElement, deps: NoticeDeps): void {
  noticeElement = element;
  noticeDeps = deps;
}

export function setNotice(message: string, isError = false): void {
  if (!noticeElement) {
    return;
  }
  noticeElement.textContent = message;
  noticeElement.dataset.tone = isError ? "error" : "normal";
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
