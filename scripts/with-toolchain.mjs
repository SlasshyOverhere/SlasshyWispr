#!/usr/bin/env node
/**
 * Run a command with the toolchain this shell may not have.
 *
 * This has to be a wrapper that spawns the child, not a `pre` hook: npm runs `pretauri:dev` as a
 * *sibling* process, so whatever it puts in its own environment the real `tauri:dev` never sees.
 * Repairing here means a terminal opened before CMake was installed still works, with no restart.
 */
import { spawnSync } from "node:child_process";

import { reconciledEnv } from "./toolchain.mjs";

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("[with-toolchain] usage: node scripts/with-toolchain.mjs <command> [...args]");
  process.exit(2);
}

const { env, notes, cmakeDir } = reconciledEnv(process.env);
for (const note of notes) {
  console.error(`[with-toolchain] ${note}`);
}

if (!cmakeDir) {
  console.error("[with-toolchain] cmake is not on PATH, in the registry, or in Program Files.");
  console.error("[with-toolchain] run `npm run setup` to install it.");
  process.exit(1);
}

// Quote only the tokens that need it; everything else stays byte-for-byte so cmd.exe sees the
// same argv npm would have built.
const command = args.map((token) => (/[\s"]/.test(token) ? `"${token.replace(/"/g, '""')}"` : token)).join(" ");

const result = spawnSync(command, { shell: true, env, stdio: "inherit" });
if (result.error) {
  console.error(`[with-toolchain] failed to start: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
