/**
 * Builds the prepacked int8 archive that `PARAKEET_UNIFIED_EN_INT8_ARCHIVE_URL`
 * points at (the English-only Parakeet model).
 *
 * No public ONNX export is already in the layout `transcribe-rs` needs. The engine
 * wants `encoder-model.int8.onnx` / `decoder_joint-model.int8.onnx` / `nemo128.onnx`
 * / `vocab.txt`; the public exports ship `encoder.int8.onnx` (+ a `.data` sidecar),
 * `decoder_joint.int8.onnx`, and no preprocessor at all. So this renames, adds the
 * shared NeMo preprocessor, and packs one tar.gz — the app then downloads a single
 * verified artifact, exactly like the v2/v3 mirrors.
 *
 * Usage:
 *   bun scripts/repack-parakeet-unified-en.mjs [--out <dir>]
 *   bun scripts/repack-parakeet-unified-en.mjs --from <model-dir>   # repack only, no download
 *
 * Publish (release tag `models-parakeet-int8-v1` must exist):
 *   gh release upload models-parakeet-int8-v1 <out>/parakeet-unified-en-int8.tar.gz
 *
 * The model is deliberately absent from `built_in_local_stt_model_catalog()` until that
 * upload happens: shipping the catalog entry first is what left users clicking a download
 * that could only 404. After uploading, re-add the entry, its `PARAKEET_UNIFIED_EN_*`
 * constants and the archive arm, then confirm with `node scripts/verify-stt-mirrors.mjs`.
 */
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { join, resolve } from "node:path";

// Int8 ONNX export of the unified model. Its fp32 encoder weights hash identically to
// the conversion below, so the two agree on the model; its bundled vocab.txt does not
// satisfy the engine (see VOCAB_REPO).
const MODEL_REPO = "bobNight/parakeet-unified-en-0.6b-onnx";
// Every NeMo Parakeet export shares one 16 kHz / 128-bin mel preprocessor.
const PREPROCESSOR_REPO = "istupakov/parakeet-tdt-0.6b-v2-onnx";
// The unified model's own token list, emitted as NeMo `token id` lines. Borrowing
// another Parakeet's vocab instead loads fine and transcribes nonsense: the token
// orderings diverge from index 10.
const VOCAB_REPO = "csukuangfj2/sherpa-onnx-nemo-parakeet-unified-en-0.6b-non-streaming";
const ROOT_DIR = "parakeet-unified-en-0.6b-int8";
// Must equal the asset name in PARAKEET_UNIFIED_EN_INT8_ARCHIVE_URL.
const ARCHIVE_NAME = "parakeet-unified-en-int8.tar.gz";

// Pinned so a silently re-uploaded upstream artifact fails here instead of in the app.
const DOWNLOADS = [
  {
    repo: MODEL_REPO,
    remote: "encoder.int8.onnx",
    local: "encoder-model.int8.onnx",
    bytes: 42_606_669,
    sha256: "c81adfab77634e00c1668a221a14f244c5fb3409e7c14eeebaf6ac963425910f",
  },
  {
    repo: MODEL_REPO,
    remote: "encoder.int8.onnx.data",
    // Keeps its original name: the ONNX file records this path internally, and
    // ONNX Runtime resolves it relative to the model, so renaming the model alone
    // is what preserves external-data resolution. Rename this and loading fails.
    local: "encoder.int8.onnx.data",
    bytes: 611_491_584,
    sha256: "3d54dd04646c15677bd2844a84df3770b12cc1ce183481f7b6e0def31c92114a",
  },
  {
    repo: MODEL_REPO,
    remote: "decoder_joint.int8.onnx",
    local: "decoder_joint-model.int8.onnx",
    bytes: 8_995_064,
    sha256: "7f76ad5f35035f25630075699c6c942a2c0c05ff42cb398f966f3c256d148e1e",
  },
  {
    repo: VOCAB_REPO,
    remote: "tokens.txt",
    local: "vocab.txt",
    bytes: 8_952,
    sha256: "dc0b4584ab2e4ddbf888425c076c61b736e7356a015250db7d307e6f1a8188ff",
  },
  {
    repo: PREPROCESSOR_REPO,
    remote: "nemo128.onnx",
    local: "nemo128.onnx",
    bytes: 139_764,
    sha256: "a9fde1486ebfcc08f328d75ad4610c67835fea58c73ba57e3209a6f6cf019e9f",
  },
];

// Mirrors `is_parakeet_model_directory` in pipeline/stt_download/archive.rs; a
// directory missing any of these is not discoverable, so the download would look
// successful and then fail to load.
const REQUIRED_FILES = [
  "encoder-model.int8.onnx",
  "encoder.int8.onnx.data",
  "decoder_joint-model.int8.onnx",
  "nemo128.onnx",
  "vocab.txt",
  "config.json",
];

function parseArgs(argv) {
  const outIndex = argv.indexOf("--out");
  const out = outIndex === -1 ? "build/parakeet-unified-en" : argv[outIndex + 1];
  if (!out) throw new Error("--out needs a directory");
  // --from packs an already-complete model directory, skipping every download.
  const fromIndex = argv.indexOf("--from");
  const from = fromIndex === -1 ? null : argv[fromIndex + 1];
  if (fromIndex !== -1 && !from) throw new Error("--from needs a directory");
  return { out: resolve(out), from: from ? resolve(from) : null };
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function fetchToFile(url, path) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status} ${response.statusText}`);
  }
  if (!response.body) throw new Error(`GET ${url} returned no body`);
  const file = createWriteStream(path);
  try {
    for await (const chunk of Readable.fromWeb(response.body)) {
      if (!file.write(chunk)) {
        await new Promise((done, fail) => {
          file.once("drain", done);
          file.once("error", fail);
        });
      }
    }
  } finally {
    await new Promise((done) => file.end(done));
  }
}

/** Reuses a cached download when it already matches the pinned size and digest. */
async function obtain(download, rawDir, modelDir) {
  const rawPath = join(rawDir, download.remote);
  let cached = false;
  try {
    cached = (await stat(rawPath)).size === download.bytes;
  } catch {
    cached = false;
  }

  if (!cached) {
    const url = `https://huggingface.co/${download.repo}/resolve/main/${download.remote}?download=true`;
    process.stdout.write(`  downloading ${download.remote} ... `);
    await fetchToFile(url, rawPath);
    process.stdout.write("done\n");
  } else {
    process.stdout.write(`  cached    ${download.remote}\n`);
  }

  const info = await stat(rawPath);
  if (info.size !== download.bytes) {
    throw new Error(
      `${download.remote}: expected ${download.bytes} bytes, got ${info.size}. ` +
        "Upstream changed — re-check the pin before repacking.",
    );
  }
  if (download.sha256) {
    const actual = await sha256File(rawPath);
    if (actual !== download.sha256) {
      throw new Error(
        `${download.remote}: sha256 ${actual} does not match the pin ${download.sha256}.`,
      );
    }
  }

  const localPath = join(modelDir, download.local);
  if (rawPath !== localPath) await rename(rawPath, localPath);
  return localPath;
}

function tarHeader({ name, size, mode, type }) {
  const header = Buffer.alloc(512);
  const writeText = (value, offset, length) => {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length > length) throw new Error(`tar field overflow: ${value}`);
    bytes.copy(header, offset);
  };
  const writeOctal = (value, offset, length) => {
    writeText(value.toString(8).padStart(length - 1, "0"), offset, length - 1);
  };

  // ustar splits names longer than 100 bytes into prefix + name.
  let shortName = name;
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    const split = name.lastIndexOf("/");
    if (split === -1) throw new Error(`tar name not splittable: ${name}`);
    prefix = name.slice(0, split);
    shortName = name.slice(split + 1);
  }

  writeText(shortName, 0, 100);
  writeOctal(mode, 100, 8);
  writeOctal(0, 108, 8);
  writeOctal(0, 116, 8);
  writeOctal(size, 124, 12);
  writeOctal(Math.floor(Date.now() / 1000), 136, 12);
  header.fill(0x20, 148, 156); // checksum field: spaces while summing
  writeText(type, 156, 1);
  writeText("ustar", 257, 5);
  writeText("00", 263, 2);
  writeText(prefix, 345, 155);

  let sum = 0;
  for (const byte of header) sum += byte;
  writeText(sum.toString(8).padStart(6, "0"), 148, 6);
  header[154] = 0x00;
  header[155] = 0x20;
  return header;
}

function writeTo(stream, chunk) {
  return new Promise((resolveWrite, rejectWrite) => {
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("error", onError);
    };
    const onDrain = () => {
      cleanup();
      resolveWrite();
    };
    const onError = (error) => {
      cleanup();
      rejectWrite(error);
    };
    stream.on("error", onError);
    if (stream.write(chunk)) {
      cleanup();
      resolveWrite();
    } else {
      stream.once("drain", onDrain);
    }
  });
}

async function writeTarEntries(gzip, modelDir) {
  await writeTo(
    gzip,
    tarHeader({ name: `${ROOT_DIR}/`, size: 0, mode: 0o755, type: "5" }),
  );

  for (const file of REQUIRED_FILES) {
    const path = join(modelDir, file);
    const { size } = await stat(path);
    await writeTo(
      gzip,
      tarHeader({ name: `${ROOT_DIR}/${file}`, size, mode: 0o644, type: "0" }),
    );
    for await (const chunk of createReadStream(path)) await writeTo(gzip, chunk);
    const padding = (512 - (size % 512)) % 512;
    if (padding > 0) await writeTo(gzip, Buffer.alloc(padding));
  }

  await writeTo(gzip, Buffer.alloc(1024)); // end-of-archive marker
}

/**
 * Applies the engine's own `vocab.txt` rules (transcribe-rs `load_vocab`): usable
 * lines are `token id`, and `<blk>` must exist. The export this model comes from
 * ships a bare HuggingFace-style vocab instead, which downloads and extracts fine and
 * then dies with "Missing <blk> token in vocabulary".
 */
async function readVocabStats(path) {
  const text = await readFile(path, "utf8");
  let pairs = 0;
  let blank = null;
  for (const line of text.split("\n")) {
    const parts = line.trimEnd().split(" ");
    if (parts.length < 2) continue;
    const id = Number.parseInt(parts[1], 10);
    if (!Number.isInteger(id)) continue;
    pairs += 1;
    if (parts[0] === "<blk>") blank = id;
  }
  if (blank === null) {
    throw new Error(
      `${path}: no '<blk>' token among ${pairs} parsed token/id pairs, so the engine ` +
        "cannot load this model — source a NeMo-format vocab",
    );
  }
  return { pairs, blank };
}

async function main() {
  const { out, from } = parseArgs(process.argv.slice(2));
  await mkdir(out, { recursive: true });

  let modelDir;
  if (from) {
    modelDir = from;
    for (const file of REQUIRED_FILES) {
      try {
        await stat(join(modelDir, file));
      } catch {
        throw new Error(`--from ${modelDir} is missing ${file}`);
      }
    }
    console.log(`Packing the existing model directory ${modelDir}:`);
  } else {
    const rawDir = join(out, "raw");
    modelDir = join(out, ROOT_DIR);
    await mkdir(rawDir, { recursive: true });
    await mkdir(modelDir, { recursive: true });

    console.log(`Fetching int8 ONNX sources (~620 MiB, cached in ${rawDir}):`);
    for (const download of DOWNLOADS) await obtain(download, rawDir, modelDir);

    // The app's discovery function requires a config.json; the engine itself does
    // not read one for Parakeet.
    await writeFile(
      join(modelDir, "config.json"),
      JSON.stringify(
        { model_type: "nemo-conformer-rnnt", model_id: "nvidia/parakeet-unified-en-0.6b" },
        null,
        2,
      ) + "\n",
    );
  }

  const vocab = await readVocabStats(join(modelDir, "vocab.txt"));
  console.log(`  vocab     ${vocab.pairs} tokens, <blk> at ${vocab.blank}`);

  const archivePath = join(out, ARCHIVE_NAME);
  const gzip = createGzip({ level: 6 });
  const sink = createWriteStream(archivePath);
  // gzip.end() closes the pipe, so wait for the *sink* to finish rather than
  // ending it separately.
  const packed = new Promise((done, fail) => {
    sink.once("finish", done);
    sink.once("error", fail);
    gzip.once("error", fail);
  });
  gzip.pipe(sink);
  await writeTarEntries(gzip, modelDir);
  gzip.end();
  await packed;

  const { size } = await stat(archivePath);
  console.log(`\nPacked ${ROOT_DIR} (${REQUIRED_FILES.length} files) -> ${archivePath}`);
  console.log(`Archive size: ${(size / (1024 * 1024)).toFixed(1)} MiB`);
  console.log(`SHA256: ${await sha256File(archivePath)}`);
  console.log(
    "\nNothing uses this until it is uploaded — the app fetches the release asset\n" +
      "named in PARAKEET_UNIFIED_EN_INT8_ARCHIVE_URL:\n" +
      `  gh release upload models-parakeet-int8-v1 "${archivePath}"\n` +
      "Then transcribe a known clip with the model selected before shipping it as a default.",
  );
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
