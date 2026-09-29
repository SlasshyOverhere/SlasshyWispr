/**
 * Gate: the production CSP must not widen script or connect sources.
 *
 * The previous check was four shell globs over the whole header. Three of them
 * matched the committed CSP, so the gate was red on main and could not be
 * trusted either way:
 *   *blob:*              also matches `media-src ... blob:`, which is legitimate
 *   *https:*connect-src*  matches any `https:` appearing anywhere before
 *                         connect-src, including the Google Fonts directives
 *   *script-src*http*     matches style-src's `https://fonts.googleapis.com`
 *                         because "s...http" is a substring of "style-src http"
 *
 * A CSP is a list of directives, so the checks are scoped to the directive
 * they are about. Script and connect are the two that gate code execution and
 * data egress; media/img blob: and font/style https: are not.
 */
import { readFileSync } from "node:fs";

const CONFIG = "src-tauri/tauri.conf.json";

function readCsp() {
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`cannot read ${CONFIG}: ${error.message}`);
  }
  const csp = config?.app?.security?.csp;
  if (typeof csp !== "string" || csp.trim() === "") {
    throw new Error(`${CONFIG} has no app.security.csp`);
  }
  return csp;
}

/** `name -> [source, ...]`, from a ";"-separated CSP header. */
function directives(csp) {
  const parsed = new Map();
  for (const part of csp.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    parsed.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return parsed;
}

const problems = [];
const csp = readCsp();
const parsed = directives(csp);

const script = parsed.get("script-src") ?? [];
if (script.length === 0) {
  problems.push("no script-src directive");
}
for (const source of script) {
  if (source === "'unsafe-eval'" || source === "'unsafe-inline'") {
    problems.push(`script-src allows ${source}`);
  }
  if (source === "*" || source === "https:" || source === "http:") {
    problems.push(`script-src allows the wildcard scheme ${source}`);
  }
}

const connect = parsed.get("connect-src") ?? [];
for (const source of connect) {
  if (source === "*") {
    problems.push("connect-src allows *");
  }
  // A bare https: here means "any https host", which is the egress hole.
  if (source === "https:" || source === "http:") {
    problems.push(`connect-src allows the wildcard scheme ${source}`);
  }
}

const defaultSrc = parsed.get("default-src") ?? [];
if (!defaultSrc.includes("'self'")) {
  problems.push("default-src is missing 'self'");
}

console.log(`[check:prod-csp] ${csp.replace(/\s+/g, " ").trim()}`);

if (problems.length > 0) {
  console.error("\n[check:prod-csp] production CSP regression:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log("[check:prod-csp] script and connect sources are locked down");
