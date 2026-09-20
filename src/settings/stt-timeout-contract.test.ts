/**
 * STT timeout bounds — the Rust <-> TypeScript half of the contract.
 *
 * `advertised_stt_timeout_bounds_match_the_clamp` (src-tauri/src/commands/settings.rs)
 * proves the command and the clamp agree, but both of those are Rust. Two things
 * cross the language boundary with no compiler between them:
 *
 *   - the fallback numbers in stt-timeout-bounds.ts, read at boot before any IPC
 *     answer can exist and used outright by the browser dev build, and
 *   - the wire field names, where a rename on either side turns every field into
 *     `undefined` and silently parks the pane on the fallback forever.
 *
 * Both failures are invisible at runtime, so they are pinned here by reading the
 * Rust source. Parsing is deliberately strict: a pattern that stops matching must
 * fail the test rather than pass it vacuously.
 */
import { describe, expect, it } from "bun:test";
import { IPC_COMMANDS } from "../ipc/commands";
import { resetSttTimeoutBoundsForTests, sttTimeoutBounds } from "./stt-timeout-bounds";

const TRANSCRIBE_RS = "src-tauri/src/services/transcribe.rs";
const SETTINGS_RS = "src-tauri/src/commands/settings.rs";
const IPC_TYPES_RS = "src-tauri/src/commands/ipc_types.rs";
const LIB_RS = "src-tauri/src/lib.rs";
const TYPES_TS = "src/types.ts";

async function read(path: string): Promise<string> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`contract test cannot find ${path}`);
  }
  return file.text();
}

function mustGroup(source: string, pattern: RegExp, what: string): string {
  const match = source.match(pattern);
  if (!match?.[1]) {
    throw new Error(`could not parse ${what} — fix this test rather than letting it pass`);
  }
  return match[1];
}

/** Body of a top-level `fn`, up to the closing brace in column zero. */
function fnBody(source: string, name: string): string {
  return mustGroup(
    source,
    new RegExp(`fn ${name}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`),
    `the body of ${name}()`,
  );
}

function structFields(source: string, name: string): string[] {
  const body = mustGroup(source, new RegExp(`struct ${name} \\{([^}]*)\\}`), `struct ${name}`);
  const fields = [...body.matchAll(/pub\(crate\)\s+(\w+)\s*:/g)].map((match) => match[1]);
  if (fields.length === 0) {
    throw new Error(`struct ${name} parsed but has no fields — check the pattern`);
  }
  return fields;
}

function interfaceFields(source: string, name: string): string[] {
  const body = mustGroup(source, new RegExp(`interface ${name} \\{([^}]*)\\}`), `interface ${name}`);
  const fields = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((match) => match[1]);
  if (fields.length === 0) {
    throw new Error(`interface ${name} parsed but has no fields — check the pattern`);
  }
  return fields;
}

function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase());
}

describe("stt timeout bounds contract", () => {
  it("keeps the TypeScript fallback equal to the numbers Rust clamps with", async () => {
    const source = await read(TRANSCRIBE_RS);
    const rustDefault = Number(
      mustGroup(
        source,
        /const STT_TIMEOUT_DEFAULT: Duration = Duration::from_secs\((\d+)\)/,
        "STT_TIMEOUT_DEFAULT",
      ),
    );
    const rustMin = Number(
      mustGroup(source, /const STT_TIMEOUT_MIN_SECS: u64 = (\d+)/, "STT_TIMEOUT_MIN_SECS"),
    );
    const rustMax = Number(
      mustGroup(source, /const STT_TIMEOUT_MAX_SECS: u64 = (\d+)/, "STT_TIMEOUT_MAX_SECS"),
    );

    // The fallback is what the pane renders until the backend answers, so it has
    // to be the same range or the field is briefly a lie.
    resetSttTimeoutBoundsForTests();
    const fallback = sttTimeoutBounds();
    expect({
      defaultSeconds: rustDefault,
      minSeconds: rustMin,
      maxSeconds: rustMax,
    }).toEqual(fallback);
  });

  it("maps each constant to the field the frontend reads", async () => {
    // Doubles as a transposition guard: swapping min and max here would clamp
    // every request to the wrong end of the range.
    const body = fnBody(await read(SETTINGS_RS), "stt_timeout_bounds");
    expect(body).toContain("default_seconds: STT_TIMEOUT_DEFAULT.as_secs()");
    expect(body).toContain("min_seconds: STT_TIMEOUT_MIN_SECS");
    expect(body).toContain("max_seconds: STT_TIMEOUT_MAX_SECS");
  });

  it("enforces the advertised constants in the clamp itself", async () => {
    const body = fnBody(await read(TRANSCRIBE_RS), "resolve_stt_timeout");
    expect(body).toContain(".clamp(STT_TIMEOUT_MIN_SECS, STT_TIMEOUT_MAX_SECS)");
    expect(body).toContain("None => STT_TIMEOUT_DEFAULT");
  });

  it("sends the field names the frontend interface declares", async () => {
    const rustSource = await read(IPC_TYPES_RS);
    // Without camelCase on this exact struct the keys arrive snake_case and every
    // read is undefined, which normalizeBounds rejects into the fallback.
    expect(rustSource).toMatch(
      /#\[serde\(rename_all = "camelCase"\)\]\s*pub\(crate\) struct SttTimeoutBoundsResponse/,
    );

    const wireKeys = structFields(rustSource, "SttTimeoutBoundsResponse").map(toCamelCase);
    const declaredKeys = interfaceFields(await read(TYPES_TS), "SttTimeoutBoundsResponse");
    expect(wireKeys.sort()).toEqual([...declaredKeys].sort());
  });

  it("sends a command name that is registered with Tauri", async () => {
    const command = IPC_COMMANDS.sttTimeoutBounds;
    expect(command).toBe("stt_timeout_bounds");

    const settingsSource = await read(SETTINGS_RS);
    expect(settingsSource).toMatch(new RegExp(`#\\[tauri::command\\]\\s*pub\\(crate\\) fn ${command}\\(`));

    // A command the frontend calls but generate_handler! never lists fails at
    // runtime as an unknown command, which the caller swallows as "no backend".
    const libSource = await read(LIB_RS);
    const registered = mustGroup(
      libSource,
      /generate_handler!\[([\s\S]*?)\]/,
      "the generate_handler! list",
    );
    expect(registered).toContain(command);
  });
});
