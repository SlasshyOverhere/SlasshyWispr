/**
 * Settings UI invariant test (F-021).
 *
 * Pins apiBaseUrlError — the client-side mirror of the backend URL validator,
 * so the form can show an inline error instead of silently coercing.
 */
import { describe, it, expect } from "bun:test";
import { apiBaseUrlError } from "./settings-store";

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