/**
 * The contract between the Rust local-STT daemon and the embedded Python bridge.
 *
 * The bridge is a subprocess driven by JSONL, so an action name is a bare string on
 * both sides with no compiler between them. Two failures are silent until runtime:
 * a Rust call for an action the bridge dropped fails as an unhelpful "Unsupported
 * action", and a dispatch arm no Rust call reaches is dead code that looks live.
 *
 * Both directions are asserted here, so deleting a bridge action without deleting
 * its caller (or the reverse) fails in CI rather than on a user's machine.
 *
 * Every parse is strict: anything this file cannot read is a failure, never a
 * skipped check. A guard whose pattern stops matching still reports success while
 * asserting nothing.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";

const RUST_SRC = "src-tauri/src";
const BRIDGE = "src-tauri/local_stt_bridge.py";

/** Call sites that reach the local-STT bridge, by definition of the sender names. */
const SENDER_MARKERS = [
  "run_local_stt_bridge_via_daemon(",
  "send_local_stt_daemon_request(",
];

function rustSources(): string[] {
  const entries = readdirSync(RUST_SRC, { recursive: true }) as string[];
  return entries
    .map((entry) => `${RUST_SRC}/${entry.replace(/\\/g, "/")}`)
    .filter((path) => path.endsWith(".rs") && !path.endsWith(".test.rs"));
}

function read(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

function actionLiterals(source: string, path: string): string[] {
  const found = [...source.matchAll(/"action":\s*"([a-z_]+)"/g)].map((m) => m[1]);
  expect({ path, found: found.length > 0 }).toEqual({ path, found: true });
  return found;
}

describe("local STT bridge actions", () => {
  const senders = rustSources().filter((path) => {
    const source = read(path);
    return SENDER_MARKERS.some((marker) => source.includes(marker));
  });

  it("scans every file that sends a local STT bridge action", () => {
    // If a new module starts driving the bridge, its actions must be covered here.
    expect(senders.map((path) => path.replace(`${RUST_SRC}/`, "")).sort()).toEqual([
      "pipeline/daemon/local_stt.rs",
      "services/transcribe.rs",
    ]);
  });

  const sent = new Set(senders.flatMap((path) => actionLiterals(read(path), path)));
  const bridge = read(BRIDGE);
  const dispatched = new Set(
    [...bridge.matchAll(/if action == "([a-z_]+)":/g)].map((m) => m[1]),
  );

  it("dispatches every action the Rust daemon sends", () => {
    expect([...sent].filter((action) => !dispatched.has(action))).toEqual([]);
  });

  it("has no dispatch arm the Rust daemon never sends", () => {
    expect([...dispatched].filter((action) => !sent.has(action))).toEqual([]);
  });

  it("has no parakeet path left in the bridge", () => {
    // Parakeet is the native in-process engine now; the bridge must not grow one back.
    expect(bridge).not.toMatch(/import nemo|nemo_toolkit|_load_parakeet_model/);
  });
});
