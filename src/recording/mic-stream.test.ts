/**
 * Mic-stream move-boundary test — Phase 5 shell decomposition.
 *
 * Pins openMicrophoneStream behavior: pre-warmed reuse (clone, no fresh
 * getUserMedia), exact-device failure without a default fallback, and
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

  it("rejects an exact-device failure instead of falling back to the default", async () => {
    getUserMediaImpl = async () => {
      throw new Error("device gone");
    };

    let error: unknown;
    try {
      await openMicrophoneStream("missing-mic");
    } catch (caught) {
      error = caught;
    }

    expect((error as Error).message).toBe("device gone");
    expect(getUserMediaCalls).toBe(1);
    expect(notices).toEqual([]);
  });

  it("keeps the pre-warm TTL armed after a reuse", async () => {
    cannedStream = fakeStream(true);
    getUserMediaImpl = async () => cannedStream!;

    const realSetTimeout = window.setTimeout;
    const realClearTimeout = window.clearTimeout;
    const timers = new Map<number, () => void>();
    const cleared: number[] = [];
    let nextId = 1;
    (window as unknown as { setTimeout: unknown }).setTimeout = (handler: () => void) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, handler);
      return id;
    };
    (window as unknown as { clearTimeout: unknown }).clearTimeout = (id?: number) => {
      cleared.push(Number(id));
    };

    try {
      await preWarmMicrophoneStream("mic-a");
      const ttlTimerId = timers.size;
      expect(ttlTimerId).toBeGreaterThan(0);

      await openMicrophoneStream("mic-a");
      // Cancelling the deadline on reuse is what left the mic open for good.
      expect(cleared).not.toContain(ttlTimerId);

      timers.get(ttlTimerId)?.();
      expect(cannedStream.tracks[0].stopped).toBe(true);
    } finally {
      window.setTimeout = realSetTimeout;
      window.clearTimeout = realClearTimeout;
    }
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

  it("F-006: refuses reuse once the prewarm TTL has elapsed", async () => {
    cannedStream = fakeStream(true);
    getUserMediaImpl = async () => cannedStream!;
    await preWarmMicrophoneStream("mic-a");
    const prewarmCalls = getUserMediaCalls;

    // Age the prewarm past its TTL (60s) without waiting in real time.
    const realNow = Date.now;
    Date.now = () => realNow() + 61_000;
    try {
      const fresh = fakeStream(true);
      getUserMediaImpl = async () => fresh;
      const opened = await openMicrophoneStream("mic-a");
      expect(opened as unknown as FakeStream).toBe(fresh as unknown as FakeStream);
      expect(getUserMediaCalls).toBe(prewarmCalls + 1);
    } finally {
      Date.now = realNow;
    }
  });

  it("F-006: releases the pre-warmed stream when the window blurs", async () => {
    cannedStream = fakeStream(true);
    getUserMediaImpl = async () => cannedStream!;
    await preWarmMicrophoneStream("mic-a");

    window.dispatchEvent(new Event("blur"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cannedStream.tracks[0].stopped).toBe(true);
  });
});
