#!/usr/bin/env bun
/**
 * Records benchmark clips with their reference transcripts.
 *
 * A word error rate needs a human reference, so this serves a local page that
 * records from the microphone, plays it back, and takes the transcript of what was
 * actually said. Each save writes `<dir>/clips/<id>.wav` and upserts the clip into
 * `<dir>/manifest.json`, which `scripts/stt-bench.mjs` then runs.
 *
 *   bun scripts/stt-bench-record.mjs                     # http://127.0.0.1:8788
 *   bun scripts/stt-bench-record.mjs --dir bench --port 9000
 *
 * Localhost is a secure context, so the microphone works over plain http. Recording
 * from another device needs https; pass --host and serve it through a tunnel.
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * The models the app ships, mirroring `built_in_local_stt_model_catalog()`.
 * Pinned by src/stt/stt-bench-roster-contract.test.ts so the two cannot drift.
 */
const DEFAULT_MODELS = [
  "nvidia/parakeet-unified-en-0.6b",
  "nvidia/parakeet-tdt-0.6b-v3",
  "nvidia/parakeet-tdt_ctc-110m",
];

const MAX_REFERENCE_CHARS = 500;
const USAGE = `Usage: bun scripts/stt-bench-record.mjs [options]

  --dir <path>       where clips and manifest.json live (default: bench)
  --port <n>         port to listen on (default: 8788)
  --host <addr>      interface to bind (default: 127.0.0.1; LAN use needs https)
  --models <a,b,c>   roster to write into a new manifest (default: the built-in catalog)
  --language <code>  language hint for the manifest (default: en)
  --help`;

function parseArgs(argv) {
  const options = {};
  const known = new Set(["--dir", "--port", "--host", "--models", "--language"]);
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

function clipIdFor(index) {
  return `clip-${String(index).padStart(3, "0")}`;
}

function readManifest(manifestPath, models, language) {
  if (!existsSync(manifestPath)) {
    return { models, clips: [], language };
  }
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  return {
    // An existing manifest keeps its own roster; --models only seeds a new one.
    models: Array.isArray(parsed.models) && parsed.models.length > 0 ? parsed.models : models,
    clips: Array.isArray(parsed.clips) ? parsed.clips : [],
    language: typeof parsed.language === "string" ? parsed.language : language,
  };
}

function writeManifest(manifestPath, manifest) {
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function isValidClipId(id) {
  return /^[a-z0-9][a-z0-9._-]*$/i.test(id) && !id.includes("..");
}

function nextClipId(manifest) {
  const used = new Set(manifest.clips.map((clip) => clip.id));
  for (let index = 1; index < 10_000; index += 1) {
    const candidate = clipIdFor(index);
    if (!used.has(candidate)) return candidate;
  }
  return clipIdFor(manifest.clips.length + 1);
}

const PAGE = (boot) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>STT bench recorder</title>
<style>
  :root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --line:#262b36; --text:#e6e9ef; --muted:#98a2b3; --accent:#4f8cff; --ok:#3ecf8e; --bad:#ff6b6b; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif; padding:24px; }
  h1 { font-size:18px; margin:0 0 4px; }
  h2 { font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:28px 0 10px; }
  .sub { color:var(--muted); font-size:13px; margin-bottom:20px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px; max-width:820px; }
  label { display:block; font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:16px 0 6px; }
  input[type=text], textarea { width:100%; background:#0c0e12; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:10px; font:inherit; }
  textarea { min-height:74px; resize:vertical; }
  button { font:inherit; border:1px solid var(--line); background:#20242e; color:var(--text); border-radius:8px; padding:10px 16px; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  button.rec { background:var(--bad); border-color:var(--bad); color:#fff; font-weight:600; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:14px; }
  .meter { height:8px; background:#0c0e12; border-radius:999px; overflow:hidden; flex:1; min-width:160px; border:1px solid var(--line); }
  .meter i { display:block; height:100%; width:0; background:var(--ok); transition:width .05s linear; }
  #status { color:var(--muted); font-size:13px; margin-left:auto; }
  #error { color:var(--bad); font-size:13px; margin-top:10px; min-height:19px; }
  table { width:100%; border-collapse:collapse; font-size:13px; margin-top:8px; }
  th, td { text-align:left; padding:7px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:500; font-size:11px; text-transform:uppercase; letter-spacing:.06em; }
  code { background:#0c0e12; padding:1px 5px; border-radius:5px; font-size:12px; }
  .hint { color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<div class="panel">
  <h1>STT bench recorder</h1>
  <div class="sub">Record a clip, then type exactly what you said. Punctuation and digit formatting are ignored when scoring, so <code>3:30</code> and <code>three thirty</code> are equal — but every word must match.</div>

  <div class="row">
    <button id="rec" class="primary">Start recording</button>
    <div class="meter"><i id="meterFill"></i></div>
    <span id="status">ready</span>
  </div>
  <div class="row"><span class="hint" id="timer">0.0s</span><span class="hint" id="bytes"></span></div>
  <div id="playback"></div>

  <label for="id">clip id</label>
  <input type="text" id="id" value="${boot.nextId}" />

  <label for="reference">what did you say?</label>
  <textarea id="reference" placeholder="type the words you spoke, in order"></textarea>

  <div class="row">
    <button id="save" class="primary" disabled>Save clip</button>
    <button id="clear">Clear</button>
  </div>
  <div id="error"></div>

  <h2>Recorded clips (<span id="count">${boot.clips.length}</span>)</h2>
  <div id="list">${boot.listHtml}</div>
  <div class="hint" style="margin-top:14px">Manifest: <code>${boot.manifestPath}</code> — clips in <code>${boot.clipsDir}</code></div>
  <div class="hint">Then run: <code>bun scripts/stt-bench.mjs --manifest ${boot.manifestPath}</code></div>
</div>

<script>
var CFG = ${boot.json};
var el = function (id) { return document.getElementById(id); };
var state = { blob: null, recorder: null, stream: null, startedAt: 0, analyser: null, raf: 0, timer: null };

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  el("rec").disabled = true;
  el("status").textContent = "mic unavailable — open this page on localhost";
}

function mergeChunks(chunks, length) {
  var out = new Float32Array(length), offset = 0;
  for (var i = 0; i < chunks.length; i += 1) { out.set(chunks[i], offset); offset += chunks[i].length; }
  return out;
}

function encodeWav(samples, sampleRate) {
  var buffer = new ArrayBuffer(44 + samples.length * 2);
  var view = new DataView(buffer);
  var writeText = function (offset, text) { for (var i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  var offset = 44;
  for (var i = 0; i < samples.length; i += 1) {
    var clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

function startMeter(analyser) {
  var data = new Uint8Array(analyser.fftSize);
  var tick = function () {
    analyser.getByteTimeDomainData(data);
    var peak = 0;
    for (var i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
    el("meterFill").style.width = Math.min(100, Math.round(peak * 140)) + "%";
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}

function stopMeter() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  el("meterFill").style.width = "0%";
}

async function startRecording() {
  el("error").textContent = "";
  var stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    el("status").textContent = "mic denied: " + (error && error.message ? error.message : error);
    return;
  }
  state.stream = stream;
  var context = new (window.AudioContext || window.webkitAudioContext)();
  var source = context.createMediaStreamSource(stream);
  var analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  var chunks = [], length = 0;
  var processor = context.createScriptProcessor(4096, 1, 1);
  processor.onaudioprocess = function (event) {
    var input = event.inputBuffer.getChannelData(0);
    var copy = new Float32Array(input.length);
    copy.set(input);
    chunks.push(copy);
    length += copy.length;
  };
  var mute = context.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  state.recorder = { context: context, processor: processor, source: source, chunks: chunks, sampleRate: context.sampleRate, lengthOf: function () { return length; } };
  state.startedAt = Date.now();
  el("rec").textContent = "Stop";
  el("rec").className = "rec";
  el("status").textContent = "recording";
  startMeter(analyser);
  state.timer = setInterval(function () {
    el("timer").textContent = ((Date.now() - state.startedAt) / 1000).toFixed(1) + "s";
  }, 100);
}

function stopRecording() {
  clearInterval(state.timer);
  state.timer = null;
  stopMeter();
  var recorder = state.recorder;
  state.recorder = null;
  if (!recorder) return null;
  try { recorder.processor.disconnect(); recorder.source.disconnect(); } catch (error) { /* already torn down */ }
  recorder.context.close();
  if (state.stream) { state.stream.getTracks().forEach(function (track) { track.stop(); }); state.stream = null; }
  var samples = mergeChunks(recorder.chunks, recorder.lengthOf());
  var seconds = samples.length / recorder.sampleRate;
  if (seconds < 0.4) return { tooShort: true };
  return { blob: encodeWav(samples, recorder.sampleRate), seconds: seconds };
}

el("rec").addEventListener("click", async function () {
  if (state.recorder) {
    var recorded = stopRecording();
    el("rec").textContent = "Start recording";
    el("rec").className = "primary";
    el("timer").textContent = "0.0s";
    if (!recorded) return;
    if (recorded.tooShort) { el("status").textContent = "too short — record again"; return; }
    state.blob = recorded.blob;
    el("bytes").textContent = (recorded.blob.size / 1024).toFixed(1) + " KB · " + recorded.seconds.toFixed(1) + "s";
    el("playback").innerHTML = "";
    var audio = document.createElement("audio");
    audio.controls = true;
    audio.src = URL.createObjectURL(recorded.blob);
    el("playback").appendChild(audio);
    el("save").disabled = false;
    el("status").textContent = "recorded — type what you said";
    el("reference").focus();
    return;
  }
  await startRecording();
});

el("save").addEventListener("click", async function () {
  var id = el("id").value.trim();
  var reference = el("reference").value.trim();
  if (!state.blob) { el("error").textContent = "record something first"; return; }
  if (!id) { el("error").textContent = "clip id is required"; return; }
  if (!reference) { el("error").textContent = "type what you said — a reference is what makes the score meaningful"; return; }
  el("error").textContent = "";
  el("save").disabled = true;
  try {
    var response = await fetch("/clip", {
      method: "POST",
      headers: { "content-type": "audio/wav", "x-clip-id": id, "x-clip-reference": encodeURIComponent(reference) },
      body: state.blob,
    });
    var body = await response.json();
    if (!response.ok || !body.ok) {
      el("error").textContent = body.error || ("save failed with status " + response.status);
      el("save").disabled = false;
      return;
    }
    el("status").textContent = "saved " + id;
    el("reference").value = "";
    state.blob = null;
    el("bytes").textContent = "";
    el("playback").innerHTML = "";
    el("id").value = body.nextId;
    el("list").innerHTML = body.listHtml;
    el("count").textContent = body.clips.length;
  } catch (error) {
    el("error").textContent = "save failed: " + (error && error.message ? error.message : error);
  }
  el("save").disabled = false;
});

el("clear").addEventListener("click", function () {
  state.blob = null;
  el("save").disabled = true;
  el("reference").value = "";
  el("bytes").textContent = "";
  el("playback").innerHTML = "";
  el("error").textContent = "";
  el("status").textContent = "ready";
});

el("reference").addEventListener("keydown", function (event) {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !el("save").disabled) el("save").click();
});
</script>
</body>
</html>`;

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );
}

function listHtml(manifest) {
  if (manifest.clips.length === 0) {
    return `<div class="hint">Nothing recorded yet. Record a sentence, then type it back.</div>`;
  }
  const rows = manifest.clips
    .map(
      (clip) =>
        `<tr><td><code>${escapeHtml(clip.id)}</code></td><td>${escapeHtml(clip.reference ?? "")}</td><td>${clip.audio ? "saved" : "missing"}</td></tr>`
    )
    .join("");
  return `<table><thead><tr><th>clip</th><th>reference</th><th>audio</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function readBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) {
        rejectPromise(new Error("clip is larger than 64 MB"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolvePromise(Buffer.concat(chunks)));
    request.on("error", rejectPromise);
  });
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

  const dir = resolve(options.dir ?? "bench");
  const clipsDir = join(dir, "clips");
  const manifestPath = join(dir, "manifest.json");
  const models = options.models
    ? options.models.split(",").map((model) => model.trim()).filter(Boolean)
    : DEFAULT_MODELS;
  const language = options.language ?? "en";

  mkdirSync(clipsDir, { recursive: true });
  let manifest = readManifest(manifestPath, models, language);
  if (!existsSync(manifestPath)) writeManifest(manifestPath, manifest);

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const send = (status, body, type = "application/json") => {
      response.writeHead(status, { "content-type": type });
      response.end(type === "application/json" ? JSON.stringify(body) : body);
    };

    if (request.method === "GET" && url.pathname === "/") {
      const boot = {
        nextId: nextClipId(manifest),
        clips: manifest.clips.map((clip) => ({ id: clip.id, reference: clip.reference ?? "" })),
        listHtml: listHtml(manifest),
        manifestPath,
        clipsDir,
        json: "{}",
      };
      boot.json = JSON.stringify({
        nextId: boot.nextId,
        clips: boot.clips,
        manifestPath,
        clipsDir,
      }).replace(/</g, "\\u003c");
      return send(200, PAGE(boot), "text/html; charset=utf-8");
    }

    if (request.method === "POST" && url.pathname === "/clip") {
      const id = String(request.headers["x-clip-id"] ?? "").trim();
      const rawReference = String(request.headers["x-clip-reference"] ?? "");
      let reference = "";
      try {
        reference = decodeURIComponent(rawReference).trim();
      } catch {
        return send(400, { ok: false, error: "reference could not be decoded" });
      }
      if (!isValidClipId(id)) {
        return send(400, { ok: false, error: `clip id must be letters, digits, dot, dash or underscore: ${id}` });
      }
      if (!reference) return send(400, { ok: false, error: "a reference transcript is required" });
      if (reference.length > MAX_REFERENCE_CHARS) {
        return send(400, { ok: false, error: `reference is longer than ${MAX_REFERENCE_CHARS} characters` });
      }

      let body;
      try {
        body = await readBody(request);
      } catch (error) {
        return send(413, { ok: false, error: error.message });
      }
      if (body.length < 44 || body.subarray(0, 4).toString("ascii") !== "RIFF") {
        return send(400, { ok: false, error: "body is not a WAV file" });
      }

      const relativeAudio = join("clips", `${id}.wav`);
      writeFileSync(join(clipsDir, `${id}.wav`), body);
      const existing = manifest.clips.findIndex((clip) => clip.id === id);
      const entry = { id, audio: relativeAudio.replace(/\\/g, "/"), reference };
      if (existing >= 0) manifest.clips[existing] = entry;
      else manifest.clips.push(entry);
      writeManifest(manifestPath, manifest);

      console.log(
        `saved ${id}: ${(body.length / 1024).toFixed(1)} KB, ${reference.split(/\s+/).length} reference words`
      );
      return send(200, {
        ok: true,
        id,
        clips: manifest.clips.map((clip) => ({ id: clip.id, reference: clip.reference ?? "" })),
        nextId: nextClipId(manifest),
        listHtml: listHtml(manifest),
      });
    }

    return send(404, { ok: false, error: "not found" });
  });

  const port = Number(options.port ?? 8788);
  const host = options.host ?? "127.0.0.1";
  server.listen(port, host, () => {
    const address = server.address();
    const bound = typeof address === "object" && address ? address.port : port;
    console.log(`STT bench recorder listening on http://${host}:${bound}`);
    console.log(`clips:    ${clipsDir}`);
    console.log(`manifest: ${manifestPath}`);
    console.log(`roster:   ${manifest.models.join(", ")}`);
    console.log(
      `\nOpen http://127.0.0.1:${bound}/ — the microphone needs localhost or https.`
    );
  });
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
