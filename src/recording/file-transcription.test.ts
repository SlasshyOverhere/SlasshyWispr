import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  handleTranscribeFileRequest,
  initFileTranscription,
  shouldIgnoreTranscribeRequest,
} from "./file-transcription";
import type { FileTranscriptionDeps } from "./file-transcription";
import type { AudioFilePayload } from "../types";

function payloadFor(text: string): AudioFilePayload {
  return {
    fileName: "note.wav",
    mimeType: "audio/wav",
    // "RIFF" base64, enough to assert the bytes survive the round trip.
    base64: btoa(text),
    byteLength: text.length,
  };
}

interface Harness {
  deps: FileTranscriptionDeps;
  runPipeline: ReturnType<typeof mock>;
  notify: ReturnType<typeof mock>;
  logs: string[];
}

async function harness(
  overrides: Partial<FileTranscriptionDeps> = {},
): Promise<Harness> {
  const runPipeline = mock(async () => {});
  const notify = mock(() => {});
  const logs: string[] = [];

  const deps: FileTranscriptionDeps = {
    // isTauri false keeps init from wiring a transport while still binding deps.
    isTauri: () => false,
    isPipelineRunning: () => false,
    runPipeline,
    log: (message) => logs.push(message),
    notify,
    readAudioFile: async () => payloadFor("RIFF"),
    takePendingFile: async () => null,
    onRequest: async () => () => {},
    ...overrides,
  };

  await initFileTranscription(deps);
  return { deps, runPipeline, notify, logs };
}

describe("shouldIgnoreTranscribeRequest", () => {
  it("ignores an empty or whitespace path", () => {
    expect(shouldIgnoreTranscribeRequest("", 1_000, "", 0)).toBe(true);
    expect(shouldIgnoreTranscribeRequest("   ", 1_000, "", 0)).toBe(true);
  });

  it("handles a first-time path", () => {
    expect(shouldIgnoreTranscribeRequest("C:\\a.wav", 1_000, "", 0)).toBe(false);
  });

  it("ignores a repeat of the same path inside the window", () => {
    expect(shouldIgnoreTranscribeRequest("C:\\a.wav", 2_000, "C:\\a.wav", 1_000)).toBe(true);
  });

  it("allows the same path again after the window elapses", () => {
    expect(shouldIgnoreTranscribeRequest("C:\\a.wav", 10_000, "C:\\a.wav", 1_000)).toBe(false);
  });

  it("treats a different path as a new request", () => {
    expect(shouldIgnoreTranscribeRequest("C:\\b.wav", 1_100, "C:\\a.wav", 1_000)).toBe(false);
  });
});

describe("handleTranscribeFileRequest", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("reads the file and feeds it to the pipeline with its mime type", async () => {
    const { runPipeline, notify } = await harness();

    await handleTranscribeFileRequest("C:\\audio\\first.wav");

    expect(runPipeline).toHaveBeenCalledTimes(1);
    const [blob, mimeType] = runPipeline.mock.calls[0] as [Blob, string];
    expect(mimeType).toBe("audio/wav");
    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(4);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("refuses to start while a pipeline is already running", async () => {
    const { runPipeline, notify } = await harness({ isPipelineRunning: () => true });

    await handleTranscribeFileRequest("C:\\audio\\busy.wav");

    expect(runPipeline).not.toHaveBeenCalled();
    expect(String(notify.mock.calls[0]?.[0])).toContain("Finish the current transcription");
  });

  it("surfaces an unreadable file instead of throwing", async () => {
    const { runPipeline, notify } = await harness({
      readAudioFile: async () => {
        throw new Error("not a supported audio file");
      },
    });

    await handleTranscribeFileRequest("C:\\audio\\broken.txt");

    expect(runPipeline).not.toHaveBeenCalled();
    expect(String(notify.mock.calls[0]?.[0])).toContain("Could not transcribe that file");
    expect(notify.mock.calls[0]?.[1]).toBe(true);
  });

  it("ignores the same request repeated in quick succession", async () => {
    const { runPipeline } = await harness();

    await handleTranscribeFileRequest("C:\\audio\\twice.wav");
    await handleTranscribeFileRequest("C:\\audio\\twice.wav");

    expect(runPipeline).toHaveBeenCalledTimes(1);
  });
});
