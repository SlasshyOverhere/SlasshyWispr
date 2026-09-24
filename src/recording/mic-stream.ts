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

// F-006: a pre-warmed stream holds the mic open (device light on, battery
// drain) for as long as it lives. Keep it briefly, then release it.
// ponytail: fixed TTL; add a user setting only if someone asks to disable prewarm.
const PREWARM_TTL_MS = 60_000;

let micDeps!: MicStreamDeps;
let preWarmedStream: MediaStream | null = null;
let preWarmedStreamDeviceId: string | null = null;
let preWarmedStreamCreateTime = 0;
let preWarmExpiryTimer: ReturnType<typeof setTimeout> | null = null;

let lifecycleListenersAttached = false;

export function initMicStream(deps: MicStreamDeps): void {
  micDeps = deps;
  if (lifecycleListenersAttached) {
    return;
  }
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return;
  }
  lifecycleListenersAttached = true;
  // Releasing on hide/visibility stops the mic from staying open while the
  // app is in the background and nobody can record.
  window.addEventListener("blur", () => {
    void releasePreWarmedStream();
  });
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        void releasePreWarmedStream();
      }
    });
  }
}

function isPrewarmExpired(): boolean {
  return preWarmedStreamCreateTime > 0
    && Date.now() - preWarmedStreamCreateTime >= PREWARM_TTL_MS;
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
  if (
    preWarmedStream &&
    preWarmedStreamDeviceId === preferredDeviceId &&
    preWarmedStream.active &&
    !isPrewarmExpired()
  ) {
    micDeps.log(`[record.mic] reusing pre-warmed stream age=${Date.now() - preWarmedStreamCreateTime}ms`);
    // The deadline stays armed: a clone owns its own tracks, so releasing the
    // source on schedule cannot cut this capture short — and cancelling the TTL
    // here would hold the device open for the rest of the session.
    return preWarmedStream.clone();
  }

  await releasePreWarmedStream();

  const baseConstraints: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  if (preferredDeviceId) {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        ...baseConstraints,
        deviceId: { exact: preferredDeviceId },
      },
    });
  }

  return navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
}

export async function releasePreWarmedStream(): Promise<void> {
  clearPrewarmExpiryTimer();
  if (!preWarmedStream) return;
  for (const track of preWarmedStream.getTracks()) {
    track.stop();
  }
  preWarmedStream = null;
  preWarmedStreamDeviceId = null;
  preWarmedStreamCreateTime = 0;
  micDeps.log("[record.prewarm] released pre-warmed stream");
}

function clearPrewarmExpiryTimer(): void {
  if (preWarmExpiryTimer !== null) {
    clearTimeout(preWarmExpiryTimer);
    preWarmExpiryTimer = null;
  }
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
    clearPrewarmExpiryTimer();
    preWarmExpiryTimer = setTimeout(() => {
      micDeps.log(`[record.prewarm] TTL ${PREWARM_TTL_MS}ms reached; releasing idle stream`);
      void releasePreWarmedStream();
    }, PREWARM_TTL_MS);
    micDeps.log(`[record.prewarm] stream opened deviceId=${deviceId || "default"}`);
  } catch (error) {
    micDeps.log(`[record.prewarm] failed: ${asErrorMessage(error)}`);
    preWarmedStream = null;
    preWarmedStreamDeviceId = null;
  }
}
