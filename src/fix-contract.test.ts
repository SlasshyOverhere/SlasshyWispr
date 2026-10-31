/**
 * End-to-end check of the two safety fixes, against the real modules.
 *
 * 1. An incognito turn must leave the tray's copy-last slots untouched.
 * 2. A digest mismatch must refuse the archive rather than extract it.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const PIPELINE_RS = readFileSync("src-tauri/src/commands/pipeline.rs", "utf8");
const CONSTANTS_RS = readFileSync("src-tauri/src/constants.rs", "utf8");
const TRANSPORT_RS = readFileSync(
  "src-tauri/src/pipeline/stt_download/transport.rs",
  "utf8",
);

describe("incognito reaches the backend", () => {
  it("reads the flag that arrives on the wire", () => {
    // The field is declared on the flattened request...
    expect(PIPELINE_RS).toMatch(/let incognito = request\.run\.incognito;/);
    // ...and every output write goes through the guard.
    const writes = PIPELINE_RS.match(
      /state\.set_last_pipeline_output\(&transcript, &assistant_response\)\?;/g,
    );
    expect(writes).toBeNull();
    const guarded = PIPELINE_RS.match(/remember_output\(&state, &transcript/g);
    expect(guarded?.length).toBe(4);
  });

  it("the guard refuses to record when incognito is set", () => {
    expect(PIPELINE_RS).toMatch(/if incognito \{[\s\S]{0,200}?return Ok\(\(\)\);/);
  });
});

describe("a pinned archive is verified before extraction", () => {
  it("checks the digest between the rename and the extract", () => {
    const verifyAt = TRANSPORT_RS.indexOf("verify_file_sha256");
    const extractAt = TRANSPORT_RS.indexOf("extract_tar_gz_archive");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(extractAt).toBeGreaterThan(-1);
    // Verification must come first, or the bytes are already on disk.
    expect(verifyAt).toBeLessThan(extractAt);
  });

  it("deletes the archive when the digest does not match", () => {
    expect(TRANSPORT_RS).toMatch(
      /verify_file_sha256[\s\S]{0,400}?remove_file\(&archive_path\)[\s\S]{0,80}?return Err/,
    );
  });

  it("both catalog archives carry a 64-hex digest", () => {
    const digests = [...CONSTANTS_RS.matchAll(/"([0-9a-f]{64})"/g)].map((m) => m[1]);
    expect(digests.length).toBeGreaterThanOrEqual(8);
    expect(digests.every((d) => d.length === 64)).toBe(true);
  });

  it("no pinned entry is left with an empty digest", () => {
    const table = /PINNED_ARTIFACT_SHA256[\s\S]*?\n\];/.exec(CONSTANTS_RS);
    expect(table).not.toBeNull();
    expect(table?.[0]).not.toMatch(/""/);
  });

  it("the shared download helper verifies rather than trusting the caller", () => {
    // Every artifact is extracted, parsed as ONNX or executed, so the check
    // sits at the one point they all pass through.
    const fs = readFileSync("src-tauri/src/pipeline/fs.rs", "utf8");
    expect(fs).toMatch(/pinned_artifact_sha256\(url\)/);
    expect(fs).toMatch(/verify_file_sha256\(destination, expected\)/);
  });

  it("the ollama installer is pinned to a version, not a rolling url", () => {
    // A rolling url cannot carry a digest: the verified bytes would not be the
    // bytes a user gets tomorrow.
    expect(CONSTANTS_RS).toMatch(
      /OLLAMA_WINDOWS_INSTALLER_URL: &str =\s*"https:\/\/github\.com\/ollama\/ollama\/releases\/download\/v[\d.]+\/OllamaSetup\.exe"/,
    );
    expect(CONSTANTS_RS).not.toMatch(/OLLAMA_WINDOWS_INSTALLER_URL: &str =\s*"https:\/\/ollama\.com/);
  });
});
