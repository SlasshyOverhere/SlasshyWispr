/**
 * Which sherpa-onnx runtime DLLs an executable actually needs.
 *
 * The dependency is in the import table, so the loader resolves it before `main` — the app
 * cannot catch a missing DLL, and a hardcoded list silently rots the moment the linked
 * feature set changes. So the list is derived from the binary instead:
 *
 *   1. read the exe's import table,
 *   2. walk the closure through our own DLLs (a DLL's own imports are just as mandatory),
 *   3. keep only names the sherpa prebuilt cache can actually supply, since everything else
 *      is a system DLL that Windows provides.
 *
 * Measured on the shipped build: the exe imports `sherpa-onnx-c-api.dll` directly, which in
 * turn imports `onnxruntime.dll`. The C++ wrapper and the shared provider library are *not*
 * in that closure — we bind the C API and run the CPU provider, which is built in.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PE_SIGNATURES = { MZ: 0x5a4d, PE32: 0x10b, PE32_PLUS: 0x20b };

function importTable(path) {
  const buffer = readFileSync(path);
  if (buffer.length < 0x40 || buffer.readUInt16LE(0) !== PE_SIGNATURES.MZ) return [];

  const peOffset = buffer.readUInt32LE(0x3c);
  const magic = buffer.readUInt16LE(peOffset + 24);
  // The data-directory array sits at a different offset in PE32 and PE32+.
  const dataDirectory = peOffset + 24 + (magic === PE_SIGNATURES.PE32_PLUS ? 112 : 96);
  const importRva = buffer.readUInt32LE(dataDirectory + 8);
  if (importRva === 0) return [];

  const sectionCount = buffer.readUInt16LE(peOffset + 6);
  const optionalHeaderSize = buffer.readUInt16LE(peOffset + 20);
  const sections = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const offset = peOffset + 24 + optionalHeaderSize + index * 40;
    sections.push({
      virtualAddress: buffer.readUInt32LE(offset + 12),
      virtualSize: buffer.readUInt32LE(offset + 8),
      rawOffset: buffer.readUInt32LE(offset + 20),
    });
  }

  const toOffset = (rva) => {
    for (const section of sections) {
      if (rva >= section.virtualAddress && rva < section.virtualAddress + Math.max(section.virtualSize, 1)) {
        return rva - section.virtualAddress + section.rawOffset;
      }
    }
    return -1;
  };

  // Import descriptors are 20 bytes each; the table ends at an all-zero descriptor.
  const names = [];
  let descriptor = toOffset(importRva);
  while (descriptor > 0) {
    const nameRva = buffer.readUInt32LE(descriptor + 12);
    if (nameRva === 0) break;
    const nameOffset = toOffset(nameRva);
    if (nameOffset < 0) break;
    let end = nameOffset;
    while (end < buffer.length && buffer[end] !== 0) end += 1;
    names.push(buffer.toString("ascii", nameOffset, end));
    descriptor += 20;
  }
  return names;
}

/** Every DLL the sherpa prebuilt cache can supply, lowercased for case-insensitive matching. */
export function cachedDlls(cacheDir) {
  if (!existsSync(cacheDir)) return new Map();
  const found = new Map();
  for (const entry of readdirSync(cacheDir)) {
    if (entry.toLowerCase().endsWith(".dll")) found.set(entry.toLowerCase(), join(cacheDir, entry));
  }
  return found;
}

/**
 * The DLLs that must sit beside `exePath`: the import closure, restricted to what the cache
 * provides. Returns `{ required, scanned }` — `scanned` is every import seen, so a caller can
 * log why a name was classified as a system DLL.
 */
export function requiredSherpaDlls(exePath, cacheDir) {
  if (!existsSync(exePath)) {
    throw new Error(`cannot read ${exePath} to derive the sherpa-onnx runtime dependency set`);
  }

  const available = cachedDlls(cacheDir);
  const scanned = new Set();
  const root = importTable(exePath).filter((name) => available.has(name.toLowerCase()));
  const required = new Set(root);
  const queue = [...root];

  while (queue.length > 0) {
    const name = queue.shift();
    for (const dependency of importTable(available.get(name.toLowerCase()))) {
      scanned.add(dependency);
      const key = dependency.toLowerCase();
      if (!available.has(key) || required.has(dependency)) continue;
      required.add(dependency);
      queue.push(dependency);
    }
  }

  return { required: [...required].sort(), scanned: [...scanned].sort(), available };
}

/** The cache directory sherpa-onnx-sys populates, derived the same way its build script does. */
export function sherpaCacheDir(targetDir) {
  return join(targetDir, "sherpa-onnx-prebuilt");
}

/** Find the `lib` directory inside the cache, whatever version-stamped name it carries. */
export function sherpaCacheLibDir(cacheDir) {
  if (!existsSync(cacheDir)) return null;
  for (const entry of readdirSync(cacheDir)) {
    const lib = join(cacheDir, entry, "lib");
    if (existsSync(lib)) return lib;
  }
  return null;
}

/** The cargo profile directory, honouring an out-of-tree CARGO_TARGET_DIR. */
export function profileDir(srcTauriDir, profile) {
  const targetRoot = process.env.CARGO_TARGET_DIR?.trim() || join(srcTauriDir, "target");
  return { targetRoot, dir: join(targetRoot, profile) };
}
