/**
 * Gate: each TypeScript bounds fallback must stay a placeholder.
 *
 * The backend owns these numbers and answers them over IPC (`sttTimeoutBounds`,
 * `maxTokensBounds`). A fallback covers only the window before that answer
 * arrives, and the browser dev build, which has no backend. It is only honest
 * while something actually supersedes it — if that stops being true, the
 * TypeScript numbers quietly become a second source of truth that Rust clamps
 * against and the UI lies.
 *
 * Four ways that can happen, one check each, run per bounds set. This is a
 * static check because the failure is a missing wire, not a wrong value: with
 * the backend's bounds equal to the fallback today, no amount of comparing
 * numbers can tell them apart.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const STORE = resolve("src", "settings", "bounds-store.ts");
const BOOT_FILES = ["src/main.tsx"];
// Matches the call site whatever it is aliased to on import, and never the
// import line itself (which has no `await`).
const HYDRATE_CALL = /await\s+hydrateSettingsFromNativeStorage\w*\(/;

const SETS = [
  {
    name: "STT timeout",
    owner: "src/settings/stt-timeout-bounds.ts",
    refresh: "refreshSttTimeoutBounds",
    client: "ipcSttTimeoutBounds",
    fields: ["defaultSeconds", "minSeconds", "maxSeconds"],
  },
  {
    name: "max tokens",
    owner: "src/settings/max-tokens-bounds.ts",
    refresh: "refreshMaxTokensBounds",
    client: "ipcMaxTokensBounds",
    fields: ["defaultTokens", "minTokens", "maxTokens"],
  },
];

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

// 1. The shared store still adopts the backend's answer by design. One place,
// because both bounds sets must supersede their fallback the same way.
const store = readText(STORE);
if (store) {
  if (!store.includes("publish(normalize(await load()) ?? fallback)")) {
    fail(
      `${STORE} no longer adopts the loaded bounds`,
      "the fetch result would be discarded and every fallback would stand for the session",
    );
  }
  if (!/refresh:\s*async[\s\S]*?catch\s*\{/.test(store)) {
    fail(
      `${STORE} no longer keeps the fallback when the fetch fails`,
      "a backend that cannot answer cannot clamp either, so the pane must still render a range",
    );
  }
}

// 2. Each owner module is only a fallback plus a wiring, never the authority.
for (const set of SETS) {
  const owner = readText(set.owner);
  if (!owner) {
    continue;
  }
  if (!owner.includes("./bounds-store")) {
    fail(
      `${set.owner} no longer uses the shared bounds store`,
      "hand-rolling the supersede rule is how the fallback becomes the authority again",
    );
  }
  if (!owner.includes(`${set.refresh} = store.refresh`)) {
    fail(
      `${set.owner} no longer exports ${set.refresh} wired to that store`,
      "nothing can replace the fallback, so the TypeScript numbers are the authority",
    );
  }
  for (const line of owner.split("\n")) {
    if (line.includes("export") && line.includes("FALLBACK_BOUNDS")) {
      fail(
        `${set.owner} exports FALLBACK_BOUNDS`,
        "another module could adopt the placeholder as the real bounds",
      );
    }
  }
}

// 3. The supersede path still runs, and runs before the first clamp that reads it.
for (const file of BOOT_FILES) {
  const source = readText(file);
  if (!source) {
    continue;
  }
  // A guard that cannot find what it orders against is not a passing guard.
  const hydrate = HYDRATE_CALL.exec(source);
  if (!hydrate) {
    fail(
      `${file} has no hydrate call for the refreshes to precede`,
      "this check exists to pin that order, so it must be updated rather than skipped",
    );
  }
  for (const set of SETS) {
    // Matches the call whatever it is aliased to on import. The client-symbol
    // check below is what proves it reaches IPC, not this pattern.
    const call = new RegExp(`\\b${set.refresh}\\w*\\(`).exec(source);
    if (!call) {
      fail(
        `${file} never calls ${set.refresh}`,
        `${set.name} would fall back to the TypeScript numbers and drift from the Rust clamp`,
      );
      continue;
    }
    const statement = source.slice(call.index, source.indexOf(";", call.index));
    if (!statement.includes(set.client)) {
      fail(
        `the ${set.refresh} call in ${file} does not load the bounds over IPC`,
        "a stubbed loader makes the placeholder permanent while looking wired up",
      );
    }
    if (hydrate && hydrate.index < call.index) {
      fail(
        `the ${set.refresh} call in ${file} runs after the settings hydrate`,
        "that hydrate clamps stored values, so it would clamp against the fallback instead of the backend",
      );
    }
  }
}

// 4. No other module restates the bounds as literals.
for (const file of sourceFiles(resolve("src"))) {
  if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) {
    continue;
  }
  if (SETS.some((set) => file === resolve(set.owner))) {
    continue;
  }
  const source = readFileSync(file, "utf8");
  for (const set of SETS) {
    const restated = set.fields.find((field) =>
      new RegExp(`${field}\\s*:\\s*-?\\d`).test(source),
    );
    if (restated) {
      fail(
        `${relative(process.cwd(), file)} restates ${restated} as a literal`,
        "a second copy of the bounds is what these fallbacks must never become",
      );
    }
  }
}

if (failures.length > 0) {
  console.error("backend bounds fallback gate failed:\n");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error(
    "\nThe bounds in src/settings/*-bounds.ts are placeholders for the backend's",
  );
  console.error("answers, not a second definition of them.\n");
  process.exit(1);
}

console.log(
  "[check:backend-bounds-fallbacks] backend bounds still supersede the TS fallbacks",
);
