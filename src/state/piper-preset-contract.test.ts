/**
 * The Piper voice-preset contract, across all three places it is stated.
 *
 * `piperQuality` and `piperEmotion` are declared four times: the TypeScript
 * union, the settings dropdown, the Rust settings validator, and the match in
 * `pipeline/tts/piper.rs` that turns them into synthesis arguments. They have
 * no compiler between them, and they drifted once: the dropdown offered
 * "balanced", the union typed it, the backend accepted it and honoured it, and
 * `asPiperQuality` rejected it — so picking Balanced silently stored "fast".
 *
 * The Rust sources are parsed here so a preset cannot be added to one side only.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import type { PiperEmotion, PiperQuality } from "../types";
import { asPiperEmotion, asPiperQuality, defaultSettings } from "./settings-store";

const RUST_SETTINGS = "src-tauri/src/commands/settings.rs";
const RUST_PIPER = "src-tauri/src/pipeline/tts/piper.rs";
const QUALITY_PANE = "src/components/settings/ModelsSettingsPane.tsx";

function readSource(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`piper preset contract cannot read ${path}`);
  }
}

/** The quoted values of an `allowed("<field>", &[...])?` entry in the Rust validator. */
function rustAllowedValues(field: string): string[] {
  const source = readSource(RUST_SETTINGS);
  // rustfmt wraps the longer lists, so the field name and the array can be
  // several lines apart.
  const match = new RegExp(`allowed\\(\\s*"${field}",\\s*&\\[([^\\]]*)\\]`).exec(source);
  if (!match) {
    throw new Error(`no allowed("${field}", &[...]) in ${RUST_SETTINGS}`);
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

/** The `<option value="...">` values of a `<select id="...">` in the settings pane. */
function paneOptions(selectId: string): string[] {
  const source = readSource(QUALITY_PANE);
  const select = new RegExp(`<select id="${selectId}"[\\s\\S]*?</select>`).exec(source);
  if (!select) {
    throw new Error(`no <select id="${selectId}"> in ${QUALITY_PANE}`);
  }
  return [...select[0].matchAll(/<option value="([^"]*)"/g)].map((entry) => entry[1]);
}

const QUALITIES: PiperQuality[] = ["fast", "balanced", "high"];
const EMOTIONS: PiperEmotion[] = ["neutral", "calm", "happy", "excited", "serious", "sad"];

describe("piperQuality", () => {
  it("round-trips every value the dropdown offers", () => {
    for (const quality of paneOptions("piperQualitySelect")) {
      expect(asPiperQuality(quality)).toBe(quality);
    }
  });

  it("offers exactly the union the types declare", () => {
    expect([...paneOptions("piperQualitySelect")].sort()).toEqual([...QUALITIES].sort());
  });

  it("agrees with the backend validator", () => {
    expect([...rustAllowedValues("piperQuality")].sort()).toEqual([...QUALITIES].sort());
  });

  it("agrees with the synthesis match in piper.rs", () => {
    // The match arms name the presets it scales for; the rest fall to the default.
    const match = /match quality\.as_str\(\)\s*\{([\s\S]*?)\n    \}/.exec(readSource(RUST_PIPER));
    if (!match) {
      throw new Error(`no quality match in ${RUST_PIPER}`);
    }
    const named = [...match[1].matchAll(/"([a-z]+)"\s*=>/g)].map((entry) => entry[1]);
    for (const quality of named) {
      expect(asPiperQuality(quality)).toBe(quality);
    }
  });

  it("falls back only for a value the UI cannot produce", () => {
    expect(asPiperQuality("nonsense")).toBe(defaultSettings().piperQuality);
  });
});

describe("piperEmotion", () => {
  it("round-trips every value the dropdown offers", () => {
    for (const emotion of paneOptions("piperEmotionSelect")) {
      expect(asPiperEmotion(emotion)).toBe(emotion);
    }
  });

  it("offers exactly the union the types declare", () => {
    expect([...paneOptions("piperEmotionSelect")].sort()).toEqual([...EMOTIONS].sort());
  });

  it("agrees with the backend validator", () => {
    expect([...rustAllowedValues("piperEmotion")].sort()).toEqual([...EMOTIONS].sort());
  });

  it("falls back only for a value the UI cannot produce", () => {
    expect(asPiperEmotion("nonsense")).toBe(defaultSettings().piperEmotion);
  });
});
