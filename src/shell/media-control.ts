/**
 * External media mute queue — Phase 5 shell decomposition.
 *
 * Owns the mute-while-dictating state machine: serialized control queue,
 * muted flag, and error-shown flag. Moved verbatim from main.tsx; shell
 * seams (settings read, notice, ipc) arrive via MediaControlDeps so this
 * module never touches main.tsx module globals.
 */
import { muteSystemAudio as ipcMuteSystemAudio } from "../ipc/client";
import { asErrorMessage } from "../utils";

export interface MediaControlDeps {
  isMutingEnabled: () => boolean;
  isTauri: () => boolean;
  notify: (message: string, isError?: boolean) => void;
}

let externalMediaMutedForDictation = false;
let externalMediaControlInFlight: Promise<void> | null = null;
let externalMediaControlErrorShown = false;

async function invokeSystemAudioMute(deps: MediaControlDeps, mute: boolean): Promise<void> {
  if (!deps.isTauri()) {
    return;
  }

  await ipcMuteSystemAudio(mute);
  externalMediaControlErrorShown = false;
}

export function isExternalMediaMutedForDictation(): boolean {
  return externalMediaMutedForDictation;
}

export function setExternalMediaMutedForDictation(muted: boolean): void {
  externalMediaMutedForDictation = muted;
}

function queueExternalMediaControl(
  deps: MediaControlDeps,
  task: () => Promise<void>,
): void {
  const previous = externalMediaControlInFlight ?? Promise.resolve();
  const next = previous
    .then(task)
    .catch((error: unknown) => {
      if (!externalMediaControlErrorShown) {
        deps.notify(`Unable to control media playback: ${asErrorMessage(error)}`, true);
        externalMediaControlErrorShown = true;
      }
    })
    .finally(() => {
      if (externalMediaControlInFlight === next) {
        externalMediaControlInFlight = null;
      }
    });
  externalMediaControlInFlight = next;
}

export function pauseExternalMediaForDictation(deps: MediaControlDeps): void {
  if (!deps.isMutingEnabled() || externalMediaMutedForDictation) {
    return;
  }

  queueExternalMediaControl(deps, async () => {
    if (!deps.isMutingEnabled() || externalMediaMutedForDictation) {
      return;
    }
    await invokeSystemAudioMute(deps, true);
    externalMediaMutedForDictation = true;
  });
}

export function resumeExternalMediaAfterDictation(deps: MediaControlDeps): void {
  if (!externalMediaMutedForDictation) {
    return;
  }

  queueExternalMediaControl(deps, async () => {
    if (!externalMediaMutedForDictation) {
      return;
    }
    await invokeSystemAudioMute(deps, false);
    externalMediaMutedForDictation = false;
  });
}

export function resetMediaControlForTests(): void {
  externalMediaMutedForDictation = false;
  externalMediaControlInFlight = null;
  externalMediaControlErrorShown = false;
}
