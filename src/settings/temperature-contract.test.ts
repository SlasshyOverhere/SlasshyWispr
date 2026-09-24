/**
 * Temperature bounds — the numbers half of the Rust <-> TypeScript contract.
 *
 * Three places used to state this range independently: the TypeScript fallback,
 * the request clamp, and the settings validator the backend accepted values
 * with. The validator allowed up to 2.0 while the clamp stopped at 1.2, so a
 * stored value in between was accepted, displayed, and silently changed on the
 * way to the model. Each is pinned here against the same constants.
 *
 * The wire field names and the command registration are not repeated here — see
 * src/ipc/command-contract.test.ts and scripts/generate-wire-types.mjs, which
 * cover those for every payload at once. Parsing is deliberately strict: a
 * pattern that stops matching must fail the test rather than pass it vacuously.
 */
import { describe, expect, it } from "bun:test";
import { resetTemperatureBoundsForTests, temperatureBounds } from "./temperature-bounds";

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

/** The constants, with the type they must keep: f32 would round 1.2 in the JSON. */
function constants(source: string): [number, number, number] {
  const number = (name: string): number =>
    Number(mustGroup(source, new RegExp(`const ${name}: f64 = ([\\d.]+)`), name));
  return [
    number("TEMPERATURE_DEFAULT"),
    number("TEMPERATURE_MIN"),
    number("TEMPERATURE_MAX"),
  ];
}

describe("temperature bounds contract", () => {
  it("keeps the TypeScript fallback equal to the numbers Rust clamps with", async () => {
    const [defaultTemperature, minTemperature, maxTemperature] = constants(
      await read(PIPELINE_RS),
    );

    // The fallback is what the pane renders until the backend answers, so it has
    // to be the same range or the slider is briefly a lie.
    resetTemperatureBoundsForTests();
    expect({ defaultTemperature, minTemperature, maxTemperature }).toEqual(
      temperatureBounds(),
    );
  });

  it("maps each constant to the field the frontend reads", async () => {
    // Doubles as a transposition guard: swapping min and max here would clamp
    // every request to the wrong end of the range.
    const body = fnBody(await read(SETTINGS_RS), "temperature_bounds");
    expect(body).toContain("default_temperature: TEMPERATURE_DEFAULT");
    expect(body).toContain("min_temperature: TEMPERATURE_MIN");
    expect(body).toContain("max_temperature: TEMPERATURE_MAX");
  });

  it("enforces the advertised constants in the clamp itself", async () => {
    const body = fnBody(await read(PIPELINE_RS), "resolve_temperature");
    expect(body).toContain(".clamp(TEMPERATURE_MIN, TEMPERATURE_MAX)");
    expect(body).toContain("TEMPERATURE_DEFAULT");
  });

  it("routes the pipeline request through that clamp", async () => {
    // A clamp nothing calls is not enforcement: an inline literal here would
    // leave the advertised bounds unhonoured while every test above still passed.
    const body = fnBody(await read(PIPELINE_RS), "run_assistant_pipeline");
    expect(body).toContain("resolve_temperature(request.temperature)");
  });

  it("validates stored values against the same range the clamp applies", async () => {
    // This is the disagreement this change removes: the validator used to accept
    // up to 2.0, so a stored 1.5 survived every check and was then clamped.
    const body = fnBody(await read(SETTINGS_RS), "validate_settings_payload");
    expect(body).toContain("(TEMPERATURE_MIN..=TEMPERATURE_MAX).contains(&temperature)");
  });
});
