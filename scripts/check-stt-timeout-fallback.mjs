/**
 * Gate: the TypeScript STT timeout fallback must stay a placeholder.
 *
 * The backend owns these bounds and answers `sttTimeoutBounds` over IPC. The
 * fallback exists for the window before that answer arrives (and for the browser
 * dev build, which has no backend). It is only honest while something actually
 * supersedes it — if that stops being true, the TypeScript numbers quietly
 * become a second source of truth that Rust clamps against and the UI lies.
 *
 * Four ways that can happen, one check each. This is a static check because the
 * failure is a missing wire, not a wrong value: with the backend's bounds equal
 * to the fallback today, no amount of comparing numbers can tell them apart.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const OWNER = resolve("src", "settings", "stt-timeout-bounds.ts");
const CLIENT_SYMBOL = "ipcSttTimeoutBounds";
const BOOT_FILES = ["src/main.tsx"];
// Matches the call site whatever it is aliased to on import, and never the
// import line itself (which has no `await`).
const HYDRATE_CALL = /await\s+hydrateSettingsFromNativeStorage\w*\(/;
const BOUNDS_FIELDS = ["defaultSeconds", "minSeconds", "maxSeconds"];

const failures = [];

function fail(problem, consequence) {
  failures.push(`${problem}\n    why: ${consequence}`);
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    fail(`cannot read ${path}`, "the gate cannot verify anything if its inputs moved");
    return "";
  }
}

function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...sourceFiles(full));
      continue;
    }
    found.push(full);
  }
  return found;
}

// 1. The module still adopts the backend's answer by design.
const owner = readText(OWNER);
if (owner) {
  if (!owner.includes("export async function refreshSttTimeoutBounds(")) {
    fail(
      `${OWNER} no longer exports refreshSttTimeoutBounds`,
      "nothing can replace the fallback, so the TypeScript numbers are the authority",
    );
  }
  if (!/setSttTimeoutBounds\(\s*await load\(\)\s*\)/.test(owner)) {
    fail(
      `${OWNER} no longer adopts the loaded bounds`,
      "the fetch result would be discarded and the fallback would stand for the session",
    );
  }
  // 4a. Other modules must not be able to import it as an authority.
  for (const line of owner.split("\n")) {
    if (line.includes("export") && line.includes("FALLBACK_BOUNDS")) {
      fail(
        `${OWNER} exports FALLBACK_BOUNDS`,
        "another module could adopt the placeholder as the real bounds",
      );
    }
  }
}

// 2. The supersede path still runs, and runs before the first clamp that reads it.
let calledAt = -1;
for (const file of BOOT_FILES) {
  const source = readText(file);
  if (!source) {
    continue;
  }
  calledAt = source.indexOf("refreshSttTimeoutBounds(");
  if (calledAt === -1) {
    fail(
      `${file} never calls refreshSttTimeoutBounds`,
      "the fallback would stand for the whole session and drift from the Rust clamp",
    );
    continue;
  }
  const statement = source.slice(calledAt, source.indexOf(";", calledAt));
  if (!statement.includes(CLIENT_SYMBOL)) {
    fail(
      `the call in ${file} does not load the bounds over IPC`,
      "a stubbed loader makes the placeholder permanent while looking wired up",
    );
  }
  // A guard that cannot find what it orders against is not a passing guard.
  const hydrate = HYDRATE_CALL.exec(source);
  if (!hydrate) {
    fail(
      `${file} has no hydrate call for the refresh to precede`,
      "this check exists to pin that order, so it must be updated rather than skipped",
    );
  } else if (hydrate.index < calledAt) {
    fail(
      `the refresh in ${file} runs after the settings hydrate`,
      "that hydrate clamps stored values, so it would clamp against the fallback instead of the backend",
    );
  }
}

// 4b. No other module restates the bounds as literals.
for (const file of sourceFiles(resolve("src"))) {
  if (file === OWNER || /\.test\.tsx?$/.test(file)) {
    continue;
  }
  if (!/\.tsx?$/.test(file)) {
    continue;
  }
  const source = readFileSync(file, "utf8");
  for (const field of BOUNDS_FIELDS) {
    const literal = new RegExp(`${field}\\s*:\\s*-?\\d`);
    if (literal.test(source)) {
      fail(
        `${relative(process.cwd(), file)} restates ${field} as a literal`,
        "a second copy of the bounds is what this fallback must never become",
      );
      break;
    }
  }
}

if (failures.length > 0) {
  console.error("stt timeout fallback gate failed:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    "\nThe fallback in src/settings/stt-timeout-bounds.ts is a placeholder for the",
  );
  console.error("backend's answer, not a second definition of it.\n");
  process.exit(1);
}

console.log("[check:stt-timeout-fallback] backend bounds still supersede the TS fallback");
