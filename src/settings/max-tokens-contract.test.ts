/**
 * Max-token bounds — the Rust <-> TypeScript half of the contract.
 *
 * `advertised_max_tokens_bounds_match_the_clamp` (src-tauri/src/commands/settings.rs)
 * proves the command and the clamp agree, but both of those are Rust. Two things
 * cross the language boundary with no compiler between them:
 *
 *   - the fallback numbers in max-tokens-bounds.ts, read at boot before any IPC
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
import { maxTokensBounds, resetMaxTokensBoundsForTests } from "./max-tokens-bounds";

const PIPELINE_RS = "src-tauri/src/commands/pipeline.rs";
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
  const body = mustGroup(source, new RegExp(`interface ${name} \\{([^}]*)\\}`, "m"), `interface ${name}`);
  const fields = [...body.matchAll(/^\s*(\w+)\s*:/gm)].map((match) => match[1]);
  if (fields.length === 0) {
    throw new Error(`interface ${name} parsed but has no fields — check the pattern`);
  }
  return fields;
}

function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase());
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

  it("sends the field names the frontend interface declares", async () => {
    const rustSource = await read(IPC_TYPES_RS);
    // Without camelCase on this exact struct the keys arrive snake_case and every
    // read is undefined, which normalizeBounds rejects into the fallback.
    expect(rustSource).toMatch(
      /#\[serde\(rename_all = "camelCase"\)\]\s*pub\(crate\) struct MaxTokensBoundsResponse/,
    );

    const wireKeys = structFields(rustSource, "MaxTokensBoundsResponse").map(toCamelCase);
    const declaredKeys = interfaceFields(await read(TYPES_TS), "MaxTokensBoundsResponse");
    expect(wireKeys.sort()).toEqual([...declaredKeys].sort());
  });

  it("sends a command name that is registered with Tauri", async () => {
    const command = IPC_COMMANDS.maxTokensBounds;
    expect(command).toBe("max_tokens_bounds");

    const settingsSource = await read(SETTINGS_RS);
    expect(settingsSource).toMatch(
      new RegExp(`#\\[tauri::command\\]\\s*pub\\(crate\\) fn ${command}\\(`),
    );

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
