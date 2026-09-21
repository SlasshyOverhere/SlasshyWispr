/**
 * Scoring for the local STT benchmark: word error rate and latency statistics.
 *
 * Kept away from the runner so it can be tested without models. WER is easy to get
 * subtly wrong — punctuation, casing and whitespace all move the number — so the
 * normalization lives here, is stated once, and is pinned by tests.
 */

export type BenchClip = {
  id: string;
  audio: string;
  reference?: string | null;
};

export type BenchManifest = {
  models: string[];
  clips: BenchClip[];
  language?: string | null;
};

export type BenchRecord = {
  model: string;
  clipId: string;
  index: number;
  cold: boolean;
  reference?: string | null;
  audio: string;
  ok: boolean;
  text?: string;
  error?: string;
  latencyMs?: number;
  audioBytes?: number;
};

export type EditCounts = {
  substitutions: number;
  deletions: number;
  insertions: number;
  errors: number;
  referenceWords: number;
  wer: number;
};

export type LatencyStats = {
  count: number;
  min: number;
  median: number;
  mean: number;
  p90: number;
  max: number;
};

export type ClipScore = {
  clipId: string;
  ok: boolean;
  text: string;
  error: string | null;
  referenceWords: number | null;
  errors: number | null;
  wer: number | null;
  latencyMs: number | null;
  cold: boolean;
  modelLoadFor: boolean;
};

export type ModelScore = {
  model: string;
  clipCount: number;
  scoredCount: number;
  failedCount: number;
  unscoredCount: number;
  corpusWer: number | null;
  meanWer: number | null;
  totalErrors: number;
  referenceWords: number;
  warmLatency: LatencyStats | null;
  coldLatencyMs: number | null;
  skippedReason: string | null;
  clips: ClipScore[];
};

const SMALL_NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * Digits to words, so "3:30" and "three thirty" score as equal. Models disagree
 * about number formatting in ways that are not transcription errors, and left alone
 * that disagreement dominates the metric on any clip containing a number.
 *
 * Folds 0-99 only: thousands and years are left alone rather than guessed at.
 */
export function foldNumbers(tokens: string[]): string[] {
  const folded: string[] = [];
  for (const token of tokens) {
    if (!/^\d{1,2}$/.test(token)) {
      folded.push(token);
      continue;
    }
    const value = Number(token);
    if (value < 20) {
      folded.push(SMALL_NUMBERS[value]);
    } else {
      folded.push(TENS[Math.floor(value / 10)]);
      if (value % 10 !== 0) folded.push(SMALL_NUMBERS[value % 10]);
    }
  }
  return folded;
}

/**
 * Comparison tokens: case, punctuation, whitespace and number formatting are
 * normalized away, because a model that writes "Hello, world." or "3:30" for
 * "hello world" / "three thirty" made no transcription error.
 */
export function normalizeTranscript(text: string): string[] {
  const tokens = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    // Quotes around a word are layout, not a word: "'quote'" and "quote" are the same token.
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => token.length > 0);
  return foldNumbers(tokens);
}

type Triple = { substitutions: number; deletions: number; insertions: number };

const total = (value: Triple) => value.substitutions + value.deletions + value.insertions;

/**
 * Levenshtein alignment over words, reporting which edit each error was.
 * Ties prefer substitution, then deletion, then insertion, so the split is stable.
 */
export function alignEdits(reference: string[], hypothesis: string[]): Triple {
  const rows = reference.length;
  const columns = hypothesis.length;
  const table: Triple[][] = [];

  for (let row = 0; row <= rows; row += 1) {
    table.push(new Array<Triple>(columns + 1));
  }
  for (let row = 0; row <= rows; row += 1) {
    table[row][0] = { substitutions: 0, deletions: row, insertions: 0 };
  }
  for (let column = 1; column <= columns; column += 1) {
    table[0][column] = { substitutions: 0, deletions: 0, insertions: column };
  }

  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= columns; column += 1) {
      const previous = table[row - 1][column - 1];
      const matches = reference[row - 1] === hypothesis[column - 1];
      const substitute: Triple = {
        substitutions: previous.substitutions + (matches ? 0 : 1),
        deletions: previous.deletions,
        insertions: previous.insertions,
      };
      const deleteOne = table[row - 1][column];
      const deletion: Triple = {
        substitutions: deleteOne.substitutions,
        deletions: deleteOne.deletions + 1,
        insertions: deleteOne.insertions,
      };
      const insertOne = table[row][column - 1];
      const insertion: Triple = {
        substitutions: insertOne.substitutions,
        deletions: insertOne.deletions,
        insertions: insertOne.insertions + 1,
      };
      // Substitution first, so an equal-cost tie aligns as a substitution rather than a drop.
      const candidates: Triple[] = [substitute, deletion, insertion];
      let best = candidates[0];
      for (const candidate of candidates) {
        if (total(candidate) < total(best)) best = candidate;
      }
      table[row][column] = best;
    }
  }

  const result = table[rows][columns];
  return { ...result };
}

/** Word error rate for one clip: errors over reference length. */
export function wordErrorRate(reference: string, hypothesis: string): EditCounts {
  const referenceWords = normalizeTranscript(reference);
  const hypothesisWords = normalizeTranscript(hypothesis);
  const edits = alignEdits(referenceWords, hypothesisWords);
  const errors = total(edits);
  return {
    ...edits,
    errors,
    referenceWords: referenceWords.length,
    // An empty reference has nothing to get wrong; a silent hypothesis is not an error.
    wer: referenceWords.length === 0 ? 0 : errors / referenceWords.length,
  };
}

/** Nearest-rank percentile over an unsorted sample. */
export function percentile(samples: number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

export function summarizeLatency(samples: number[]): LatencyStats | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const sum = sorted.reduce((accumulator, value) => accumulator + value, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    median,
    mean: sum / sorted.length,
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1],
  };
}

export function parseManifest(raw: unknown): BenchManifest {
  const manifest = raw as Partial<BenchManifest> | null;
  if (!manifest || typeof manifest !== "object") {
    throw new Error("bench manifest must be a JSON object");
  }
  const models = manifest.models;
  if (!Array.isArray(models) || models.length === 0 || models.some((m) => typeof m !== "string")) {
    throw new Error("bench manifest needs a non-empty `models` array of strings");
  }
  const clips = manifest.clips;
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error("bench manifest needs a non-empty `clips` array");
  }
  const seen = new Set<string>();
  const parsed: BenchClip[] = clips.map((clip, index) => {
    if (!clip || typeof clip !== "object") {
      throw new Error(`clip ${index} must be an object`);
    }
    if (typeof clip.id !== "string" || clip.id.trim().length === 0) {
      throw new Error(`clip ${index} needs a non-empty string id`);
    }
    if (seen.has(clip.id)) {
      // Duplicate ids would silently join one clip's reference to another's audio.
      throw new Error(`duplicate clip id: ${clip.id}`);
    }
    seen.add(clip.id);
    if (typeof clip.audio !== "string" || clip.audio.trim().length === 0) {
      throw new Error(`clip ${clip.id} needs an audio path`);
    }
    if (clip.reference != null && typeof clip.reference !== "string") {
      throw new Error(`clip ${clip.id} has a non-string reference`);
    }
    return { id: clip.id, audio: clip.audio, reference: clip.reference ?? null };
  });
  return {
    models: models.map((model) => model.trim()),
    clips: parsed,
    language: typeof manifest.language === "string" ? manifest.language : null,
  };
}

export function scoreRun(records: BenchRecord[], manifest: BenchManifest): ModelScore[] {
  return manifest.models.map((model) => scoreModel(model, records));
}

function scoreModel(model: string, records: BenchRecord[]): ModelScore {
  const forModel = records
    .filter((record) => record.model === model)
    .sort((a, b) => a.index - b.index);

  const clips: ClipScore[] = forModel.map((record) => {
    const hasReference = typeof record.reference === "string" && record.reference.trim() !== "";
    const edits =
      record.ok && hasReference
        ? wordErrorRate(record.reference as string, record.text ?? "")
        : null;
    return {
      clipId: record.clipId,
      ok: record.ok,
      text: record.text ?? "",
      error: record.error ?? null,
      referenceWords: edits ? edits.referenceWords : null,
      errors: edits ? edits.errors : null,
      wer: edits ? edits.wer : null,
      latencyMs: typeof record.latencyMs === "number" ? record.latencyMs : null,
      cold: record.cold === true,
      modelLoadFor: record.index === 0,
    };
  });

  const scored = clips.filter((clip) => clip.wer !== null);
  const totalErrors = scored.reduce((sum, clip) => sum + (clip.errors ?? 0), 0);
  const referenceWords = scored.reduce((sum, clip) => sum + (clip.referenceWords ?? 0), 0);
  const warmSamples = clips
    .filter((clip) => clip.ok && !clip.modelLoadFor && clip.latencyMs !== null)
    .map((clip) => clip.latencyMs as number);
  const coldClip = clips.find((clip) => clip.modelLoadFor && clip.ok);
  const failed = clips.filter((clip) => !clip.ok);

  return {
    model,
    clipCount: clips.length,
    scoredCount: scored.length,
    failedCount: failed.length,
    unscoredCount: clips.length - scored.length - failed.length,
    // Corpus WER weights by reference length, so a long clip counts for more than a short one.
    corpusWer: referenceWords > 0 ? totalErrors / referenceWords : null,
    meanWer:
      scored.length > 0
        ? scored.reduce((sum, clip) => sum + (clip.wer ?? 0), 0) / scored.length
        : null,
    totalErrors,
    referenceWords,
    warmLatency: summarizeLatency(warmSamples),
    coldLatencyMs: coldClip?.latencyMs ?? null,
    skippedReason:
      clips.length > 0 && failed.length === clips.length
        ? (failed[0].error ?? "every clip failed")
        : null,
    clips,
  };
}

export type BaselineDelta = {
  model: string;
  status: "unchanged" | "regressed" | "improved" | "new" | "missing" | "incomparable";
  werDelta: number | null;
  medianLatencyDeltaMs: number | null;
  note: string;
};

export type Tolerance = { wer: number; latencyPercent: number };

/**
 * A model that failed every clip cannot be compared: a null score is not a regression,
 * and reporting it as one would train the reader to ignore the report.
 */
export function compareToBaseline(
  current: ModelScore[],
  baseline: ModelScore[],
  tolerance: Tolerance
): BaselineDelta[] {
  const byModel = new Map(baseline.map((score) => [score.model, score]));
  const deltas: BaselineDelta[] = current.map((score) => {
    const before = byModel.get(score.model);
    if (!before) {
      return {
        model: score.model,
        status: "new" as const,
        werDelta: null,
        medianLatencyDeltaMs: null,
        note: "not in baseline",
      };
    }
    if (score.corpusWer === null || before.corpusWer === null) {
      return {
        model: score.model,
        status: "incomparable" as const,
        werDelta: null,
        medianLatencyDeltaMs: null,
        note: "no scored clips on one side",
      };
    }
    const werDelta = score.corpusWer - before.corpusWer;
    const currentMedian = score.warmLatency?.median ?? null;
    const baselineMedian = before.warmLatency?.median ?? null;
    const medianLatencyDeltaMs =
      currentMedian !== null && baselineMedian !== null ? currentMedian - baselineMedian : null;

    const werRegressed = werDelta > tolerance.wer;
    const latencyRegressed =
      medianLatencyDeltaMs !== null &&
      baselineMedian !== null &&
      baselineMedian > 0 &&
      medianLatencyDeltaMs / baselineMedian > tolerance.latencyPercent;
    const werImproved = werDelta < -tolerance.wer;
    const latencyImproved =
      medianLatencyDeltaMs !== null &&
      baselineMedian !== null &&
      baselineMedian > 0 &&
      medianLatencyDeltaMs / baselineMedian < -tolerance.latencyPercent;

    const status = werRegressed || latencyRegressed
      ? ("regressed" as const)
      : werImproved || latencyImproved
        ? ("improved" as const)
        : ("unchanged" as const);
    const notes: string[] = [];
    if (werDelta !== 0) {
      notes.push(`${werDelta > 0 ? "+" : ""}${(werDelta * 100).toFixed(2)}pp WER`);
    }
    if (medianLatencyDeltaMs !== null && medianLatencyDeltaMs !== 0) {
      notes.push(
        `${medianLatencyDeltaMs > 0 ? "+" : ""}${Math.round(medianLatencyDeltaMs)}ms median`
      );
    }
    return {
      model: score.model,
      status,
      werDelta,
      medianLatencyDeltaMs,
      note: notes.length > 0 ? notes.join(", ") : "no change",
    };
  });

  // A model dropped from the run should not vanish from the report silently.
  const currentModels = new Set(current.map((score) => score.model));
  const missing: BaselineDelta[] = baseline
    .filter((score) => !currentModels.has(score.model))
    .map((score) => ({
      model: score.model,
      status: "missing" as const,
      werDelta: null,
      medianLatencyDeltaMs: null,
      note: "absent from this run",
    }));
  return [...deltas, ...missing];
}

const percent = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(2)}%`;
const millis = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : Math.round(value).toString();

export function formatTable(scores: ModelScore[], deltas: BaselineDelta[] = []): string {
  const deltaByModel = new Map(deltas.map((delta) => [delta.model, delta]));
  const rows = scores.map((score) => {
    const delta = deltaByModel.get(score.model);
    const notes: string[] = [];
    if (score.clipCount === 0) notes.push("no records (not run)");
    if (score.skippedReason) notes.push(`SKIPPED: ${score.skippedReason}`);
    if (score.failedCount > 0 && !score.skippedReason) {
      notes.push(`${score.failedCount}/${score.clipCount} clips failed`);
    }
    if (score.unscoredCount > 0) notes.push(`${score.unscoredCount} clips have no reference`);
    if (delta && delta.status !== "unchanged") notes.push(`${delta.status}: ${delta.note}`);
    return [
      shorten(score.model, 34),
      `${score.scoredCount}/${score.clipCount}`,
      percent(score.corpusWer),
      millis(score.warmLatency?.median),
      millis(score.warmLatency?.p90),
      millis(score.coldLatencyMs),
      notes.join("; "),
    ];
  });

  const header = ["MODEL", "SCORED", "WER", "MEDIAN", "P90", "COLD", "NOTES"];
  const table = [header, ...rows];
  const widths = header.map((_, column) =>
    Math.max(...table.map((row) => (row[column] ?? "").length))
  );
  return table
    .map((row) =>
      row
        .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
        .join("  ")
        .trimEnd()
    )
    .join("\n");
}

function shorten(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
