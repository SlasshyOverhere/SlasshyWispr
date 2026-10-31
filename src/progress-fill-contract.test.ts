/**
 * The progress-fill CSS contract.
 *
 * `--p` is a 0..1 fraction written from `updater-view.ts` and
 * `local-stt-client.ts`, and the only thing that can turn it into a visible bar
 * is a `width` in the stylesheet. When that rule had no width the bars rendered
 * nothing at all and nothing failed, so the rule is pinned here.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const STYLE_CSS = "src/style.css";

function rule(name: string): string {
  const source = readFileSync(STYLE_CSS, "utf8");
  const match = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`, "g");
  const declarations: string[] = [];
  for (const found of source.matchAll(match)) {
    declarations.push(found[1]);
  }
  if (declarations.length === 0) {
    throw new Error(`no .${name} rule in ${STYLE_CSS}`);
  }
  return declarations.join(";");
}

describe(".progress-fill", () => {
  const fill = rule("progress-fill");

  it("sizes its width from the --p fraction the writer sets", () => {
    expect(fill).toMatch(/width\s*:\s*calc\(var\(--p/);
  });

  it("defaults to empty rather than full when --p is unset", () => {
    expect(fill).toMatch(/var\(--p,\s*0\s*\)/);
  });

  it("is a block, so width and height apply at all", () => {
    // It is a <span>; without this the element stays inline and the width is
    // ignored, which is exactly how the bar went missing.
    expect(fill).toMatch(/display\s*:\s*block/);
  });
});
