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
import { prefersReducedMotion } from "./dock-geometry";
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
  /** F-030 (Agent 2 rule): true when a payload token was superseded by a newer
      generation. Wired by Agent 3/main.tsx to Agent 2's generation-token API;
      absent = no stale tokens, everything shows. Paste logic untouched. */
  isTokenStale?: (token: number) => boolean;
  /** F-030 return-focus: refocus the main window after the popup closes.
      Wired by Agent 3 (one-liner); absent = hide only. */
  focusMainWindow?: () => Promise<void>;
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
      if (latest && !isPayloadTokenStale(latest.token)) {
        popupDeps.copyResult(latest.text);
      }
      return;
    }

    if (payload.action === "replace-selection") {
      const latest = popupDeps.getLatestPayload();
      // F-030: stale generation = no-op. Paste call below is unchanged.
      if (latest && !isPayloadTokenStale(latest.token)) {
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
          if (!replaced) {
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
    title: "SlasshyWispr",
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

export function isPayloadTokenStale(token: number): boolean {
  try {
    return popupDeps.isTokenStale?.(token) ?? false;
  } catch {
    return false;
  }
}

/** F-030 ARIA: the popup page applies these to its dialog root. */
export function selectionPopupA11yAttributes(payload: SelectionPopupPayload): {
  role: string;
  ariaModal: string;
  ariaLabel: string;
} {
  return { role: "dialog", ariaModal: "true", ariaLabel: payload.title };
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** F-030 focus trap math: next index for Tab/Shift+Tab over N focusables. Pure. */
export function trapFocusNextIndex(current: number, shiftKey: boolean, count: number): number {
  if (count <= 0) return 0;
  const next = current + (shiftKey ? -1 : 1);
  return ((next % count) + count) % count;
}

/** F-030: Tab-cycles focus inside container; Escape dismisses. For the popup page. */
export function handlePopupFocusTrap(event: KeyboardEvent, container: HTMLElement): void {
  if (event.key !== "Tab") return;
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.tabIndex !== -1,
  );
  if (focusables.length === 0) {
    event.preventDefault();
    return;
  }
  const active = container.ownerDocument?.activeElement as HTMLElement | null;
  const current = focusables.indexOf(active as HTMLElement);
  event.preventDefault();
  const next = current === -1 ? 0 : trapFocusNextIndex(current, event.shiftKey, focusables.length);
  focusables[next]?.focus();
}

export async function showSelectionAssistantPopup(payload: SelectionPopupPayload): Promise<boolean> {
  // F-030: stale generation never reaches the screen.
  if (isPayloadTokenStale(payload.token)) {
    popupDeps.log(`selection.popup stale token=${payload.token} -> no-op`);
    return false;
  }
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
    // F-030: reducedMotion lets the popup page kill its enter transition.
    // ponytail: if the popup ever needs animated enter/exit beyond a transition,
    // move to Motion (motion.dev) + prefers-reduced-motion gate there.
    const reducedMotion = prefersReducedMotion();
    popupChannel?.postMessage({
      kind: "payload",
      payload,
      reducedMotion,
    });
    window.setTimeout(() => {
      popupChannel?.postMessage({
        kind: "payload",
        payload,
        reducedMotion,
      });
    }, 120);
    return true;
  } catch (error) {
    popupDeps.notify(`Unable to open selection popup: ${asErrorMessage(error)}`, true);
    return false;
  }
}

export function setLatestSelectionPopupPayload(payload: SelectionPopupPayload | null): void {
  popupDeps.setLatestPayload(payload);
}

async function returnFocusToMain(): Promise<void> {
  try {
    await popupDeps.focusMainWindow?.();
  } catch (error) {
    popupDeps.log(`selection.popup return-focus failed: ${asErrorMessage(error)}`);
  }
}

export async function dismissSelectionPopup(): Promise<void> {
  popupDeps.setLatestPayload(null);
  const win = popupDeps.getWindow();
  // No popup window: nothing was shown, so never touch focus. The dictation
  // auto-paste path calls dismiss unconditionally before Ctrl+V; stealing
  // focus here is what trips the backend foreground guard and silently turns
  // every paste into a clipboard-only write.
  if (!win) {
    return;
  }
  let wasVisible = true;
  try {
    wasVisible = await win.isVisible();
  } catch {
    // Visibility probe failed: assume it was shown (previous behavior).
  }
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
  // Only a popup the user actually saw earns focus back. A hidden window
  // means dictation flow: focus stays where the paste target snapshot took it.
  if (wasVisible) {
    await returnFocusToMain();
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
