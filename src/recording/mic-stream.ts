/**
 * Microphone stream prewarm/open helpers — Phase 5 shell decomposition.
 *
 * Owns canPreWarmMicrophone + openMicrophoneStream + preWarmMicrophoneStream
 * + releasePreWarmedStream. Moved verbatim from main.tsx; the pre-warmed
 * stream state lives here, and shell seams (notice/log) arrive via
 * initMicStream so this module never touches main.tsx module globals.
 */
import { isMicrophonePermissionGranted } from "../shell/microphones";
import { asErrorMessage } from "../utils";

export interface MicStreamDeps {
  notify: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
}

let micDeps!: MicStreamDeps;
let preWarmedStream: MediaStream | null = null;
let preWarmedStreamDeviceId: string | null = null;
let preWarmedStreamCreateTime = 0;

export function initMicStream(deps: MicStreamDeps): void {
  micDeps = deps;
}

export async function canPreWarmMicrophone(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return false;
  }

  if (isMicrophonePermissionGranted()) {
    return true;
  }

  if (typeof navigator.permissions?.query !== "function") {
    return false;
  }

  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}

export async function openMicrophoneStream(preferredDeviceId: string): Promise<MediaStream> {
  if (preWarmedStream && preWarmedStreamDeviceId === preferredDeviceId && preWarmedStream.active) {
    micDeps.log(`[record.mic] reusing pre-warmed stream age=${Date.now() - preWarmedStreamCreateTime}ms`);
    const clonedStream = preWarmedStream.clone();
    return clonedStream;
  }

  await releasePreWarmedStream();

  const baseConstraints: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  if (preferredDeviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseConstraints,
          deviceId: { exact: preferredDeviceId },
        },
      });
    } catch {
      micDeps.notify("Selected microphone is unavailable. Falling back to default device.", true);
    }
  }

  return navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
}

export async function releasePreWarmedStream(): Promise<void> {
  if (!preWarmedStream) return;
  for (const track of preWarmedStream.getTracks()) {
    track.stop();
  }
  preWarmedStream = null;
  preWarmedStreamDeviceId = null;
  preWarmedStreamCreateTime = 0;
  micDeps.log("[record.prewarm] released pre-warmed stream");
}

export async function preWarmMicrophoneStream(deviceId: string): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;

  if (preWarmedStream && preWarmedStreamDeviceId === deviceId && preWarmedStream.active) {
    return;
  }

  await releasePreWarmedStream();

  const baseConstraints: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  try {
    const constraints: MediaStreamConstraints = {
      audio: deviceId
        ? { ...baseConstraints, deviceId: { exact: deviceId } }
        : baseConstraints,
    };
    preWarmedStream = await navigator.mediaDevices.getUserMedia(constraints);
    preWarmedStreamDeviceId = deviceId;
    preWarmedStreamCreateTime = Date.now();
    micDeps.log(`[record.prewarm] stream opened deviceId=${deviceId || "default"}`);
  } catch (error) {
    micDeps.log(`[record.prewarm] failed: ${asErrorMessage(error)}`);
    preWarmedStream = null;
    preWarmedStreamDeviceId = null;
  }
}
