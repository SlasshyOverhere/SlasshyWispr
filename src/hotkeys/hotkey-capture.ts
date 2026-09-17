/**
 * Hotkey capture UI — Phase 5 shell decomposition.
 *
 * Owns the push-to-talk / command-hotkey capture state machine (active
 * flags, modifier snapshots, keydown/keyup handling). Moved verbatim from
 * main.tsx; inputs arrive via initHotkeyCapture and shell seams (stored
 * hotkeys, notice, commit) via HotkeyCaptureDeps, so this module never
 * touches main.tsx module globals.
 */
import {
  formatHotkeyForDisplay,
  normalizeEventKey,
  parseHotkey,
} from "./hotkey-service";

export interface HotkeyCaptureDeps {
  getPushHotkey: () => string;
  getCommandHotkey: () => string;
  notify: (message: string, isError?: boolean) => void;
  onCommitted: () => void;
}

let hotkeyInput!: HTMLInputElement;
let commandHotkeyInput!: HTMLInputElement;
let captureDeps!: HotkeyCaptureDeps;

let hotkeyCaptureActive = false;
const hotkeyCaptureModifiers = {
  ctrl: false,
  shift: false,
  alt: false,
  meta: false,
};
let commandHotkeyCaptureActive = false;
const commandHotkeyCaptureModifiers = {
  ctrl: false,
  shift: false,
  alt: false,
  meta: false,
};

export function initHotkeyCapture(
  inputs: { hotkeyInput: HTMLInputElement; commandHotkeyInput: HTMLInputElement },
  deps: HotkeyCaptureDeps,
): void {
  hotkeyInput = inputs.hotkeyInput;
  commandHotkeyInput = inputs.commandHotkeyInput;
  captureDeps = deps;
}

export function isHotkeyCaptureActive(): boolean {
  return hotkeyCaptureActive;
}

export function isCommandHotkeyCaptureActive(): boolean {
  return commandHotkeyCaptureActive;
}

export function isAnyHotkeyCaptureActive(): boolean {
  return hotkeyCaptureActive || commandHotkeyCaptureActive;
}

export function beginHotkeyCapture(): void {
  if (hotkeyInput.disabled || hotkeyCaptureActive) {
    return;
  }
  if (commandHotkeyCaptureActive) {
    cancelCommandHotkeyCapture();
  }

  hotkeyCaptureActive = true;
  hotkeyCaptureModifiers.ctrl = false;
  hotkeyCaptureModifiers.shift = false;
  hotkeyCaptureModifiers.alt = false;
  hotkeyCaptureModifiers.meta = false;
  hotkeyInput.classList.add("is-capturing-hotkey");
  hotkeyInput.value = "Press shortcut...";
  captureDeps.notify("Hotkey capture enabled. Press your shortcut combination now.");
}

export function cancelHotkeyCapture(): void {
  hotkeyCaptureActive = false;
  hotkeyCaptureModifiers.ctrl = false;
  hotkeyCaptureModifiers.shift = false;
  hotkeyCaptureModifiers.alt = false;
  hotkeyCaptureModifiers.meta = false;
  hotkeyInput.classList.remove("is-capturing-hotkey");
  hotkeyInput.value = captureDeps.getPushHotkey();
}

export function handleHotkeyCaptureKeydown(event: KeyboardEvent): void {
  if (!hotkeyCaptureActive) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const normalizedKey = normalizeEventKey(event.key);
  hotkeyCaptureModifiers.ctrl = event.ctrlKey;
  hotkeyCaptureModifiers.shift = event.shiftKey;
  hotkeyCaptureModifiers.alt = event.altKey;
  hotkeyCaptureModifiers.meta = event.metaKey;
  if (
    normalizedKey === "escape" &&
    !hotkeyCaptureModifiers.ctrl &&
    !hotkeyCaptureModifiers.shift &&
    !hotkeyCaptureModifiers.alt &&
    !hotkeyCaptureModifiers.meta
  ) {
    cancelHotkeyCapture();
    captureDeps.notify("Hotkey capture canceled.");
    return;
  }

  if (isModifierKey(normalizedKey)) {
    hotkeyInput.value = formatHotkeyCapturePreview();
    return;
  }

  const candidateTokens: string[] = [];
  if (hotkeyCaptureModifiers.ctrl) candidateTokens.push("ctrl");
  if (hotkeyCaptureModifiers.shift) candidateTokens.push("shift");
  if (hotkeyCaptureModifiers.alt) candidateTokens.push("alt");
  if (hotkeyCaptureModifiers.meta) candidateTokens.push("meta");

  candidateTokens.push(normalizedKey);

  const parsed = parseHotkey(candidateTokens.join("+"));
  if (!parsed) {
    hotkeyInput.value = formatHotkeyCapturePreview();
    captureDeps.notify("Unsupported hotkey key. Try another combination.", true);
    return;
  }

  hotkeyCaptureActive = false;
  hotkeyInput.classList.remove("is-capturing-hotkey");
  hotkeyInput.value = parsed.label;
  captureDeps.onCommitted();
  captureDeps.notify(`Push-to-talk hotkey updated to ${formatHotkeyForDisplay(parsed.label)}.`);
  hotkeyInput.blur();
}

export function handleHotkeyCaptureKeyup(event: KeyboardEvent): void {
  if (!hotkeyCaptureActive) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  hotkeyCaptureModifiers.ctrl = event.ctrlKey;
  hotkeyCaptureModifiers.shift = event.shiftKey;
  hotkeyCaptureModifiers.alt = event.altKey;
  hotkeyCaptureModifiers.meta = event.metaKey;

  if (isModifierKey(normalizeEventKey(event.key))) {
    hotkeyInput.value = formatHotkeyCapturePreview();
  }
}

function formatHotkeyCapturePreview(): string {
  const parts: string[] = [];
  if (hotkeyCaptureModifiers.ctrl) parts.push("Ctrl");
  if (hotkeyCaptureModifiers.shift) parts.push("Shift");
  if (hotkeyCaptureModifiers.alt) parts.push("Alt");
  if (hotkeyCaptureModifiers.meta) parts.push("Meta");

  if (parts.length === 0) {
    return "Press shortcut...";
  }

  return `${parts.join(" + ")} + ...`;
}

function isModifierKey(key: string): boolean {
  return key === "control" || key === "shift" || key === "alt" || key === "meta";
}

export function beginCommandHotkeyCapture(): void {
  if (commandHotkeyInput.disabled || commandHotkeyCaptureActive) {
    return;
  }
  if (hotkeyCaptureActive) {
    cancelHotkeyCapture();
  }

  commandHotkeyCaptureActive = true;
  commandHotkeyCaptureModifiers.ctrl = false;
  commandHotkeyCaptureModifiers.shift = false;
  commandHotkeyCaptureModifiers.alt = false;
  commandHotkeyCaptureModifiers.meta = false;
  commandHotkeyInput.classList.add("is-capturing-hotkey");
  commandHotkeyInput.value = "Press shortcut...";
  captureDeps.notify("Command hotkey capture enabled. Press your shortcut combination now.");
}

export function cancelCommandHotkeyCapture(): void {
  commandHotkeyCaptureActive = false;
  commandHotkeyCaptureModifiers.ctrl = false;
  commandHotkeyCaptureModifiers.shift = false;
  commandHotkeyCaptureModifiers.alt = false;
  commandHotkeyCaptureModifiers.meta = false;
  commandHotkeyInput.classList.remove("is-capturing-hotkey");
  commandHotkeyInput.value = captureDeps.getCommandHotkey();
}

export function handleCommandHotkeyCaptureKeydown(event: KeyboardEvent): void {
  if (!commandHotkeyCaptureActive) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const normalizedKey = normalizeEventKey(event.key);
  commandHotkeyCaptureModifiers.ctrl = event.ctrlKey;
  commandHotkeyCaptureModifiers.shift = event.shiftKey;
  commandHotkeyCaptureModifiers.alt = event.altKey;
  commandHotkeyCaptureModifiers.meta = event.metaKey;
  if (
    normalizedKey === "escape" &&
    !commandHotkeyCaptureModifiers.ctrl &&
    !commandHotkeyCaptureModifiers.shift &&
    !commandHotkeyCaptureModifiers.alt &&
    !commandHotkeyCaptureModifiers.meta
  ) {
    cancelCommandHotkeyCapture();
    captureDeps.notify("Command hotkey capture canceled.");
    return;
  }

  if (isModifierKey(normalizedKey)) {
    commandHotkeyInput.value = formatModifierPreview(commandHotkeyCaptureModifiers);
    return;
  }

  const candidateTokens: string[] = [];
  if (commandHotkeyCaptureModifiers.ctrl) candidateTokens.push("ctrl");
  if (commandHotkeyCaptureModifiers.shift) candidateTokens.push("shift");
  if (commandHotkeyCaptureModifiers.alt) candidateTokens.push("alt");
  if (commandHotkeyCaptureModifiers.meta) candidateTokens.push("meta");

  candidateTokens.push(normalizedKey);
  const parsed = parseHotkey(candidateTokens.join("+"));
  if (!parsed) {
    commandHotkeyInput.value = formatModifierPreview(commandHotkeyCaptureModifiers);
    captureDeps.notify("Unsupported key for command hotkey.", true);
    return;
  }

  commandHotkeyCaptureActive = false;
  commandHotkeyInput.classList.remove("is-capturing-hotkey");
  commandHotkeyInput.value = parsed.label;
  captureDeps.onCommitted();
  captureDeps.notify(`Command mode hotkey updated to ${formatHotkeyForDisplay(parsed.label)}.`);
  commandHotkeyInput.blur();
}

export function handleCommandHotkeyCaptureKeyup(event: KeyboardEvent): void {
  if (!commandHotkeyCaptureActive) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  commandHotkeyCaptureModifiers.ctrl = event.ctrlKey;
  commandHotkeyCaptureModifiers.shift = event.shiftKey;
  commandHotkeyCaptureModifiers.alt = event.altKey;
  commandHotkeyCaptureModifiers.meta = event.metaKey;

  if (isModifierKey(normalizeEventKey(event.key))) {
    commandHotkeyInput.value = formatModifierPreview(commandHotkeyCaptureModifiers);
  }
}

function formatModifierPreview(modifiers: {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}): string {
  const parts: string[] = [];
  if (modifiers.ctrl) parts.push("Ctrl");
  if (modifiers.shift) parts.push("Shift");
  if (modifiers.alt) parts.push("Alt");
  if (modifiers.meta) parts.push("Meta");
  if (parts.length === 0) {
    return "Press shortcut...";
  }
  return `${parts.join(" + ")} + ...`;
}
