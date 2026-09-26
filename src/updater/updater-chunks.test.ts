/**
 * Bundle-split pin: vite.config.ts must keep vendor + analytics manualChunks
 * (Agent 3 owns React.lazy boundaries; this file pins the chunk half).
 */
import { describe, it, expect } from "bun:test";

describe("manualChunks vendor split", () => {
  it("declares vendor and analytics chunks in vite.config.ts", async () => {
    const source = await Bun.file("vite.config.ts").text();
    expect(source).toContain("manualChunks");
    expect(source).toContain('"vendor"');
    expect(source).toContain('"analytics"');
  });

  it("pins the VAD model to a commit SHA with a verified hash", async () => {
    const source = await Bun.file("src-tauri/src/constants.rs").text();
    expect(source).toMatch(/SILERO_VAD_PINNED_COMMIT: &str = "[0-9a-f]{40}"/);
    expect(source).toMatch(/SILERO_VAD_MODEL_EXPECTED_SHA256: &str =\s*"[0-9a-f]{64}"/);
    // The pinned builder must target the current upstream path, not the removed files/ one.
    const builder = source.match(/pub fn silero_vad_model_url\(\) -> String \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(builder).toContain("/src/silero_vad/data/silero_vad.onnx");
    expect(builder).not.toContain("/files/silero_vad.onnx");
  });
});
