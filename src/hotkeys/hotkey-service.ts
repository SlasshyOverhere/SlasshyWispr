import type { HotkeySpec } from "../types";

/**
 * Canonical hotkey pure helpers - Phase 5c extraction from main.tsx.
 * No DOM, no settings, no invoke. Moved verbatim: normalize/parse/match/
 * format + global-shortcut token builders + typing-element guard.
 */

export function normalizeHotkeyModifierToken(token: string): "ctrl" | "shift" | "alt" | "meta" | "" {
  const normalized = token.trim().toLowerCase();
  if (
    normalized === "commandorcontrol" ||
    normalized === "commandorctrl" ||
    normalized === "cmdorctrl" ||
    normalized === "cmdorcontrol" ||
    normalized === "ctrl" ||
    normalized === "control"
  ) {
    return "ctrl";
  }
  if (normalized === "shift") {
    return "shift";
  }
  if (normalized === "alt" || normalized === "option" || normalized === "altgraph") {
    return "alt";
  }
  if (
    normalized === "super" ||
    normalized === "meta" ||
    normalized === "cmd" ||
    normalized === "command" ||
    normalized === "win" ||
    normalized === "os"
  ) {
    return "meta";
  }
  return "";
}

const GLOBAL_SHORTCUT_KEY_MAP: Record<string, string> = {
  space: "Space",
  enter: "Enter",
  tab: "Tab",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  capslock: "CapsLock",
  numlock: "NumLock",
  scrolllock: "ScrollLock",
  printscreen: "PrintScreen",
  pause: "Pause",
  plus: "Plus",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
  "[": "BracketLeft",
  "]": "BracketRight",
  numpadadd: "NumpadAdd",
  numpadsubtract: "NumpadSubtract",
  numpadmultiply: "NumpadMultiply",
  numpaddivide: "Numpaddivide",
  numpaddecimal: "NumpadDecimal",
  numpadenter: "NumpadEnter",
};

const FUNCTION_KEY_PATTERN = /^f([1-9]|1[0-9]|2[0-4])$/;

export function isFunctionKeyToken(value: string): boolean {
  return FUNCTION_KEY_PATTERN.test(value);
}

const NUMPAD_DIGIT_PATTERN = /^numpad[0-9]$/;

export function isNumpadDigitToken(value: string): boolean {
  return NUMPAD_DIGIT_PATTERN.test(value);
}

export function isAsciiLowerAlphaNumeric(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

export function toGlobalShortcutKeyToken(key: string): string {
  if (isFunctionKeyToken(key)) {
    return key.toUpperCase();
  }
  if (isNumpadDigitToken(key)) {
    return `Numpad${key.slice(-1)}`;
  }
  if (key.length === 1 && isAsciiLowerAlphaNumeric(key)) {
    return key.toUpperCase();
  }
  const mappedKey = GLOBAL_SHORTCUT_KEY_MAP[key];
  return typeof mappedKey === "string" ? mappedKey : key;
}

export function toGlobalShortcutString(hotkey: HotkeySpec): string {
  const parts: string[] = [];
  if (hotkey.ctrl) parts.push("CommandOrControl");
  if (hotkey.shift) parts.push("Shift");
  if (hotkey.alt) parts.push("Alt");
  if (hotkey.meta) parts.push("Super");
  parts.push(toGlobalShortcutKeyToken(hotkey.key));
  return parts.join("+");
}

export function normalizeShortcutToken(value: string): string {
  const rawTokens = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (rawTokens.length === 0) {
    return "";
  }

  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  let key = "";

  for (const token of rawTokens) {
    const modifier = normalizeHotkeyModifierToken(token);
    if (modifier) {
      if (modifier === "ctrl") ctrl = true;
      if (modifier === "shift") shift = true;
      if (modifier === "alt") alt = true;
      if (modifier === "meta") meta = true;
      continue;
    }

    if (!key) {
      key = normalizeHotkeyKeyToken(token) || token.trim().toLowerCase();
    }
  }

  if (!key) {
    return "";
  }

  const ordered: string[] = [];
  if (ctrl) ordered.push("ctrl");
  if (shift) ordered.push("shift");
  if (alt) ordered.push("alt");
  if (meta) ordered.push("meta");
  ordered.push(key);
  return ordered.join("+");
}

export function formatHotkeyForDisplay(hotkey: string): string {
  return hotkey
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" + ");
}

export function parseHotkey(raw: string): HotkeySpec | null {
  const source = raw.trim();
  if (!source) return null;

  const tokens = source
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0) return null;

  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  let key = "";

  for (const token of tokens) {
    const modifier = normalizeHotkeyModifierToken(token);
    if (modifier) {
      if (modifier === "ctrl") ctrl = true;
      if (modifier === "shift") shift = true;
      if (modifier === "alt") alt = true;
      if (modifier === "meta") meta = true;
      continue;
    }

    if (key) return null;

    key = normalizeHotkeyKeyToken(token);
    if (!key) return null;
  }

  if (!key) return null;

  const parts: string[] = [];
  if (ctrl) parts.push("Ctrl");
  if (shift) parts.push("Shift");
  if (alt) parts.push("Alt");
  if (meta) parts.push("Meta");
  parts.push(displayHotkeyKey(key));

  return {
    ctrl,
    shift,
    alt,
    meta,
    key,
    label: parts.join("+"),
  };
}

const SHIFTED_ALIASES_MAP: Record<string, string> = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "plus",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
  "~": "`",
};

const ALLOWED_PUNCTUATION_KEYS = new Set([",", ".", "/", "\\", ";", "'", "`", "-", "=", "[", "]"]);

const NORMALIZED_HOTKEY_MAP: Record<string, string> = {
  space: "space",
  spacebar: "space",
  enter: "enter",
  return: "enter",
  tab: "tab",
  esc: "escape",
  escape: "escape",
  backspace: "backspace",
  delete: "delete",
  del: "delete",
  insert: "insert",
  ins: "insert",
  home: "home",
  end: "end",
  pageup: "pageup",
  pgup: "pageup",
  pagedown: "pagedown",
  pgdown: "pagedown",
  arrowup: "up",
  up: "up",
  arrowdown: "down",
  down: "down",
  arrowleft: "left",
  left: "left",
  arrowright: "right",
  right: "right",
  capslock: "capslock",
  numlock: "numlock",
  scrolllock: "scrolllock",
  printscreen: "printscreen",
  prtsc: "printscreen",
  pause: "pause",
  break: "pause",
  comma: ",",
  period: ".",
  dot: ".",
  slash: "/",
  forwardslash: "/",
  backslash: "\\",
  semicolon: ";",
  quote: "'",
  apostrophe: "'",
  backquote: "`",
  grave: "`",
  graveaccent: "`",
  minus: "-",
  dash: "-",
  hyphen: "-",
  equal: "=",
  equals: "=",
  plus: "plus",
  leftbracket: "[",
  bracketleft: "[",
  lbracket: "[",
  rightbracket: "]",
  bracketright: "]",
  rbracket: "]",
  numpadadd: "numpadadd",
  add: "numpadadd",
  numpadsubtract: "numpadsubtract",
  subtract: "numpadsubtract",
  numpadmultiply: "numpadmultiply",
  multiply: "numpadmultiply",
  numpaddivide: "numpaddivide",
  divide: "numpaddivide",
  numpaddecimal: "numpaddecimal",
  decimal: "numpaddecimal",
  numpadenter: "numpadenter",
};

export function normalizeHotkeyKeyToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.length === 1) {
    if (isAsciiLowerAlphaNumeric(normalized)) return normalized;
    const shiftedAlias = SHIFTED_ALIASES_MAP[normalized];
    if (typeof shiftedAlias === "string") {
      return shiftedAlias;
    }
    if (ALLOWED_PUNCTUATION_KEYS.has(normalized)) {
      return normalized;
    }
  }
  if (isFunctionKeyToken(normalized)) return normalized;
  if (isNumpadDigitToken(normalized)) return normalized;

  const mappedKey = NORMALIZED_HOTKEY_MAP[normalized];
  return typeof mappedKey === "string" ? mappedKey : "";
}

const DISPLAY_HOTKEY_LOWERCASE_PATTERN = /[a-z]/;
const DISPLAY_HOTKEY_DIGIT_PATTERN = /[0-9]/;

export function displayHotkeyKey(key: string): string {
  if (key.length === 1) {
    return DISPLAY_HOTKEY_LOWERCASE_PATTERN.test(key) ? key.toUpperCase() : key;
  }
  if (key === "plus") return "Plus";
  if (key === "space") return "Space";
  if (key === "delete") return "Delete";
  if (key === "insert") return "Insert";
  if (key === "home") return "Home";
  if (key === "end") return "End";
  if (key === "pageup") return "PageUp";
  if (key === "pagedown") return "PageDown";
  if (key === "up") return "Up";
  if (key === "down") return "Down";
  if (key === "left") return "Left";
  if (key === "right") return "Right";
  if (key === "capslock") return "CapsLock";
  if (key === "numlock") return "NumLock";
  if (key === "scrolllock") return "ScrollLock";
  if (key === "printscreen") return "PrintScreen";
  if (key === "pause") return "Pause";
  if (key.startsWith("numpad")) {
    if (key.length === 7 && DISPLAY_HOTKEY_DIGIT_PATTERN.test(key.slice(-1))) {
      return `Numpad${key.slice(-1)}`;
    }
    const suffix = key.slice("numpad".length);
    return `Numpad${suffix.slice(0, 1).toUpperCase()}${suffix.slice(1)}`;
  }
  if (key.startsWith("f")) return key.toUpperCase();
  if (key === "escape") return "Esc";
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

export function matchesHotkey(event: KeyboardEvent, hotkey: HotkeySpec): boolean {
  return (
    event.ctrlKey === hotkey.ctrl &&
    event.shiftKey === hotkey.shift &&
    event.altKey === hotkey.alt &&
    event.metaKey === hotkey.meta &&
    normalizeEventKey(event.key) === hotkey.key
  );
}

export function normalizeEventKey(value: string): string {
  const normalized = normalizeHotkeyKeyToken(value);
  if (normalized) {
    return normalized;
  }

  const lower = value.toLowerCase();
  if (lower === " ") return "space";
  if (lower === "control" || lower === "ctrl") return "control";
  if (lower === "altgraph") return "alt";
  if (lower === "os" || lower === "command" || lower === "win") return "meta";
  return lower;
}

export function isTypingElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}
