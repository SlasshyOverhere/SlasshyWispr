#!/usr/bin/env node
/**
 * Verify the configured bundle would actually put the sherpa-onnx runtime next to the exe.
 *
 * `bundle.resources` is a glob, and a glob that matches nothing is not an error — Tauri bundles
 * the app without the files and the installer looks fine until a user double-clicks it. So the
 * three things that have to agree are checked here, against each other rather than by hand:
 *
 *   1. what the built exe imports (read from its import table),
 *   2. what `beforeBundleCommand` staged for the bundler,
 *   3. what `bundle.resources` says it will pick up, mapped onto the install root.
 *
 * Runs after `tauri build`; `npm run tauri:build` chains it so a release cannot skip it.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  profileDir,
  requiredSherpaDlls,
  sherpaCacheDir,
  sherpaCacheLibDir,
} from "./sherpa-runtime-closure.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_TAURI = join(REPO_ROOT, "src-tauri");
const STAGING_DIR = join(SRC_TAURI, "sherpa-runtime");
const CONFIG = join(SRC_TAURI, "tauri.conf.json");

const problems = [];

const config = JSON.parse(readFileSync(CONFIG, "utf8").replace(/^\uFEFF/, ""));
const resources = config.bundle?.resources ?? [];
// Only the map form can place files at the install root, which is what the loader searches.
const rootMap =
  !Array.isArray(resources) && typeof resources === "object"
    ? Object.entries(resources).find(([, target]) => target === "." || target === "")
    : undefined;

if (!rootMap) {
  problems.push(
    "bundle.resources has no entry mapping DLLs onto the install root (target \".\"); " +
      "resources in a subdirectory are not on the exe's DLL search path.",
  );
} else if (!rootMap[0].includes("sherpa-runtime/")) {
  problems.push(
    `bundle.resources maps "${rootMap[0]}" onto the install root, which is not where ` +
      "stage-sherpa-runtime.mjs writes.",
  );
}

if (config.build?.beforeBundleCommand?.includes("stage-sherpa-runtime")) {
  // present as intended
} else {
  problems.push("build.beforeBundleCommand does not run stage-sherpa-runtime.mjs, so nothing stages the DLLs.");
}

const profile = process.env.TAURI_ENV_DEBUG === "true" ? "debug" : "release";
const { targetRoot, dir: profilePath } = profileDir(SRC_TAURI, profile);
const exe = join(profilePath, "app.exe");

if (!existsSync(exe)) {
  problems.push(`no ${profile} binary at ${exe}; build before verifying.`);
} else {
  const cacheLib = sherpaCacheLibDir(sherpaCacheDir(targetRoot));
  if (!cacheLib) {
    problems.push("no sherpa-onnx prebuilt cache; cannot derive the expected dependency set.");
  } else {
    const { required } = requiredSherpaDlls(exe, cacheLib);
    const staged = existsSync(STAGING_DIR)
      ? readdirSync(STAGING_DIR).filter((name) => name.toLowerCase().endsWith(".dll"))
      : [];

    for (const dll of required) {
      if (!staged.some((name) => name.toLowerCase() === dll.toLowerCase())) {
        problems.push(`${dll} is imported by the exe but not staged in src-tauri/sherpa-runtime/.`);
      }
    }
    for (const name of staged) {
      if (!required.some((dll) => dll.toLowerCase() === name.toLowerCase())) {
        problems.push(`${name} is staged but nothing imports it; it would ship as dead weight.`);
      }
    }

    if (problems.length === 0) {
      console.log(
        `[verify-sherpa-bundle] ${required.join(", ")} resolved from the exe's import table, ` +
          "staged, and mapped onto the install root",
      );
    }
  }
}

if (problems.length > 0) {
  console.error("[verify-sherpa-bundle] the bundle would not run on a clean machine:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
