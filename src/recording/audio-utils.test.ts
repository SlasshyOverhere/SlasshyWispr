import { describe, expect, it } from "bun:test";
import { base64ToBytes, isSilentSamples, NO_SIGNAL_PEAK, peakAmplitude } from "./audio-utils";

describe("no-signal detection", () => {
  it("reports a muted or dead device as silent", () => {
    expect(isSilentSamples(new Float32Array(4800))).toBe(true);
    expect(isSilentSamples(new Float32Array([0, 0, 1e-6, -1e-6]))).toBe(true);
  });

  it("keeps quiet speech", () => {
    expect(isSilentSamples(new Float32Array([0, 0.02, -0.03, 0.01]))).toBe(false);
  });

  it("treats the peak, not the average, as the signal", () => {
    // One loud sample in an otherwise quiet clip is speech, not silence.
    const samples = new Float32Array(10_000);
    samples[4_321] = 0.4;
    expect(peakAmplitude(samples)).toBeCloseTo(0.4, 6);
    expect(isSilentSamples(samples)).toBe(false);
  });

  it("puts the line below any audible level", () => {
    expect(NO_SIGNAL_PEAK).toBeLessThan(0.01);
  });
});

describe("base64ToBytes", () => {
  it("decodes back to the original bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const base64 = btoa(String.fromCharCode(...bytes));
    expect(Array.from(base64ToBytes(base64))).toEqual(Array.from(bytes));
  });

  it("returns an empty array for empty input", () => {
    expect(base64ToBytes("").length).toBe(0);
  });

  it("handles a payload larger than the argument-spread limit", () => {
    const bytes = new Uint8Array(70_000).fill(7);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    const decoded = base64ToBytes(btoa(binary));
    expect(decoded.length).toBe(bytes.length);
    expect(decoded[69_999]).toBe(7);
  });
});

describe("native capture PCM payload", () => {
  // Contract with the Rust side (`audio::capture::encode_capture_payload`):
  // [sample_rate: u32 LE][samples: f32 LE...]. A mismatch here would reach the
  // STT stage as noise rather than fail loudly, so pin the layout.
  it("reads the sample rate from the first four little-endian bytes", () => {
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, 16_000, true);
    const payload = new Uint8Array([...header, ...new Uint8Array([0, 0, 128, 63])]);

    const decoded = base64ToBytes(btoa(String.fromCharCode(...payload)));
    const view = new DataView(decoded.buffer);
    expect(view.getUint32(0, true)).toBe(16_000);
    expect(view.getFloat32(4, true)).toBeCloseTo(1.0, 6);
    expect(decoded.length).toBe(4 + 4);
  });
});
