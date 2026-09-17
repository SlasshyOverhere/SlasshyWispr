/**
 * Mic-stream move-boundary test — Phase 5 shell decomposition.
 *
 * Pins openMicrophoneStream behavior: pre-warmed reuse (clone, no fresh
 * getUserMedia), device-fallback notice on exact-device failure, and
 * preWarm reuse/release transitions. Uses injectable navigator stubs.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  initMicStream,
  openMicrophoneStream,
  preWarmMicrophoneStream,
  releasePreWarmedStream,
} from "./mic-stream";
import { setMicrophonePermissionGranted } from "../shell/microphones";

interface FakeTrack {
  stopped: boolean;
  stop(): void;
}

interface FakeStream {
  tracks: FakeTrack[];
  active: boolean;
  clonedFrom: FakeStream | null;
  getTracks(): FakeTrack[];
  clone(): FakeStream;
}

function fakeTrack(): FakeTrack {
  return {
    stopped: false,
    stop(this: FakeTrack) {
      this.stopped = true;
    },
  };
}

function fakeStream(active = true): FakeStream {
  const stream: FakeStream = {
    tracks: [fakeTrack()],
    active,
    clonedFrom: null,
    getTracks() {
      return this.tracks;
    },
    clone() {
      const copy = fakeStream(this.active);
      copy.clonedFrom = this;
      return copy;
    },
  };
  return stream;
}

const notices: Array<{ message: string; isError?: boolean }> = [];
const logs: string[] = [];
let cannedStream: FakeStream | null = null;
let getUserMediaCalls = 0;
let getUserMediaImpl: (constraints: MediaStreamConstraints) => Promise<FakeStream> =
  async () => fakeStream();

function installNavigatorStub(): void {
  (globalThis as unknown as { navigator: unknown }).navigator = {
    mediaDevices: {
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        getUserMediaCalls += 1;
        return getUserMediaImpl(constraints);
      },
    },
  };
}

beforeEach(() => {
  notices.length = 0;
  logs.length = 0;
  cannedStream = null;
  getUserMediaCalls = 0;
  getUserMediaImpl = async () => fakeStream();
  installNavigatorStub();
  setMicrophonePermissionGranted(false);
  initMicStream({
    notify: (message, isError) => {
      notices.push({ message, isError });
    },
    log: (message) => {
      logs.push(message);
    },
  });
});

describe("openMicrophoneStream", () => {
  it("reuses an active pre-warmed stream without fresh getUserMedia", async () => {
    cannedStream = fakeStream(true);
    getUserMediaImpl = async () => cannedStream!;
    await preWarmMicrophoneStream("mic-a");
    expect(getUserMediaCalls).toBe(1);

    const opened = (await openMicrophoneStream("mic-a")) as unknown as FakeStream;
    expect(opened.clonedFrom).toBe(cannedStream);
    expect(getUserMediaCalls).toBe(1);
    expect(logs.some((line) => line.includes("reusing pre-warmed stream"))).toBe(true);
  });

  it("falls back to default device with notice when exact device fails", async () => {
    const fallback = fakeStream(true);
    getUserMediaImpl = async (constraints) => {
      const audio = constraints.audio as Record<string, unknown>;
      if (audio && typeof audio === "object" && "deviceId" in audio) {
        throw new Error("device gone");
      }
      return fallback;
    };

    const opened = await openMicrophoneStream("missing-mic");
    expect(opened as unknown as FakeStream).toBe(fallback as unknown as FakeStream);
    expect(notices).toEqual([
      { message: "Selected microphone is unavailable. Falling back to default device.", isError: true },
    ]);
  });

  it("skips pre-warmed reuse for a different device", async () => {
    cannedStream = fakeStream(true);
    getUserMediaImpl = async () => cannedStream!;
    await preWarmMicrophoneStream("mic-a");
    const callsAfterPrewarm = getUserMediaCalls;

    const other = fakeStream(true);
    getUserMediaImpl = async () => other;
    const opened = await openMicrophoneStream("mic-b");
    expect(opened as unknown as FakeStream).toBe(other as unknown as FakeStream);
    expect(getUserMediaCalls).toBe(callsAfterPrewarm + 1);
  });
});

describe("releasePreWarmedStream", () => {
  it("stops tracks and logs the release", async () => {
    cannedStream = fakeStream(true);
    getUserMediaImpl = async () => cannedStream!;
    await preWarmMicrophoneStream("mic-a");
    await releasePreWarmedStream();
    expect(cannedStream.tracks[0].stopped).toBe(true);
    expect(logs.some((line) => line.includes("released pre-warmed stream"))).toBe(true);
  });
});
