/**
 * IPC Contract Tests — TypeScript side.
 *
 * These tests verify that the TypeScript type definitions for IPC messages
 * match the Rust serde configuration. If these tests fail, the Rust ↔
 * TypeScript serialization contract has drifted.
 *
 * See also: the Rust-side `ipc_request_serializes_with_camel_case` and
 * `ipc_response_has_expected_camel_case_fields` tests in lib.rs.
 */
import { describe, it, expect } from "bun:test";
import type {
  AssistantPipelineResponse,
  AppUpdateCheckResponse,
  AppUpdateInstallProgressEvent,
  InstallAppUpdateRequest,
  OllamaStatusResponse,
  LocalSttDownloadStatusResponse,
  LocalSttRuntimeStateResponse,
  TtsSetupStatusResponse,
} from "./types";

// ===== AssistantPipelineResponse =====

describe("IPC Contract: AssistantPipelineResponse", () => {
  it("has all expected camelCase fields", () => {
    const response: AssistantPipelineResponse = {
      mode: "dictation",
      selectionRewrite: false,
      selectionPending: false,
      selectionContextCleared: false,
      selectionContextUsed: false,
      transcript: "Hello world",
      assistantResponse: "Hello world.",
      audioBase64: "",
      sttLatencyMs: 250,
      aiLatencyMs: 800,
      ttsLatencyMs: 150,
      totalLatencyMs: 1200,
    };

    // Verify the shape matches Rust serde camelCase output
    expect(response.mode).toBe("dictation");
    expect(response.selectionRewrite).toBe(false);
    expect(response.selectionPending).toBe(false);
    expect(response.selectionContextCleared).toBe(false);
    expect(response.selectionContextUsed).toBe(false);
    expect(response.transcript).toBe("Hello world");
    expect(response.assistantResponse).toBe("Hello world.");
    expect(response.audioBase64).toBe("");
    expect(response.sttLatencyMs).toBe(250);
    expect(response.aiLatencyMs).toBe(800);
    expect(response.ttsLatencyMs).toBe(150);
    expect(response.totalLatencyMs).toBe(1200);
  });

  it("mode field accepts 'assistant' value", () => {
    const response: AssistantPipelineResponse = {
      mode: "assistant",
      selectionRewrite: false,
      selectionPending: false,
      selectionContextCleared: false,
      selectionContextUsed: false,
      transcript: "Hey Lily, summarize this",
      assistantResponse: "Summary text.",
      audioBase64: "dGVzdA==",
      sttLatencyMs: 100,
      aiLatencyMs: 500,
      ttsLatencyMs: 200,
      totalLatencyMs: 800,
    };
    expect(response.mode).toBe("assistant");
  });

  it("mode field accepts 'dictation' value", () => {
    const response: AssistantPipelineResponse = {
      mode: "dictation",
      selectionRewrite: false,
      selectionPending: false,
      selectionContextCleared: false,
      selectionContextUsed: false,
      transcript: "write this exactly",
      assistantResponse: "write this exactly",
      audioBase64: "",
      sttLatencyMs: 100,
      aiLatencyMs: 0,
      ttsLatencyMs: 0,
      totalLatencyMs: 100,
    };
    expect(response.mode).toBe("dictation");
  });

  it("serializes to JSON with correct field names", () => {
    const response: AssistantPipelineResponse = {
      mode: "assistant",
      selectionRewrite: true,
      selectionPending: false,
      selectionContextCleared: true,
      selectionContextUsed: true,
      transcript: "test transcript",
      assistantResponse: "improved text",
      audioBase64: "abc123",
      sttLatencyMs: 100,
      aiLatencyMs: 200,
      ttsLatencyMs: 50,
      totalLatencyMs: 350,
    };

    const json = JSON.parse(JSON.stringify(response));

    // Verify camelCase keys are preserved
    expect(json.mode).toBe("assistant");
    expect(json.selectionRewrite).toBe(true);
    expect(json.selectionPending).toBe(false);
    expect(json.selectionContextCleared).toBe(true);
    expect(json.selectionContextUsed).toBe(true);
    expect(json.transcript).toBe("test transcript");
    expect(json.assistantResponse).toBe("improved text");
    expect(json.audioBase64).toBe("abc123");
    expect(json.sttLatencyMs).toBe(100);
    expect(json.aiLatencyMs).toBe(200);
    expect(json.ttsLatencyMs).toBe(50);
    expect(json.totalLatencyMs).toBe(350);

    // Verify no snake_case keys leaked through
    expect(json.stt_latency_ms).toBeUndefined();
    expect(json.ai_latency_ms).toBeUndefined();
    expect(json.tts_latency_ms).toBeUndefined();
    expect(json.total_latency_ms).toBeUndefined();
    expect(json.assistant_response).toBeUndefined();
    expect(json.selection_rewrite).toBeUndefined();
    expect(json.selection_pending).toBeUndefined();
    expect(json.selection_context_cleared).toBeUndefined();
    expect(json.selection_context_used).toBeUndefined();
    expect(json.audio_base64).toBeUndefined();
  });
});

// ===== AppUpdateCheckResponse =====

describe("IPC Contract: AppUpdateCheckResponse", () => {
  it("has all expected camelCase fields", () => {
    const response: AppUpdateCheckResponse = {
      currentVersion: "1.0.10",
      latestVersion: "1.0.11",
      available: true,
      releaseName: "v1.0.11",
      releaseNotes: "Bug fixes.",
      publishedAt: "2026-07-20T12:00:00Z",
      releaseUrl: "https://github.com/SlasshyOverhere/SlasshyWispr/releases/tag/v1.0.11",
      installerDownloadUrl: "https://github.com/.../SlasshyWispr_1.0.11_x64-setup.exe",
      installerAssetName: "SlasshyWispr_1.0.11_x64-setup.exe",
      expectedSha256: "abc123",
    };

    expect(response.currentVersion).toBe("1.0.10");
    expect(response.latestVersion).toBe("1.0.11");
    expect(response.available).toBe(true);
    expect(response.installerAssetName).toBe("SlasshyWispr_1.0.11_x64-setup.exe");
    expect(response.expectedSha256).toBe("abc123");
  });

  it("serializes with correct field names", () => {
    const response: AppUpdateCheckResponse = {
      currentVersion: "1.0.0",
      latestVersion: "1.0.1",
      available: true,
      releaseName: "v1.0.1",
      releaseNotes: "",
      publishedAt: "",
      releaseUrl: "",
      installerDownloadUrl: "",
      installerAssetName: "",
      expectedSha256: "",
    };

    const json = JSON.parse(JSON.stringify(response));

    // Verify camelCase
    expect(json.currentVersion).toBe("1.0.0");
    expect(json.latestVersion).toBe("1.0.1");
    expect(json.installerDownloadUrl).toBe("");
    expect(json.installerAssetName).toBe("");
    expect(json.expectedSha256).toBe("");

    // No snake_case leakage
    expect(json.current_version).toBeUndefined();
    expect(json.latest_version).toBeUndefined();
    expect(json.installer_download_url).toBeUndefined();
    expect(json.installer_asset_name).toBeUndefined();
    expect(json.expected_sha256).toBeUndefined();
  });
});

// ===== AppUpdateInstallProgressEvent =====

describe("IPC Contract: AppUpdateInstallProgressEvent", () => {
  it("serializes with correct field names", () => {
    const event: AppUpdateInstallProgressEvent = {
      stage: "downloading",
      message: "Downloading update installer...",
      downloadedBytes: 1024,
      totalBytes: 2048,
      progressPercent: 50.0,
      completed: false,
      success: false,
    };

    const json = JSON.parse(JSON.stringify(event));

    expect(json.stage).toBe("downloading");
    expect(json.downloadedBytes).toBe(1024);
    expect(json.totalBytes).toBe(2048);
    expect(json.progressPercent).toBe(50.0);

    // No snake_case
    expect(json.downloaded_bytes).toBeUndefined();
    expect(json.total_bytes).toBeUndefined();
    expect(json.progress_percent).toBeUndefined();
  });
});

// ===== InstallAppUpdateRequest =====

describe("IPC Contract: InstallAppUpdateRequest", () => {
  it("serializes with correct field names", () => {
    const request: InstallAppUpdateRequest = {
      downloadUrl: "https://github.com/.../setup.exe",
      assetName: "setup.exe",
      silent: true,
      expectedSha256: "abc123",
    };

    const json = JSON.parse(JSON.stringify(request));

    expect(json.downloadUrl).toBe("https://github.com/.../setup.exe");
    expect(json.assetName).toBe("setup.exe");
    expect(json.silent).toBe(true);
    expect(json.expectedSha256).toBe("abc123");

    // No snake_case
    expect(json.download_url).toBeUndefined();
    expect(json.asset_name).toBeUndefined();
    expect(json.expected_sha256).toBeUndefined();
  });

  it("handles missing optional fields", () => {
    const request: InstallAppUpdateRequest = {
      downloadUrl: "https://github.com/.../setup.exe",
    };

    const json = JSON.parse(JSON.stringify(request));
    expect(json.downloadUrl).toBe("https://github.com/.../setup.exe");
    expect(json.assetName).toBeUndefined();
    expect(json.silent).toBeUndefined();
    expect(json.expectedSha256).toBeUndefined();
  });
});

// ===== OllamaStatusResponse =====

describe("IPC Contract: OllamaStatusResponse", () => {
  it("serializes with correct field names", () => {
    const response: OllamaStatusResponse = {
      installed: true,
      running: true,
      version: "0.1.30",
      details: "Ollama is running.",
    };

    const json = JSON.parse(JSON.stringify(response));
    expect(json.installed).toBe(true);
    expect(json.running).toBe(true);
    expect(json.version).toBe("0.1.30");
    expect(json.details).toBe("Ollama is running.");
  });
});

// ===== LocalSttDownloadStatusResponse =====

describe("IPC Contract: LocalSttDownloadStatusResponse", () => {
  it("serializes with correct camelCase field names", () => {
    const response: LocalSttDownloadStatusResponse = {
      active: true,
      completed: false,
      success: false,
      model: "nvidia/parakeet-tdt-0.6b-v3",
      repoId: "SlasshyOverhere/parakeet-int8-mirror",
      stage: "Downloading",
      message: "Downloading model...",
      currentFile: "model.onnx",
      downloadedBytes: 50000,
      totalBytes: 100000,
      filesCompleted: 1,
      filesTotal: 3,
      progressPercent: 50.0,
      updatedAtMs: 1700000000000,
    };

    const json = JSON.parse(JSON.stringify(response));

    expect(json.active).toBe(true);
    expect(json.repoId).toBe("SlasshyOverhere/parakeet-int8-mirror");
    expect(json.downloadedBytes).toBe(50000);
    expect(json.totalBytes).toBe(100000);
    expect(json.filesCompleted).toBe(1);
    expect(json.filesTotal).toBe(3);
    expect(json.progressPercent).toBe(50.0);
    expect(json.updatedAtMs).toBe(1700000000000);

    // No snake_case
    expect(json.repo_id).toBeUndefined();
    expect(json.downloaded_bytes).toBeUndefined();
    expect(json.total_bytes).toBeUndefined();
    expect(json.files_completed).toBeUndefined();
    expect(json.files_total).toBeUndefined();
    expect(json.progress_percent).toBeUndefined();
    expect(json.updated_at_ms).toBeUndefined();
  });
});

// ===== LocalSttRuntimeStateResponse =====

describe("IPC Contract: LocalSttRuntimeStateResponse", () => {
  it("serializes with correct camelCase field names", () => {
    const response: LocalSttRuntimeStateResponse = {
      loaded: true,
      daemonCount: 1,
      loadedDaemonCount: 1,
      details: "Parakeet loaded.",
    };

    const json = JSON.parse(JSON.stringify(response));
    expect(json.loaded).toBe(true);
    expect(json.daemonCount).toBe(1);
    expect(json.loadedDaemonCount).toBe(1);

    // No snake_case
    expect(json.daemon_count).toBeUndefined();
    expect(json.loaded_daemon_count).toBeUndefined();
  });
});

// ===== TtsSetupStatusResponse =====

describe("IPC Contract: TtsSetupStatusResponse", () => {
  it("serializes with correct field names", () => {
    const response: TtsSetupStatusResponse = {
      running: false,
      completed: true,
      success: true,
      stage: "Piper ready.",
      logs: ["Setup complete."],
    };

    const json = JSON.parse(JSON.stringify(response));
    expect(json.running).toBe(false);
    expect(json.completed).toBe(true);
    expect(json.success).toBe(true);
    expect(json.stage).toBe("Piper ready.");
    expect(json.logs).toEqual(["Setup complete."]);
  });
});
