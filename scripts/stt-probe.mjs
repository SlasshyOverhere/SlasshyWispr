#!/usr/bin/env bun
// Dev-only STT probe: open the printed URL on a phone, record, and see the transcript.
// Mirrors transcribe_audio_openai_compatible in src-tauri/src/pipeline/stt/transcribe.rs.
//
//   bun scripts/stt-probe.mjs --key sk-... --base-url https://api.openai.com/v1 --model whisper-1
//
// Flags/env:
//   --port 8787        PORT
//   --key              STT_API_KEY        (never sent to the browser, never logged)
//   --base-url         STT_BASE_URL       default https://api.openai.com/v1
//   --model            STT_MODEL          default whisper-1
//   --language         STT_LANGUAGE       optional ISO-639-1 hint
//   --app <exe>        STT_APP_EXE        enables "send to the desktop app"; auto-detected otherwise
//   --dir <path>       STT_UPLOAD_DIR     default <repo>/stt-probe-recordings
//   --no-token                            disable the ?k= URL token (LAN-only advice: keep it on)

import { mkdir, writeFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    if (name === "no-token") {
      flags[name] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const PORT = Number(flags.port ?? process.env.PORT ?? 8787);
const BASE_URL = String(flags["base-url"] ?? process.env.STT_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const MODEL = String(flags.model ?? process.env.STT_MODEL ?? "whisper-1");
const LANGUAGE = flags.language ?? process.env.STT_LANGUAGE ?? "";
const API_KEY = String(flags.key ?? process.env.STT_API_KEY ?? "");
const UPLOAD_DIR = path.resolve(String(flags.dir ?? process.env.STT_UPLOAD_DIR ?? path.join(ROOT, "stt-probe-recordings")));
const TOKEN = flags["no-token"] ? "" : randomUUID().slice(0, 8);
const STT_TIMEOUT_MS = 60_000; // STT_TIMEOUT_DEFAULT

const APP_CANDIDATES = [
  flags.app,
  process.env.STT_APP_EXE,
  path.join(ROOT, "src-tauri/target/debug/app.exe"),
  path.join(ROOT, "src-tauri/target/release/app.exe"),
  path.join(process.env.LOCALAPPDATA ?? "", "Programs/SlasshyWispr/SlasshyWispr.exe"),
].filter(Boolean);

async function resolveAppExe() {
  for (const candidate of APP_CANDIDATES) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

const MIME_EXT = {
  "audio/wav": "wav",
  "audio/wave": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "video/mp4": "mp4",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

const EXT_MIME = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  aac: "audio/aac",
  flac: "audio/flac",
};

function pickExtension(mime, filename) {
  const fromMime = MIME_EXT[String(mime).split(";")[0].trim().toLowerCase()];
  if (fromMime) return fromMime;
  const fromName = path.extname(filename ?? "").slice(1).toLowerCase();
  return EXT_MIME[fromName] ? fromName : "wav";
}

async function saveAudio(buffer, extension) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(UPLOAD_DIR, `${stamp}-${randomUUID().slice(0, 6)}.${extension}`);
  await writeFile(file, Buffer.from(buffer));
  return file;
}

// Same request shape as the Rust path: multipart model + file, response_format=json,
// optional language, bearer only when a key exists.
async function transcribe(buffer, { mime, filename }) {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("response_format", "json");
  if (LANGUAGE) form.append("language", String(LANGUAGE));
  form.append("file", new Blob([buffer], { type: mime || "audio/wav" }), filename);

  const headers = {};
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

  const started = Date.now();
  const response = await fetch(`${BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers,
    body: form,
    signal: AbortSignal.timeout(STT_TIMEOUT_MS),
  });
  const elapsedMs = Date.now() - started;
  const raw = await response.text();

  if (!response.ok) {
    return { ok: false, status: response.status, elapsedMs, error: raw.slice(0, 600) };
  }

  let text = "";
  try {
    const parsed = JSON.parse(raw);
    text = typeof parsed.text === "string" ? parsed.text : typeof parsed.transcript === "string" ? parsed.transcript : JSON.stringify(parsed);
  } catch {
    text = raw;
  }
  return { ok: true, status: response.status, elapsedMs, text: text.trim(), model: MODEL, baseUrl: BASE_URL };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), { status, headers: { "content-type": "application/json" } });
}

function authorized(req, url) {
  if (!TOKEN) return true;
  const supplied = url.searchParams.get("k") ?? req.headers.get("x-probe-token") ?? "";
  return supplied === TOKEN;
}

async function readUpload(req) {
  const rawName = req.headers.get("x-probe-filename") ?? "";
  const mime = (req.headers.get("content-type") ?? "audio/wav").split(";")[0].trim();
  const extension = pickExtension(mime, rawName);
  const buffer = await req.arrayBuffer();
  const filename = rawName || `phone-recording.${extension}`;
  return { buffer, mime: mime || EXT_MIME[extension] || "audio/wav", extension, filename };
}

const appExe = await resolveAppExe();

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return json({ ok: true, baseUrl: BASE_URL, model: MODEL, keyConfigured: API_KEY.length > 0, appExe });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (!authorized(req, url)) return new Response("Add ?k=<token> to the URL (see the server console).", { status: 401 });
      return new Response(page(TOKEN, { baseUrl: BASE_URL, model: MODEL, language: LANGUAGE, keyConfigured: API_KEY.length > 0, appExe }), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/transcribe" && req.method === "POST") {
      if (!authorized(req, url)) return json({ ok: false, error: "bad token" }, 401);
      try {
        const { buffer, mime, extension, filename } = await readUpload(req);
        if (buffer.byteLength === 0) return json({ ok: false, error: "empty body" }, 400);
        const saved = await saveAudio(buffer, extension);
        const result = await transcribe(buffer, { mime, filename });
        return json({
          ...result,
          bytes: buffer.byteLength,
          durationMs: Number(req.headers.get("x-probe-duration-ms") ?? 0) || null,
          saved,
          request: { url: `${BASE_URL}/audio/transcriptions`, model: MODEL, mime, filename, timeoutMs: STT_TIMEOUT_MS, keyConfigured: API_KEY.length > 0 },
        });
      } catch (error) {
        const message = error?.name === "TimeoutError" ? `no response within ${STT_TIMEOUT_MS}ms` : String(error?.message ?? error);
        return json({ ok: false, error: message }, 500);
      }
    }

    // Hands the file to the real desktop pipeline (second launch forwards it over single-instance).
    if (url.pathname === "/handoff" && req.method === "POST") {
      if (!authorized(req, url)) return json({ ok: false, error: "bad token" }, 401);
      if (!appExe) return json({ ok: false, error: "app.exe not found — pass --app <path to app.exe>" }, 400);
      try {
        const { buffer, extension } = await readUpload(req);
        const saved = await saveAudio(buffer, extension);
        const child = spawn(appExe, [`--transcribe-file`, saved], { detached: true, stdio: "ignore" });
        child.unref();
        return json({ ok: true, saved, appExe, hint: "Watch the desktop app; the transcript should appear there." });
      } catch (error) {
        return json({ ok: false, error: String(error?.message ?? error) }, 500);
      }
    }

    return new Response("not found", { status: 404 });
  },
});

function lanAddresses() {
  const found = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) found.push(entry.address);
    }
  }
  return found;
}

const config = { baseUrl: BASE_URL, model: MODEL, language: LANGUAGE || "(auto)", key: API_KEY ? "set" : "MISSING", appExe: appExe ?? "not found" };
console.log("SlasshyWispr STT probe");
for (const [key, value] of Object.entries(config)) console.log(`  ${key.padEnd(9)} ${value}`);
console.log(`  uploads   ${UPLOAD_DIR}`);
console.log("");
console.log("Open on the phone (same Wi-Fi / tailnet):");
for (const address of lanAddresses()) console.log(`  http://${address}:${server.port}/?k=${TOKEN}`);
console.log(`  http://localhost:${server.port}/?k=${TOKEN}   (this machine)`);
console.log("");
console.log("Phone browsers only allow mic capture on https://. If the mic button is unavailable,");
console.log("either upload a voice memo with the file picker, or expose this over https:");
console.log(`  tailscale serve --bg ${server.port}      (then use the printed https://*.ts.net URL + /?k=${TOKEN})`);
console.log(`  cloudflared tunnel --url http://localhost:${server.port}`);
if (!API_KEY) console.log("\nWARNING: no API key set — the SaaS request will come back 401.");

function page(token, info) {
  const boot = JSON.stringify({ token, ...info, port: PORT });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>SlasshyWispr STT probe</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; padding: 20px 16px 40px; font: 15px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         background: #0b0d12; color: #e7e9ee; max-width: 640px; margin-inline: auto; }
  h1 { font-size: 17px; margin: 0 0 4px; }
  .sub { color: #8b93a7; font-size: 12.5px; margin-bottom: 16px; }
  .card { background: #12151d; border: 1px solid #222838; border-radius: 14px; padding: 14px; margin-bottom: 12px; }
  .row { display: flex; gap: 10px; align-items: center; }
  button { font: inherit; font-weight: 600; border: 0; border-radius: 10px; padding: 12px 16px; background: #2a3143; color: #e7e9ee; }
  button:active { transform: translateY(1px); }
  button.primary { background: #3b6cf6; color: #fff; flex: 1; padding: 16px; font-size: 16px; }
  button.rec { background: #d7443e; color: #fff; flex: 1; padding: 16px; font-size: 16px; }
  button[disabled] { opacity: .45; }
  #meter { height: 6px; border-radius: 3px; background: #1c2231; overflow: hidden; margin: 12px 0 4px; }
  #meterFill { height: 100%; width: 0%; background: linear-gradient(90deg, #38b26a, #e0c341, #d7443e); transition: width .08s linear; }
  .meta { color: #8b93a7; font-size: 12px; display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  pre, .transcript { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: inherit; }
  .transcript { font-size: 16px; min-height: 60px; padding: 12px; background: #0e1119; border: 1px solid #222838; border-radius: 10px; }
  .err { color: #ff9c95; font-size: 13px; white-space: pre-wrap; word-break: break-word; }
  .ok { color: #6cd48f; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  td { padding: 3px 0; vertical-align: top; }
  td:first-child { color: #8b93a7; width: 40%; }
  code { color: #cfd6e6; word-break: break-all; }
  audio { width: 100%; margin-top: 10px; }
  label.file { display: block; text-align: center; padding: 12px; border: 1px dashed #333c52; border-radius: 10px; color: #a7b0c5; font-size: 13.5px; }
  input[type=file] { display: none; }
  .spin { color: #8b93a7; font-size: 13px; }
</style>
</head>
<body>
<h1>SlasshyWispr STT probe</h1>
<div class="sub">Records with this phone's mic and runs the exact SaaS request the app makes.</div>

<div class="card">
  <div class="row">
    <button id="rec" class="primary">Start recording</button>
  </div>
  <div id="meter"><div id="meterFill"></div></div>
  <div class="meta"><span id="status">idle</span><span id="timer">0.0s</span></div>
  <div id="playback"></div>
  <div class="row" style="margin-top:12px">
    <button id="transcribe" disabled>Transcribe</button>
    <button id="handoff" ${info.appExe ? "" : "disabled"}>Open in app</button>
  </div>
  <div class="meta" style="margin-top:8px"><span id="handoffNote">${info.appExe ? "app: " + escapeHtml(path.basename(info.appExe)) : "app.exe not found - handoff off"}</span></div>
</div>

<div class="card">
  <label class="file" for="fileInput">or pick an audio file from this phone</label>
  <input id="fileInput" type="file" accept="audio/*,video/mp4" />
</div>

<div class="card">
  <div class="meta" style="margin-bottom:8px"><span>Transcript</span><span id="elapsed"></span></div>
  <div class="transcript" id="transcript">-</div>
  <div class="err" id="error"></div>
</div>

<div class="card">
  <div class="meta" style="margin-bottom:6px">Request echo</div>
  <table>
    <tr><td>endpoint</td><td><code id="iUrl"></code></td></tr>
    <tr><td>model</td><td><code id="iModel"></code></td></tr>
    <tr><td>language</td><td><code id="iLang"></code></td></tr>
    <tr><td>api key</td><td><code id="iKey"></code></td></tr>
    <tr><td>audio sent</td><td><code id="iBytes">-</code></td></tr>
    <tr><td>saved as</td><td><code id="iSaved">-</code></td></tr>
    <tr><td>secure context</td><td><code id="iSecure"></code></td></tr>
  </table>
</div>

<script>
var CFG = ${boot};
var el = function (id) { return document.getElementById(id); };
var state = { blob: null, mime: "audio/wav", durationMs: 0, recorder: null, stream: null, chunks: [], startedAt: 0, timer: null, analyser: null, raf: 0 };

el("iUrl").textContent = CFG.baseUrl + "/audio/transcriptions";
el("iModel").textContent = CFG.model;
el("iLang").textContent = CFG.language || "(auto)";
el("iKey").textContent = CFG.keyConfigured ? "set (server-side)" : "MISSING";
el("iSecure").textContent = window.isSecureContext ? "yes" : "no - mic blocked, use upload";

function setStatus(text) { el("status").textContent = text; }

if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
  el("rec").disabled = true;
  setStatus("mic unavailable over http - use the picker below");
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

function stopMeter() {
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  el("meterFill").style.width = "0%";
}

function startMeter() {
  var analyser = state.analyser, data = new Uint8Array(analyser.fftSize);
  var tick = function () {
    analyser.getByteTimeDomainData(data);
    var peak = 0;
    for (var i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
    el("meterFill").style.width = Math.min(100, Math.round(peak * 140)) + "%";
    state.raf = requestAnimationFrame(tick);
  };
  state.raf = requestAnimationFrame(tick);
}

function attach(blob, mime, durationMs, label) {
  state.blob = blob; state.mime = mime; state.durationMs = durationMs;
  el("playback").innerHTML = "";
  var audio = document.createElement("audio");
  audio.controls = true;
  audio.src = URL.createObjectURL(blob);
  el("playback").appendChild(audio);
  el("iBytes").textContent = blob.size + " bytes (" + (blob.size / 1024).toFixed(1) + " KB)";
  el("transcribe").disabled = false;
  setStatus(label);
}

async function startRecording() {
  el("error").textContent = "";
  el("transcript").textContent = "-";
  var stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    setStatus("mic denied: " + (error && error.message ? error.message : error));
    return;
  }
  state.stream = stream;
  var context = new (window.AudioContext || window.webkitAudioContext)();
  var source = context.createMediaStreamSource(stream);
  var analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  state.analyser = analyser;
  var chunks = [];
  var length = 0;
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
  el("rec").textContent = "Stop and transcribe";
  el("rec").className = "rec";
  setStatus("recording - keep talking");
  startMeter();
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
  var durationMs = Date.now() - state.startedAt;
  var samples = mergeChunks(recorder.chunks, recorder.lengthOf());
  var seconds = samples.length / recorder.sampleRate;
  return { blob: encodeWav(samples, recorder.sampleRate), durationMs: durationMs, seconds: seconds };
}

el("rec").addEventListener("click", async function () {
  if (state.recorder) {
    var recorded = stopRecording();
    el("rec").textContent = "Start recording";
    el("rec").className = "primary";
    el("timer").textContent = "0.0s";
    if (!recorded || recorded.seconds < 0.3) { setStatus("too short - record again"); return; }
    attach(recorded.blob, "audio/wav", recorded.durationMs, "recorded " + recorded.seconds.toFixed(1) + "s - sending");
    await runTranscription();
    return;
  }
  await startRecording();
});

el("transcribe").addEventListener("click", runTranscription);

async function postAudio(pathname) {
  var response = await fetch(pathname + "?k=" + encodeURIComponent(CFG.token), {
    method: "POST",
    headers: { "content-type": state.mime, "x-probe-filename": "phone-recording.wav", "x-probe-duration-ms": String(state.durationMs || 0) },
    body: state.blob,
  });
  return { status: response.status, body: await response.json().catch(function () { return { ok: false, error: "non-JSON response" }; }) };
}

async function runTranscription() {
  if (!state.blob) return;
  el("error").textContent = "";
  el("transcript").textContent = "transcribing...";
  el("elapsed").textContent = "";
  el("transcribe").disabled = true;
  try {
    var result = await postAudio("/transcribe");
    var data = result.body;
    if (!data.ok) {
      el("transcript").textContent = "-";
      el("error").textContent = "HTTP " + (data.status || result.status) + "\\n" + (data.error || "unknown error");
      setStatus("failed");
    } else {
      el("transcript").textContent = data.text || "(empty transcript - no speech detected?)";
      el("elapsed").textContent = data.elapsedMs + " ms";
      el("iSaved").textContent = data.saved;
      setStatus("done");
    }
  } catch (error) {
    el("error").textContent = String(error && error.message ? error.message : error);
    setStatus("failed");
  } finally {
    el("transcribe").disabled = false;
    el("status").className = "";
  }
}

el("handoff").addEventListener("click", async function () {
  if (!state.blob) return;
  el("error").textContent = "";
  setStatus("sending to the desktop app...");
  try {
    var result = await postAudio("/handoff");
    if (!result.body.ok) { el("error").textContent = result.body.error || "handoff failed"; setStatus("handoff failed"); return; }
    el("handoffNote").textContent = "sent: " + result.body.saved;
    setStatus("handed off - check the desktop app");
  } catch (error) {
    el("error").textContent = String(error && error.message ? error.message : error);
    setStatus("handoff failed");
  }
});

el("fileInput").addEventListener("change", async function (event) {
  var file = event.target.files && event.target.files[0];
  if (!file) return;
  var parts = file.name.split(".");
  var extension = (parts.length > 1 ? parts[parts.length - 1] : "wav").toLowerCase();
  var mimeByExtension = { wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", webm: "audio/webm", ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac" };
  state.mime = file.type || mimeByExtension[extension] || "audio/wav";
  state.durationMs = 0;
  el("error").textContent = "";
  el("transcript").textContent = "-";
  attach(file, state.mime, 0, "picked " + file.name + " - sending");
  el("iBytes").textContent = file.size + " bytes";
  await runTranscription();
});
</script>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}
