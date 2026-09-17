/**
 * TTS playback state machine — Phase 5 shell decomposition.
 *
 * Owns playGeneratedAudio + interruptTtsPlaybackForCaptureIntent. Moved
 * verbatim from main.tsx; shell seams (audio element, stage probes,
 * state-machine transitions, availability sync) arrive via initPlayback
 * so this module never touches main.tsx module globals.
 */
import type { ActiveTtsPlayback, TtsEngine } from "../types";

export type RecordingMachineEvent =
  | { type: "tts-playback-started" }
  | { type: "interrupt-playback" };

export interface PlaybackDeps {
  getActivePlayback: () => ActiveTtsPlayback | null;
  setActivePlayback: (playback: ActiveTtsPlayback | null) => void;
  getStage: () => string;
  transition: (event: RecordingMachineEvent) => void;
  syncAvailability: () => void;
}

let playbackAudio!: HTMLAudioElement;
let playbackDeps!: PlaybackDeps;

export function initPlayback(audio: HTMLAudioElement, deps: PlaybackDeps): void {
  playbackAudio = audio;
  playbackDeps = deps;
}

export function interruptTtsPlaybackForCaptureIntent(): boolean {
  const activePlayback = playbackDeps.getActivePlayback();
  if (!activePlayback && playbackDeps.getStage() !== "speaking") {
    return false;
  }

  if (activePlayback) {
    activePlayback.interrupted = true;
  }

  playbackAudio.pause();
  playbackAudio.currentTime = 0;
  playbackAudio.removeAttribute("src");
  playbackAudio.load();

  if (activePlayback) {
    activePlayback.finish(false);
  }

  if (playbackDeps.getStage() === "speaking") {
    playbackDeps.transition({ type: "interrupt-playback" });
    playbackDeps.syncAvailability();
  }

  return true;
}

export async function playGeneratedAudio(audioBase64: string, _engine: TtsEngine): Promise<boolean> {
  playbackDeps.transition({ type: "tts-playback-started" });

  let playback!: ActiveTtsPlayback;
  let settled = false;
  let completionResolve: ((completed: boolean) => void) | null = null;

  const completion = new Promise<boolean>((resolve) => {
    completionResolve = resolve;
  });

  const finishPlayback = (completed: boolean): void => {
    if (settled) {
      return;
    }
    settled = true;
    playbackAudio.removeEventListener("ended", onPlaybackDone);
    playbackAudio.removeEventListener("error", onPlaybackDone);
    if (playbackDeps.getActivePlayback() === playback) {
      playbackDeps.setActivePlayback(null);
    }
    completionResolve?.(completed);
  };

  const onPlaybackDone = (): void => {
    finishPlayback(!playback.interrupted);
  };

  playback = {
    interrupted: false,
    finish: finishPlayback,
  };

  playbackDeps.setActivePlayback(playback);
  playbackAudio.addEventListener("ended", onPlaybackDone);
  playbackAudio.addEventListener("error", onPlaybackDone);

  playbackAudio.src = `data:audio/wav;base64,${audioBase64}`;
  playbackAudio.currentTime = 0;
  try {
    await playbackAudio.play();
  } catch (error) {
    if (playback.interrupted) {
      finishPlayback(false);
      return false;
    }
    finishPlayback(false);
    throw error;
  }

  return completion;
}
