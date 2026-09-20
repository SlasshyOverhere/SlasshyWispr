import type { PersistedSettings } from "../types";

/**
 * Canonical audio utilities — Phase 5a (pure extraction from main.tsx).
 *
 * No DOM, no MediaRecorder, no invoke. Moved verbatim.
 */

export async function decodeAudioSample(file: Blob): Promise<AudioBuffer> {
  const AudioCtor = window.AudioContext;
  if (!AudioCtor) {
    throw new Error("Audio decoding is not supported in this environment.");
  }

  const context = new AudioCtor();
  try {
    const data = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(data.slice(0));
    return decoded;
  } finally {
    void context.close().catch(() => {
      // Ignore close errors for short-lived decode contexts.
    });
  }
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

export function pcmSamplesToWavBlob(
  channels: readonly Float32Array[],
  sampleRate: number,
): Blob {
  const numChannels = channels.length;
  const frameCount = channels[0]?.length ?? 0;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = frameCount * numChannels * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // Optimization: use Int16Array view on the same buffer for faster PCM writing
  // Offset 44 is where the data chunk starts.
  const pcmData = new Int16Array(wavBuffer, 44, dataSize / 2);

  let pcmIndex = 0;
  if (numChannels === 2) {
    const left = channels[0];
    const right = channels[1];
    for (let frame = 0; frame < frameCount; frame += 1) {
      let sL = left[frame];
      if (sL > 1) sL = 1;
      else if (sL < -1) sL = -1;
      pcmData[pcmIndex++] = sL < 0 ? Math.round(sL * 0x8000) : Math.round(sL * 0x7fff);

      let sR = right[frame];
      if (sR > 1) sR = 1;
      else if (sR < -1) sR = -1;
      pcmData[pcmIndex++] = sR < 0 ? Math.round(sR * 0x8000) : Math.round(sR * 0x7fff);
    }
  } else if (numChannels === 1) {
    const channelData = channels[0];
    for (let frame = 0; frame < frameCount; frame += 1) {
      let sample = channelData[frame];
      if (sample > 1) sample = 1;
      else if (sample < -1) sample = -1;
      pcmData[frame] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    }
  } else {
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < numChannels; channel += 1) {
        let sample = channels[channel]?.[frame] ?? 0;
        if (sample > 1) sample = 1;
        else if (sample < -1) sample = -1;
        pcmData[pcmIndex++] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      }
    }
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}

export function audioBufferToWavBlob(audioBuffer: AudioBuffer): Blob {
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    channels.push(audioBuffer.getChannelData(channel));
  }
  return pcmSamplesToWavBlob(channels, audioBuffer.sampleRate);
}

export function shouldOptimizeOnlineSttUpload(settings: PersistedSettings): boolean {
  return (
    settings.sttRuntimeMode === "online" &&
    settings.sttModelName.trim().toLocaleLowerCase().includes("whisper")
  );
}

export function resolvePreferredOnlineSttBitrate(settings: PersistedSettings): number | null {
  if (!shouldOptimizeOnlineSttUpload(settings)) {
    return null;
  }

  return 48_000;
}

export function missingApiKeyForOnlineRuntime(activeSettings: PersistedSettings): boolean {
  const anyOnlineRuntime =
    activeSettings.sttRuntimeMode === "online" || activeSettings.aiRuntimeMode === "online";
  const apiKeyPresent = activeSettings.apiKey.trim().length > 0;
  return anyOnlineRuntime && !apiKeyPresent;
}

/**
 * F-029: local STT needs a model, local AI needs an Ollama model. Catching
 * this before the recorder opens avoids capturing audio that cannot be
 * transcribed. Returns a user-facing reason, or null when the combination is
 * usable.
 */
export function invalidRuntimeCombinationReason(settings: PersistedSettings): string | null {
  if (missingApiKeyForOnlineRuntime(settings)) {
    return "Add an API key in Settings > Models before recording with an online runtime.";
  }
  if (settings.sttRuntimeMode === "local" && !settings.localSttModel.trim()) {
    return "Local STT needs a downloaded model. Open Settings > Models and pick one.";
  }
  if (settings.aiRuntimeMode === "local" && !settings.localOllamaModel.trim()) {
    return "Local AI needs an Ollama model. Open Settings > Models and pull one.";
  }
  if (settings.aiRuntimeMode === "local" && !settings.localOllamaBaseUrl.trim()) {
    return "Local AI needs an Ollama base URL. Open Settings > Models and set it.";
  }
  return null;
}

export function pickBestRecorderMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }

  return "";
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Failed to convert audio blob to base64"));

    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected FileReader output"));
        return;
      }

      const markerIndex = result.indexOf(",");
      if (markerIndex < 0) {
        reject(new Error("Unexpected base64 data URL format"));
        return;
      }

      resolve(result.slice(markerIndex + 1));
    };

    reader.readAsDataURL(blob);
  });
}

export function formatTimer(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  const tenths = Math.floor((elapsedMs % 1000) / 100);
  return `${String(seconds).padStart(2, "0")}.${tenths}s`;
}
