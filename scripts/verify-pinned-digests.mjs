#!/usr/bin/env node
/**
 * Re-check the pinned third-party digests against their upstream releases.
 *
 * The Parakeet mirror publishes a `checksums.json`, and GitHub computes a
 * `digest` for every release asset it serves. Both are authoritative and are
 * not derived from our own table, so a re-published or replaced asset shows up
 * here instead of breaking installs at runtime — where the app would refuse a
 * download and the user would have no idea why.
 *
 * HuggingFace files are pinned to a `resolve/main` URL, which is a mutable
 * branch ref. Those cannot be checked against a published manifest, so they are
 * reported for review rather than verified.
 *
 * Usage: node scripts/verify-pinned-digests.mjs
 */
import { readFileSync } from "node:fs";

const CONSTANTS_RS = "src-tauri/src/constants.rs";

function read(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`cannot read ${path}`);
  }
}

function rustConst(name) {
  // rustfmt wraps the longer URLs onto their own line, so the value can be a
  // few lines below the name.
  const match = read(CONSTANTS_RS).match(
    new RegExp(`pub const ${name}: &str =\\s*"([^"]+)"`),
  );
  if (!match) throw new Error(`${CONSTANTS_RS} has no string constant ${name}`);
  return match[1];
}

/** URL constant name -> pinned digest, parsed from the table. */
function pinned() {
  const table = read(CONSTANTS_RS).match(
    /pub const PINNED_ARTIFACT_SHA256: &\[\(&str, &str\)\] = &\[([\s\S]*?)\n\];/,
  );
  if (!table) throw new Error(`${CONSTANTS_RS} has no PINNED_ARTIFACT_SHA256 table`);
  const found = new Map();
  for (const [, key, value] of table[1].matchAll(
    /\(\s*\n?\s*([A-Z][A-Z_0-9]*)\s*,?\s*\n?\s*"([0-9a-fA-F]{64})"\s*,?\s*\)/g,
  )) {
    found.set(key, { url: rustConst(key), digest: value.toLowerCase() });
  }
  if (found.size === 0) throw new Error("no entries parsed from PINNED_ARTIFACT_SHA256");
  return found;
}

/** GitHub release asset digest, or null when the release does not publish one. */
async function githubDigest(url) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/.exec(url);
  if (!match) return null;
  const [, owner, repo, tag, asset] = match;
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, {
    headers: { "User-Agent": "slasshywispr-digest-check" },
  });
  if (!response.ok) return { error: `release ${tag} returned HTTP ${response.status}` };
  const body = await response.json();
  const entry = (body.assets ?? []).find((a) => a.name === decodeURIComponent(asset));
  if (!entry) return { error: `${asset} is not an asset of ${tag}` };
  if (!entry.digest) return { unreported: true };
  return entry.digest.replace(/^sha256:/, "").toLowerCase();
}

const entries = pinned();
const problems = [];
const unverified = [];

console.log(`[verify-pinned-digests] ${entries.size} pinned artifact(s)\n`);

for (const [name, { url, digest }] of entries) {
  if (url.startsWith("https://huggingface.co/")) {
    unverified.push(name);
    console.log(`review ${name}\n     mutable ref, no published manifest to check against`);
    continue;
  }

  const published = await githubDigest(url);
  if (published === null) {
    problems.push(`${name}: not a GitHub release asset, so it cannot be re-checked`);
    console.log(`FAIL   ${name}\n     not a GitHub release asset`);
    continue;
  }
  if (published.error || published.unreported) {
    const why = published.error ?? "the release publishes no digest for this asset";
    console.log(`review ${name}\n     ${why}`);
    continue;
  }

  const ok = published === digest;
  console.log(
    `${ok ? "ok    " : "FAIL  "} ${name}\n     pinned=${digest.slice(0, 16)}… release=${published.slice(0, 16)}…`,
  );
  if (!ok) {
    problems.push(
      `${name}: the artifact was replaced upstream. Pinned ${digest}, ${published} is served now. ` +
        "Re-run scripts/compute-pinned-digests.mjs and review the new bytes before re-pinning.",
    );
  }
}

if (unverified.length > 0) {
  console.log(
    `\n${unverified.length} pinned to a mutable upstream ref and cannot be verified: ${unverified.join(", ")}`,
  );
}

if (problems.length > 0) {
  console.error("\n[verify-pinned-digests] pinned digests no longer match upstream:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("\n[verify-pinned-digests] every verifiable pinned digest matches upstream");
