/**
 * Dictation sound effects — Phase 5 shell decomposition.
 *
 * Owns the WebAudio beep profiles + shared AudioContext. Moved verbatim
 * from main.tsx; sound selection/volume arrive via SoundDeps so this
 * module never touches main.tsx module globals.
 */
import type { PersistedSettings } from "../types";

export interface SoundDeps {
  currentSettings: () => PersistedSettings;
  previewVolume: () => number;
}

let effectAudioContext: AudioContext | null = null;

export function playDictationSoundEffect(
  deps: SoundDeps,
  kind: "start" | "stop" | "error",
  previewSoundId?: string,
): void {
  const settings = deps.currentSettings();
  if (!previewSoundId && !settings.dictationSoundEffects) {
    return;
  }

  const AudioCtor = window.AudioContext;
  if (!AudioCtor) {
    return;
  }

  if (!effectAudioContext) {
    effectAudioContext = new AudioCtor();
  }

  if (effectAudioContext.state === "suspended") {
    void effectAudioContext.resume().catch(() => {
      // Ignore resume failures so recording flow is never blocked.
    });
  }

  const soundIdToPlay = previewSoundId || (kind === "start" ? settings.pushToTalkSound : kind === "stop" ? settings.pushToTalkEndSound : "error");

  let profile: { frequencies: number[], durations: number[], type: OscillatorType };

  switch (soundIdToPlay) {
    case "beep-start":
      profile = { frequencies: [680, 920], durations: [0.06, 0.08], type: "sine" };
      break;
    case "beep-end":
      profile = { frequencies: [580], durations: [0.1], type: "triangle" };
      break;
    case "click":
      profile = { frequencies: [1000], durations: [0.03], type: "square" };
      break;
    case "pop":
      profile = { frequencies: [400], durations: [0.05], type: "sine" };
      break;
    case "ding":
      profile = { frequencies: [880], durations: [0.2], type: "sine" };
      break;
    case "chirp":
      profile = { frequencies: [400, 800], durations: [0.05, 0.05], type: "sine" };
      break;
    case "blip":
      profile = { frequencies: [1200], durations: [0.05], type: "square" };
      break;
    case "thud":
      profile = { frequencies: [150], durations: [0.08], type: "sine" };
      break;
    case "whoosh":
      profile = { frequencies: [200, 100], durations: [0.06, 0.06], type: "sine" };
      break;
    case "chime":
      profile = { frequencies: [523, 659], durations: [0.07, 0.08], type: "sine" };
      break;
    case "buzz":
      profile = { frequencies: [180], durations: [0.1], type: "sawtooth" };
      break;
    case "ping":
      profile = { frequencies: [2000], durations: [0.04], type: "sine" };
      break;
    case "error":
      profile = { frequencies: [260, 190], durations: [0.1, 0.12], type: "square" };
      break;
    default:
      profile = { frequencies: [680, 920], durations: [0.06, 0.08], type: "sine" };
      break;
  }

  const baseVolume = previewSoundId ?
    (deps.previewVolume() / 100) * 0.14 :
    settings.pushToTalkSoundVolume * 0.14;

  let offset = 0;
  for (let index = 0; index < profile.frequencies.length; index += 1) {
    const frequency = profile.frequencies[index] ?? profile.frequencies[0] ?? 440;
    const duration = profile.durations[index] ?? 0.1;
    const startAt = effectAudioContext.currentTime + offset;
    offset += duration * 0.72;

    const oscillator = effectAudioContext.createOscillator();
    const gain = effectAudioContext.createGain();
    oscillator.type = profile.type;
    oscillator.frequency.setValueAtTime(frequency, startAt);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(baseVolume, startAt + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(gain);
    gain.connect(effectAudioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  }
}
