/**
 * Capture-monitors move-boundary test — Phase 5 shell decomposition.
 *
 * Pins the ticker (reset label, 100ms interval writes elapsed time,
 * stop clears), releaseMicrophone (stops tracks, clears via setter),
 * and stopAmplitudeMonitoring reset behavior (publishes only when the
 * level was nonzero).
 */
import { describe, it, expect, beforeEach } from "bun:test";
import {
  beginRecordingTicker,
  initCaptureMonitors,
  releaseMicrophone,
  stopAmplitudeMonitoring,
  stopRecordingTicker,
} from "./capture-monitors";

function fakeTimer(): HTMLSpanElement {
  return { textContent: "" } as unknown as HTMLSpanElement;
}

function wireHarness(options: { amplitude?: number; startedAt?: number } = {}) {
  const timer = fakeTimer();
  let amplitude = options.amplitude ?? 0;
  let publishes = 0;
  let stream: MediaStream | null = {
    getTracks: () => [
      { stopped: false, stop(this: { stopped: boolean }) { this.stopped = true; } },
    ],
  } as unknown as MediaStream;
  initCaptureMonitors(
    { recordTimer: timer },
    {
      getAmplitude: () => amplitude,
      setAmplitude: (level) => {
        amplitude = level;
      },
      publishDockState: () => {
        publishes += 1;
      },
      now: () => 5_000,
      getRecordingStartedAt: () => options.startedAt ?? 4_500,
      getMediaStream: () => stream,
      setMediaStream: (next) => {
        stream = next;
      },
    },
  );
  return {
    timer,
    getAmplitude: () => amplitude,
    publishes: () => publishes,
    getStream: () => stream,
  };
}

beforeEach(() => {
  stopRecordingTicker();
  stopAmplitudeMonitoring(false);
});

describe("beginRecordingTicker / stopRecordingTicker", () => {
  it("resets the label and writes elapsed time on a fake 100ms clock", () => {
    const harness = wireHarness({ startedAt: 4_500 });
    const labels: string[] = [];
    let clock = 0;
    const realSetInterval = globalThis.setInterval;
    (globalThis as unknown as { setInterval: unknown }).setInterval = (
      fn: () => void,
    ) => {
      clock += 1;
      if (clock === 1) {
        fn();
        labels.push(harness.timer.textContent);
      }
      return 7 as unknown as ReturnType<typeof setInterval>;
    };
    try {
      beginRecordingTicker();
    } finally {
      (globalThis as unknown as { setInterval: unknown }).setInterval = realSetInterval;
    }
    stopRecordingTicker();
    // now()=5000, startedAt=4500 -> "00.5s"
    expect(labels).toEqual(["00.5s"]);
  });
});

describe("releaseMicrophone", () => {
  it("stops tracks and clears the stream", () => {
    const harness = wireHarness();
    releaseMicrophone();
    expect(harness.getStream()).toBeNull();
  });
});

describe("stopAmplitudeMonitoring", () => {
  it("publishes only when resetting a nonzero level", () => {
    const idle = wireHarness({ amplitude: 0 });
    stopAmplitudeMonitoring(true);
    expect(idle.publishes()).toBe(0);

    const active = wireHarness({ amplitude: 0.5 });
    stopAmplitudeMonitoring(true);
    expect(active.getAmplitude()).toBe(0);
    expect(active.publishes()).toBe(1);
  });
});
