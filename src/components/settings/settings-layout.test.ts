import { describe, expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsModal } from "./SettingsModal";

const EXPECTED_SECTIONS = [
  "audio",
  "dictation",
  "assistant",
  "appearance",
  "app-privacy",
  "recordings",
  "sound",
  "runtime",
  "online-provider",
  "local-ai",
  "local-stt",
  "voice",
  "controls",
  "status",
  "updates",
] as const;

describe("settings layout", () => {
  it("renders every planned category in the directory and content", () => {
    const html = renderToStaticMarkup(createElement(SettingsModal));

    for (const section of EXPECTED_SECTIONS) {
      expect(html).toContain(`data-settings-section-nav="${section}"`);
      expect(html).toContain(`data-settings-section="${section}"`);
    }
    expect(html).not.toMatch(/class="settings-category"[^>]* hidden/);
  });

  it("renders as a direct page rather than a modal dialog", () => {
    const html = renderToStaticMarkup(createElement(SettingsModal));

    expect(html).toContain('class="settings-page"');
    expect(html).not.toContain("settings-overlay");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('id="closeSettingsBtn"');
  });

  it("keeps the capture-mode DOM contract used by settings hydration", () => {
    const html = renderToStaticMarkup(createElement(SettingsModal));

    expect(html).toContain('id="captureModeSingle"');
    expect(html).toContain('id="captureModePushToTalk"');
  });
});
