/**
 * Settings state ownership — Phase 4 per-pane conversion.
 *
 * Owns the committed settings snapshot that React panes render from.
 * main.tsx initializes it at boot and commits after every change;
 * converted (controlled) panes read it via useSettingsSnapshot and send
 * patches back through the slasshywispr:settings-patch window event, which
 * main.tsx handles through the submit pipeline. Unconverted panes keep
 * using the DOM until their turn.
 */
import { loadSettings } from "../state/settings-store";
import type { PersistedSettings } from "../types";

let current: PersistedSettings | null = null;
const listeners = new Set<() => void>();
const convertedPanes = new Set<string>();

export const SETTINGS_PATCH_EVENT = "slasshywispr:settings-patch";

export function initSettingsState(initial: PersistedSettings): void {
  current = initial;
  notifySettingsSubscribers();
}

export function getSettingsSnapshot(): PersistedSettings {
  if (!current) {
    current = loadSettings();
  }
  return current;
}

export function setSettingsSnapshot(next: PersistedSettings): void {
  current = next;
  notifySettingsSubscribers();
}

export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifySettingsSubscribers(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function markPaneConverted(pane: string): void {
  convertedPanes.add(pane);
}

export function isPaneConverted(pane: string): boolean {
  return convertedPanes.has(pane);
}

export function dispatchSettingsPatch(patch: Partial<PersistedSettings>): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_PATCH_EVENT, { detail: patch }));
}

export function resetSettingsStateForTests(): void {
  current = null;
  listeners.clear();
  convertedPanes.clear();
}
