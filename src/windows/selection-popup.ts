/**
 * Selection-assistant popup window — Phase 5 shell decomposition.
 *
 * Owns selectionAssistantUrl + clampSelectionPopupHeight +
 * estimateSelectionPopupHeight + applySelectionPopupSize +
 * nextSelectionPopupToken + ensureSelectionAssistantWindow +
 * showSelectionAssistantPopup + the payload-channel actions +
 * closeSelectionAssistantWindowForTray. Moved verbatim from main.tsx;
 * shell seams (Tauri probe, notice/log, clipboard/paste, window state)
 * arrive via initSelectionPopup so this module never touches main.tsx
 * module globals.
 */
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/window";
import {
  SELECTION_POPUP_CHARS_PER_LINE,
  SELECTION_POPUP_MAX_HEIGHT,
  SELECTION_POPUP_MIN_HEIGHT,
  SELECTION_POPUP_MIN_WIDTH,
  SELECTION_POPUP_WIDTH,
} from "../constants";
import type { SelectionPopupPayload } from "../types";
import { asErrorMessage } from "../utils";

export interface SelectionPopupDeps {
  isTauri: () => boolean;
  notify: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  copyResult: (text: string) => void;
  replaceSelection: (text: string) => Promise<boolean>;
  getWindow: () => WebviewWindow | null;
  setWindow: (win: WebviewWindow | null) => void;
  getLatestPayload: () => SelectionPopupPayload | null;
  setLatestPayload: (payload: SelectionPopupPayload | null) => void;
  nextToken: () => number;
}

let popupDeps!: SelectionPopupDeps;
let popupChannel: BroadcastChannel | null = null;

export function initSelectionPopup(deps: SelectionPopupDeps, channel: BroadcastChannel): void {
  popupDeps = deps;
  popupChannel = channel;
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const payload = event.data as { kind?: string; action?: string } | null;
    if (!payload || payload.kind !== "action") {
      return;
    }

    if (payload.action === "request-state") {
      const latest = popupDeps.getLatestPayload();
      if (latest) {
        popupChannel?.postMessage({
          kind: "payload",
          payload: latest,
        });
      } else {
        popupChannel?.postMessage({
          kind: "clear",
        });
      }
      return;
    }

    if (payload.action === "copy-result") {
      const latest = popupDeps.getLatestPayload();
      if (latest) {
        popupDeps.copyResult(latest.text);
      }
      return;
    }

    if (payload.action === "replace-selection") {
      const latest = popupDeps.getLatestPayload();
      if (latest) {
        void (async () => {
          const win = popupDeps.getWindow();
          if (win) {
            try {
              await win.hide();
            } catch {
              // Ignore hide failures and still attempt replacement.
            }
            await new Promise<void>((resolve) => {
              window.setTimeout(resolve, 140);
            });
          }

          const replaced = await popupDeps.replaceSelection(latest.text);
          if (replaced) {
            popupDeps.notify("Selected text replaced from popup.");
          } else {
            popupDeps.notify("Unable to replace selection automatically from popup.", true);
          }
        })();
      }
      return;
    }

    if (payload.action === "close-popup") {
      const win = popupDeps.getWindow();
      if (win) {
        void win.hide().catch(() => {
          // Ignore hide errors.
        });
      }
    }
  };
}

export function selectionAssistantUrl(): string {
  if (window.location.origin.startsWith("http")) {
    return `${window.location.origin}/selection-assistant.html`;
  }
  return "selection-assistant.html";
}

export function clampSelectionPopupHeight(height: number): number {
  return Math.min(SELECTION_POPUP_MAX_HEIGHT, Math.max(SELECTION_POPUP_MIN_HEIGHT, Math.round(height)));
}

export function estimateSelectionPopupHeight(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return SELECTION_POPUP_MIN_HEIGHT;
  }

  const lines = trimmed.split(/\r?\n/);
  let wrappedLines = 0;
  for (const line of lines) {
    const lineLength = line.trim().length > 0 ? line.length : 1;
    wrappedLines += Math.max(1, Math.ceil(lineLength / SELECTION_POPUP_CHARS_PER_LINE));
  }

  const contentHeight = wrappedLines * 24;
  const chromeHeight = 84;
  return clampSelectionPopupHeight(contentHeight + chromeHeight);
}

export async function applySelectionPopupSize(win: WebviewWindow, payload: SelectionPopupPayload): Promise<void> {
  const nextHeight = estimateSelectionPopupHeight(payload.text);
  await win.setSize(new LogicalSize(SELECTION_POPUP_WIDTH, nextHeight));
}

export function nextSelectionPopupToken(): number {
  return popupDeps.nextToken();
}

export async function ensureSelectionAssistantWindow(): Promise<WebviewWindow> {
  const current = popupDeps.getWindow();
  if (current) {
    return current;
  }

  const existing = await WebviewWindow.getByLabel("selection_assistant");
  if (existing) {
    try {
      await existing.close();
    } catch {
      // Ignore close errors and continue with a fresh window.
    }
  }

  const width = SELECTION_POPUP_WIDTH;
  const height = 260;
  const x = Math.max(32, Math.round((window.screen.availWidth - width) / 2));
  const y = Math.max(32, Math.round((window.screen.availHeight - height) / 2));

  const created = new WebviewWindow("selection_assistant", {
    title: "SlasshyWispr Selection Assistant",
    url: selectionAssistantUrl(),
    width,
    height,
    x,
    y,
    minWidth: SELECTION_POPUP_MIN_WIDTH,
    minHeight: SELECTION_POPUP_MIN_HEIGHT,
    resizable: false,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    visible: false,
    focus: true,
  });

  created.once("tauri://destroyed", () => {
    popupDeps.setWindow(null);
  });

  const creationReady = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finishResolve = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const finishReject = (reason: unknown): void => {
      if (settled) return;
      settled = true;
      reject(new Error(asErrorMessage(reason)));
    };
    created.once("tauri://created", () => {
      finishResolve();
    });
    created.once("tauri://error", (event) => {
      const payload = (event as { payload?: unknown }).payload ?? "unknown error";
      finishReject(payload);
    });
    window.setTimeout(() => {
      finishResolve();
    }, 900);
  });

  await creationReady;
  popupDeps.setWindow(created);
  return created;
}

export async function showSelectionAssistantPopup(payload: SelectionPopupPayload): Promise<boolean> {
  popupDeps.setLatestPayload(payload);

  if (!popupDeps.isTauri()) {
    return false;
  }

  try {
    const win = await ensureSelectionAssistantWindow();
    try {
      await applySelectionPopupSize(win, payload);
    } catch (error) {
      popupDeps.log(`selection.popup size update failed: ${asErrorMessage(error)}`);
    }
    await win.show();
    await win.setFocus();
    popupChannel?.postMessage({
      kind: "payload",
      payload,
    });
    window.setTimeout(() => {
      popupChannel?.postMessage({
        kind: "payload",
        payload,
      });
    }, 120);
    popupDeps.notify("Selection assistant popup opened.");
    return true;
  } catch (error) {
    popupDeps.notify(`Unable to open selection popup: ${asErrorMessage(error)}`, true);
    return false;
  }
}

export function setLatestSelectionPopupPayload(payload: SelectionPopupPayload | null): void {
  popupDeps.setLatestPayload(payload);
}

export async function dismissSelectionPopup(): Promise<void> {
  popupDeps.setLatestPayload(null);
  const win = popupDeps.getWindow();
  if (win) {
    try {
      await win.hide();
    } catch (hideError) {
      popupDeps.log(`selection.popup hide failed: ${asErrorMessage(hideError)}`);
      try {
        await win.close();
      } catch (closeError) {
        popupDeps.log(`selection.popup close fallback failed: ${asErrorMessage(closeError)}`);
      } finally {
        popupDeps.setWindow(null);
      }
    }
  }
}

export async function closeSelectionAssistantWindowForTray(): Promise<void> {
  popupDeps.setLatestPayload(null);
  const win = popupDeps.getWindow();
  if (!win) {
    return;
  }

  try {
    await win.close();
  } catch (error) {
    popupDeps.log(`[tray.background] selection popup close failed: ${asErrorMessage(error)}`);
    try {
      await win.hide();
    } catch {
      // Ignore best-effort cleanup failures while entering tray mode.
    }
  } finally {
    popupDeps.setWindow(null);
  }
}
