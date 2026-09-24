#!/usr/bin/env bun
/**
 * Local STT benchmark driver.
 *
 * Runs the app's headless bench mode (which drives the same transcription path a
 * dictation uses), scores word error rate and latency per model, prints a table, and
 * diffs against a saved baseline.
 *
 *   bun scripts/stt-bench.mjs --manifest bench/manifest.json
 *   bun scripts/stt-bench.mjs --manifest bench/manifest.json --baseline bench/baseline.json
 *   bun scripts/stt-bench.mjs --results bench/stt-bench-results.jsonl --manifest bench/manifest.json
 *
 * Run with bun: it imports the TypeScript scorer so WER has one implementation.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  compareToBaseline,
  formatTable,
  parseManifest,
  scoreRun,
} from "../src/stt/bench-scoring.ts";

const USAGE = `Usage: bun scripts/stt-bench.mjs --manifest <manifest.json> [options]

  --manifest <path>    clip manifest to run (required)
  --results <path>     score an existing results file instead of running the app
  --app <path>         app binary; resolved from cargo otherwise
  --profile <name>     debug (default) or release
  --out <path>         where the app writes JSONL (default: beside the manifest)
  --save <path>        where to write this run's results JSON
  --baseline <path>    previous results JSON to diff against
  --tolerance-wer <n>  WER movement that counts as a change, in points (default 1.0)
  --tolerance-latency <n>  median latency movement that counts, as a ratio (default 0.20)
  --help`;

function parseArgs(argv) {
  const options = {};
  const known = new Set([
    "--manifest",
    "--results",
    "--app",
    "--profile",
    "--out",
    "--save",
    "--baseline",
    "--tolerance-wer",
    "--tolerance-latency",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    const [name, inline] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, null];
    if (!known.has(name)) throw new Error(`unknown option: ${arg}\n\n${USAGE}`);
    const value = inline ?? argv[++index];
    if (value === undefined) throw new Error(`${name} needs a value`);
    options[name.replace(/^--/, "")] = value;
  }
  return options;
}

function resolveAppBinary(profile) {
  let metadata;
  try {
    metadata = JSON.parse(
      execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps"], {
        cwd: "src-tauri",
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    );
  } catch (error) {
    throw new Error(`could not read cargo metadata: ${error.message}`);
  }
  const target = metadata.target_directory;
  const binary = metadata.packages
    .flatMap((pkg) => pkg.targets)
    .find((target_) => target_.kind.includes("bin"));
  if (!binary) throw new Error("no binary target found in src-tauri");
  const suffix = process.platform === "win32" ? ".exe" : "";
  return join(target, profile, `${binary.name}${suffix}`);
}

function readResults(path) {
  if (!existsSync(path)) {
    throw new Error(
      `no results were written to ${path}.\n` +
        `The app only writes results if it reached the bench mode: check the log lines above, ` +
        `and that the models in the manifest are downloaded.`
    );
  }
  const records = [];
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    try {
      records.push(JSON.parse(trimmed));
    } catch (error) {
      throw new Error(`${path}:${index + 1} is not valid JSON: ${error.message}`);
    }
  });
  if (records.length === 0) throw new Error(`${path} contains no result records`);
  return records;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.manifest) {
    console.error(USAGE);
    process.exit(2);
  }

  const manifestPath = resolve(options.manifest);
  if (!existsSync(manifestPath)) {
    console.error(`manifest not found: ${manifestPath}`);
    process.exit(2);
  }
  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));

  const outPath = options.out
    ? resolve(options.out)
    : join(dirname(manifestPath), "stt-bench-results.jsonl");

  let appLabel = "existing results";
  if (!options.results) {
    const profile = options.profile ?? "debug";
    const appPath = options.app ? resolve(options.app) : resolveAppBinary(profile);
    if (!existsSync(appPath)) {
      console.error(
        `${appPath} does not exist.\n` +
          `Build it first, e.g. \`cd src-tauri && cargo build\` for the debug profile, ` +
          `or pass --app <path>.`
      );
      process.exit(2);
    }
    appLabel = `${appPath} (${profile})`;
    console.log(`running ${appLabel}`);
    console.log(`manifest ${manifestPath} — ${manifest.clips.length} clips, ${manifest.models.length} models\n`);

    mkdirSync(dirname(outPath), { recursive: true });
    const run = spawnSync(
      appPath,
      ["--stt-bench", manifestPath, "--stt-bench-out", outPath],
      { stdio: "inherit" }
    );
    if (run.error) {
      console.error(`could not start the app: ${run.error.message}`);
      process.exit(2);
    }
    if (run.status !== 0) {
      // A partial run still has usable rows; report what was written and keep going.
      console.error(`\nthe app exited with code ${run.status}; scoring whatever it wrote`);
    }
  }

  const records = readResults(options.results ? resolve(options.results) : outPath);
  const scores = scoreRun(records, manifest);

  const baselineScores = options.baseline
    ? JSON.parse(readFileSync(resolve(options.baseline), "utf8")).scores
    : null;
  const tolerance = {
    wer: options["tolerance-wer"] ? Number(options["tolerance-wer"]) / 100 : 0.01,
    latency: options["tolerance-latency"] ? Number(options["tolerance-latency"]) : 0.2,
  };
  const deltas = baselineScores
    ? compareToBaseline(scores, baselineScores, {
        wer: tolerance.wer,
        latencyPercent: tolerance.latency,
      })
    : [];

  console.log(`\n${formatTable(scores, deltas)}`);

  const summary = {
    generatedAt: new Date().toISOString(),
    app: appLabel,
    manifest: manifestPath,
    clipCount: manifest.clips.length,
    scores,
    deltas,
  };
  const savePath = resolve(options.save ?? join(dirname(manifestPath), "baseline.json"));
  mkdirSync(dirname(savePath), { recursive: true });
  writeFileSync(savePath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`\nresults written to ${savePath}`);
  if (!options.results) console.log(`raw records in ${outPath}`);

  const regressed = deltas.filter((delta) => delta.status === "regressed");
  if (regressed.length > 0) {
    console.error(
      `\nregressions against ${options.baseline}:\n` +
        regressed.map((delta) => `  ${delta.model}: ${delta.note}`).join("\n")
    );
    process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
