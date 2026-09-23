#!/usr/bin/env node
/**
 * Verify the toolchain, installing CMake if it is missing.
 *
 * Every check reports what it found rather than a bare pass/fail, because the failure mode that
 * prompted this is a shell that simply does not see an installed tool. Nothing is installed
 * without being shown first, and a non-interactive run prints the command instead of hanging on a
 * prompt it cannot answer.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";

import {
  CMAKE_MIN_VERSION,
  CMAKE_PINNED_VERSION,
  CMAKE_WINGET_ID,
  cmakeVersion,
  compareVersions,
  findCmakeDir,
} from "./toolchain.mjs";

function probe(command) {
  const result = spawnSync(command, { shell: true, encoding: "utf8", windowsHide: true });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0 || result.error) return { ok: false, detail: text.trim().split(/\r?\n/)[0] };
  return { ok: true, detail: text.trim().split(/\r?\n/)[0] };
}

function detectMsvc() {
  const roots = [process.env["ProgramFiles(x86)"], "C:\\Program Files (x86)"].filter(Boolean);
  const vswhere = roots.map((root) => `${root}\\Microsoft Visual Studio\\Installer\\vswhere.exe`).find(existsSync);
  if (!vswhere) return { ok: false, detail: "vswhere.exe not found; install the VS 2022 Build Tools" };

  // -products '*' is required: without it vswhere only matches full VS and reports nothing here.
  const run = (extra) =>
    spawnSync(`"${vswhere}" -products * -latest ${extra}`, { shell: true, encoding: "utf8", windowsHide: true });
  const name = run("-property displayName").stdout?.trim();
  const version = run("-property installationVersion").stdout?.trim();
  if (!name) return { ok: false, detail: "no VS installation visible to vswhere (-products '*')" };
  return { ok: true, detail: `${name} ${version ?? ""}`.trim() };
}

function detectVulkanSdk() {
  const live = process.env.VULKAN_SDK;
  if (live) {
    return existsSync(live)
      ? { ok: true, detail: live }
      : { ok: false, detail: `VULKAN_SDK points at a missing directory: ${live}` };
  }
  return {
    ok: false,
    detail: "VULKAN_SDK unset (native Whisper needs the LunarG Vulkan SDK; set it to its install dir)",
  };
}

function detectCmake() {
  const found = findCmakeDir();
  if (!found) return { ok: false, needsInstall: true, detail: "not found" };

  const version = cmakeVersion(found.dir);
  if (!version) return { ok: false, detail: `found at ${found.dir} but it would not report a version` };

  const detail = `${version} (${found.source})`;
  if (compareVersions(version, CMAKE_MIN_VERSION) < 0) {
    return { ok: false, needsInstall: true, detail: `${detail} is older than the required ${CMAKE_MIN_VERSION}` };
  }
  return { ok: true, detail, version };
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^(y|yes)$/i.test(answer.trim());
}

function installCmake() {
  const command =
    `winget install --id ${CMAKE_WINGET_ID} --exact --version ${CMAKE_PINNED_VERSION} ` +
    "--accept-package-agreements --accept-source-agreements --silent";
  console.log(`[setup] running:\n  ${command}`);
  const result = spawnSync(command, { shell: true, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`[setup] winget exited ${result.status}. Install CMake ${CMAKE_PINNED_VERSION} manually, then re-run.`);
    return false;
  }
  return true;
}

const width = Math.max(...["Node.js", "npm", "bun", "Rust", "cargo", "MSVC", "Vulkan SDK", "CMake"].map((s) => s.length));
let failed = 0;
const results = [];

function record(label, state) {
  const tag = state.ok ? (state.fixed ? "fixed " : "ok   ") : "FAIL ";
  results.push(`${tag}${label.padEnd(width)}  ${state.detail ?? ""}`);
  if (!state.ok) failed += 1;
}

record("Node.js", { ok: Boolean(process.version), detail: process.version });
record("npm", probe("npm --version"));
record("bun", probe("bun --version"));
record("Rust", probe("rustc --version"));
record("cargo", probe("cargo --version"));
record("MSVC", detectMsvc());
record("Vulkan SDK", detectVulkanSdk());

const cmake = detectCmake();
if (!cmake.ok && cmake.needsInstall) {
  const reason = cmake.detail === "not found" ? "CMake is not installed" : `CMake is too old (${cmake.detail})`;
  console.log(`[setup] ${reason}.`);
  const proceed = await confirm(`Install CMake ${CMAKE_PINNED_VERSION} (pinned) with winget?`);
  if (proceed && installCmake()) {
    const after = detectCmake();
    record("CMake", { ok: after.ok, fixed: after.ok, detail: after.detail });
  } else if (!process.stdin.isTTY) {
    console.log(
      `[setup] non-interactive session, so nothing was installed. Run this yourself:\n` +
        `  winget install --id ${CMAKE_WINGET_ID} --exact --version ${CMAKE_PINNED_VERSION} ` +
        "--accept-package-agreements --accept-source-agreements --silent",
    );
    record("CMake", { ok: false, detail: `${cmake.detail} (not installed: needs confirmation)` });
  } else {
    record("CMake", { ok: false, detail: `${cmake.detail} (install declined)` });
  }
} else {
  record("CMake", cmake);
}

console.log("[setup] toolchain:");
for (const line of results) console.log(`[setup]   ${line}`);

if (failed > 0) {
  console.error(`[setup] ${failed} requirement(s) missing, see above.`);
  process.exit(1);
}

console.log("[setup] all requirements present.");
console.log(
  "[setup] if this shell was open while CMake was installed, its PATH is still stale. " +
    "`npm run tauri:dev` and `npm run tauri:build` repair that themselves, so no restart is needed.",
);
