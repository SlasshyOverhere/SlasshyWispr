#!/usr/bin/env node
/**
 * Find the build toolchain without trusting the shell we were launched from.
 *
 * Windows hands a process its PATH at launch and never re-reads it, so a terminal opened before
 * CMake was installed keeps failing with `is cmake not installed?` forever: no child process can
 * write into its parent's environment. the registry is still correct the whole time, so we read
 * it back and reconcile against it instead of believing the live PATH.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, join } from "node:path";

export const CMAKE_WINGET_ID = "Kitware.CMake";
// Pinned to the newest 3.x rather than left to the installer's default: CMake 4 is a
// major-version jump (raised compatibility floor, changed default policies) and nothing in this
// tree has been verified against it. `winget install Kitware.CMake` with no --version gets 4.4.3.
export const CMAKE_PINNED_VERSION = "3.31.8";

// What this tree actually requires: transcribe-cpp-sys asks for 3.16, ggml's Vulkan backend —
// which we build — for 3.19. No ceiling: 4.4.3 configures and compiles it clean.
export const CMAKE_MIN_VERSION = "3.19";

// Vars the Rust side reads that a stale shell can be missing even though the registry has them.
const REGISTRY_BACKED_VARS = ["VULKAN_SDK", "CARGO_HOME", "RUSTUP_HOME"];

const IS_WINDOWS = process.platform === "win32";
const CMAKE_EXE = IS_WINDOWS ? "cmake.exe" : "cmake";

/** Split a PATH-shaped string, tolerating the quoting and blank entries real PATHs contain. */
export function splitPath(value) {
  return String(value ?? "")
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

/** Rebuild a PATH with `prepend` first, dropping duplicates (case-insensitive on Windows). */
export function mergePath(current, prepend) {
  const seen = new Set();
  const out = [];
  for (const dir of [...prepend, ...splitPath(current)]) {
    const key = IS_WINDOWS ? dir.toLowerCase() : dir;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(dir);
  }
  return out.join(delimiter);
}

/** Set a var on a copied env without producing PATH/Path twins Windows then resolves twice. */
export function setEnv(target, key, value) {
  const existing = Object.keys(target).find((k) => k.toLowerCase() === key.toLowerCase());
  if (existing) target[existing] = value;
  else target[key] = value;
  return target;
}

/** Expand `%VAR%` references the registry stores unexpanded. */
export function expandValue(value, env) {
  return String(value ?? "").replace(/%([^%]+)%/g, (match, name) => env[name] ?? match);
}

export function parseCmakeVersion(text) {
  const match = /cmake version (\d+(?:\.\d+)+)/i.exec(String(text ?? ""));
  return match ? match[1] : null;
}

export function compareVersions(left, right) {
  const a = String(left).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = String(right).split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return 0;
}

function dirHasCmake(dir) {
  try {
    return statSync(join(dir, CMAKE_EXE)).isFile();
  } catch {
    return false;
  }
}

/**
 * One PowerShell call for everything we might need from the registry, because PowerShell startup
 * is the expensive part and a stale shell can be missing several things at once.
 */
function registrySnapshot(extraNames) {
  const nameList = extraNames.map((n) => `'${n}'`).join(",");
  const script = [
    `$m=[Environment]::GetEnvironmentVariable('Path','Machine')`,
    `$u=[Environment]::GetEnvironmentVariable('Path','User')`,
    `Write-Output ('PATH=' + $m + ';' + $u)`,
    `foreach($x in @(${nameList})){`,
    `  $v=[Environment]::GetEnvironmentVariable($x,'Machine')`,
    `  if(-not $v){ $v=[Environment]::GetEnvironmentVariable($x,'User') }`,
    `  if($v){ Write-Output ($x + '=' + $v) }`,
    `}`,
  ].join("\n");

  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  });

  const values = new Map();
  for (const line of String(result.stdout ?? "").split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    values.set(line.slice(0, at), line.slice(at + 1));
  }
  return values;
}

function knownCmakeDirs() {
  const roots = [
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  ].filter(Boolean);
  return [...new Set(roots.map((root) => join(root, "CMake", "bin")))];
}

/**
 * Resolve a CMake directory, falling back to the registry for shells launched before it was on
 * PATH. `allowRegistry: false` keeps the probe to a pure filesystem scan.
 */
export function findCmakeDir({ allowRegistry = true } = {}) {
  const live = splitPath(process.env.PATH);
  const fromLive = live.find(dirHasCmake);
  if (fromLive) return { dir: fromLive, source: "path" };
  if (!IS_WINDOWS || !allowRegistry) return null;

  const snapshot = registrySnapshot([]);
  const registryPath = expandAll(splitPath(snapshot.get("PATH")), snapshot);
  const fromRegistry = registryPath.find(dirHasCmake);
  if (fromRegistry) return { dir: fromRegistry, source: "registry" };

  const fromKnown = knownCmakeDirs().find(dirHasCmake);
  return fromKnown ? { dir: fromKnown, source: "known location" } : null;
}

/** Registry PATH entries are stored unexpanded, so `%LOCALAPPDATA%` has to be resolved first. */
function expandAll(entries, snapshot) {
  const vars = { ...process.env, ...Object.fromEntries(snapshot) };
  return entries.map((entry) => expandValue(entry, vars));
}

export function cmakeVersion(dir) {
  const exe = join(dir, CMAKE_EXE);
  const result = spawnSync(`"${exe}" --version`, { shell: true, encoding: "utf8", windowsHide: true });
  return parseCmakeVersion(result.stdout);
}

/**
 * Build an environment this shell does not deserve: keep what is already right, restore from the
 * registry what the live env is missing, and say out loud what was repaired.
 */
export function reconciledEnv(base = process.env) {
  const env = { ...base };
  const notes = [];

  const liveCmake = splitPath(base.PATH).find(dirHasCmake) ?? null;
  const missingVars = REGISTRY_BACKED_VARS.filter((name) => !base[name]);

  if (liveCmake && missingVars.length === 0) {
    return { env, notes, cmakeDir: liveCmake };
  }

  const snapshot = registrySnapshot(missingVars);
  let cmakeDir = liveCmake;

  if (!cmakeDir) {
    const registryPath = expandAll(splitPath(snapshot.get("PATH")), snapshot);
    cmakeDir = registryPath.find(dirHasCmake) ?? knownCmakeDirs().find(dirHasCmake) ?? null;
    if (cmakeDir) {
      setEnv(env, "PATH", mergePath(base.PATH, [cmakeDir]));
      const source = registryPath.includes(cmakeDir) ? "the registry PATH" : "a known install location";
      notes.push(`cmake is not on this shell's PATH; restored from ${source}: ${cmakeDir}`);
    }
  }

  for (const name of missingVars) {
    const value = snapshot.get(name);
    if (value) {
      setEnv(env, name, value);
      notes.push(`${name} was not in this shell's environment; restored from the registry`);
    }
  }

  return { env, notes, cmakeDir };
}
