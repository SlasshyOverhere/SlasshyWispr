/**
 * The Rust <-> TypeScript wire contract, checked against the Rust sources.
 *
 * Two things cross the language boundary with no compiler between them, and
 * both fail silently: the serde field names of every IPC payload (a rename reads
 * as `undefined`), and the command-name strings (an unregistered command arrives
 * as "no backend", which callers swallow). The Rust sources are parsed here and
 * treated as the single source of truth for both, so a payload shape or a
 * command name is declared once, in Rust, and only ever checked on the TS side.
 *
 * Every parse is strict on purpose: anything this file cannot read is a failure,
 * never a skipped check. A guard whose pattern stops matching still reports
 * success while asserting nothing, which is the failure it exists to prevent.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { IPC_COMMANDS } from "./commands";

const RUST_SRC = "src-tauri/src";
const LIB_RS = `${RUST_SRC}/lib.rs`;
const TYPES_TS = "src/types.ts";
const COMMANDS_TS = "src/ipc/commands.ts";

/**
 * Every TypeScript interface that mirrors a Rust struct, by the name they share.
 *
 * Listed rather than discovered so a rename on either side fails loudly instead
 * of quietly dropping the type out of coverage. Pairing is by name only; no
 * field data is duplicated here, so the Rust structs stay the only definition.
 */
const WIRE_TYPES = [
  "AppUpdateCheckResponse",
  "AppUpdateInstallProgressEvent",
  "AssistantInfoResponse",
  "AssistantPipelineResponse",
  "AudioFilePayload",
  "ForegroundInputBlockStatus",
  "InstallAppUpdateRequest",
  "LocalSttDeactivateResponse",
  "LocalSttDeleteResponse",
  "LocalSttDownloadResponse",
  "LocalSttDownloadStatusResponse",
  "LocalSttHardwareAdviceResponse",
  "LocalSttModelStatusResponse",
  "LocalSttOpenPathResponse",
  "LocalSttRuntimeStateResponse",
  "LocalSttWarmupResponse",
  "MaxTokensBoundsResponse",
  "OllamaPullResponse",
  "OllamaStatusResponse",
  "PiperValidationResponse",
  "ProviderModelsResponse",
  "RecordingsStats",
  "RuntimeSetupResponse",
  "SttTimeoutBoundsResponse",
  "TtsSetupStatusResponse",
  "VoiceInstallResponse",
];

/**
 * Commands the backend registers without a frontend caller: tray actions, media
 * control, and the Coqui runtime (which Rust drives itself). Named explicitly so
 * a new command has to be classified rather than silently skipped.
 */
const RUST_ONLY_COMMANDS = [
  "clone_coqui_voice",
  "control_media_playback",
  "get_coqui_status",
  "list_coqui_models",
  "list_coqui_voices",
  "preview_coqui_voice",
  "set_tray_update_available",
  "show_update_settings",
  "validate_coqui",
];

// ===== source access =====

function readSource(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`wire contract cannot read ${path}`);
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

/** Frontend sources, excluding this file's own fixtures and the command map. */
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

const camelCase = (snake: string): string =>
  snake.replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase());

// ===== the Rust side =====

interface RustField {
  name: string;
  type: string;
  /** Absent from the payload is legal: `Option<T>` or `#[serde(default)]`. */
  optional: boolean;
  /** Struct spliced into this one's fields, or null. */
  flatten: string | null;
}

interface RustStruct {
  file: string;
  /** The container's `#[serde(...)]` attributes, verbatim. */
  serde: string;
  fields: RustField[];
}

/** Attribute lines directly above `index`, including a multi-line attribute. */
function attributeBlockAbove(source: string[], index: number): string {
  const collected: string[] = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = source[i].trim();
    const continuesMultiline = collected.length > 0 && bracketDepth(collected.join(" ")) > 0;
    if (!line.startsWith("#[") && !continuesMultiline) {
      break;
    }
    collected.unshift(line);
  }
  return collected.join(" ");
}

function bracketDepth(text: string): number {
  return [...text].reduce((depth, char) => {
    if (char === "[") return depth + 1;
    if (char === "]") return depth - 1;
    return depth;
  }, 0);
}

function parseRustFields(body: string[], where: string): RustField[] {
  const fields: RustField[] = [];
  let pending: string[] = [];

  for (const raw of body) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//")) {
      continue;
    }
    if (line.startsWith("#[")) {
      pending.push(line);
      continue;
    }

    const match = /^(?:pub(?:\(crate\))?\s+)?(\w+)\s*:\s*(.+?),?$/.exec(line);
    if (!match) {
      // A shape this parser cannot read must stop the test, not be ignored.
      throw new Error(`cannot parse a field of ${where}: ${line}`);
    }

    const attrs = pending.join(" ");
    pending = [];
    const type = match[2].replace(/,$/, "").trim();
    if (/serde\([^)]*\bskip\b/.test(attrs) && !/skip_serializing_if/.test(attrs)) {
      continue; // not on the wire, so TypeScript must not declare it
    }
    fields.push({
      name: match[1],
      type,
      optional: /^Option</.test(type) || /serde\([^)]*\bdefault\b/.test(attrs),
      flatten: /serde\([^)]*\bflatten\b/.test(attrs) ? type : null,
    });
  }

  if (pending.length > 0) {
    throw new Error(`trailing attribute with no field in ${where}`);
  }
  if (fields.length === 0) {
    throw new Error(`parsed no fields for ${where}`);
  }
  return fields;
}

function parseRustStructs(): Map<string, RustStruct> {
  const structs = new Map<string, RustStruct>();

  for (const file of rustFiles()) {
    const source = lines(file);
    for (let i = 0; i < source.length; i += 1) {
      const header = /^pub(?:\(crate\))? struct (\w+)\s*\{/.exec(source[i]);
      if (!header) {
        continue;
      }
      const name = header[1];
      if (structs.has(name)) {
        throw new Error(`two Rust structs named ${name}`);
      }
      const body: string[] = [];
      for (let j = i + 1; j < source.length && !source[j].startsWith("}"); j += 1) {
        body.push(source[j]);
      }
      structs.set(name, {
        file,
        serde: attributeBlockAbove(source, i),
        fields: parseRustFields(body, `${name} in ${file}`),
      });
    }
  }

  if (structs.size === 0) {
    throw new Error("parsed no Rust structs");
  }
  return structs;
}

// ===== the TypeScript side =====

interface TsInterface {
  heritage: string;
  fields: { name: string; optional: boolean }[];
}

function parseTsInterfaces(): Map<string, TsInterface> {
  const source = lines(TYPES_TS);
  const interfaces = new Map<string, TsInterface>();

  for (let i = 0; i < source.length; i += 1) {
    const header = /^export interface (\w+)([^{]*)\{/.exec(source[i]);
    if (!header) {
      continue;
    }
    const name = header[1];
    const fields: TsInterface["fields"] = [];
    let inBlockComment = false;

    for (let j = i + 1; j < source.length; j += 1) {
      const line = source[j];
      if (line.startsWith("}")) {
        break;
      }
      const trimmed = line.trim();
      if (inBlockComment) {
        inBlockComment = !trimmed.includes("*/");
        continue;
      }
      if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("*")) {
        continue;
      }
      if (trimmed.startsWith("/*")) {
        inBlockComment = !trimmed.includes("*/");
        continue;
      }

      const field = /^(?:readonly\s+)?(\w+)(\?)?\s*:\s*(.+);$/.exec(trimmed);
      if (!field) {
        throw new Error(`cannot parse a field of ${name} in ${TYPES_TS}: ${trimmed}`);
      }
      fields.push({ name: field[1], optional: Boolean(field[2]) });
    }

    if (fields.length === 0) {
      throw new Error(`parsed no fields for interface ${name}`);
    }
    if (interfaces.has(name)) {
      throw new Error(`two interfaces named ${name}`);
    }
    interfaces.set(name, { heritage: header[2].trim(), fields });
  }
  return interfaces;
}

// ===== the field contract =====

/**
 * The names and optionality the backend puts on the wire for one struct:
 * the Rust field name converted by the container's `rename_all`, with flattened
 * structs spliced in, since their fields arrive at this level.
 */
function wireFields(name: string, structs: Map<string, RustStruct>): RustField[] {
  const struct = structs.get(name);
  if (!struct) {
    throw new Error(`${name} is not a Rust struct — fix the roster in this test`);
  }

  const serde = /#\[serde\(([^)]*)\)\]/.exec(struct.serde)?.[1];
  const args = (serde ?? "")
    .split(",")
    .map((arg) => arg.trim())
    .filter(Boolean);
  const unknown = args.filter(
    (arg) => !/^rename_all\s*=\s*"camelCase"$/.test(arg) && arg !== "default" && arg !== "deny_unknown_fields",
  );
  if (unknown.length > 0) {
    throw new Error(
      `${name} in ${struct.file} uses serde attributes this test cannot interpret (${unknown.join(", ")}) — update the test rather than letting it pass`,
    );
  }
  if (!args.includes('rename_all = "camelCase"')) {
    throw new Error(
      `${name} in ${struct.file} does not declare #[serde(rename_all = "camelCase")], so its wire names are not the camelCase ones TypeScript reads`,
    );
  }

  return struct.fields.flatMap((field) =>
    field.flatten
      ? wireFields(field.flatten, structs)
      : [{ ...field, name: camelCase(field.name) }],
  );
}

// ===== command names =====

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

// ===== tests =====

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
    expect(registered.filter((name) => !frontend.has(name) && !RUST_ONLY_COMMANDS.includes(name))).toEqual([]);
    expect(RUST_ONLY_COMMANDS.filter((name) => frontend.has(name) || !registered.includes(name))).toEqual([]);
  });

  it("keeps IPC_COMMANDS and the attributed functions one-to-one", () => {
    const registered = new Set(registeredCommands());
    const attributed = attributedCommands();

    // In both directions: a registration without the attribute would not compile,
    // and an attribute without registration is a command nothing can reach.
    expect(registeredCommands().filter((name) => !attributed.some((fn) => fn.name === name))).toEqual([]);
    expect(attributed.filter((fn) => !registered.has(fn.name)).map((fn) => `${fn.name} (${fn.file})`)).toEqual([]);
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

describe("wire types", () => {
  it("pairs every wire type with a Rust struct", () => {
    const structs = parseRustStructs();
    const interfaces = parseTsInterfaces();

    expect(WIRE_TYPES.filter((name) => !structs.has(name))).toEqual([]);
    expect(WIRE_TYPES.filter((name) => !interfaces.has(name))).toEqual([]);

    // A flattened or inherited type contributes fields this test does not follow,
    // so it has to be handled explicitly rather than compared as if it were flat.
    const inherited = WIRE_TYPES.filter((name) => interfaces.get(name)?.heritage);
    expect(inherited).toEqual([]);
  });

  it("declares exactly the fields the backend sends", () => {
    const structs = parseRustStructs();
    const interfaces = parseTsInterfaces();
    const drift: string[] = [];

    for (const name of WIRE_TYPES) {
      const declared = interfaces.get(name);
      if (!declared) {
        continue; // the pairing test above reports this
      }
      const wire = wireFields(name, structs);
      const remaining = new Map(declared.fields.map((field) => [field.name, field]));

      for (const field of wire) {
        const match = remaining.get(field.name);
        if (!match) {
          drift.push(`${name}.${field.name} is sent by Rust (${field.name}: ${field.type}) but not declared in TypeScript`);
          continue;
        }
        remaining.delete(field.name);
        if (match.optional !== field.optional) {
          drift.push(
            `${name}.${field.name} is ${field.optional ? "optional" : "required"} in Rust and ${match.optional ? "optional" : "required"} in TypeScript`,
          );
        }
      }
      for (const extra of remaining.keys()) {
        drift.push(`${name}.${extra} is declared in TypeScript but never sent by Rust`);
      }
    }

    expect(drift).toEqual([]);
  });
});
