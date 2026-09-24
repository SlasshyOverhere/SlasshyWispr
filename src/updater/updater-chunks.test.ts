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

  it("pins the VAD commit SHA in the verify helper (no raw master)", async () => {
    const source = await Bun.file("src-tauri/src/pipeline/stt_download/verify.rs").text();
    expect(source).toContain("60b7ffa243625ebdc1070275a29f18c87843786a");
    expect(source).not.toContain("raw/master");
  });
});
