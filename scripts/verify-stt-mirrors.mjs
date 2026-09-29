#!/usr/bin/env node
/**
 * Check every catalog model's archive is actually published.
 *
 * A catalog model whose mirror asset is missing strands the user: the model is
 * offered as downloadable, and the download fails with a 404 that no test ever
 * saw — the Rust guard only asserts *a* source is configured, which stays green
 * while the URL points at nothing. Nothing offline can tell a real URL from a
 * plausible one, so this is a script rather than a test, and it is deliberately
 * network-bound.
 *
 * The release publishes `checksums.json` listing every asset it holds, so the
 * asset list is checked against the release's own manifest first — that catches
 * a wrong URL without downloading 450 MB — and each URL is then ranged-requested
 * to confirm it resolves.
 *
 * Usage: node scripts/verify-stt-mirrors.mjs
 */
import { readFileSync } from "node:fs";

const CONSTANTS_RS = "src-tauri/src/constants.rs";
const ARCHIVE_RS = "src-tauri/src/pipeline/stt_download/archive.rs";
const ROUTING_RS = "src-tauri/src/pipeline/routing.rs";

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`cannot read ${path}`);
  }
}

/** `pub const NAME: &str = "…";` → value, so the URL lives in one place. */
function rustConst(name) {
  const match = read(CONSTANTS_RS).match(
    new RegExp(`pub const ${name}: &str =\\s*"([^"]+)"`),
  );
  if (!match) throw new Error(`${CONSTANTS_RS} has no string constant ${name}`);
  return match[1];
}

/** Model id → archive source, read from the same match arms the downloader uses. */
function archiveSources() {
  const source = read(ARCHIVE_RS);
  const arms = source.matchAll(
    /"([^"]+)" => Some\(LocalParakeetArchiveSource \{\s*archive_url: (\w+),\s*expected_root_dir: (\w+),\s*\}\)/g,
  );
  const found = new Map();
  for (const [, model, urlConst] of arms) {
    found.set(model, rustConst(urlConst));
  }
  if (found.size === 0) {
    throw new Error(`no archive sources parsed out of ${ARCHIVE_RS}`);
  }
  return found;
}

/** The downloadable roster, as the download command sees it. */
function catalog() {
  const match = read(ROUTING_RS).match(
    /pub fn built_in_local_stt_model_catalog\(\) -> Vec<String> \{\s*vec!\[([\s\S]*?)\]/,
  );
  if (!match) throw new Error(`cannot read the catalog from ${ROUTING_RS}`);
  const models = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  if (models.length === 0) {
    throw new Error("the catalog parsed empty; the check would pass vacuously");
  }
  return models;
}

/** Where the assets live, derived from one archive URL rather than restated. */
function releaseFrom(url) {
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/,
  );
  if (!match) throw new Error(`unrecognised release asset URL: ${url}`);
  const [, owner, repo, tag, asset] = match;
  return { owner, repo, tag, asset, api: `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}` };
}

async function publishedAssets(url) {
  const release = releaseFrom(url);
  const response = await fetch(release.api, {
    headers: { accept: "application/vnd.github+json", "user-agent": "slasshywispr-mirror-check" },
  });
  if (!response.ok) {
    throw new Error(`GitHub release ${release.tag} not readable (${response.status})`);
  }
  const body = await response.json();
  return { release, names: new Set((body.assets ?? []).map((asset) => asset.name)) };
}

async function resolves(url) {
  const response = await fetch(url, { headers: { range: "bytes=0-0" }, redirect: "follow" });
  return response.status;
}

/** The release's own `checksums.json`, keyed by asset name. */
async function publishedDigests(release, names) {
  if (!names.has("checksums.json")) return null;
  const base = `https://github.com/${release.owner}/${release.repo}/releases/download/${release.tag}`;
  const response = await fetch(`${base}/checksums.json`, { redirect: "follow" });
  if (!response.ok) return null;
  const body = await response.json();
  return new Map(body.map((entry) => [entry.file, String(entry.sha256).toLowerCase()]));
}

/** Digest pinned in constants.rs for an archive URL, if any. */
function pinnedDigest(url) {
  const table = read(CONSTANTS_RS).match(
    /pub const PINNED_ARTIFACT_SHA256: &\[\(&str, &str\)\] = &\[([\s\S]*?)\n\];/,
  );
  if (!table) return null;
  // The entries span several lines: (URL_CONSTANT, "64 hex chars").
  for (const [, key, value] of table[1].matchAll(
    /\(\s*\n?\s*([A-Z][A-Z_0-9]*)\s*,?\s*\n?\s*"([0-9a-fA-F]{64})"\s*,?\s*\)/g,
  )) {
    if (rustConst(key) === url) return value.toLowerCase();
  }
  return null;
}

const sources = archiveSources();
const models = catalog();
const problems = [];

console.log(`[verify-stt-mirrors] ${models.length} catalog model(s)\n`);

for (const model of models) {
  const url = sources.get(model);
  if (!url) {
    problems.push(`${model} is in the catalog with no archive source`);
    continue;
  }

  const { release, names } = await publishedAssets(url);
  const listed = names.has(release.asset);
  const status = await resolves(url);
  const pinned = pinnedDigest(url);
  const published = (await publishedDigests(release, names))?.get(release.asset) ?? null;
  const digestOk = !pinned || !published || pinned === published;
  const ok = listed && status < 400 && digestOk;

  console.log(
    `${ok ? "ok  " : "FAIL"} ${model}\n     ${release.asset} — ${listed ? "listed in" : "MISSING from"} ${release.tag}, HTTP ${status}` +
      `\n     digest ${pinned ? (digestOk ? "matches the release" : `MISMATCH pinned=${pinned} release=${published}`) : "NOT PINNED"}`,
  );

  if (!listed) {
    problems.push(
      `${model}: ${release.asset} is not among the assets in ${release.tag} ` +
        `(${[...names].join(", ") || "none"})`,
    );
  } else if (status >= 400) {
    problems.push(`${model}: ${release.asset} is listed but returns HTTP ${status}`);
  } else if (!pinned) {
    // Not fatal here: it installs unverified and warns. Fix by pinning.
    console.warn(`     note: ${model} has no pinned SHA-256; it will be installed unverified.`);
  } else if (!digestOk) {
    problems.push(
      `${model}: the archive was re-published. constants.rs pins ${pinned} but ` +
        `${release.tag} now serves ${published}. Re-pin before shipping.`,
    );
  }
}

if (problems.length > 0) {
  console.error("\n[verify-stt-mirrors] the catalog offers a model that cannot be downloaded:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nPublish the missing asset (see scripts/repack-parakeet-unified-en.mjs for the build and" +
      " `gh release upload` line), or remove the model from built_in_local_stt_model_catalog().",
  );
  process.exit(1);
}

console.log("\n[verify-stt-mirrors] every catalog model resolves to a published asset");
