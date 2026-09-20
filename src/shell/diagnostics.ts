/**
 * Shell diagnostics — Phase 5 shell decomposition.
 *
 * Owns setNotice/logClientEvent behind an injected NoticeDeps seam so
 * extracted shell modules can report without touching main.tsx globals.
 *
 * setNotice writes the status line, which replaces itself. queueNotice stacks a
 * notice, which stays on screen until it is dismissed. See notice-stack.ts for
 * the ordering rules.
 */
import { logClientEvent as ipcLogClientEvent } from "../ipc/client";
import { createNoticeStack, type NoticeItem, type NoticeStack } from "./notice-stack";

export interface NoticeDeps {
  isTauri: () => boolean;
}

interface NoticeRow {
  root: HTMLElement;
  text: HTMLElement;
}

let noticeElement: HTMLElement | null = null;
let noticeDeps: NoticeDeps = { isTauri: () => false };
let stack: NoticeStack | null = null;
const rows = new Map<number, NoticeRow>();

function createRow(item: NoticeItem): NoticeRow {
  const root = document.createElement("div");
  root.className = "notice-item";

  const text = document.createElement("p");
  text.className = "notice-item-text";
  root.appendChild(text);

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "notice-dismiss";
  dismiss.textContent = "\u00d7";
  dismiss.title = "Dismiss notice";
  // Each button dismisses its own row: the label names which one, so a screen
  // reader can tell stacked notices apart.
  dismiss.setAttribute("aria-label", `Dismiss notice: ${item.message}`);
  dismiss.addEventListener("click", () => {
    stack?.dismiss(item.id);
  });
  root.appendChild(dismiss);

  return { root, text };
}

function renderStack(items: NoticeItem[]): void {
  if (!noticeElement) {
    return;
  }

  const live = new Set(items.map((item) => item.id));
  for (const [id, row] of rows) {
    if (!live.has(id)) {
      row.root.remove();
      rows.delete(id);
    }
  }

  for (const item of items) {
    let row = rows.get(item.id);
    if (!row) {
      row = createRow(item);
      rows.set(item.id, row);
      // Items are only ever appended or removed, never reordered, so appending
      // here keeps the DOM in list order.
      noticeElement.appendChild(row.root);
    }
    row.text.textContent = item.message;
    row.root.dataset.tone = item.isError ? "error" : "normal";
  }
}

export function initDiagnostics(element: HTMLElement, deps: NoticeDeps): void {
  // Re-init starts from an empty area, so stale rows cannot outlive their items.
  element.textContent = "";
  rows.clear();
  noticeElement = element;
  noticeDeps = deps;
  stack = createNoticeStack({ render: renderStack });
}

export function setNotice(message: string, isError = false): void {
  stack?.present(message, isError);
}

export function queueNotice(message: string, isError = false): void {
  stack?.enqueue(message, isError);
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
