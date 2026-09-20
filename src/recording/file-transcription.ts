/**
 * File transcription intake — backs Explorer's "Transcribe with SlasshyWispr".
 *
 * A file has two ways in: Rust parks the path in state during a cold start
 * (no frontend listener exists yet), or emits an event when a second launch
 * forwards a request to the running instance. Both end up in the same pipeline
 * a recording would use, so the transcript lands wherever the user is typing.
 *
 * Tauri/transport seams arrive via `initFileTranscription`; this module owns
 * only the request handling.
 */
import type { AudioFilePayload } from "../types";
import { asErrorMessage } from "../utils";
import { base64ToBytes } from "./audio-utils";

export interface FileTranscriptionDeps {
  isTauri: () => boolean;
  isPipelineRunning: () => boolean;
  runPipeline: (blob: Blob, mimeType: string) => Promise<void>;
  log: (message: string) => void;
  notify: (message: string, isError?: boolean) => void;
  readAudioFile: (path: string) => Promise<AudioFilePayload>;
  /** Path parked by Rust during a cold start, if any. */
  takePendingFile: () => Promise<string | null>;
  /** Subscribe to forwarded requests; resolves to an unsubscribe function. */
  onRequest: (handler: (path: string) => void) => Promise<() => void>;
}

/**
 * Explorer can fire a verb more than once for one user action, and a failed
 * attempt must not be retried in a loop. Ignore an empty path and a repeat of
 * the same path inside a short window.
 */
export function shouldIgnoreTranscribeRequest(
  path: string,
  now: number,
  lastPath: string,
  lastHandledAt: number,
  windowMs = 4_000,
): boolean {
  if (!path.trim()) {
    return true;
  }
  return path === lastPath && now - lastHandledAt < windowMs;
}

let deps: FileTranscriptionDeps | null = null;
let unsubscribe: (() => void) | null = null;
let lastHandledPath = "";
let lastHandledAt = 0;

export async function handleTranscribeFileRequest(path: string): Promise<void> {
  if (!deps) {
    return;
  }

  const now = Date.now();
  if (shouldIgnoreTranscribeRequest(path, now, lastHandledPath, lastHandledAt)) {
    deps.log(`[shell.transcribe] ignoring duplicate or empty request path=${path || "<empty>"}`);
    return;
  }
  lastHandledPath = path;
  lastHandledAt = now;

  if (deps.isPipelineRunning()) {
    deps.notify("Finish the current transcription before transcribing a file.", true);
    return;
  }

  try {
    const payload = await deps.readAudioFile(path);
    deps.log(
      `[shell.transcribe] file='${payload.fileName}' bytes=${payload.byteLength} mime=${payload.mimeType}`,
    );

    const blob = new Blob([base64ToBytes(payload.base64)], { type: payload.mimeType });
    deps.notify(`Transcribing ${payload.fileName}...`);
    await deps.runPipeline(blob, payload.mimeType);
  } catch (error) {
    const message = asErrorMessage(error);
    deps.log(`[shell.transcribe] failed: ${message}`);
    deps.notify(`Could not transcribe that file: ${message}`, true);
  }
}

export async function initFileTranscription(nextDeps: FileTranscriptionDeps): Promise<void> {
  deps = nextDeps;

  if (!deps.isTauri()) {
    return;
  }

  if (!unsubscribe) {
    unsubscribe = await deps.onRequest((path) => {
      void handleTranscribeFileRequest(path);
    });
  }

  try {
    const pending = await deps.takePendingFile();
    if (pending) {
      void handleTranscribeFileRequest(pending);
    }
  } catch (error) {
    deps.log(`[shell.transcribe] pending request lookup failed: ${asErrorMessage(error)}`);
  }
}

export function teardownFileTranscription(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
