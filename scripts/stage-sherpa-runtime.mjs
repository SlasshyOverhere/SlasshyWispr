#!/usr/bin/env node
/**
 * Stage the sherpa-onnx runtime DLLs for the installer.
 *
 * sherpa-onnx is linked in shared mode (the static archive is built /MT and collides with
 * our /MD ORT objects), so the exe has an import-table dependency on four DLLs. Its build
 * script copies them next to the cargo profile output, which is enough for `cargo run` and
 * `tauri dev` but invisible to the bundler — a shipped installer without them fails at
 * process start, before any Rust code runs.
 *
 * This copies them into `src-tauri/sherpa-runtime/`, which `tauri.conf.json` maps onto the
 * install root so the Windows loader finds them beside the exe. Wired as
 * `bundle.beforeBundleCommand`.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_TAURI = join(REPO_ROOT, "src-tauri");
const STAGING_DIR = join(SRC_TAURI, "sherpa-runtime");

/** The four files the linked configuration actually needs. DirectML.dll is not among them. */
const REQUIRED_DLLS = [
  "sherpa-onnx-c-api.dll",
  "sherpa-onnx-cxx-api.dll",
  "onnxruntime.dll",
  "onnxruntime_providers_shared.dll",
];

function profileDir() {
  const targetRoot =
    process.env.CARGO_TARGET_DIR?.trim() || join(SRC_TAURI, "target");
  // Release first — that is what a bundle build produces — then debug, so the script
  // can be exercised on a tree that has only been built once.
  const order = process.env.TAURI_ENV_DEBUG === "true" ? ["debug", "release"] : ["release", "debug"];
  const candidates = [...order.map((name) => join(targetRoot, name)), targetRoot];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, REQUIRED_DLLS[0]))) return candidate;
  }
  return candidates[0];
}

const profile = profileDir();
mkdirSync(STAGING_DIR, { recursive: true });

const missing = [];
for (const dll of REQUIRED_DLLS) {
  const source = join(profile, dll);
  if (!existsSync(source)) {
    missing.push(dll);
    continue;
  }
  copyFileSync(source, join(STAGING_DIR, dll));
}

if (missing.length > 0) {
  console.error(
    `[stage-sherpa-runtime] missing ${missing.join(", ")} in ${profile}.\n` +
      "Build the Rust crate first (cargo build --release); sherpa-onnx's build script copies\n" +
      "these out of its downloaded archive before the bundle step runs.",
  );
  process.exit(1);
}

console.log(
  `[stage-sherpa-runtime] staged ${readdirSync(STAGING_DIR).filter((name) => name.endsWith(".dll")).length} DLLs from ${profile}`,
);
