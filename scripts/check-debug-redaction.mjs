/**
 * Gate: a struct that holds an API key must not derive Debug.
 *
 * The previous version of this check grepped a single line for both "derive
 * Debug" and "api_key", so it could never fire — the derive and the field are
 * always several lines apart. A pipeline Debug that printed the key would have
 * passed it.
 *
 * A test that proves the redactor works is not evidence it is wired, so this
 * asserts the structural property instead: find every struct that declares an
 * api_key field, and require a hand-written Debug impl beside it.
 */
import { readFileSync } from "node:fs";

const FILES = [
  "src-tauri/src/commands/pipeline.rs",
  "src-tauri/src/commands/ipc_types.rs",
  "src-tauri/src/pipeline/routing.rs",
];

const problems = [];

/** `#[derive(...)]` lines and the `struct`/`enum` declaration each one covers. */
function declarations(source) {
  const lines = source.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*#\[derive\(/.test(lines[i])) continue;
    const derive = lines[i];
    // Attributes may stack; the declaration is the next non-attribute line.
    let j = i + 1;
    while (j < lines.length && /^\s*#\[/.test(lines[j])) j += 1;
    const declaration = (lines[j] ?? "").trim();
    if (declaration) found.push({ line: i + 1, derive, declaration });
    i = j;
  }
  return found;
}

/** The body of a declaration: from its opening brace to the matching close. */
function body(source, from) {
  const open = source.indexOf("{", from);
  if (open < 0) return "";
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i);
    }
  }
  return source.slice(open);
}

for (const file of FILES) {
  let source;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    problems.push(`cannot read ${file}; the gate cannot verify anything if its inputs moved`);
    continue;
  }

  const hasRedaction = /REDACTED/.test(source);

  for (const { line, derive, declaration } of declarations(source)) {
    if (!/\bDebug\b/.test(derive)) continue;
    const name = declaration.match(/\b(?:struct|enum)\s+(\w+)/)?.[1] ?? declaration;
    // Scoped to this declaration's own body, so a nearby key-holding type
    // cannot make an innocent one look guilty.
    const start = source.indexOf(declaration);
    if (!/\bapi_key\b/.test(body(source, start))) continue;

    problems.push(
      `${file}:${line} ${name} holds an api_key and derives Debug; ` +
        "drop Debug from the derive and add a redacting impl",
    );
  }

  if (!hasRedaction) {
    problems.push(`${file} has no redacting Debug impl at all`);
  }
}

if (problems.length > 0) {
  console.error("debug redaction gate failed:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`[check:debug-redaction] no derived Debug on a key-holding struct in ${FILES.length} files`);
