#!/usr/bin/env node
/**
 * Compute SHA-256 for the third-party artifacts we download, so they can be
 * pinned in constants.rs. Run once per upstream release; the values are pasted
 * into the digest tables and then verified by scripts/verify-pinned-digests.mjs.
 *
 * Usage: node scripts/compute-pinned-digests.mjs
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const TARGETS = [
  ["PIPER_WINDOWS_AMD64", "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"],
  ["OLLAMA_WINDOWS_INSTALLER", "https://github.com/ollama/ollama/releases/download/v0.34.4/OllamaSetup.exe"],
  ["VOICE_CLONE_ARCHIVE", "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-zipvoice-distill-int8-zh-en-emilia.tar.bz2"],
  ["VOICE_CLONE_VOCODER", "https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx"],
  ["VOICE_MODEL", "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx"],
  ["VOICE_CONFIG", "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json"],
];

const dir = await mkdtemp(join(tmpdir(), "sw-digests-"));
const results = [];

for (const [name, url] of TARGETS) {
  process.stdout.write(`${name} ... `);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    results.push({ name, url, error: `HTTP ${response.status}` });
    console.log(`HTTP ${response.status}`);
    continue;
  }
  const path = join(dir, name);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(path));
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  await pipeline(createReadStream(path), hash);
  const digest = hash.digest("hex");
  const { statSync } = await import("node:fs");
  results.push({ name, url, bytes: statSync(path).size, sha256: digest });
  console.log(`${digest}  (${(statSync(path).size / 1048576).toFixed(1)} MiB)`);
}

await rm(dir, { recursive: true, force: true });

console.log("\n--- paste into src-tauri/src/constants.rs ---");
for (const entry of results) {
  if (entry.error) {
    console.log(`// ${entry.name}: ${entry.error}`);
  } else {
    console.log(`    (\n        ${entry.name},\n        "${entry.sha256}",\n    ),`);
  }
}
