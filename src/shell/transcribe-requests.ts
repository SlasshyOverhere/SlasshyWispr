/**
 * Tauri adapters for file transcription requests — Phase 5 shell seam.
 *
 * Keeps `@tauri-apps/api` out of `recording/file-transcription.ts` so that
 * module stays unit-testable, matching how the tray and updater flows split.
 */
import { listen } from "@tauri-apps/api/event";
import { APP_EVENT_TRANSCRIBE_FILE } from "../constants";
import { readAudioFileBase64, takePendingTranscribeFile } from "../ipc/client";
import type { AudioFilePayload } from "../types";

export function readAudioFile(path: string): Promise<AudioFilePayload> {
  return readAudioFileBase64(path);
}

export function takePendingFile(): Promise<string | null> {
  return takePendingTranscribeFile();
}

export async function onTranscribeRequest(
  handler: (path: string) => void,
): Promise<() => void> {
  return listen<{ path?: string }>(APP_EVENT_TRANSCRIBE_FILE, (event) => {
    handler(event.payload?.path ?? "");
  });
}
