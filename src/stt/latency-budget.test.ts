/**
 * Latency-budget thin slice: pins formatStageTimings + explainWhySlow
 * (your surfaces only; Agent 2 owns pipeline-render.ts).
 */
import { describe, it, expect, mock } from "bun:test";

mock.module("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(null),
}));

// Import after the mock so IPC wrappers bind the stub.
const { explainWhySlow, formatStageTimings } = await import("./local-stt-diagnostics");
const { describeTtsLatency } = await import("../tts/tts-client");
const { formatLocalSttCatalogLabel } = await import("../shell/model-catalogs");

describe("formatStageTimings", () => {
  it("renders per-stage ms in one line", () => {
    expect(formatStageTimings({ sttMs: 412, aiMs: 1830, ttsMs: 305, totalMs: 2547 })).toBe(
      "STT 412ms / AI 1830ms / TTS 305ms (total 2547ms)",
    );
  });

  it("marks missing stages n/a", () => {
    expect(formatStageTimings({})).toBe("STT n/a / AI n/a / TTS n/a");
  });
});

describe("explainWhySlow", () => {
  it("names the slowest stage", () => {
    expect(explainWhySlow({ sttMs: 300, aiMs: 5000, ttsMs: 200 })).toContain("AI");
  });

  it("reports fast when every stage is under budget", () => {
    expect(explainWhySlow({ sttMs: 100, aiMs: 200, ttsMs: 150 })).toContain("fast");
  });

  it("asks for a first run when no timings exist", () => {
    expect(explainWhySlow({})).toContain("No timing data");
  });
});

describe("describeTtsLatency", () => {
  it("labels Piper as the local engine", () => {
    expect(describeTtsLatency(305)).toBe("TTS 305ms (Piper, local)");
    expect(describeTtsLatency(undefined)).toBe("TTS n/a");
  });
});

describe("formatLocalSttCatalogLabel", () => {
  it("carries size label plus download state", () => {
    expect(formatLocalSttCatalogLabel("nvidia/parakeet-tdt-0.6b-v3", true)).toContain("478 MB");
    expect(formatLocalSttCatalogLabel("nvidia/parakeet-tdt-0.6b-v3", true)).toContain("downloaded");
    expect(formatLocalSttCatalogLabel("nvidia/parakeet-tdt-0.6b-v3", false)).toContain("not downloaded");
  });
});
