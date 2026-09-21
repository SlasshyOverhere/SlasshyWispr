/**
 * The recorder's default roster against the app's built-in catalog.
 *
 * `scripts/stt-bench-record.mjs` seeds a new manifest with the models to measure, and
 * `built_in_local_stt_model_catalog()` is what the app will actually accept. They are
 * different languages with nothing between them, and a drift is quiet: the manifest
 * still runs, and one model silently reports "not downloaded" forever while another
 * that the app ships is never measured.
 *
 * The Rust list is parsed rather than restated, so adding a model there fails here.
 * Every parse is strict: anything this file cannot read is a failure, never a skip.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const RECORDER = "scripts/stt-bench-record.mjs";
const ROUTING_RS = "src-tauri/src/pipeline/routing.rs";

function catalogFromRust(): string[] {
  const source = readFileSync(ROUTING_RS, "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("pub fn built_in_local_stt_model_catalog() -> Vec<String> {");
  if (start === -1) throw new Error("could not find built_in_local_stt_model_catalog");
  const end = source.indexOf("]", start);
  if (end === -1) throw new Error("could not find the end of the catalog vec");
  const body = source.slice(start, end);
  const models = [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (models.length === 0) throw new Error("the catalog parses as empty");
  return models;
}

function rosterFromRecorder(): string[] {
  const source = readFileSync(RECORDER, "utf8").replace(/\r\n/g, "\n");
  const start = source.indexOf("const DEFAULT_MODELS = [");
  if (start === -1) throw new Error("could not find DEFAULT_MODELS");
  const end = source.indexOf("];", start);
  if (end === -1) throw new Error("could not find the end of DEFAULT_MODELS");
  const body = source.slice(start, end);
  const models = [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (models.length === 0) throw new Error("DEFAULT_MODELS parses as empty");
  return models;
}

describe("bench roster", () => {
  it("defaults to exactly the models the app ships, in the same order", () => {
    expect(rosterFromRecorder()).toEqual(catalogFromRust());
  });

  it("reads a catalog that is not empty, so the check cannot pass vacuously", () => {
    expect(catalogFromRust().length).toBeGreaterThan(0);
  });
});
