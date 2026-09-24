/**
 * Generates src/generated/ipc-wire-types.ts from the Rust IPC structs.
 *
 * Every payload that crosses the Tauri boundary is declared once, in Rust, and
 * this turns those declarations into the TypeScript the frontend reads. Run it
 * with `npm run generate:wire-types`; run it with `--check` to fail when the
 * committed file is not current, which is what `prebuild` and CI do.
 *
 * The parsing is deliberately fussy. A struct that is missing its camelCase
 * rename rule, a field type with no TypeScript equivalent, a roster entry that
 * no longer exists — each is an error here rather than something skipped,
 * because a generator that silently emits nothing still overwrites the file
 * with a plausible-looking result.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const RUST_SRC = "src-tauri/src";
const OUTPUT = "src/generated/ipc-wire-types.ts";

/**
 * Rust structs the frontend reads, by name. Listed rather than discovered: the
 * crate has ~95 serializable structs and most never reach the webview, so the
 * wire surface is a decision. A name that stops existing fails the generator.
 */
const WIRE_TYPES = [
  "AppUpdateCheckResponse",
  "AppUpdateInstallProgressEvent",
  "AssistantInfoResponse",
  "AssistantPipelineResponse",
  "AudioFilePayload",
  "CaptureInfo",
  "CapturedAudio",
  "ForegroundInputBlockStatus",
  "InstallAppUpdateRequest",
  "LaunchAtLoginStatus",
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
  "TemperatureBoundsResponse",
  "TtsSetupStatusResponse",
  "VoiceCloneEngineResponse",
  "VoiceCloneListResponse",
  "VoiceCloneModelResponse",
  "VoiceClonePreviewResponse",
  "VoiceCloneResponse",
  "VoiceCloneStatusResponse",
  "VoiceInstallResponse",
];

/** Rust struct -> the name TypeScript declares for it, where they differ. */
const RENAMED = {
  CaptureInfo: "NativeCaptureInfo",
  CapturedAudio: "NativeCapturedAudio",
};

/** Rust primitives, as the TypeScript type that reads them. */
const SCALARS = {
  String: "string",
  "&str": "string",
  "&'static str": "string",
  bool: "boolean",
  u8: "number",
  u16: "number",
  u32: "number",
  u64: "number",
  usize: "number",
  i8: "number",
  i16: "number",
  i32: "number",
  i64: "number",
  isize: "number",
  f32: "number",
  f64: "number",
};

// ===== Rust sources =====

function rustFiles() {
  const found = [];
  const visit = (dir) => {
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
  return found;
}

function bracketDepth(text) {
  let depth = 0;
  for (const char of text) {
    if (char === "[") depth += 1;
    if (char === "]") depth -= 1;
  }
  return depth;
}

/**
 * Everything directly above `index`: the attributes, and the doc comment that
 * precedes them. Both are contiguous with the declaration, so a blank line ends
 * the block — which keeps a neighbouring item's attributes out of it.
 */
function preludeAbove(source, index) {
  const attributes = [];
  const doc = [];
  for (let i = index - 1; i >= 0; i -= 1) {
    const line = source[i].trim();
    const continuesMultiline =
      attributes.length > 0 && bracketDepth(attributes.join(" ")) > 0;
    if (line.startsWith("///")) {
      doc.unshift(line.replace(/^\/\/\/\s?/, ""));
      continue;
    }
    if (!line.startsWith("#[") && !continuesMultiline) break;
    attributes.unshift(line);
  }
  return { serde: attributes.join(" "), doc: doc.join("\n") };
}

function parseFields(body, where) {
  const fields = [];
  let attrs = [];
  let doc = [];

  for (const raw of body) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("///")) {
      doc.push(line.replace(/^\/\/\/\s?/, ""));
      continue;
    }
    if (line.startsWith("//")) continue;
    if (line.startsWith("#[")) {
      attrs.push(line);
      continue;
    }

    const match = /^(?:pub(?:\(crate\))?\s+)?(\w+)\s*:\s*(.+?),?$/.exec(line);
    if (!match) {
      throw new Error(`cannot parse a field of ${where}: ${line}`);
    }

    const fieldAttrs = attrs.join(" ");
    attrs = [];
    const fieldDoc = doc.join("\n");
    doc = [];
    if (/serde\([^)]*\bskip\b/.test(fieldAttrs) && !/skip_serializing_if/.test(fieldAttrs)) {
      continue; // not on the wire
    }
    fields.push({
      raw: match[1],
      type: match[2].replace(/,$/, "").trim(),
      doc: fieldDoc,
      optional: /^Option</.test(match[2]) || /serde\([^)]*\bdefault\b/.test(fieldAttrs),
      flatten: /serde\([^)]*\bflatten\b/.test(fieldAttrs) ? match[2].trim() : null,
      rename: /serde\([^)]*\brename\s*=\s*"([^"]+)"/.exec(fieldAttrs)?.[1] ?? null,
    });
  }

  if (fields.length === 0) throw new Error(`parsed no fields for ${where}`);
  return fields;
}

function parseStructs() {
  const structs = new Map();
  for (const file of rustFiles()) {
    const source = readFileSync(file, "utf8").split(/\r?\n/);
    for (let i = 0; i < source.length; i += 1) {
      const header = /^pub(?:\(crate\))? struct (\w+)\s*\{/.exec(source[i]);
      if (!header) continue;
      if (structs.has(header[1])) throw new Error(`two Rust structs named ${header[1]}`);
      const body = [];
      for (let j = i + 1; j < source.length && !source[j].startsWith("}"); j += 1) {
        body.push(source[j]);
      }
      structs.set(header[1], {
        file: relative(process.cwd(), file).replace(/\\/g, "/"),
        ...preludeAbove(source, i),
        fields: parseFields(body, `${header[1]} in ${file}`),
      });
    }
  }
  return structs;
}

// ===== Rust types -> TypeScript =====

function tsType(rust, where) {
  const trimmed = rust.trim();
  if (SCALARS[trimmed]) return SCALARS[trimmed];

  const option = /^Option<(.+)>$/.exec(trimmed);
  if (option) return tsType(option[1], where);

  const vector = /^Vec<(.+)>$/.exec(trimmed);
  if (vector) {
    const inner = tsType(vector[1], where);
    return inner.includes(" | ") ? `(${inner})[]` : `${inner}[]`;
  }

  const map = /^(?:HashMap|BTreeMap)<\s*String\s*,\s*(.+)>$/.exec(trimmed);
  if (map) return `Record<string, ${tsType(map[1], where)}>`;

  if (WIRE_TYPES.includes(trimmed)) return RENAMED[trimmed] ?? trimmed;

  throw new Error(
    `${where} has no TypeScript equivalent for \`${trimmed}\` — add the mapping to SCALARS in scripts/generate-wire-types.mjs rather than letting it through`,
  );
}

/**
 * The fields the frontend sees for one struct: renamed by the container's
 * `rename_all`, with flattened structs spliced in, since their fields arrive at
 * this level rather than nested under the flattening field's name.
 */
function wireFields(name, structs) {
  const struct = structs.get(name);
  if (!struct) {
    throw new Error(`${name} is not a Rust struct — fix the roster in scripts/generate-wire-types.mjs`);
  }

  const serde = /#\[serde\(([^)]*)\)\]/.exec(struct.serde)?.[1];
  const args = (serde ?? "")
    .split(",")
    .map((arg) => arg.trim())
    .filter(Boolean);
  const unknown = args.filter(
    (arg) =>
      !/^rename_all\s*=\s*"camelCase"$/.test(arg) &&
      arg !== "default" &&
      arg !== "deny_unknown_fields",
  );
  if (unknown.length > 0) {
    throw new Error(
      `${name} (${struct.file}) uses serde attributes the generator cannot interpret: ${unknown.join(", ")}`,
    );
  }
  if (!args.includes('rename_all = "camelCase"')) {
    throw new Error(
      `${name} (${struct.file}) does not declare #[serde(rename_all = "camelCase")], so its wire names are not the camelCase ones the frontend reads`,
    );
  }

  return struct.fields.flatMap((field) => {
    if (field.flatten) return wireFields(field.flatten, structs);
    const wire = field.rename ?? camelCase(field.raw);
    return [{ ...field, wire, ts: tsType(field.type, `${name}.${wire}`) }];
  });
}

const camelCase = (snake) =>
  snake.replace(/_([a-z])/g, (_all, letter) => letter.toUpperCase());

// ===== emit =====

/** A Rust doc comment as JSDoc, or nothing when there is none. */
function renderDoc(doc, indent = "") {
  if (!doc) return [];
  const text = doc.split("\n");
  if (text.length === 1) return [`${indent}/** ${text[0]} */`];
  return [
    `${indent}/**`,
    ...text.map((line) => `${indent} * ${line}`.trimEnd()),
    `${indent} */`,
  ];
}

function renderInterface(name, structs) {
  const struct = structs.get(name);
  const tsName = RENAMED[name] ?? name;
  const lines = [`// ${struct.file}`];
  if (tsName !== name) {
    lines.push(`// Rust: ${name}`);
  }
  lines.push(...renderDoc(struct.doc));
  lines.push(`export interface ${tsName} {`);

  const seen = new Set();
  for (const field of wireFields(name, structs)) {
    if (seen.has(field.wire)) {
      throw new Error(`${tsName} would declare ${field.wire} twice — check the renames on ${name}`);
    }
    seen.add(field.wire);
    lines.push(...renderDoc(field.doc, "  "));
    lines.push(`  ${field.wire}${field.optional ? "?" : ""}: ${field.ts};`);
  }

  lines.push("}", "");
  return lines.join("\n");
}

function render(structs) {
  // Checked before anything is rendered: a roster name that no longer exists
  // must not quietly drop an interface from the file.
  for (const name of WIRE_TYPES) {
    if (!structs.has(name)) {
      throw new Error(
        `${name} is not a Rust struct — fix the roster in scripts/generate-wire-types.mjs`,
      );
    }
  }

  const header = [
    "/**",
    " * IPC payload shapes, generated from the Rust structs.",
    " *",
    " * Do not edit — run `npm run generate:wire-types`. Each interface below is a",
    " * Rust struct named in the comment above it, so a payload is declared once and",
    " * the frontend cannot drift from the wire. `npm run build` and CI run the",
    " * generator with --check, so a stale file fails the build.",
    " */",
    "",
  ];
  const names = [...WIRE_TYPES].sort((a, b) =>
    (RENAMED[a] ?? a).localeCompare(RENAMED[b] ?? b),
  );
  const body = names.map((name) => renderInterface(name, structs));
  const fieldCount = names.reduce((total, name) => total + wireFields(name, structs).length, 0);
  return { source: `${header.join("\n")}${body.join("\n")}\n`, count: names.length, fieldCount };
}

// ===== run =====

const check = process.argv.includes("--check");
const structs = parseStructs();
const { source, count, fieldCount } = render(structs);

let current = "";
try {
  current = readFileSync(OUTPUT, "utf8");
} catch {
  current = "";
}

const normalize = (text) => text.split(/\r?\n/).join("\n");
const stale = normalize(current) !== normalize(source);

if (check) {
  if (stale) {
    const before = normalize(current).split("\n");
    const after = normalize(source).split("\n");
    const at = before.findIndex((line, index) => line !== after[index]);
    console.error(`${OUTPUT} is not current — run \`npm run generate:wire-types\`.\n`);
    console.error(`  line ${at + 1}`);
    console.error(`    committed: ${before[at] ?? "(end of file)"}`);
    console.error(`    generated: ${after[at] ?? "(end of file)"}`);
    process.exit(1);
  }
  console.log(
    `[generate-wire-types] ${count} interfaces, ${fieldCount} fields, up to date with the Rust structs`,
  );
} else {
  writeFileSync(OUTPUT, source);
  console.log(`[generate-wire-types] wrote ${OUTPUT} (${count} interfaces, ${fieldCount} fields)`);
}
