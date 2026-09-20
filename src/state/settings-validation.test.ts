/**
 * Settings UI invariant test (F-021).
 *
 * Pins apiBaseUrlError — the client-side mirror of the backend URL validator,
 * so the form can show an inline error instead of silently coercing — and the
 * system prompt's empty-means-built-in rule.
 */
import { describe, it, expect } from "bun:test";
import { apiBaseUrlError, coerceSystemPrompt, defaultSettings } from "./settings-store";

// Exactly what older installs persisted, copied from the removed TS constant.
const LEGACY_PROMPT =
  "You are SlasshyWispr, a helpful desktop voice assistant. Keep replies concise and easy to speak aloud.";

describe("apiBaseUrlError", () => {
  it("accepts an empty value (means 'use the default')", () => {
    expect(apiBaseUrlError("")).toBeNull();
    expect(apiBaseUrlError("   ")).toBeNull();
  });

  it("accepts well-formed https URLs", () => {
    expect(apiBaseUrlError("https://api.example.com/v1")).toBeNull();
  });

  it("accepts loopback http (local gateway)", () => {
    expect(apiBaseUrlError("http://localhost:20128/v1")).toBeNull();
    expect(apiBaseUrlError("http://127.0.0.1:20128/v1")).toBeNull();
    expect(apiBaseUrlError("http://[::1]:20128/v1")).toBeNull();
  });

  it("rejects non-loopback plain http", () => {
    expect(apiBaseUrlError("http://api.example.com/v1")).toContain("https://");
    expect(apiBaseUrlError("http://192.168.1.10:11434")).toContain("https://");
  });

  it("rejects a value that is not a URL", () => {
    expect(apiBaseUrlError("api.example.com")).toContain("full URL");
  });

  it("rejects a non-http protocol", () => {
    expect(apiBaseUrlError("ftp://example.com")).toContain("https://");
  });
});

describe("system prompt", () => {
  it("ships empty, so the backend's built-in prompt applies", () => {
    // A non-empty default here would freeze a copy at first run and stop the
    // built-in prompt from ever being improved for anyone.
    expect(defaultSettings().systemPrompt).toBe("");
  });

  it("migrates the old TypeScript default to empty", () => {
    expect(coerceSystemPrompt(LEGACY_PROMPT, "")).toBe("");
    expect(coerceSystemPrompt(`  ${LEGACY_PROMPT}\n`, "")).toBe("");
  });

  it("keeps a prompt the user actually wrote", () => {
    expect(coerceSystemPrompt("  Be terse.  ", "")).toBe("  Be terse.  ");
    // Near-misses must not be swallowed by the migration.
    expect(coerceSystemPrompt(`${LEGACY_PROMPT} Be brief.`, "")).not.toBe("");
  });

  it("falls back when the field was never stored", () => {
    expect(coerceSystemPrompt(undefined, "fallback")).toBe("fallback");
  });
});