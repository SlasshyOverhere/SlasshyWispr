#!/usr/bin/env node
/**
 * Stage the sherpa-onnx runtime DLLs the installer has to ship.
 *
 * sherpa-onnx is linked in shared mode — the static archive is built /MT and collides with our
 * /MD ORT objects — so the exe has a hard import-table dependency on its C API, which in turn
 * needs onnxruntime. sherpa's build script copies those beside the cargo profile output, which
 * covers `cargo run` and `tauri dev` but is invisible to the bundler: an installer without them
 * fails at process start, before any Rust code runs, with only a Windows loader dialog to show
 * for it.
 *
 * This copies exactly the needed set into `src-tauri/sherpa-runtime/`, which `tauri.conf.json`
 * maps onto the install root so the Windows loader finds them beside the exe. Wired as
 * `bundle.beforeBundleCommand`, so a failure here aborts the bundle rather than shipping it.
 *
 * The resource entry names that directory rather than globbing `*.dll`: a glob is resolved by
 * Tauri's build script, which errors when it matches nothing, and then `cargo check`, `cargo
 * test` and `tauri dev` all fail on any tree where nothing has been staged yet. The directory
 * is tracked with a `.gitkeep` for the same reason.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
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

const profile = process.env.TAURI_ENV_DEBUG === "true" ? "debug" : "release";
const { targetRoot, dir: profilePath } = profileDir(SRC_TAURI, profile);
const exe = join(profilePath, "app.exe");

function fail(message) {
  console.error(`[stage-sherpa-runtime] ${message}`);
  process.exit(1);
}

if (!existsSync(exe)) {
  fail(
    `no ${exe} to inspect.\n` +
      "The dependency set is derived from the built binary, so the Rust crate has to be built\n" +
      "before the bundle step runs.",
  );
}

const cacheLib = sherpaCacheLibDir(sherpaCacheDir(targetRoot));
if (!cacheLib) {
  fail("no sherpa-onnx prebuilt cache found; build the Rust crate first so the DLLs are on disk.");
}

let required;
try {
  ({ required } = requiredSherpaDlls(exe, cacheLib));
} catch (error) {
  fail(error.message);
}

if (required.length === 0) {
  fail(
    `${exe} imports no sherpa-onnx DLL.\n` +
      "Either the crate lost its shared-mode feature or the exe is stale; bundling now would\n" +
      "ship an installer whose runtime cannot load its model.",
  );
}

// Rebuild the directory from scratch: a leftover file from an earlier feature set would be
// bundled as dead weight at best, and as a stale version of a live dependency at worst.
rmSync(STAGING_DIR, { recursive: true, force: true });
mkdirSync(STAGING_DIR, { recursive: true });

let stagedBytes = 0;
for (const dll of required) {
  const source = join(cacheLib, dll);
  if (!existsSync(source)) {
    fail(`${dll} is imported by the exe but missing from ${cacheLib}.`);
  }
  copyFileSync(source, join(STAGING_DIR, dll));
  stagedBytes += statSync(source).size;
}

console.log(
  `[stage-sherpa-runtime] staged ${required.length} DLL(s), ${(stagedBytes / 1048576).toFixed(1)} MiB ` +
    `from ${cacheLib}: ${required.join(", ")}`,
);
