/**
 * STT timeout bounds — the numbers half of the Rust <-> TypeScript contract.
 *
 * `advertised_stt_timeout_bounds_match_the_clamp` (src-tauri/src/commands/settings.rs)
 * proves the command and the clamp agree, but both of those are Rust. What is
 * pinned here is the one number that crosses the boundary with no compiler
 * between it: the fallback in stt-timeout-bounds.ts, which is read at boot before
 * any IPC answer can exist and is used outright by the browser dev build.
 *
 * The wire field names and the command registration are not repeated here — see
 * src/ipc/wire-contract.test.ts, which covers those for every payload at once.
 * Parsing is deliberately strict: a pattern that stops matching must fail the
 * test rather than pass it vacuously.
 */
import { describe, expect, it } from "bun:test";
import { resetSttTimeoutBoundsForTests, sttTimeoutBounds } from "./stt-timeout-bounds";

const TRANSCRIBE_RS = "src-tauri/src/services/transcribe.rs";
const SETTINGS_RS = "src-tauri/src/commands/settings.rs";

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
});
