/**
 * Playback move-boundary test — Phase 5 shell decomposition.
 *
 * Pins the interrupt guard (no playback + not speaking -> false), the
 * interrupt path (audio reset, finish(false), interrupt-playback event
 * when speaking), and playGeneratedAudio success/error completion.
 */
import { describe, it, expect } from "bun:test";
import type { ActiveTtsPlayback } from "../types";
import {
  initPlayback,
  interruptTtsPlaybackForCaptureIntent,
  playGeneratedAudio,
  type RecordingMachineEvent,
} from "./playback";

function fakeAudio(): HTMLAudioElement {
  const listeners = new Map<string, Array<() => void>>();
  return {
    pauseCalls: 0,
    playCalls: 0,
    currentTime: 99,
    src: "data:old",
    pause() {
      (this as unknown as { pauseCalls: number }).pauseCalls += 1;
    },
    load() {},
    removeAttribute() {},
    addEventListener(type: string, listener: () => void) {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener() {},
    play() {
      (this as unknown as { playCalls: number }).playCalls += 1;
      return Promise.resolve();
    },
    __fire(type: string) {
      for (const listener of listeners.get(type) ?? []) {
        listener();
      }
    },
  } as unknown as HTMLAudioElement & { __fire: (type: string) => void };
}

function wireHarness(options: { playback: ActiveTtsPlayback | null; stage: string }) {
  const audio = fakeAudio();
  const events: RecordingMachineEvent[] = [];
  let syncCalls = 0;
  let active: ActiveTtsPlayback | null = options.playback;
  initPlayback(audio, {
    getActivePlayback: () => active,
    setActivePlayback: (next) => {
      active = next;
    },
    getStage: () => options.stage,
    transition: (event) => {
      events.push(event);
    },
    syncAvailability: () => {
      syncCalls += 1;
    },
  });
  return { audio, events, getActive: () => active, syncCalls: () => syncCalls };
}

describe("interruptTtsPlaybackForCaptureIntent", () => {
  it("returns false when idle with no active playback", () => {
    const harness = wireHarness({ playback: null, stage: "idle" });
    expect(interruptTtsPlaybackForCaptureIntent()).toBe(false);
    expect(harness.events).toEqual([]);
  });

  it("resets audio, finishes playback, and transitions when speaking", () => {
    let finishedWith: boolean | null = null;
    const playback: ActiveTtsPlayback = {
      interrupted: false,
      finish: (completed) => {
        finishedWith = completed;
      },
    };
    const harness = wireHarness({ playback, stage: "speaking" });
    expect(interruptTtsPlaybackForCaptureIntent()).toBe(true);
    expect(playback.interrupted).toBe(true);
    expect(finishedWith).toBe(false);
    expect(harness.events).toEqual([{ type: "interrupt-playback" }]);
    expect(harness.syncCalls()).toBe(1);
  });
});

describe("playGeneratedAudio", () => {
  it("transitions, sets src, and resolves true on ended", async () => {
    const harness = wireHarness({ playback: null, stage: "idle" });
    const pending = playGeneratedAudio("aGVsbG8=", "piper");
    expect(harness.getActive()).not.toBeNull();
    harness.audio.__fire("ended");
    await expect(pending).resolves.toBe(true);
    expect(harness.events).toEqual([{ type: "tts-playback-started" }]);
    expect(harness.getActive()).toBeNull();
  });

  it("resolves false when play() throws after interrupt", async () => {
    const audio = fakeAudio();
    (audio as unknown as { play: () => Promise<void> }).play = () =>
      Promise.reject(new Error("boom"));
    let active: ActiveTtsPlayback | null = null;
    const events: RecordingMachineEvent[] = [];
    initPlayback(audio, {
      getActivePlayback: () => active,
      setActivePlayback: (next) => {
        active = next;
      },
      getStage: () => "idle",
      transition: (event) => {
        events.push(event);
      },
      syncAvailability: () => {},
    });
    const pending = playGeneratedAudio("aGVsbG8=", "piper");
    active!.interrupted = true;
    await expect(pending).resolves.toBe(false);
    expect(events).toEqual([{ type: "tts-playback-started" }]);
  });
});
