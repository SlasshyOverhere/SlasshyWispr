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

  it("pins the VAD commit SHA where the downloader reads it (no raw master)", async () => {
    // The pin is a compiled constant, and ensure_vad_model reads it from here.
    // Asserting it anywhere else would pass while the download stayed unpinned.
    const source = await Bun.file("src-tauri/src/constants.rs").text();
    expect(source).toContain("60b7ffa243625ebdc1070275a29f18c87843786a");

    const download = await Bun.file("src-tauri/src/audio/vad.rs").text();
    expect(download).toContain("silero_vad_model_url()");
    expect(download).not.toContain("SILERO_VAD_MODEL_URL");
  });
});
