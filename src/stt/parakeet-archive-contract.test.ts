/**
 * The contract between the repack script and the app's model-directory discovery.
 *
 * `scripts/repack-parakeet-unified-en.mjs` publishes the tar.gz that
 * `find_local_parakeet_model_root` has to accept. The two lists of filenames live in
 * different languages with no compiler between them, and a mismatch fails late and
 * confusingly: the download and the extraction both succeed, then loading reports
 * "no compatible local Parakeet model directory", which reads like a corrupt
 * download rather than a bad archive.
 *
 * The Rust side is parsed rather than restated, so adding a required file there
 * fails here instead of quietly producing archives the app will reject.
 *
 * Every parse is strict: anything this file cannot read is a failure, never a
 * skipped check. A guard whose pattern stops matching still reports success while
 * asserting nothing.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const REPACK_SCRIPT = "scripts/repack-parakeet-unified-en.mjs";
const ARCHIVE_RS = "src-tauri/src/pipeline/stt_download/archive.rs";

function sliceBetween(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  if (from === -1) throw new Error(`could not find ${start}`);
  const to = source.indexOf(end, from + start.length);
  if (to === -1) throw new Error(`could not find ${end} after ${start}`);
  return source.slice(from, to);
}

/** Files the packer writes into the archive. */
function packedFileNames(): string[] {
  const script = readFileSync(REPACK_SCRIPT, "utf8");
  const block = sliceBetween(script, "const REQUIRED_FILES = [", "\n];");
  const names = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]!);
  if (names.length === 0) throw new Error("parsed no filenames from REQUIRED_FILES");
  return names;
}

/** Files the packer stages on disk before packing. */
function stagedFileNames(): string[] {
  const script = readFileSync(REPACK_SCRIPT, "utf8");
  const block = sliceBetween(script, "const DOWNLOADS = [", "\n];");
  const locals = [...block.matchAll(/local:\s*"([^"]+)"/g)].map((match) => match[1]!);
  if (locals.length === 0) throw new Error("parsed no local names from DOWNLOADS");
  // Written separately, not downloaded.
  return [...locals, "config.json"];
}

/**
 * Files `is_parakeet_model_directory` insists on, grouped by the alternatives it
 * allows (an fp32 or an int8 encoder satisfies the encoder check).
 */
function requiredAlternatives(): string[][] {
  const rust = readFileSync(ARCHIVE_RS, "utf8");
  const body = sliceBetween(rust, "fn is_parakeet_model_directory", "\n}");
  const names = [...body.matchAll(/path\.join\("([^"]+)"\)/g)].map((match) => match[1]!);
  if (names.length === 0) throw new Error("parsed no filenames from archive.rs");

  const groups = new Map<string, string[]>();
  for (const name of names) {
    const family = name.startsWith("encoder")
      ? "encoder"
      : name.startsWith("decoder")
        ? "decoder"
        : name;
    groups.set(family, [...(groups.get(family) ?? []), name]);
  }
  return [...groups.values()];
}

describe("parakeet archive repack vs model-directory discovery", () => {
  it("stages exactly the files it packs", () => {
    expect(new Set(packedFileNames())).toEqual(new Set(stagedFileNames()));
  });

  it("packs at least one alternative for every file the app requires", () => {
    const packed = new Set(packedFileNames());
    const missing = requiredAlternatives().filter(
      (alternatives) => !alternatives.some((name) => packed.has(name)),
    );
    expect(missing).toEqual([]);
  });

  it("does not rely on the fp32 encoder or decoder", () => {
    // The archive is the int8 mirror; an fp32 file would multiply its size for no
    // gain, and the engine prefers int8 anyway.
    const packed = packedFileNames();
    expect(packed).not.toContain("encoder-model.onnx");
    expect(packed).not.toContain("decoder_joint-model.onnx");
  });
});
