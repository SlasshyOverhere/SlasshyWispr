import { describe, expect, it } from "bun:test";

import {
  alignEdits,
  compareToBaseline,
  type BenchRecord,
  formatTable,
  type ModelScore,
  normalizeTranscript,
  parseManifest,
  percentile,
  scoreRun,
  summarizeLatency,
  wordErrorRate,
} from "./bench-scoring";

const manifest = (models: string[], clips: { id: string; reference?: string | null }[]) =>
  parseManifest({
    models,
    clips: clips.map((clip) => ({ ...clip, audio: `${clip.id}.wav` })),
  });

const record = (overrides: Partial<BenchRecord>): BenchRecord => ({
  model: "m",
  clipId: "c1",
  index: 0,
  cold: true,
  reference: "hello world",
  audio: "c1.wav",
  ok: true,
  text: "hello world",
  latencyMs: 100,
  ...overrides,
});

describe("normalizeTranscript", () => {
  it("folds case, punctuation and whitespace so formatting is not scored as error", () => {
    expect(normalizeTranscript("Hello,   World!")).toEqual(["hello", "world"]);
    expect(normalizeTranscript("Um — well…")).toEqual(["um", "well"]);
  });

  it("keeps apostrophes inside words but drops quotation marks standing alone", () => {
    expect(normalizeTranscript("don't 'quote' me")).toEqual(["don't", "quote", "me"]);
  });

  it("normalizes width and compatibility forms", () => {
    expect(normalizeTranscript("ＨＥＬＬＯ")).toEqual(["hello"]);
  });

  it("folds digits to words so number formatting is not scored as error", () => {
    expect(normalizeTranscript("at 3:30")).toEqual(normalizeTranscript("at three thirty"));
    expect(normalizeTranscript("2 apples")).toEqual(["two", "apples"]);
    expect(normalizeTranscript("21 people")).toEqual(["twenty", "one", "people"]);
    expect(normalizeTranscript("20 people")).toEqual(["twenty", "people"]);
  });

  it("leaves numbers it cannot spell out rather than guessing", () => {
    expect(normalizeTranscript("in 2026")).toEqual(["in", "2026"]);
    expect(normalizeTranscript("call 555 1234")).toEqual(["call", "555", "1234"]);
  });

  it("returns nothing for empty or symbol-only input", () => {
    expect(normalizeTranscript("")).toEqual([]);
    expect(normalizeTranscript("   ")).toEqual([]);
    expect(normalizeTranscript("...")).toEqual([]);
  });

  it("splits scripts without word spacing into characters", () => {
    expect(normalizeTranscript("你好世界")).toEqual(["你", "好", "世", "界"]);
    // Punctuation cannot separate tokens in a language that has none: the same sentence
    // with and without it must produce the same tokens.
    expect(normalizeTranscript("你好，世界.")).toEqual(normalizeTranscript("你好世界"));
  });

  it("keeps latin runs whole inside a mixed token", () => {
    expect(normalizeTranscript("你好world")).toEqual(["你", "好", "world"]);
  });
});

describe("wordErrorRate on scripts without word spacing", () => {
  it("scores a punctuation-only difference as no error", () => {
    // The real case this guards: SenseVoice drops CJK punctuation, and scoring that as an
    // error reported a perfect transcript as 100% wrong.
    const score = wordErrorRate("真诚，就是不欺人也不自欺.", "真诚就是不欺人也不自欺");
    expect(score.errors).toBe(0);
    expect(score.wer).toBe(0);
  });

  it("still counts a genuinely wrong character once", () => {
    const score = wordErrorRate("你好世界", "你好四界");
    expect(score.substitutions).toBe(1);
    expect(score.referenceWords).toBe(4);
    expect(score.wer).toBeCloseTo(0.25, 5);
  });
});

describe("wordErrorRate", () => {
  it("scores an exact match as zero errors", () => {
    const scored = wordErrorRate("the quick brown fox", "the quick brown fox");
    expect(scored.errors).toBe(0);
    expect(scored.wer).toBe(0);
    expect(scored.referenceWords).toBe(4);
  });

  it("ignores differences that are only casing or punctuation", () => {
    expect(wordErrorRate("Hello, world.", "hello world").wer).toBe(0);
  });

  it("counts a substitution", () => {
    const scored = wordErrorRate("the cat sat", "the dog sat");
    expect(scored.substitutions).toBe(1);
    expect(scored.deletions).toBe(0);
    expect(scored.insertions).toBe(0);
    expect(scored.wer).toBeCloseTo(1 / 3, 10);
  });

  it("counts a deletion", () => {
    const scored = wordErrorRate("the cat sat", "the sat");
    expect(scored.deletions).toBe(1);
    expect(scored.substitutions).toBe(0);
    expect(scored.errors).toBe(1);
  });

  it("counts an insertion", () => {
    const scored = wordErrorRate("the cat sat", "the big cat sat");
    expect(scored.insertions).toBe(1);
    expect(scored.errors).toBe(1);
  });

  it("treats a wholly missing transcript as every word deleted", () => {
    const scored = wordErrorRate("two words", "");
    expect(scored.deletions).toBe(2);
    expect(scored.wer).toBe(1);
  });

  it("does not punish a hypothesis when there is no reference to match", () => {
    const scored = wordErrorRate("", "anything at all");
    expect(scored.referenceWords).toBe(0);
    expect(scored.wer).toBe(0);
  });

  it("scores a long transcription with a mix of edits", () => {
    const scored = wordErrorRate(
      "please send the report to the team today",
      "please send report to the whole team today"
    );
    // "the" deleted, "whole" inserted.
    expect(scored.deletions).toBe(1);
    expect(scored.insertions).toBe(1);
    expect(scored.errors).toBe(2);
    expect(scored.wer).toBeCloseTo(2 / 8, 10);
  });
});

describe("number-aware scoring", () => {
  it("does not charge a model for writing digits where the reference has words", () => {
    expect(wordErrorRate("the meeting is at three thirty", "the meeting is at 3:30").wer).toBe(0);
  });
});

describe("alignEdits", () => {
  it("is deterministic when a substitution and a delete/insert pair cost the same", () => {
    // "a b" -> "a c" could be one substitution or a deletion plus an insertion.
    expect(alignEdits(["a", "b"], ["a", "c"])).toEqual({
      substitutions: 1,
      deletions: 0,
      insertions: 0,
    });
  });

  it("breaks ties toward substitution rather than dropping and re-adding", () => {
    expect(alignEdits(["x"], ["y"]).substitutions).toBe(1);
  });
});

describe("percentile and summarizeLatency", () => {
  it("uses nearest rank rather than interpolation", () => {
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9)).toBe(90);
    expect(percentile([5], 0.9)).toBe(5);
    expect(percentile([3, 1, 2], 0.9)).toBe(3);
  });

  it("reports an odd-length median", () => {
    const stats = summarizeLatency([300, 100, 200]);
    expect(stats?.median).toBe(200);
    expect(stats?.min).toBe(100);
    expect(stats?.max).toBe(300);
    expect(stats?.mean).toBe(200);
  });

  it("averages the two middle samples for an even count", () => {
    expect(summarizeLatency([100, 200, 300, 400])?.median).toBe(250);
  });

  it("returns null rather than zeros when there is nothing to summarize", () => {
    expect(summarizeLatency([])).toBeNull();
  });
});

describe("parseManifest", () => {
  it("accepts a minimal manifest and trims model names", () => {
    const parsed = parseManifest({
      models: [" nvidia/parakeet-unified-en-0.6b "],
      clips: [{ id: "a", audio: "a.wav", reference: "hi" }],
    });
    expect(parsed.models).toEqual(["nvidia/parakeet-unified-en-0.6b"]);
    expect(parsed.clips[0].reference).toBe("hi");
  });

  it("allows a clip with no reference, since it can still be timed", () => {
    const parsed = parseManifest({
      models: ["m"],
      clips: [{ id: "a", audio: "a.wav" }],
    });
    expect(parsed.clips[0].reference).toBeNull();
  });

  it("rejects an empty roster or empty clip set", () => {
    expect(() => parseManifest({ models: [], clips: [{ id: "a", audio: "a.wav" }] })).toThrow(
      /models/
    );
    expect(() => parseManifest({ models: ["m"], clips: [] })).toThrow(/clips/);
  });

  it("rejects duplicate clip ids, which would join one reference to another clip", () => {
    expect(() =>
      parseManifest({
        models: ["m"],
        clips: [
          { id: "a", audio: "a.wav" },
          { id: "a", audio: "b.wav" },
        ],
      })
    ).toThrow(/duplicate clip id/);
  });

  it("rejects a clip without an audio path", () => {
    expect(() => parseManifest({ models: ["m"], clips: [{ id: "a" }] })).toThrow(/audio path/);
  });

  it("rejects a non-string reference instead of scoring nonsense", () => {
    expect(() =>
      parseManifest({ models: ["m"], clips: [{ id: "a", audio: "a.wav", reference: 7 }] })
    ).toThrow(/non-string reference/);
  });
});

describe("scoreRun", () => {
  it("weights corpus WER by reference length rather than averaging clips", () => {
    const scores = scoreRun(
      [
        record({ model: "m", clipId: "short", index: 0, reference: "one", text: "two" }),
        record({
          model: "m",
          clipId: "long",
          index: 1,
          cold: false,
          reference: "a b c d e f g h i",
          text: "a b c d e f g h i",
        }),
      ],
      manifest(["m"], [{ id: "short" }, { id: "long" }])
    );
    const score = scores[0];
    // One error in ten reference words, versus a mean of (1 + 0) / 2.
    expect(score.corpusWer).toBeCloseTo(0.1, 10);
    expect(score.meanWer).toBeCloseTo(0.5, 10);
  });

  it("keeps the first clip out of the warm latency stats and reports it as cold", () => {
    const scores = scoreRun(
      [
        record({ model: "m", clipId: "a", index: 0, cold: true, latencyMs: 4000 }),
        record({ model: "m", clipId: "b", index: 1, cold: false, latencyMs: 200 }),
        record({ model: "m", clipId: "c", index: 2, cold: false, latencyMs: 400 }),
      ],
      manifest(["m"], [{ id: "a" }, { id: "b" }, { id: "c" }])
    );
    expect(scores[0].coldLatencyMs).toBe(4000);
    expect(scores[0].warmLatency?.count).toBe(2);
    expect(scores[0].warmLatency?.median).toBe(300);
  });

  it("still times a clip that has no reference while leaving it unscored", () => {
    const scores = scoreRun(
      [record({ model: "m", clipId: "a", index: 0, reference: null })],
      manifest(["m"], [{ id: "a", reference: null }])
    );
    expect(scores[0].scoredCount).toBe(0);
    expect(scores[0].unscoredCount).toBe(1);
    expect(scores[0].coldLatencyMs).toBe(100);
  });

  it("names the reason when a model produced nothing at all", () => {
    const scores = scoreRun(
      [
        record({
          model: "m",
          clipId: "a",
          index: 0,
          ok: false,
          text: undefined,
          error: "Local STT model is not downloaded yet.",
        }),
      ],
      manifest(["m"], [{ id: "a" }])
    );
    expect(scores[0].skippedReason).toContain("not downloaded");
    expect(scores[0].corpusWer).toBeNull();
  });

  it("does not count a failed clip's latency as a result", () => {
    const scores = scoreRun(
      [
        record({ model: "m", clipId: "a", index: 0, latencyMs: null, ok: false, error: "boom" }),
      ],
      manifest(["m"], [{ id: "a" }])
    );
    expect(scores[0].coldLatencyMs).toBeNull();
  });

  it("reports a model in the manifest with no records as fully failed, not as perfect", () => {
    const scores = scoreRun([], manifest(["never-ran"], [{ id: "a" }]));
    expect(scores[0].clipCount).toBe(0);
    expect(scores[0].corpusWer).toBeNull();
  });

  it("keeps models in the manifest order", () => {
    const scores = scoreRun(
      [record({ model: "second", clipId: "a" }), record({ model: "first", clipId: "a" })],
      manifest(["first", "second"], [{ id: "a" }])
    );
    expect(scores.map((score) => score.model)).toEqual(["first", "second"]);
  });
});

const scoredModel = (overrides: Partial<ModelScore>): ModelScore => ({
  model: "m",
  clipCount: 1,
  scoredCount: 1,
  failedCount: 0,
  unscoredCount: 0,
  corpusWer: 0.1,
  meanWer: 0.1,
  totalErrors: 1,
  referenceWords: 10,
  warmLatency: summarizeLatency([100, 200]),
  coldLatencyMs: 900,
  skippedReason: null,
  clips: [],
  ...overrides,
});

describe("compareToBaseline", () => {
  const tolerance = { wer: 0.01, latencyPercent: 0.2 };

  it("flags a WER regression beyond tolerance", () => {
    const deltas = compareToBaseline(
      [scoredModel({ corpusWer: 0.2 })],
      [scoredModel({ corpusWer: 0.1 })],
      tolerance
    );
    expect(deltas[0].status).toBe("regressed");
    expect(deltas[0].werDelta).toBeCloseTo(0.1, 10);
  });

  it("treats movement inside tolerance as unchanged", () => {
    const deltas = compareToBaseline(
      [scoredModel({ corpusWer: 0.105 })],
      [scoredModel({ corpusWer: 0.1 })],
      tolerance
    );
    expect(deltas[0].status).toBe("unchanged");
  });

  it("flags a latency regression by percentage, not absolute milliseconds", () => {
    const deltas = compareToBaseline(
      [scoredModel({ warmLatency: summarizeLatency([300, 300]) })],
      [scoredModel({ warmLatency: summarizeLatency([200, 200]) })],
      tolerance
    );
    expect(deltas[0].status).toBe("regressed");
    expect(deltas[0].medianLatencyDeltaMs).toBe(100);
  });

  it("reports a lower WER as an improvement rather than a negative regression", () => {
    const deltas = compareToBaseline(
      [scoredModel({ corpusWer: 0.05 })],
      [scoredModel({ corpusWer: 0.2 })],
      tolerance
    );
    expect(deltas[0].status).toBe("improved");
  });

  it("refuses to compare a model that had nothing scored on either side", () => {
    const deltas = compareToBaseline(
      [scoredModel({ corpusWer: null, skippedReason: "not downloaded" })],
      [scoredModel({ corpusWer: 0.1 })],
      tolerance
    );
    expect(deltas[0].status).toBe("incomparable");
    expect(deltas[0].werDelta).toBeNull();
  });

  it("marks a model that is new to the run", () => {
    const deltas = compareToBaseline([scoredModel({ model: "fresh" })], [], tolerance);
    expect(deltas[0].status).toBe("new");
  });

  it("marks a baseline model that is absent from the run, so it cannot vanish quietly", () => {
    const deltas = compareToBaseline([], [scoredModel({ model: "dropped" })], tolerance);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].status).toBe("missing");
    expect(deltas[0].model).toBe("dropped");
  });
});

describe("formatTable", () => {
  it("prints one row per model with the headline numbers", () => {
    const table = formatTable([scoredModel({ model: "nvidia/parakeet-unified-en-0.6b" })]);
    const lines = table.split("\n");
    expect(lines[0]).toContain("MODEL");
    expect(lines[0]).toContain("WER");
    expect(lines[1]).toContain("parakeet");
    expect(lines[1]).toContain("10.00%");
  });

  it("marks a model with no records as not run rather than as a clean zero", () => {
    const table = formatTable([
      scoredModel({
        clipCount: 0,
        scoredCount: 0,
        corpusWer: null,
        coldLatencyMs: null,
        warmLatency: null,
      }),
    ]);
    expect(table).toContain("no records (not run)");
  });

  it("says why a skipped model was skipped instead of showing zeroes", () => {
    const table = formatTable([
      scoredModel({ corpusWer: null, coldLatencyMs: null, warmLatency: null, skippedReason: "not downloaded" }),
    ]);
    expect(table).toContain("SKIPPED: not downloaded");
  });

  it("surfaces a partial failure count", () => {
    const table = formatTable([
      scoredModel({ clipCount: 4, scoredCount: 3, failedCount: 1, corpusWer: 0.2 }),
    ]);
    expect(table).toContain("1/4 clips failed");
  });
});
