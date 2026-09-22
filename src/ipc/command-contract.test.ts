/**
 * The command-name half of the Rust <-> TypeScript contract.
 *
 * Command names cross the language boundary as strings with no compiler between
 * them, and they fail silently: an unregistered command reaches the backend as
 * an unknown command, which the caller reports as "no backend". The Rust sources
 * are parsed here so `IPC_COMMANDS` and `generate_handler!` cannot disagree.
 *
 * Payload shapes are not checked here — they are generated from the Rust structs
 * into src/generated/ipc-wire-types.ts by scripts/generate-wire-types.mjs, which
 * `prebuild` and CI verify is current.
 *
 * Every parse is strict on purpose: anything this file cannot read is a failure,
 * never a skipped check. A guard whose pattern stops matching still reports
 * success while asserting nothing.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { IPC_COMMANDS } from "./commands";

const RUST_SRC = "src-tauri/src";
const LIB_RS = `${RUST_SRC}/lib.rs`;
const COMMANDS_TS = "src/ipc/commands.ts";

/**
 * Commands the backend registers without a frontend caller: tray actions and
 * media control. Named explicitly so a new command has to be classified rather
 * than silently skipped.
 */
const RUST_ONLY_COMMANDS = [
  "control_media_playback",
  "set_tray_update_available",
  "show_update_settings",
];

function readSource(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`command contract cannot read ${path}`);
  }
}

function lines(path: string): string[] {
  return readSource(path).split(/\r?\n/);
}

function rustFiles(): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        visit(full);
      } else if (full.endsWith(".rs")) {
        found.push(full);
      }
    }
  };
  visit(RUST_SRC);
  if (found.length === 0) {
    throw new Error(`no Rust sources found under ${RUST_SRC}`);
  }
  return found;
}

/** Frontend sources, excluding tests and the command map itself. */
function frontendFiles(): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry).replace(/\\/g, "/");
      if (statSync(full).isDirectory()) {
        visit(full);
        continue;
      }
      if (!/\.tsx?$/.test(full) || /\.test\.tsx?$/.test(full) || full === COMMANDS_TS) {
        continue;
      }
      found.push(full);
    }
  };
  visit("src");
  return found;
}

function ipcCommandEntries(): { key: string; value: string }[] {
  const entries = lines(COMMANDS_TS)
    .map((line) => /^[ \t]*(\w+): "([a-z0-9_]+)",$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ key: match[1], value: match[2] }));

  if (entries.length === 0) {
    throw new Error(`parsed no commands from ${COMMANDS_TS}`);
  }
  return entries;
}

function registeredCommands(): string[] {
  const list = /generate_handler!\[([\s\S]*?)\]/.exec(readSource(LIB_RS))?.[1];
  if (list === undefined) {
    throw new Error(`cannot find generate_handler! in ${LIB_RS}`);
  }
  const names = list
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .join("")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (names.length === 0) {
    throw new Error(`parsed no commands from generate_handler! in ${LIB_RS}`);
  }
  return names;
}

function attributedCommands(): { name: string; file: string }[] {
  const found: { name: string; file: string }[] = [];

  for (const file of rustFiles()) {
    const source = lines(file);
    for (let i = 0; i < source.length; i += 1) {
      if (!/^#\[tauri::command/.test(source[i].trim())) {
        continue;
      }
      let name: string | null = null;
      for (let j = i + 1; j < source.length && j <= i + 6; j += 1) {
        const trimmed = source[j].trim();
        if (trimmed === "" || trimmed.startsWith("#[") || trimmed.startsWith("//")) {
          continue;
        }
        const fn = /^(?:pub(?:\(crate\))?\s+)?(?:async\s+)?fn\s+(\w+)/.exec(trimmed);
        if (!fn) {
          throw new Error(`${file}:${i + 1} has #[tauri::command] but no fn: ${trimmed}`);
        }
        name = fn[1];
        break;
      }
      if (!name) {
        throw new Error(`${file}:${i + 1} has #[tauri::command] with no fn below it`);
      }
      found.push({ name, file });
    }
  }

  if (found.length === 0) {
    throw new Error("found no #[tauri::command] functions");
  }
  return found;
}

describe("command names", () => {
  it("registers every command the frontend calls", () => {
    const registered = new Set(registeredCommands());
    const missing = ipcCommandEntries()
      .filter((entry) => !registered.has(entry.value))
      .map((entry) => `${entry.key} -> ${entry.value}`);

    // An unregistered command fails at runtime as an unknown command, which the
    // caller reports as "no backend" — a wire mismatch that looks like an outage.
    expect(missing).toEqual([]);
  });

  it("classifies every registered command", () => {
    const frontend = new Set(ipcCommandEntries().map((entry) => entry.value));
    const registered = registeredCommands();

    // A newly registered command must be either wired to the frontend or named
    // as backend-only, so one that is meant for the UI cannot pass unnoticed.
    expect(
      registered.filter((name) => !frontend.has(name) && !RUST_ONLY_COMMANDS.includes(name)),
    ).toEqual([]);
    expect(
      RUST_ONLY_COMMANDS.filter((name) => frontend.has(name) || !registered.includes(name)),
    ).toEqual([]);
  });

  it("keeps IPC_COMMANDS and the attributed functions one-to-one", () => {
    const registered = new Set(registeredCommands());
    const attributed = attributedCommands();

    // In both directions: a registration without the attribute would not compile,
    // and an attribute without registration is a command nothing can reach.
    expect(
      registeredCommands().filter((name) => !attributed.some((fn) => fn.name === name)),
    ).toEqual([]);
    expect(
      attributed
        .filter((fn) => !registered.has(fn.name))
        .map((fn) => `${fn.name} (${fn.file})`),
    ).toEqual([]);
  });

  it("names no command with a string literal", () => {
    const literals = frontendFiles().filter((file) =>
      /invoke(?:<[^>]*>)?\(\s*["'`]/.test(readSource(file)),
    );

    // Call sites go through IPC_COMMANDS (see AGENTS.md) so a rename lands in one
    // place; a literal is invisible to every check above.
    expect(literals).toEqual([]);
  });

  it("uses every constant it declares", () => {
    const sources = frontendFiles().map(readSource);
    const unused = ipcCommandEntries()
      .filter((entry) => !sources.some((source) => source.includes(`IPC_COMMANDS.${entry.key}`)))
      .map((entry) => `${entry.key} -> ${entry.value}`);

    // An unused constant is a command the frontend never calls, so it belongs in
    // RUST_ONLY_COMMANDS instead of pretending to be part of the frontend surface.
    expect(unused).toEqual([]);
  });
});
