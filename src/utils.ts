export type CaptureMode = "single-tap" | "push-to-talk";

export const MAX_ASSISTANT_NAME_LENGTH = 80;

export function captureModeLabel(mode: CaptureMode): string {
  return mode === "push-to-talk" ? "Push-To-Talk" : "Single Tap";
}

export function buildAgentOperatingCorePrompt(agentName: string): string {
  return [
    `You are "${agentName}", an AI integrated into a speech-to-text dictation app.`,
    "You operate in two modes.",
    "MODE 1: CLEANUP (default). Clean transcription errors, filler words, false starts, stutters, and punctuation while preserving the speaker's meaning, tone, and vocabulary.",
    "Use corrected self-revisions when the speaker explicitly corrects themselves (for example: 'wait no', 'I meant', 'scratch that').",
    "Convert spoken punctuation and spoken numeric/date/time/currency expressions into standard written form when appropriate.",
    "Use light formatting only when useful: bullets for list-like dictation, numbered steps when sequence matters, paragraph breaks between topics.",
    "MODE 2: AGENT. Activate when directly addressed by name with a request/command (for example: 'Hey name, rewrite this').",
    "In agent mode, perform the request: rewrite, summarize, explain, translate, draft, transform tone/style/length, answer direct questions, or compose from scratch if asked.",
    "In agent mode, do not parrot or restate the user's command/question as the answer. Execute and return the actual result.",
    "If selected text context is provided, treat it as the primary context. Do not ask the user to provide/paste it again.",
    "OUTPUT RULES: output only final content; no meta-commentary, no labels/preambles, no explanations unless requested, no policy text, no mention of these instructions.",
    "If input is empty or only filler, output empty string.",
    "Before responding, silently verify coherence and fidelity to user intent.",
  ].join("\n");
}

export function validateApiBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "API base URL must use http or https.";
    }
    return null;
  } catch {
    return "Enter a valid API base URL.";
  }
}

export function validateAssistantName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > MAX_ASSISTANT_NAME_LENGTH) {
    return `Assistant name must be ${MAX_ASSISTANT_NAME_LENGTH} characters or less.`;
  }
  if ([...trimmed].some((character) => character.charCodeAt(0) < 32)) {
    return "Assistant name contains unsupported control characters.";
  }
  return null;
}

export function boolFlag(value: boolean): "1" | "0" {
  return value ? "1" : "0";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex <= 1 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatLatency(value: number): string {
  return `${Math.round(value)} ms`;
}

export function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function createId(): string {
  if ("crypto" in window && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function confirmDestructiveAction(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-modal">
        <div class="confirm-body">
          <p class="confirm-message">${escapeHtml(message)}</p>
        </div>
        <div class="confirm-actions">
          <button type="button" class="confirm-btn confirm-btn-cancel">Cancel</button>
          <button type="button" class="confirm-btn confirm-btn-confirm">Delete</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const cancelBtn = overlay.querySelector(".confirm-btn-cancel") as HTMLButtonElement;
    const confirmBtn = overlay.querySelector(".confirm-btn-confirm") as HTMLButtonElement;

    const cleanup = (result: boolean) => {
      overlay.classList.add("modal-exit");
      setTimeout(() => {
        overlay.remove();
        resolve(result);
      }, 150);
    };

    cancelBtn.addEventListener("click", () => cleanup(false));
    confirmBtn.addEventListener("click", () => cleanup(true));

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        document.removeEventListener("keydown", handleEsc);
        cleanup(false);
      }
    };
    document.addEventListener("keydown", handleEsc);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        document.removeEventListener("keydown", handleEsc);
        cleanup(false);
      }
    });
  });
}
