import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const isWindows = process.platform === "win32";
if (!isWindows) {
  process.exit(0);
}

const exePath = resolve("src-tauri", "target", "debug", "app.exe");
const pdbPath = resolve("src-tauri", "target", "debug", "app.pdb");

function isLikelyValidPeExecutable(path) {
  if (!existsSync(path)) {
    return true;
  }

  const statSample = readFileSync(path);
  if (statSample.length < 0x40) {
    return false;
  }

  if (statSample[0] !== 0x4d || statSample[1] !== 0x5a) {
    return false;
  }

  const peOffset = statSample.readUInt32LE(0x3c);
  if (peOffset <= 0 || peOffset + 6 >= statSample.length) {
    return false;
  }

  const pe0 = statSample[peOffset];
  const pe1 = statSample[peOffset + 1];
  const pe2 = statSample[peOffset + 2];
  const pe3 = statSample[peOffset + 3];
  if (pe0 !== 0x50 || pe1 !== 0x45 || pe2 !== 0x00 || pe3 !== 0x00) {
    return false;
  }

  const machine = statSample.readUInt16LE(peOffset + 4);
  const knownMachine = machine === 0x014c || machine === 0x8664 || machine === 0xaa64 || machine === 0x01c0;
  if (!knownMachine) {
    return false;
  }

  return true;
}

function safeDelete(path) {
  if (!existsSync(path)) {
    return;
  }
  try {
    unlinkSync(path);
  } catch {
    // Ignore cleanup failures and let cargo report any follow-up error.
  }
}

if (!isLikelyValidPeExecutable(exePath)) {
  console.warn("[tauri:dev] Detected invalid/corrupted app.exe. Removing stale dev binary so cargo can rebuild it.");
  safeDelete(exePath);
  safeDelete(pdbPath);
}
