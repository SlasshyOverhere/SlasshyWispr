/**
 * Max-token bounds — the numbers half of the Rust <-> TypeScript contract.
 *
 * `advertised_max_tokens_bounds_match_the_clamp` (src-tauri/src/commands/settings.rs)
 * proves the command and the clamp agree, but both of those are Rust. What is
 * pinned here is the one number that crosses the boundary with no compiler
 * between it: the fallback in max-tokens-bounds.ts, which is read at boot before
 * any IPC answer can exist and is used outright by the browser dev build.
 *
 * The wire field names and the command registration are not repeated here — see
 * src/ipc/wire-contract.test.ts, which covers those for every payload at once.
 * Parsing is deliberately strict: a pattern that stops matching must fail the
 * test rather than pass it vacuously.
 */
import { describe, expect, it } from "bun:test";
import { maxTokensBounds, resetMaxTokensBoundsForTests } from "./max-tokens-bounds";

const PIPELINE_RS = "src-tauri/src/commands/pipeline.rs";
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

describe("max tokens bounds contract", () => {
  it("keeps the TypeScript fallback equal to the numbers Rust clamps with", async () => {
    const source = await read(PIPELINE_RS);
    const rustDefault = Number(
      mustGroup(source, /const MAX_TOKENS_DEFAULT: u32 = (\d+)/, "MAX_TOKENS_DEFAULT"),
    );
    const rustMin = Number(
      mustGroup(source, /const MAX_TOKENS_MIN: u32 = (\d+)/, "MAX_TOKENS_MIN"),
    );
    const rustMax = Number(
      mustGroup(source, /const MAX_TOKENS_MAX: u32 = (\d+)/, "MAX_TOKENS_MAX"),
    );

    // The fallback is what the pane renders until the backend answers, so it has
    // to be the same range or the field is briefly a lie.
    resetMaxTokensBoundsForTests();
    const fallback = maxTokensBounds();
    expect({
      defaultTokens: rustDefault,
      minTokens: rustMin,
      maxTokens: rustMax,
    }).toEqual(fallback);
  });

  it("maps each constant to the field the frontend reads", async () => {
    // Doubles as a transposition guard: swapping min and max here would clamp
    // every request to the wrong end of the range.
    const body = fnBody(await read(SETTINGS_RS), "max_tokens_bounds");
    expect(body).toContain("default_tokens: MAX_TOKENS_DEFAULT");
    expect(body).toContain("min_tokens: MAX_TOKENS_MIN");
    expect(body).toContain("max_tokens: MAX_TOKENS_MAX");
  });

  it("enforces the advertised constants in the clamp itself", async () => {
    const body = fnBody(await read(PIPELINE_RS), "resolve_max_tokens");
    expect(body).toContain(".clamp(MAX_TOKENS_MIN, MAX_TOKENS_MAX)");
    expect(body).toContain("None => MAX_TOKENS_DEFAULT");
  });

  it("routes the pipeline request through that clamp", async () => {
    // A clamp nothing calls is not enforcement: an inline literal here would
    // leave the advertised bounds unhonoured while every test above still passed.
    const body = fnBody(await read(PIPELINE_RS), "run_assistant_pipeline");
    expect(body).toContain("resolve_max_tokens(request.max_tokens)");
  });
});
