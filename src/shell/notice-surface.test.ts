/**
 * Where the notice area lives.
 *
 * It used to sit inside the Pipeline settings pane, so every notice the shell
 * raised — including "an update is available" — was only on screen for a user
 * who had already opened Settings on that one tab. Nothing failed and nothing
 * logged: the messages were simply never read. `#noticeStack` is a shell
 * element now, and this keeps it that way.
 *
 * Strict on purpose: every pane is read, so relocating the area into any pane
 * fails rather than a named list going stale.
 */
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

const SHELL = "src/App.tsx";
const PANES_DIR = "src/components/settings";

function readSource(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`notice surface check cannot read ${path}`);
  }
}

function paneFiles(): string[] {
  return readdirSync(PANES_DIR)
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `${PANES_DIR}/${name}`);
}

describe("notice surface", () => {
  it("renders the notice area in the always-visible shell", () => {
    expect(readSource(SHELL)).toContain('id="noticeStack"');
  });

  it("keeps the notice area out of every settings pane", () => {
    const offenders = paneFiles().filter((path) => readSource(path).includes("noticeStack"));

    expect(offenders).toEqual([]);
  });

  it("reads at least one pane, so the sweep above cannot pass vacuously", () => {
    expect(paneFiles().length).toBeGreaterThan(0);
  });
});
