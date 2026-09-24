import { beforeEach, describe, expect, it } from "bun:test";
import {
  initMicrophones,
  refreshMicrophones,
  selectedMicrophoneLabel,
  setMicrophonePermissionGranted,
} from "./microphones";

type FakeOption = { value: string; textContent: string };

function fakeSelect(): {
  select: HTMLSelectElement;
  value: () => string;
  html: () => string;
} {
  let html = "";
  let value = "";
  const options: FakeOption[] = [];
  const select = {
    get innerHTML() {
      return html;
    },
    set innerHTML(next: string) {
      html = next;
      options.length = 0;
      const pattern = /<option value="([^"]*)"([^>]*)>(.*?)<\/option>/g;
      let match: RegExpExecArray | null;
      let selectedValue = "";
      while ((match = pattern.exec(next))) {
        options.push({
          value: match[1],
          textContent: match[3].replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'"),
        });
        if (/\bselected\b/.test(match[2])) {
          selectedValue = match[1];
        }
      }
      value = selectedValue || options[0]?.value || "";
    },
    get value() {
      return value;
    },
    set value(next: string) {
      value = next;
    },
    options,
    selectedOptions: {
      item(index: number) {
        if (index !== 0) {
          return null;
        }
        return options.find((option) => option.value === value) ?? null;
      },
    },
  } as unknown as HTMLSelectElement;

  return {
    select,
    value: () => value,
    html: () => html,
  };
}

function installDevices(devices: Array<{ deviceId: string; label: string }>): void {
  (globalThis as unknown as { navigator: unknown }).navigator = {
    mediaDevices: {
      enumerateDevices: async () => devices.map((device) => ({
        kind: "audioinput",
        deviceId: device.deviceId,
        label: device.label,
      })),
    },
  };
}

function setup(currentId: string, devices: Array<{ deviceId: string; label: string }>) {
  const select = fakeSelect();
  const summary = { textContent: "" } as HTMLElement;
  let savedId = currentId;
  const deps = {
    getMicrophoneDeviceId: () => savedId,
    setMicrophoneDeviceId: (id: string) => {
      savedId = id;
    },
    persist: () => {},
    getStage: () => "idle",
    getShowFlowBar: () => false,
    primeCapture: () => {},
    notify: () => {},
  };
  initMicrophones({ select: select.select, summary }, deps);
  installDevices(devices);
  return { ...select, savedId: () => savedId, summaryText: () => summary.textContent };
}

beforeEach(() => {
  setMicrophonePermissionGranted(false);
});

describe("microphone selection persistence", () => {
  it("keeps automatic input selected instead of adopting the first device", async () => {
    const harness = setup("", [{ deviceId: "default", label: "Default microphone" }]);

    await refreshMicrophones(false);

    expect(harness.value()).toBe("");
    expect(harness.savedId()).toBe("");
    expect(harness.summaryText()).toBe("Auto-detect");
    expect(selectedMicrophoneLabel()).toBe("");
  });

  it("does not report automatic input while an explicit lock is unresolved", () => {
    setup("pinned-mic", []);

    expect(selectedMicrophoneLabel()).toBe("Selected microphone unavailable");
  });

  it("keeps an explicit device selected when it is temporarily absent", async () => {
    const harness = setup("pinned-mic", [{ deviceId: "default", label: "Default microphone" }]);

    await refreshMicrophones(false);

    expect(harness.value()).toBe("pinned-mic");
    expect(harness.savedId()).toBe("pinned-mic");
    expect(harness.html()).toContain("Selected microphone unavailable");
    expect(selectedMicrophoneLabel()).toBe("Selected microphone unavailable");
  });

  it("keeps an available explicit device selected for native capture", async () => {
    const harness = setup("pinned-mic", [
      { deviceId: "default", label: "Default microphone" },
      { deviceId: "pinned-mic", label: "Pinned USB microphone" },
    ]);

    await refreshMicrophones(false);

    expect(harness.value()).toBe("pinned-mic");
    expect(selectedMicrophoneLabel()).toBe("Pinned USB microphone");
  });

  it("keeps an explicit device selected when no microphones are enumerated", async () => {
    const harness = setup("pinned-mic", []);

    await refreshMicrophones(false);

    expect(harness.value()).toBe("pinned-mic");
    expect(harness.savedId()).toBe("pinned-mic");
  });
});
