/**
 * Local-STT state move-boundary test — Phase 5 shell decomposition.
 *
 * Pins the pure helpers moved to local-stt-state: model label fallback,
 * selected-model loaded check, action block-reason priority, and the
 * advisor shown flag round-trip.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  getLocalSttActionBlockReason,
  getSelectedLocalSttModel,
  hasShownLocalSttHardwareAdvisor,
  initLocalSttState,
  isSelectedLocalSttModelLoaded,
  localSttModelLabel,
  markLocalSttHardwareAdvisorShown,
  setLastWarmedLocalSttModel,
  setLocalSttDeleteInFlight,
  setLocalSttHardwareAdvisorOpen,
  setLocalSttRuntimeLoaded,
} from "./local-stt-state";
import { LOCAL_STT_HARDWARE_ADVISOR_STORAGE_KEY } from "../constants";

function wireHarness(options: {
  model?: string;
  catalogSelection?: string;
  pipelineRunning?: boolean;
  stage?: string;
} = {}) {
  initLocalSttState({
    readSettings: () => ({
      sttRuntimeMode: "local",
      localSttModel: options.model ?? "parakeet-tdt-0.6b-v3",
    }),
    getCatalogSelection: () => options.catalogSelection ?? "",
    isPipelineRunning: () => options.pipelineRunning ?? false,
    getStage: () => options.stage ?? "idle",
    renderSidebarToggle: () => {},
    renderSettingsStatus: () => {},
  });
  setLocalSttDeleteInFlight(false);
  setLocalSttHardwareAdvisorOpen(false);
  setLocalSttRuntimeLoaded(true);
  setLastWarmedLocalSttModel(options.model ?? "parakeet-tdt-0.6b-v3");
}

beforeEach(() => {
  localStorage.clear();
  wireHarness();
});

describe("localSttModelLabel", () => {
  it("returns a dash for blank models and size labels for known ones", () => {
    expect(localSttModelLabel("   ")).toBe("-");
    expect(localSttModelLabel("nvidia/parakeet-tdt-0.6b-v3")).toBe("Parakeet v3 (478 MB)");
    expect(localSttModelLabel("custom-model")).toBe("custom-model");
  });
});

describe("getSelectedLocalSttModel / isSelectedLocalSttModelLoaded", () => {
  it("prefers the form model over the catalog selection", () => {
    wireHarness({ model: "", catalogSelection: "parakeet-tdt-1.1b-v3" });
    expect(getSelectedLocalSttModel()).toBe("parakeet-tdt-1.1b-v3");
  });

  it("reports loaded only when the warmed model matches", () => {
    wireHarness({ model: "parakeet-tdt-0.6b-v3" });
    expect(isSelectedLocalSttModelLoaded()).toBe(true);
    setLastWarmedLocalSttModel("other-model");
    expect(isSelectedLocalSttModelLoaded()).toBe(false);
    setLocalSttRuntimeLoaded(false);
    setLastWarmedLocalSttModel("parakeet-tdt-0.6b-v3");
    expect(isSelectedLocalSttModelLoaded()).toBe(false);
  });
});

describe("getLocalSttActionBlockReason", () => {
  it("returns null when idle and prioritizes pipeline over delete", () => {
    wireHarness();
    expect(getLocalSttActionBlockReason()).toBeNull();
    wireHarness({ pipelineRunning: true });
    setLocalSttDeleteInFlight(true);
    expect(getLocalSttActionBlockReason()).toBe("Finish the current pipeline run first.");
  });

  it("blocks during recording and open advisor", () => {
    wireHarness({ stage: "recording" });
    expect(getLocalSttActionBlockReason()).toBe("Stop recording before changing offline STT setup.");
    wireHarness();
    setLocalSttHardwareAdvisorOpen(true);
    expect(getLocalSttActionBlockReason()).toBe("Close the hardware advisor before continuing.");
  });
});

describe("hardware advisor flag", () => {
  it("round-trips through localStorage", () => {
    expect(hasShownLocalSttHardwareAdvisor()).toBe(false);
    markLocalSttHardwareAdvisorShown();
    expect(hasShownLocalSttHardwareAdvisor()).toBe(true);
    expect(localStorage.getItem(LOCAL_STT_HARDWARE_ADVISOR_STORAGE_KEY)).toBe("1");
  });
});
