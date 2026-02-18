
import "./style.css";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize, availableMonitors, currentMonitor, type Monitor } from "@tauri-apps/api/window";
import {
  register as registerGlobalShortcut,
  unregisterAll as unregisterAllGlobalShortcuts,
  type ShortcutEvent,
} from "@tauri-apps/plugin-global-shortcut";

type Stage = "idle" | "recording" | "processing" | "speaking" | "error";
type CaptureMode = "single-tap" | "push-to-talk";
type ThemeMode = "system" | "light" | "dark";
type StyleProfile = "adaptive" | "professional" | "casual" | "concise" | "developer";
type MainPage = "home" | "dictionary" | "snippets" | "notes";
type SettingsPane = "general" | "system" | "tts" | "pipeline";
type TtsEngine = "piper" | "coqui";
type PiperQuality = "fast" | "balanced" | "high";
type PiperEmotion = "neutral" | "calm" | "happy" | "excited" | "serious" | "sad";
type CoquiQuality = "fast" | "balanced" | "high";
type CoquiEmotion = "neutral" | "calm" | "happy" | "excited" | "serious" | "sad";
type TtsProfilePane = "piper" | "coqui";
type HoldSource = "notes-button" | "hotkey";
type TeamScope = "personal" | "shared";

interface AssistantInfoResponse {
  baseUrl: string;
  sttModel: string;
  aiModel: string;
  piperInstalled: boolean;
  piperPath: string;
  voiceInstalled: boolean;
  voiceModelPath: string;
  coquiInstalled: boolean;
  coquiPythonPath: string;
}

interface RuntimeSetupResponse {
  piperPath: string;
  voiceModelPath: string;
}

interface VoiceInstallResponse {
  modelPath: string;
}

interface PiperValidationResponse {
  ok: boolean;
  details: string;
}

interface CoquiStatusResponse {
  available: boolean;
  pythonPath: string;
  ttsVersion: string;
  cudaAvailable: boolean;
  voiceDir: string;
  voices: string[];
  defaultModel: string;
  error: string;
}

interface CoquiSetupResponse {
  pythonPath: string;
  details: string;
}

interface CoquiValidationResponse {
  ok: boolean;
  details: string;
}

interface CoquiVoicesResponse {
  voiceDir: string;
  voices: string[];
}

interface CoquiModelsResponse {
  models: string[];
}

interface ProviderModelsResponse {
  baseUrl: string;
  models: string[];
}

interface CoquiVoiceCloneResponse {
  speakerId: string;
  durationSeconds: number;
  voiceDir: string;
  voices: string[];
  previewAudioBase64: string;
}

interface CoquiVoicePreviewResponse {
  audioBase64: string;
  text: string;
}

interface TtsSetupStatusResponse {
  running: boolean;
  completed: boolean;
  success: boolean;
  stage: string;
  logs: string[];
}

interface AssistantPipelineResponse {
  mode: "assistant" | "dictation";
  selectionRewrite: boolean;
  selectionPending: boolean;
  selectionContextCleared: boolean;
  selectionContextUsed: boolean;
  transcript: string;
  assistantResponse: string;
  audioBase64: string;
  sttLatencyMs: number;
  aiLatencyMs: number;
  ttsLatencyMs: number;
  totalLatencyMs: number;
}

interface PersistedSettings {
  apiKey: string;
  apiBaseUrl: string;
  sttModelName: string;
  aiModelName: string;
  rememberApiKey: boolean;
  captureMode: CaptureMode;
  piperPath: string;
  microphoneDeviceId: string;
  pushToTalkHotkey: string;
  commandHotkey: string;
  dictationLanguage: string;
  styleProfile: StyleProfile;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  launchAtLogin: boolean;
  showFlowBar: boolean;
  showAppInDock: boolean;
  commandMode: boolean;
  wakeWordEnabled: boolean;
  assistantName: string;
  autoPasteDictation: boolean;
  contextAwareness: boolean;
  copyToClipboard: boolean;
  incognitoMode: boolean;
  themeMode: ThemeMode;
  dictationSoundEffects: boolean;
  muteMusicWhileDictating: boolean;
  backtrackCorrection: boolean;
  removeFillers: boolean;
  autoPunctuation: boolean;
  numberedLists: boolean;
  ttsEngine: TtsEngine;
  piperSpeed: number;
  piperQuality: PiperQuality;
  piperEmotion: PiperEmotion;
  coquiPythonPath: string;
  coquiModelName: string;
  coquiLanguage: string;
  coquiVoiceId: string;
  coquiSpeed: number;
  coquiQuality: CoquiQuality;
  coquiEmotion: CoquiEmotion;
  coquiUseGpu: boolean;
  coquiSplitSentences: boolean;
}

interface HotkeySpec {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  key: string;
  label: string;
}

interface DictionaryTerm {
  id: string;
  source: string;
  target: string;
  scope: TeamScope;
  createdAt: number;
}

interface SnippetEntry {
  id: string;
  trigger: string;
  expansion: string;
  scope: TeamScope;
  createdAt: number;
}

interface QuickNoteEntry {
  id: string;
  text: string;
  createdAt: number;
}

interface UsageStats {
  sessions: number;
  words: number;
  avgWpm: number;
}

interface DockLayout {
  x: number;
  y: number;
}

interface ForegroundInputBlockStatus {
  blocked: boolean;
  processName: string;
}

interface HomeHistoryEntry {
  speaker: string;
  content: string;
  tone: "assistant" | "user";
  timestamp: number;
}

interface DockPlacementBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface ActiveTtsPlayback {
  interrupted: boolean;
  finish: (completed: boolean) => void;
}

type SelectionPopupMode = "rewrite" | "answer" | "pending";

interface SelectionPopupPayload {
  token: number;
  mode: SelectionPopupMode;
  title: string;
  text: string;
  audioBase64: string;
}

const SELECTION_POPUP_WIDTH = 640;
const SELECTION_POPUP_MIN_WIDTH = 420;
const SELECTION_POPUP_MIN_HEIGHT = 120;
const SELECTION_POPUP_MAX_HEIGHT = 560;
const SELECTION_POPUP_CHARS_PER_LINE = 68;

const SETTINGS_STORAGE_KEY = "slasshy-desktop-assistant-settings-v4";
const LEGACY_SETTINGS_STORAGE_KEY = "slasshy-desktop-assistant-settings-v3";
const DICTIONARY_STORAGE_KEY = "slasshy-wispr-dictionary-v1";
const SNIPPETS_STORAGE_KEY = "slasshy-wispr-snippets-v1";
const NOTES_STORAGE_KEY = "slasshy-wispr-notes-v1";
const USAGE_STORAGE_KEY = "slasshy-wispr-usage-v1";
const DOCK_LAYOUT_STORAGE_KEY = "slasshy-wispr-dock-layout-v2";
const HOME_HISTORY_STORAGE_KEY = "slasshy-wispr-home-history-v1";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "slasshy-wispr-sidebar-collapsed-v1";
const EMPTY_HISTORY_HINT = "No turns yet. Start dictating to see your recent activity.";
const LEGACY_DEFAULT_SYSTEM_PROMPT =
  "You are SlasshyWispr, a helpful desktop voice assistant. Keep replies concise and easy to speak aloud.";
const DEFAULT_SYSTEM_PROMPT = "";
const DEFAULT_TEMPERATURE = 0.35;
const DEFAULT_MAX_TOKENS = 320;
const DEFAULT_API_BASE_URL = "";
const DEFAULT_STT_MODEL_NAME = "";
const DEFAULT_AI_MODEL_NAME = "";
const DEFAULT_HOTKEY = "Ctrl+Space";
const DEFAULT_COMMAND_HOTKEY = "Ctrl+Shift+Space";
const DEFAULT_CAPTURE_MODE: CaptureMode = "push-to-talk";
const DEFAULT_STYLE_PROFILE: StyleProfile = "adaptive";
const DEFAULT_TTS_ENGINE: TtsEngine = "piper";
const DEFAULT_ASSISTANT_NAME = "Lily";
const DEFAULT_PIPER_SPEED = 1.0;
const DEFAULT_PIPER_QUALITY: PiperQuality = "balanced";
const DEFAULT_PIPER_EMOTION: PiperEmotion = "neutral";
const DEFAULT_COQUI_MODEL = "tts_models/multilingual/multi-dataset/xtts_v2";
const DEFAULT_COQUI_LANGUAGE = "en";
const DEFAULT_COQUI_SPEED = 1.0;
const DEFAULT_COQUI_QUALITY: CoquiQuality = "balanced";
const DEFAULT_COQUI_EMOTION: CoquiEmotion = "neutral";
const MAX_COQUI_REFERENCE_SECONDS = 30;
const MAX_RECORDING_MS = 45_000;
const MAX_HISTORY_ITEMS = 12;
const FOREGROUND_BLOCK_CHECK_CACHE_MS = 320;
const BLOCKED_INPUT_NOTICE_COOLDOWN_MS = 2400;

function buildAgentOperatingCorePrompt(agentName: string): string {
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

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("Missing #app root element");
}

appRoot.innerHTML = `
  <div class="flow-shell">
    <aside class="flow-sidebar">
      <div class="window-controls">
        <button id="toggleSidebarBtn" class="chrome-icon" type="button" aria-label="Toggle sidebar">
          <span class="ico-grid"></span>
        </button>
        <button id="openProfileBtn" class="chrome-icon" type="button" aria-label="Open settings">
          <span class="ico-user"></span>
        </button>
      </div>

      <div class="brand-row">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <strong>SlasshyWispr</strong>
        <span class="brand-plan">Basic</span>
      </div>

      <nav class="nav-main" aria-label="Main navigation">
        <button class="nav-item is-active" data-page-nav="home" type="button"><span class="nav-glyph">⌂</span>Home</button>
        <button class="nav-item" data-page-nav="dictionary" type="button"><span class="nav-glyph">◱</span>Dictionary</button>
      </nav>

      <nav class="nav-secondary" aria-label="Secondary navigation">
        <button id="openSettingsBtn" class="secondary-link" type="button"><span class="secondary-glyph">⚙</span>Settings</button>
      </nav>
    </aside>

    <main class="flow-content">
      <section class="flow-page is-active" data-page="home">
        <div class="flow-page-inner home-page">
          <div class="welcome-row">
            <h1>Welcome back, Suman</h1>
            <div class="metric-pills" aria-label="Activity metrics">
              <span id="metricWords">0 words</span>
              <span id="metricWpm">0 WPM</span>
            </div>
          </div>

          <article class="focus-card home-setup-banner">
            <button class="home-setup-close" type="button" aria-label="Dismiss setup guidance">×</button>
            <div class="home-setup-copy">
              <h2>Using SlasshyWispr around other people?</h2>
              <p>Set up your hardware to dictate anywhere</p>
              <button class="dark-action" type="button">Improve my set up</button>
            </div>
            <div class="home-setup-art" aria-hidden="true">
              <span class="setup-art-bubble"></span>
              <span class="setup-art-bubble"></span>
              <span class="setup-art-card"></span>
              <span class="setup-art-card"></span>
            </div>
          </article>

          <section class="home-output">
            <article class="home-output-card">
              <h3>Transcript</h3>
              <p id="transcriptText" class="output-text muted">Your transcribed speech will appear here.</p>
            </article>
            <article class="home-output-card">
              <h3>Assistant Response</h3>
              <p id="assistantText" class="output-text muted">The AI response will appear here.</p>
            </article>
          </section>

          <section class="home-log">
            <div class="section-head">
              <h3 id="activityDate">February 18, 2026</h3>
              <button id="clearHistoryBtn" class="inline-link" type="button">Clear</button>
            </div>
            <div id="conversationLog" class="conversation-log">
              <p class="empty-hint">No turns yet. Start dictating to see your recent activity.</p>
            </div>
          </section>
        </div>
      </section>

      <section class="flow-page" data-page="dictionary" hidden>
        <div class="flow-page-inner">
          <div class="page-title-row">
            <h1>Dictionary</h1>
            <button id="dictionaryAddBtnTop" class="dark-action" type="button">Add new</button>
          </div>
          <div class="mini-tabs" role="tablist" aria-label="Dictionary filters">
            <button class="mini-tab is-active" data-dictionary-filter="all" type="button">All</button>
            <button class="mini-tab" data-dictionary-filter="personal" type="button">Personal</button>
            <button class="mini-tab" data-dictionary-filter="shared" type="button">Shared with team</button>
          </div>
          <article class="focus-card">
            <h2>SlasshyWispr speaks the way you speak.</h2>
            <p>
              Learn unique words and names automatically or manually. Add personal terms, company jargon,
              and client names so everyone stays aligned.
            </p>
            <form id="dictionaryForm" class="inline-create-form is-collapsed">
              <input id="dictionarySourceInput" type="text" placeholder="Spoken term (example: slashy)" autocomplete="off" />
              <input id="dictionaryTargetInput" type="text" placeholder="Correct term (example: Slasshy)" autocomplete="off" />
              <label class="inline-check"><input id="dictionarySharedInput" type="checkbox" />Shared with team</label>
              <button id="dictionaryAddBtn" class="dark-action" type="submit">Add new word</button>
            </form>
          </article>
          <div id="dictionaryList" class="simple-list">
            <p>No dictionary terms yet. Add your first correction above.</p>
          </div>
        </div>
      </section>

      <section class="flow-page" data-page="snippets" hidden>
        <div class="flow-page-inner">
          <div class="page-title-row">
            <h1>Snippets</h1>
            <button id="snippetsAddBtnTop" class="dark-action" type="button">Add new</button>
          </div>
          <div class="mini-tabs" role="tablist" aria-label="Snippet filters">
            <button class="mini-tab is-active" data-snippet-filter="all" type="button">All</button>
            <button class="mini-tab" data-snippet-filter="personal" type="button">Personal</button>
            <button class="mini-tab" data-snippet-filter="shared" type="button">Shared with team</button>
          </div>
          <article class="focus-card">
            <h2>The stuff you shouldn't have to re-type.</h2>
            <p>Save shortcuts for things you type all the time and expand them instantly while dictating.</p>
            <form id="snippetForm" class="inline-create-form is-collapsed">
              <input id="snippetTriggerInput" type="text" placeholder="Trigger phrase (example: intro email)" autocomplete="off" />
              <input id="snippetExpansionInput" type="text" placeholder="Expansion text" autocomplete="off" />
              <label class="inline-check"><input id="snippetSharedInput" type="checkbox" />Shared with team</label>
              <button id="snippetAddBtn" class="dark-action" type="submit">Add new snippet</button>
            </form>
          </article>
          <div id="snippetsList" class="simple-list">
            <p>No snippets yet. Add your first expansion above.</p>
          </div>
        </div>
      </section>

      <section class="flow-page" data-page="notes" hidden>
        <div class="flow-page-inner notes-layout">
          <h1>For quick thoughts you want to come back to</h1>
          <article class="quick-note-card">
            <p>Take a quick note with your voice</p>
            <button id="notesQuickMicBtn" class="notes-mic-btn" type="button" aria-label="Dictate a quick note">🎤</button>
          </article>
          <div class="section-head notes-head">
            <h3>Recents</h3>
          </div>
          <div id="notesList" class="notes-list">
            <p class="notes-empty">No notes found</p>
          </div>
        </div>
      </section>
    </main>
  </div>

  <div id="settingsOverlay" class="settings-overlay" hidden>
    <div class="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settingsPaneTitle">
      <aside class="settings-sidebar">
        <p class="settings-kicker">Settings</p>
        <nav class="settings-nav" aria-label="Settings sections">
          <button class="settings-nav-item is-active" data-settings-pane-nav="general" type="button">General</button>
          <button class="settings-nav-item" data-settings-pane-nav="system" type="button">System</button>
          <button class="settings-nav-item" data-settings-pane-nav="tts" type="button">TTS</button>
          <button class="settings-nav-item" data-settings-pane-nav="pipeline" type="button">Pipeline</button>
        </nav>

        <p class="settings-version">SlasshyWispr v0.1.0</p>
      </aside>

      <section class="settings-main">
        <header class="settings-header">
          <h2 id="settingsPaneTitle">General</h2>
          <button id="closeSettingsBtn" class="close-settings" type="button" aria-label="Close settings">✕</button>
        </header>

        <section class="settings-pane is-active" data-settings-pane="general">
          <div class="settings-card">
            <div class="settings-row">
              <div>
                <h3>Keyboard shortcuts</h3>
                <p>Dictation shortcut is <strong id="hotkeyHint">Ctrl + Space</strong>. <span class="learn-link">Learn more →</span></p>
                <div id="hotkeyEditor" class="inline-editor" hidden>
                  <label class="field">
                    <span>Push-To-Talk Hotkey</span>
                    <input id="hotkeyInput" type="text" placeholder="Click and press keys" autocomplete="off" />
                  </label>
                  <label class="field">
                    <span>Command Mode Hotkey</span>
                    <input id="commandHotkeyInput" type="text" placeholder="Ctrl+Shift+Space" autocomplete="off" />
                  </label>
                </div>
              </div>
              <button id="toggleHotkeyEditorBtn" class="ghost-action" type="button">Change</button>
            </div>

            <div class="settings-row">
              <div>
                <h3>Microphone</h3>
                <p id="microphoneSummary">Auto-detect</p>
                <div id="microphoneEditor" class="inline-editor" hidden>
                  <label class="field">
                    <span>Microphone Device</span>
                    <select id="microphoneSelect"></select>
                  </label>
                  <label class="field">
                    <span>Dictation language</span>
                    <select id="dictationLanguageSelect">
                      <option value="">Auto-detect</option>
                      <option value="en">English</option>
                      <option value="es">Spanish</option>
                      <option value="fr">French</option>
                      <option value="de">German</option>
                      <option value="it">Italian</option>
                      <option value="pt">Portuguese</option>
                      <option value="hi">Hindi</option>
                      <option value="bn">Bengali</option>
                      <option value="ja">Japanese</option>
                      <option value="ko">Korean</option>
                      <option value="zh">Chinese</option>
                      <option value="ar">Arabic</option>
                      <option value="ru">Russian</option>
                    </select>
                  </label>
                  <button id="refreshMicsBtn" class="ghost-action mini" type="button">Refresh</button>
                </div>
              </div>
              <button id="toggleMicEditorBtn" class="ghost-action" type="button">Change</button>
            </div>

            <div class="settings-row">
              <div>
                <h3>Capture mode</h3>
                <p id="captureModeHint">Push-To-Talk</p>
                <div class="capture-mode-pills">
                  <label><input id="captureModeSingle" name="captureMode" type="radio" value="single-tap" />Single tap</label>
                  <label><input id="captureModePushToTalk" name="captureMode" type="radio" value="push-to-talk" />Push-to-talk</label>
                </div>
              </div>
            </div>

            <div class="settings-row">
              <div>
                <h3>Style profile</h3>
                <p>Choose how SlasshyWispr rewrites and responds.</p>
                <label class="field inline-select">
                  <span>Style</span>
                  <select id="styleProfileSelect">
                    <option value="adaptive">Adaptive</option>
                    <option value="professional">Professional</option>
                    <option value="casual">Casual</option>
                    <option value="concise">Concise</option>
                    <option value="developer">Developer</option>
                  </select>
                </label>
              </div>
            </div>

          </div>
        </section>

        <section class="settings-pane" data-settings-pane="system" hidden>
          <h3 class="settings-section-title">App settings</h3>
          <div class="settings-card">
            <label class="switch-row"><span>Launch app at login</span><input id="launchAtLoginToggle" class="switch-input" type="checkbox" /></label>
            <label class="switch-row"><span>Show floating dock at all times</span><input id="showFlowBarToggle" class="switch-input" type="checkbox" /></label>
            <label class="switch-row"><span>Show app in dock</span><input id="showAppInDockToggle" class="switch-input" type="checkbox" /></label>
            <label class="switch-row"><span>Command mode</span><input id="commandModeToggle" class="switch-input" type="checkbox" /></label>
            <label class="switch-row"><span>Require wake phrase for AI replies</span><input id="wakeWordEnabledToggle" class="switch-input" type="checkbox" /></label>
            <label class="field">
              <span>Assistant wake name (say "Hey name")</span>
              <input id="assistantNameInput" type="text" placeholder="${DEFAULT_ASSISTANT_NAME}" autocomplete="off" />
            </label>
            <p id="wakePhrasePreview" class="notice">Wake phrase examples: "Hey ${DEFAULT_ASSISTANT_NAME}", "Hi ${DEFAULT_ASSISTANT_NAME}", "Okay ${DEFAULT_ASSISTANT_NAME}"</p>
            <label class="switch-row"><span>Context awareness (recent turns)</span><input id="contextAwarenessToggle" class="switch-input" type="checkbox" /></label>
            <label class="switch-row"><span>Copy assistant response to clipboard</span><input id="copyToClipboardToggle" class="switch-input" type="checkbox" /></label>
            <label class="switch-row"><span>Auto paste dictation after copy</span><input id="autoPasteDictationToggle" class="switch-input" type="checkbox" /></label>
            <label class="switch-row"><span>Incognito mode (no local history/notes)</span><input id="incognitoModeToggle" class="switch-input" type="checkbox" /></label>
            <label class="select-row">
              <span>Theme</span>
              <select id="themeModeSelect">
                <option value="system">Match system</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
          </div>

          <h3 class="settings-section-title">Provider models</h3>
          <div class="settings-card">
            <div class="settings-row">
              <div class="full-row">
                <h3>Provider models</h3>
                <div class="compact-grid">
                  <label class="field">
                    <span>API Base URL</span>
                    <input id="apiBaseUrlInput" type="text" placeholder="Use default provider URL" autocomplete="off" />
                  </label>
                  <label class="field">
                    <span>STT model</span>
                    <input id="sttModelInput" type="text" placeholder="Use default STT model" autocomplete="off" />
                  </label>
                </div>
                <label class="field">
                  <span>Provider API Key</span>
                  <input id="apiKeyInput" type="password" placeholder="Paste your API key" autocomplete="off" />
                </label>
                <label class="checkbox-field">
                  <input id="rememberApiKeyInput" type="checkbox" />
                  <span>Remember API key locally on this machine</span>
                </label>
                <label class="field">
                  <span>AI model</span>
                  <input id="aiModelInput" type="text" placeholder="Use default AI model" autocomplete="off" />
                </label>
                <label class="field">
                  <span>Model catalog</span>
                  <select id="providerModelCatalogSelect">
                    <option value="">Fetch models to load catalog...</option>
                  </select>
                </label>
                <div class="button-row">
                  <button id="fetchProviderModelsBtn" class="ghost-action" type="button">Fetch models</button>
                  <button id="applyModelToAiBtn" class="ghost-action" type="button">Use for AI</button>
                  <button id="applyModelToSttBtn" class="ghost-action" type="button">Use for STT</button>
                </div>
                <p class="notice">Set API base URL, STT model, and AI model to run the pipeline.</p>
              </div>
            </div>
          </div>

          <h3 class="settings-section-title">Sound</h3>
          <div class="settings-card">
            <label class="switch-row"><span>Dictation sound effects</span><input id="dictationSoundEffectsToggle" class="switch-input" type="checkbox" /></label>
            <label class="switch-row"><span>Mute music while dictating</span><input id="muteMusicWhileDictatingToggle" class="switch-input" type="checkbox" /></label>
          </div>

          <h3 class="settings-section-title">Transcript refinement</h3>
          <div class="settings-card">
            <label class="switch-row"><span>Backtrack corrections (e.g. "scratch that")</span><input id="backtrackToggle" class="switch-input" type="checkbox" /></label>
            <label class="switch-row"><span>Remove filler words</span><input id="removeFillersToggle" class="switch-input" type="checkbox" /></label>
            <label class="switch-row"><span>Auto punctuation</span><input id="autoPunctuationToggle" class="switch-input" type="checkbox" /></label>
            <label class="switch-row"><span>Auto numbered lists</span><input id="numberedListsToggle" class="switch-input" type="checkbox" /></label>
          </div>
        </section>

        <section class="settings-pane" data-settings-pane="tts" hidden>
          <h3 class="settings-section-title">Setup</h3>
          <div id="ttsBootstrapCard" class="settings-card tts-bootstrap-card">
            <div class="tts-bootstrap-head">
              <div>
                <h3>TTS Runtime Bootstrap</h3>
                <p>
                  Use one button to install and configure Piper (main) + Coqui (beta) runtime dependencies with live progress logs.
                </p>
              </div>
              <button id="setupAllTtsBtn" class="dark-action" type="button">Setup all TTS runtimes</button>
            </div>
            <p id="ttsSetupStatus" class="notice">Waiting for setup.</p>
            <div id="ttsSetupLogs" class="setup-log-list" aria-live="polite">
              <p class="setup-log-item">No setup logs yet.</p>
            </div>
          </div>

          <div id="ttsProfilesArea" hidden>
            <h3 class="settings-section-title">Profiles</h3>
            <div class="settings-card tts-engine-card">
              <label class="field inline-select">
                <span>Active engine profile</span>
                <select id="ttsEngineSelect">
                  <option value="piper">Piper (Main)</option>
                  <option value="coqui">Coqui (Beta)</option>
                </select>
              </label>

              <div class="compact-grid">
                <label class="field">
                  <span>Quality</span>
                  <select id="coquiQualitySelect">
                    <option value="fast">Fast</option>
                    <option value="balanced">Balanced</option>
                    <option value="high">High quality</option>
                  </select>
                </label>
                <label class="field">
                  <span>Emotion style</span>
                  <select id="coquiEmotionSelect">
                    <option value="neutral">Neutral</option>
                    <option value="calm">Calm</option>
                    <option value="happy">Happy</option>
                    <option value="excited">Excited</option>
                    <option value="serious">Serious</option>
                    <option value="sad">Sad</option>
                  </select>
                </label>
              </div>

              <label class="field">
                <span>Speed <strong id="coquiSpeedValue">1.00x</strong></span>
                <input id="coquiSpeedInput" type="range" min="0.5" max="2" step="0.05" />
              </label>
              <label class="checkbox-field">
                <input id="coquiSplitSentencesToggle" type="checkbox" />
                <span>Split long replies into shorter sentence chunks (Coqui)</span>
              </label>
            </div>

            <div class="tts-profile-tabs" role="tablist" aria-label="TTS profiles">
              <button id="ttsProfilePiperTab" class="mini-tab is-active" type="button">Piper (Main)</button>
              <button id="ttsProfileCoquiTab" class="mini-tab" type="button">Coqui (Beta)</button>
            </div>

            <div id="ttsProfilePiperPanel" class="settings-card tts-profile-panel">
              <div class="tts-profile-grid">
                <label class="field">
                  <span>Piper executable path (optional override)</span>
                  <input id="piperPathInput" type="text" placeholder="Auto-filled after runtime setup" autocomplete="off" />
                </label>
                <div class="compact-grid">
                  <label class="field">
                    <span>Voice quality</span>
                    <select id="piperQualitySelect">
                      <option value="fast">Fast</option>
                      <option value="balanced">Balanced</option>
                      <option value="high">High quality</option>
                    </select>
                  </label>
                  <label class="field">
                    <span>Emotion style</span>
                    <select id="piperEmotionSelect">
                      <option value="neutral">Neutral</option>
                      <option value="calm">Calm</option>
                      <option value="happy">Happy</option>
                      <option value="excited">Excited</option>
                      <option value="serious">Serious</option>
                      <option value="sad">Sad</option>
                    </select>
                  </label>
                </div>
                <label class="field">
                  <span>Speed <strong id="piperSpeedValue">1.00x</strong></span>
                  <input id="piperSpeedInput" type="range" min="0.5" max="2" step="0.05" />
                </label>
                <p class="notice">Emotion/quality for Piper are expressive presets, not true voice cloning.</p>

                <div class="button-row">
                  <button id="setupRuntimeBtn" class="ghost-action" type="button">Re-setup Piper</button>
                  <button id="validatePiperBtn" class="ghost-action" type="button">Validate Piper</button>
                  <button id="downloadVoiceBtn" class="ghost-action" type="button">Download voice only</button>
                </div>
              </div>

              <div class="model-meta">
                <p><span>Base URL</span><code id="baseUrlValue">loading...</code></p>
                <p><span>STT Model</span><code id="sttModelValue">loading...</code></p>
                <p><span>AI Model</span><code id="aiModelValue">loading...</code></p>
                <p><span>Piper</span><code id="piperStatusValue">checking...</code></p>
                <p><span>Piper Path</span><code id="piperPathValue">-</code></p>
                <p><span>Voice</span><code id="voiceStatusValue">checking...</code></p>
                <p><span>Voice Path</span><code id="voicePathValue">-</code></p>
              </div>
            </div>

            <div id="ttsProfileCoquiPanel" class="settings-card tts-profile-panel" hidden>
              <p class="notice">Coqui is beta and loads only when you select it.</p>
              <div class="tts-profile-grid">
                <label class="field">
                  <span>Python path (optional override)</span>
                  <input id="coquiPythonPathInput" type="text" placeholder="Leave blank to use bundled/runtime python" autocomplete="off" />
                </label>
                <label class="field">
                  <span>Coqui model</span>
                  <input id="coquiModelInput" type="text" placeholder="${DEFAULT_COQUI_MODEL}" autocomplete="off" />
                </label>
                <label class="field">
                  <span>Language code</span>
                  <input id="coquiLanguageInput" type="text" placeholder="en" autocomplete="off" />
                </label>
                <label class="checkbox-field">
                  <input id="coquiUseGpuToggle" type="checkbox" />
                  <span>Use CUDA/GPU if available</span>
                </label>

                <div class="button-row">
                  <button id="setupCoquiBtn" class="ghost-action" type="button">Re-setup Coqui</button>
                  <button id="validateCoquiBtn" class="ghost-action" type="button">Validate Coqui</button>
                  <button id="refreshCoquiModelsBtn" class="ghost-action" type="button">Refresh models</button>
                </div>

                <label class="field">
                  <span>Model catalog</span>
                  <select id="coquiModelCatalogSelect">
                    <option value="">Load models list...</option>
                  </select>
                </label>

                <div class="model-meta">
                  <p><span>Status</span><code id="coquiStatusValue">checking...</code></p>
                  <p><span>Python</span><code id="coquiPythonValue">-</code></p>
                  <p><span>TTS Version</span><code id="coquiVersionValue">-</code></p>
                  <p><span>CUDA</span><code id="coquiCudaValue">-</code></p>
                  <p><span>Voice Dir</span><code id="coquiVoiceDirValue">-</code></p>
                </div>
              </div>

              <div class="tts-clone-card">
                <label class="field">
                  <span>Voice profile ID</span>
                  <input id="coquiVoiceIdInput" type="text" placeholder="my_voice_profile" autocomplete="off" />
                </label>
                <label class="field">
                  <span>Reference sample (WAV/MP3/WEBM, max 30 seconds)</span>
                  <input id="coquiVoiceFileInput" type="file" accept="audio/*" />
                </label>
                <p id="coquiCloneStatus" class="notice">Ready to clone a voice sample.</p>
                <div class="button-row">
                  <button id="cloneCoquiVoiceBtn" class="ghost-action" type="button">Clone voice</button>
                  <button id="testCoquiVoiceBtn" class="ghost-action" type="button">Test selected voice</button>
                  <button id="refreshCoquiVoicesBtn" class="ghost-action" type="button">Refresh voices</button>
                </div>
                <label class="field">
                  <span>Saved cloned voices</span>
                  <select id="coquiVoiceSelect">
                    <option value="">No voices found</option>
                  </select>
                </label>
                <audio id="coquiVoicePreview" controls preload="none"></audio>
                <p class="notice">Upload a clean sample between 3 and 30 seconds for best cloning quality.</p>
              </div>
            </div>
          </div>
        </section>

        <section class="settings-pane" data-settings-pane="pipeline" hidden>
          <h3 class="settings-section-title">Prompting</h3>
          <div class="settings-card">
            <label class="field">
              <span>System Prompt</span>
              <textarea id="systemPromptInput" rows="4" spellcheck="false"></textarea>
            </label>
            <div class="compact-grid">
              <label class="field">
                <span>Temperature <strong id="temperatureValue">0.35</strong></span>
                <input id="temperatureInput" type="range" min="0" max="1.2" step="0.05" />
              </label>
              <label class="field">
                <span>Max Tokens</span>
                <input id="maxTokensInput" type="number" min="64" max="1024" step="16" />
              </label>
            </div>
          </div>

          <h3 class="settings-section-title">Pipeline status</h3>
          <div class="settings-card">
            <div class="pipeline-status-row">
              <div id="statusPill" class="status-pill" data-stage="idle">Idle</div>
              <p id="statusDetail" class="status-detail">Ready.</p>
            </div>
            <div class="latency-grid" aria-live="polite">
              <p><span>STT</span><strong id="sttLatency">-</strong></p>
              <p><span>AI</span><strong id="aiLatency">-</strong></p>
              <p><span>TTS</span><strong id="ttsLatency">-</strong></p>
              <p><span>Total</span><strong id="totalLatency">-</strong></p>
            </div>
            <p id="noticeText" class="notice">Ready.</p>
            <audio id="assistantAudio" controls preload="none"></audio>
          </div>
        </section>
      </section>
    </div>
  </div>

  <div class="hidden-runtime-state" aria-hidden="true">
    <span id="recordTimer">00.0s</span>
    <button id="recordBtn" class="hidden-record" type="button">Start Recording</button>
  </div>
`;

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}

function applySidebarCollapsed(collapsed: boolean): void {
  document.body.classList.toggle("sidebar-collapsed", collapsed);
  toggleSidebarBtn.setAttribute("aria-pressed", collapsed ? "true" : "false");
}

const settingsOverlay = requiredElement<HTMLDivElement>("#settingsOverlay");
const toggleSidebarBtn = requiredElement<HTMLButtonElement>("#toggleSidebarBtn");
const openProfileBtn = requiredElement<HTMLButtonElement>("#openProfileBtn");
const openSettingsBtn = requiredElement<HTMLButtonElement>("#openSettingsBtn");
const closeSettingsBtn = requiredElement<HTMLButtonElement>("#closeSettingsBtn");
const settingsPaneTitle = requiredElement<HTMLElement>("#settingsPaneTitle");
const homeSetupBanner = document.querySelector<HTMLElement>(".home-setup-banner");
const homeSetupCloseBtn = document.querySelector<HTMLButtonElement>(".home-setup-close");
const ttsBootstrapCard = requiredElement<HTMLDivElement>("#ttsBootstrapCard");
const ttsProfilesArea = requiredElement<HTMLDivElement>("#ttsProfilesArea");
const ttsSetupStatus = requiredElement<HTMLParagraphElement>("#ttsSetupStatus");
const ttsSetupLogs = requiredElement<HTMLDivElement>("#ttsSetupLogs");
const setupAllTtsBtn = requiredElement<HTMLButtonElement>("#setupAllTtsBtn");
const ttsProfilePiperTab = requiredElement<HTMLButtonElement>("#ttsProfilePiperTab");
const ttsProfileCoquiTab = requiredElement<HTMLButtonElement>("#ttsProfileCoquiTab");
const ttsProfilePiperPanel = requiredElement<HTMLDivElement>("#ttsProfilePiperPanel");
const ttsProfileCoquiPanel = requiredElement<HTMLDivElement>("#ttsProfileCoquiPanel");

const pageNavButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-page-nav]"));
const pagePanels = Array.from(document.querySelectorAll<HTMLElement>("[data-page]"));
const settingsNavButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-settings-pane-nav]"),
);
const settingsPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-settings-pane]"));

const statusPill = requiredElement<HTMLDivElement>("#statusPill");
const statusDetail = requiredElement<HTMLParagraphElement>("#statusDetail");
const hotkeyHint = requiredElement<HTMLElement>("#hotkeyHint");
const captureModeHint = requiredElement<HTMLElement>("#captureModeHint");
const noticeText = requiredElement<HTMLParagraphElement>("#noticeText");
const activityDate = requiredElement<HTMLElement>("#activityDate");
const metricWords = requiredElement<HTMLElement>("#metricWords");
const metricWpm = requiredElement<HTMLElement>("#metricWpm");

const dictionaryList = requiredElement<HTMLDivElement>("#dictionaryList");
const dictionaryForm = requiredElement<HTMLFormElement>("#dictionaryForm");
const dictionarySourceInput = requiredElement<HTMLInputElement>("#dictionarySourceInput");
const dictionaryTargetInput = requiredElement<HTMLInputElement>("#dictionaryTargetInput");
const dictionarySharedInput = requiredElement<HTMLInputElement>("#dictionarySharedInput");
const dictionaryAddBtn = requiredElement<HTMLButtonElement>("#dictionaryAddBtn");
const dictionaryAddBtnTop = requiredElement<HTMLButtonElement>("#dictionaryAddBtnTop");
const dictionaryFilterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-dictionary-filter]"),
);

const snippetsList = requiredElement<HTMLDivElement>("#snippetsList");
const snippetForm = requiredElement<HTMLFormElement>("#snippetForm");
const snippetTriggerInput = requiredElement<HTMLInputElement>("#snippetTriggerInput");
const snippetExpansionInput = requiredElement<HTMLInputElement>("#snippetExpansionInput");
const snippetSharedInput = requiredElement<HTMLInputElement>("#snippetSharedInput");
const snippetAddBtn = requiredElement<HTMLButtonElement>("#snippetAddBtn");
const snippetsAddBtnTop = requiredElement<HTMLButtonElement>("#snippetsAddBtnTop");
const snippetFilterButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-snippet-filter]"),
);

const notesList = requiredElement<HTMLDivElement>("#notesList");

const apiKeyInput = requiredElement<HTMLInputElement>("#apiKeyInput");
const apiBaseUrlInput = requiredElement<HTMLInputElement>("#apiBaseUrlInput");
const sttModelInput = requiredElement<HTMLInputElement>("#sttModelInput");
const aiModelInput = requiredElement<HTMLInputElement>("#aiModelInput");
const providerModelCatalogSelect = requiredElement<HTMLSelectElement>("#providerModelCatalogSelect");
const rememberApiKeyInput = requiredElement<HTMLInputElement>("#rememberApiKeyInput");
const captureModeSingleInput = requiredElement<HTMLInputElement>("#captureModeSingle");
const captureModePushToTalkInput = requiredElement<HTMLInputElement>("#captureModePushToTalk");
const microphoneSelect = requiredElement<HTMLSelectElement>("#microphoneSelect");
const microphoneSummary = requiredElement<HTMLElement>("#microphoneSummary");
const hotkeyInput = requiredElement<HTMLInputElement>("#hotkeyInput");
const commandHotkeyInput = requiredElement<HTMLInputElement>("#commandHotkeyInput");
const dictationLanguageSelect = requiredElement<HTMLSelectElement>("#dictationLanguageSelect");
const styleProfileSelect = requiredElement<HTMLSelectElement>("#styleProfileSelect");
const ttsEngineSelect = requiredElement<HTMLSelectElement>("#ttsEngineSelect");
const piperPathInput = requiredElement<HTMLInputElement>("#piperPathInput");
const piperQualitySelect = requiredElement<HTMLSelectElement>("#piperQualitySelect");
const piperEmotionSelect = requiredElement<HTMLSelectElement>("#piperEmotionSelect");
const piperSpeedInput = requiredElement<HTMLInputElement>("#piperSpeedInput");
const coquiPythonPathInput = requiredElement<HTMLInputElement>("#coquiPythonPathInput");
const coquiModelInput = requiredElement<HTMLInputElement>("#coquiModelInput");
const coquiLanguageInput = requiredElement<HTMLInputElement>("#coquiLanguageInput");
const coquiVoiceIdInput = requiredElement<HTMLInputElement>("#coquiVoiceIdInput");
const coquiVoiceSelect = requiredElement<HTMLSelectElement>("#coquiVoiceSelect");
const coquiModelCatalogSelect = requiredElement<HTMLSelectElement>("#coquiModelCatalogSelect");
const coquiSpeedInput = requiredElement<HTMLInputElement>("#coquiSpeedInput");
const coquiQualitySelect = requiredElement<HTMLSelectElement>("#coquiQualitySelect");
const coquiEmotionSelect = requiredElement<HTMLSelectElement>("#coquiEmotionSelect");
const coquiUseGpuToggle = requiredElement<HTMLInputElement>("#coquiUseGpuToggle");
const coquiSplitSentencesToggle = requiredElement<HTMLInputElement>("#coquiSplitSentencesToggle");
const coquiVoiceFileInput = requiredElement<HTMLInputElement>("#coquiVoiceFileInput");
const systemPromptInput = requiredElement<HTMLTextAreaElement>("#systemPromptInput");
const temperatureInput = requiredElement<HTMLInputElement>("#temperatureInput");
const temperatureValue = requiredElement<HTMLElement>("#temperatureValue");
const piperSpeedValue = requiredElement<HTMLElement>("#piperSpeedValue");
const coquiSpeedValue = requiredElement<HTMLElement>("#coquiSpeedValue");
const maxTokensInput = requiredElement<HTMLInputElement>("#maxTokensInput");

const launchAtLoginToggle = requiredElement<HTMLInputElement>("#launchAtLoginToggle");
const showFlowBarToggle = requiredElement<HTMLInputElement>("#showFlowBarToggle");
const showAppInDockToggle = requiredElement<HTMLInputElement>("#showAppInDockToggle");
const commandModeToggle = requiredElement<HTMLInputElement>("#commandModeToggle");
const wakeWordEnabledToggle = requiredElement<HTMLInputElement>("#wakeWordEnabledToggle");
const assistantNameInput = requiredElement<HTMLInputElement>("#assistantNameInput");
const wakePhrasePreview = requiredElement<HTMLParagraphElement>("#wakePhrasePreview");
const contextAwarenessToggle = requiredElement<HTMLInputElement>("#contextAwarenessToggle");
const copyToClipboardToggle = requiredElement<HTMLInputElement>("#copyToClipboardToggle");
const autoPasteDictationToggle = requiredElement<HTMLInputElement>("#autoPasteDictationToggle");
const incognitoModeToggle = requiredElement<HTMLInputElement>("#incognitoModeToggle");
const themeModeSelect = requiredElement<HTMLSelectElement>("#themeModeSelect");
const dictationSoundEffectsToggle = requiredElement<HTMLInputElement>("#dictationSoundEffectsToggle");
const muteMusicWhileDictatingToggle = requiredElement<HTMLInputElement>(
  "#muteMusicWhileDictatingToggle",
);
const backtrackToggle = requiredElement<HTMLInputElement>("#backtrackToggle");
const removeFillersToggle = requiredElement<HTMLInputElement>("#removeFillersToggle");
const autoPunctuationToggle = requiredElement<HTMLInputElement>("#autoPunctuationToggle");
const numberedListsToggle = requiredElement<HTMLInputElement>("#numberedListsToggle");

const baseUrlValue = requiredElement<HTMLElement>("#baseUrlValue");
const sttModelValue = requiredElement<HTMLElement>("#sttModelValue");
const aiModelValue = requiredElement<HTMLElement>("#aiModelValue");
const piperStatusValue = requiredElement<HTMLElement>("#piperStatusValue");
const piperPathValue = requiredElement<HTMLElement>("#piperPathValue");
const voiceStatusValue = requiredElement<HTMLElement>("#voiceStatusValue");
const voicePathValue = requiredElement<HTMLElement>("#voicePathValue");
const coquiStatusValue = requiredElement<HTMLElement>("#coquiStatusValue");
const coquiPythonValue = requiredElement<HTMLElement>("#coquiPythonValue");
const coquiVersionValue = requiredElement<HTMLElement>("#coquiVersionValue");
const coquiCudaValue = requiredElement<HTMLElement>("#coquiCudaValue");
const coquiVoiceDirValue = requiredElement<HTMLElement>("#coquiVoiceDirValue");

const refreshMicsBtn = requiredElement<HTMLButtonElement>("#refreshMicsBtn");
const setupRuntimeBtn = requiredElement<HTMLButtonElement>("#setupRuntimeBtn");
const fetchProviderModelsBtn = requiredElement<HTMLButtonElement>("#fetchProviderModelsBtn");
const applyModelToAiBtn = requiredElement<HTMLButtonElement>("#applyModelToAiBtn");
const applyModelToSttBtn = requiredElement<HTMLButtonElement>("#applyModelToSttBtn");
const validatePiperBtn = requiredElement<HTMLButtonElement>("#validatePiperBtn");
const downloadVoiceBtn = requiredElement<HTMLButtonElement>("#downloadVoiceBtn");
const setupCoquiBtn = requiredElement<HTMLButtonElement>("#setupCoquiBtn");
const validateCoquiBtn = requiredElement<HTMLButtonElement>("#validateCoquiBtn");
const refreshCoquiVoicesBtn = requiredElement<HTMLButtonElement>("#refreshCoquiVoicesBtn");
const refreshCoquiModelsBtn = requiredElement<HTMLButtonElement>("#refreshCoquiModelsBtn");
const cloneCoquiVoiceBtn = requiredElement<HTMLButtonElement>("#cloneCoquiVoiceBtn");
const testCoquiVoiceBtn = requiredElement<HTMLButtonElement>("#testCoquiVoiceBtn");
const recordBtn = requiredElement<HTMLButtonElement>("#recordBtn");
const clearHistoryBtn = requiredElement<HTMLButtonElement>("#clearHistoryBtn");
const notesQuickMicBtn = requiredElement<HTMLButtonElement>("#notesQuickMicBtn");

const toggleHotkeyEditorBtn = requiredElement<HTMLButtonElement>("#toggleHotkeyEditorBtn");
const toggleMicEditorBtn = requiredElement<HTMLButtonElement>("#toggleMicEditorBtn");
const hotkeyEditor = requiredElement<HTMLDivElement>("#hotkeyEditor");
const microphoneEditor = requiredElement<HTMLDivElement>("#microphoneEditor");

const recordTimer = requiredElement<HTMLSpanElement>("#recordTimer");
const sttLatency = requiredElement<HTMLElement>("#sttLatency");
const aiLatency = requiredElement<HTMLElement>("#aiLatency");
const ttsLatency = requiredElement<HTMLElement>("#ttsLatency");
const totalLatency = requiredElement<HTMLElement>("#totalLatency");

const transcriptText = requiredElement<HTMLParagraphElement>("#transcriptText");
const assistantText = requiredElement<HTMLParagraphElement>("#assistantText");
const conversationLog = requiredElement<HTMLDivElement>("#conversationLog");
const assistantAudio = requiredElement<HTMLAudioElement>("#assistantAudio");
const coquiVoicePreview = requiredElement<HTMLAudioElement>("#coquiVoicePreview");
const coquiCloneStatus = requiredElement<HTMLParagraphElement>("#coquiCloneStatus");

let stage: Stage = "idle";
let pipelineRunning = false;
let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let recorderMimeType = "audio/webm";
let recordedChunks: Blob[] = [];
let recordingStartedAt = 0;
let recordingTickerId: number | null = null;
let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let amplitudeSourceNode: MediaStreamAudioSourceNode | null = null;
let amplitudeBuffer: Float32Array<ArrayBuffer> | null = null;
let amplitudeFrameId: number | null = null;
let dockAmplitude = 0;
let lastDockAmplitudePublishAt = 0;
let dockHideTimerId: number | null = null;
let microphonePermissionGranted = false;
const pushToTalkHoldSources = new Set<HoldSource>();
let activeTtsPlayback: ActiveTtsPlayback | null = null;
let voiceIndicatorWindow: WebviewWindow | null = null;
let selectionAssistantWindow: WebviewWindow | null = null;
let latestSelectionPopupPayload: SelectionPopupPayload | null = null;
let dockLayout = loadDockLayout();
let hotkeyCaptureActive = false;
const hotkeyCaptureModifiers = {
  ctrl: false,
  shift: false,
  alt: false,
  meta: false,
};
let commandHotkeyCaptureActive = false;
const commandHotkeyCaptureModifiers = {
  ctrl: false,
  shift: false,
  alt: false,
  meta: false,
};
let activeDictionaryFilter: "all" | TeamScope = "all";
let activeSnippetFilter: "all" | TeamScope = "all";
let dictionaryTerms = loadDictionaryTerms();
let snippets = loadSnippets();
let quickNotes = loadQuickNotes();
let usageStats = loadUsageStats();
let homeHistoryEntries = loadHomeHistory();
let commandModeArmed = false;
let commandSelectionSnapshot: string | null = null;
const recentTurns: Array<{ speaker: string; content: string }> = [];
let activePage: MainPage = "home";
let globalShortcutsActive = false;
let shortcutsSuppressedByBlockedApp = false;
let registeredPushShortcut = "";
let registeredCommandShortcut = "";
let registeredShortcutSignature = "";
let shortcutSyncInFlight: Promise<void> | null = null;
let shortcutSyncQueued = false;
let dockRuntimeErrorShown = false;
let coquiModelCatalog: string[] = [];
let providerModelCatalog: string[] = [];
let latestAssistantInfoDefaults: AssistantInfoResponse | null = null;
let piperRuntimeReady = false;
let coquiRuntimeInstalled = false;
let coquiCloneInProgress = false;
let ttsSetupPollingId: number | null = null;
let ttsSetupRunning = false;
let ttsSetupPollInFlight = false;
let effectAudioContext: AudioContext | null = null;
let externalMediaMutedForDictation = false;
let externalMediaControlInFlight: Promise<void> | null = null;
let externalMediaControlErrorShown = false;
let launchAtLoginSyncNonce = 0;
let foregroundBlockStatusCache: ForegroundInputBlockStatus = {
  blocked: false,
  processName: "",
};
let foregroundBlockCheckedAt = 0;
let foregroundBlockCheckInFlight: Promise<ForegroundInputBlockStatus> | null = null;
let lastBlockedInputNoticeAt = 0;
let lastBlockedInputProcess = "";
let foregroundBlockMonitorId: number | null = null;
let foregroundBlockMonitorInFlight = false;
const dockChannel = new BroadcastChannel("slasshywispr-dock");
const selectionPopupChannel = new BroadcastChannel("slasshywispr-selection-popup");
const systemThemeMediaQuery =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;

let settings = loadSettings();
if (settings.ttsEngine === "coqui") {
  settings.ttsEngine = "piper";
}
const initialHotkey = parseHotkey(settings.pushToTalkHotkey) ?? parseHotkey(DEFAULT_HOTKEY);
settings.pushToTalkHotkey = initialHotkey?.label ?? DEFAULT_HOTKEY;
const initialCommandHotkey =
  parseHotkey(settings.commandHotkey) ?? parseHotkey(DEFAULT_COMMAND_HOTKEY);
settings.commandHotkey = initialCommandHotkey?.label ?? DEFAULT_COMMAND_HOTKEY;
applySettingsToForm(settings);
renderCoquiModelCatalog([], settings.coquiModelName);
renderProviderModelCatalog([], settings.aiModelName || settings.sttModelName);
renderCoquiVoiceOptions([], settings.coquiVoiceId);
setActiveTtsProfile("piper");
updateTtsSetupGate();
persistSettings(settings);
persistDictionaryTerms();
persistSnippets();
persistQuickNotes();
persistUsageStats();

dockChannel.onmessage = (event: MessageEvent<unknown>) => {
  const payload = event.data as { kind?: string; action?: string } | null;
  if (!payload || payload.kind !== "action") {
    return;
  }

  if (payload.action === "toggle-mic") {
    void handleDockMicToggle();
  }
};

selectionPopupChannel.onmessage = (event: MessageEvent<unknown>) => {
  const payload = event.data as { kind?: string; action?: string } | null;
  if (!payload || payload.kind !== "action") {
    return;
  }

  if (payload.action === "request-state") {
    if (latestSelectionPopupPayload) {
      selectionPopupChannel.postMessage({
        kind: "payload",
        payload: latestSelectionPopupPayload,
      });
    }
    return;
  }

  if (payload.action === "copy-result") {
    if (latestSelectionPopupPayload) {
      void copyToClipboard(latestSelectionPopupPayload.text, {
        successMessage: "Selection result copied to clipboard.",
        errorMessage: "Unable to copy selection result.",
      });
    }
    return;
  }

  if (payload.action === "replace-selection") {
    if (latestSelectionPopupPayload) {
      void (async () => {
        if (selectionAssistantWindow) {
          try {
            await selectionAssistantWindow.hide();
          } catch {
            // Ignore hide failures and still attempt replacement.
          }
          await new Promise<void>((resolve) => {
            window.setTimeout(resolve, 140);
          });
        }

        const replaced = await triggerAutoPaste(latestSelectionPopupPayload.text);
        if (replaced) {
          setNotice("Selected text replaced from popup.");
        } else {
          setNotice("Unable to replace selection automatically from popup.", true);
        }
      })();
    }
    return;
  }

  if (payload.action === "close-popup") {
    if (selectionAssistantWindow) {
      void selectionAssistantWindow.hide().catch(() => {
        // Ignore hide errors.
      });
    }
  }
};

if (systemThemeMediaQuery) {
  const handleSystemThemeChange = (): void => {
    if (settings.themeMode === "system") {
      publishDockState();
    }
  };

  systemThemeMediaQuery.addEventListener("change", handleSystemThemeChange);
}

setActivePage("home");
setActiveSettingsPane("general");
renderDictionaryList();
renderSnippetsList();
renderNotesList();
updateUsageMetrics();
renderHomeHistory();
refreshRecordButton();
syncActionAvailability();
hotkeyInput.readOnly = true;
commandHotkeyInput.readOnly = true;
requestGlobalShortcutSync(true);
requestLaunchAtLoginSync(settings.launchAtLogin);
startBlockedAppShortcutSuppressionMonitor();
applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1");
activityDate.textContent = new Date().toLocaleDateString([], {
  month: "long",
  day: "numeric",
  year: "numeric",
});

for (const navButton of pageNavButtons) {
  navButton.addEventListener("click", () => {
    const page = asMainPage(navButton.dataset.pageNav);
    if (!page) return;
    setActivePage(page);
  });
}

for (const navButton of settingsNavButtons) {
  navButton.addEventListener("click", () => {
    const pane = asSettingsPane(navButton.dataset.settingsPaneNav);
    if (!pane) return;
    setActiveSettingsPane(pane);
  });
}

ttsProfilePiperTab.addEventListener("click", () => {
  if (ttsEngineSelect.value !== "piper") {
    ttsEngineSelect.value = "piper";
    handleSettingsChange();
    return;
  }
  setActiveTtsProfile("piper");
});

ttsProfileCoquiTab.addEventListener("click", () => {
  if (ttsEngineSelect.value !== "coqui") {
    ttsEngineSelect.value = "coqui";
    handleSettingsChange();
    return;
  }
  setActiveTtsProfile("coqui");
});

toggleSidebarBtn.addEventListener("click", () => {
  const collapsed = !document.body.classList.contains("sidebar-collapsed");
  applySidebarCollapsed(collapsed);
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
});

openProfileBtn.addEventListener("click", () => {
  openSettings();
});

openSettingsBtn.addEventListener("click", () => {
  openSettings();
});

if (homeSetupBanner && homeSetupCloseBtn) {
  homeSetupCloseBtn.addEventListener("click", () => {
    homeSetupBanner.remove();
  });
}

closeSettingsBtn.addEventListener("click", () => {
  closeSettings();
});

settingsOverlay.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) {
    closeSettings();
  }
});

document.addEventListener("keydown", (event) => {
  if (hotkeyCaptureActive) {
    handleHotkeyCaptureKeydown(event);
    return;
  }
  if (commandHotkeyCaptureActive) {
    handleCommandHotkeyCaptureKeydown(event);
    return;
  }

  if (event.key === "Escape" && !settingsOverlay.hidden) {
    closeSettings();
    return;
  }

  if (isTypingElement(event.target)) {
    return;
  }

  if (globalShortcutsActive) {
    return;
  }

  const commandHotkey = parseHotkey(settings.commandHotkey);
  if (settings.commandMode && commandHotkey && matchesHotkey(event, commandHotkey)) {
    if (event.repeat) {
      return;
    }
    event.preventDefault();
    void (async () => {
      if (await shouldBlockAssistantInputFromForegroundApp()) {
        return;
      }
      toggleCommandModeArmed();
    })();
    return;
  }

  const parsed = parseHotkey(settings.pushToTalkHotkey);
  if (!parsed || !matchesHotkey(event, parsed)) {
    return;
  }

  if (settings.captureMode === "push-to-talk") {
    if (event.repeat) {
      return;
    }

    event.preventDefault();
    void engagePushToTalk("hotkey");
    return;
  }

  if (event.repeat) {
    return;
  }

  event.preventDefault();
  void handleRecordToggle();
});

document.addEventListener("keyup", (event) => {
  if (hotkeyCaptureActive) {
    handleHotkeyCaptureKeyup(event);
    return;
  }
  if (commandHotkeyCaptureActive) {
    handleCommandHotkeyCaptureKeyup(event);
    return;
  }

  if (globalShortcutsActive) {
    return;
  }

  if (settings.captureMode !== "push-to-talk") {
    return;
  }

  if (!pushToTalkHoldSources.has("hotkey")) {
    return;
  }

  const parsed = parseHotkey(settings.pushToTalkHotkey);
  if (!parsed || !isHotkeyReleaseEvent(event, parsed)) {
    return;
  }

  event.preventDefault();
  releasePushToTalk("hotkey");
});

window.addEventListener("blur", () => {
  if (settings.captureMode !== "push-to-talk") {
    return;
  }

  if (pushToTalkHoldSources.size === 0) {
    return;
  }

  clearPushToTalkHolds();
  if (stage === "recording") {
    stopRecording();
  }
});

window.addEventListener("focus", () => {
  if (!globalShortcutsActive && !hotkeyCaptureActive && !commandHotkeyCaptureActive) {
    requestGlobalShortcutSync();
  }
});

window.addEventListener("beforeunload", () => {
  stopTtsSetupPolling();
  if (dockHideTimerId !== null) {
    window.clearTimeout(dockHideTimerId);
    dockHideTimerId = null;
  }
  if (foregroundBlockMonitorId !== null) {
    window.clearInterval(foregroundBlockMonitorId);
    foregroundBlockMonitorId = null;
  }
  if (externalMediaMutedForDictation) {
    void invokeExternalMediaPlayback("play").catch(() => {
      // Ignore shutdown restore failures.
    });
    externalMediaMutedForDictation = false;
  }
  void persistDockPositionFromWindow(voiceIndicatorWindow);
  dockChannel.close();
  selectionPopupChannel.close();
  if (isTauriEnvironment()) {
    void unregisterAllGlobalShortcuts().catch(() => {
      // Ignore cleanup errors on shutdown.
    });
  }
});

toggleHotkeyEditorBtn.addEventListener("click", () => {
  hotkeyEditor.hidden = !hotkeyEditor.hidden;
});

toggleMicEditorBtn.addEventListener("click", () => {
  microphoneEditor.hidden = !microphoneEditor.hidden;
});

apiKeyInput.addEventListener("input", handleSettingsChange);
apiBaseUrlInput.addEventListener("input", handleSettingsChange);
sttModelInput.addEventListener("input", handleSettingsChange);
aiModelInput.addEventListener("input", handleSettingsChange);
rememberApiKeyInput.addEventListener("change", handleSettingsChange);
piperPathInput.addEventListener("input", handleSettingsChange);
piperQualitySelect.addEventListener("change", handleSettingsChange);
piperEmotionSelect.addEventListener("change", handleSettingsChange);
piperSpeedInput.addEventListener("input", handleSettingsChange);
coquiPythonPathInput.addEventListener("input", handleSettingsChange);
coquiModelInput.addEventListener("input", handleSettingsChange);
coquiLanguageInput.addEventListener("input", handleSettingsChange);
coquiVoiceIdInput.addEventListener("input", handleSettingsChange);
ttsEngineSelect.addEventListener("change", handleSettingsChange);
coquiQualitySelect.addEventListener("change", handleSettingsChange);
coquiEmotionSelect.addEventListener("change", handleSettingsChange);
coquiUseGpuToggle.addEventListener("change", handleSettingsChange);
coquiSplitSentencesToggle.addEventListener("change", handleSettingsChange);
coquiSpeedInput.addEventListener("input", handleSettingsChange);
systemPromptInput.addEventListener("input", handleSettingsChange);
temperatureInput.addEventListener("input", handleSettingsChange);
maxTokensInput.addEventListener("input", handleSettingsChange);
microphoneSelect.addEventListener("change", handleSettingsChange);
dictationLanguageSelect.addEventListener("change", handleSettingsChange);
styleProfileSelect.addEventListener("change", handleSettingsChange);
captureModeSingleInput.addEventListener("change", handleSettingsChange);
captureModePushToTalkInput.addEventListener("change", handleSettingsChange);
launchAtLoginToggle.addEventListener("change", handleSettingsChange);
showFlowBarToggle.addEventListener("change", handleSettingsChange);
showAppInDockToggle.addEventListener("change", handleSettingsChange);
commandModeToggle.addEventListener("change", handleSettingsChange);
wakeWordEnabledToggle.addEventListener("change", handleSettingsChange);
assistantNameInput.addEventListener("input", handleSettingsChange);
contextAwarenessToggle.addEventListener("change", handleSettingsChange);
copyToClipboardToggle.addEventListener("change", handleSettingsChange);
autoPasteDictationToggle.addEventListener("change", handleSettingsChange);
incognitoModeToggle.addEventListener("change", handleSettingsChange);
themeModeSelect.addEventListener("change", handleSettingsChange);
dictationSoundEffectsToggle.addEventListener("change", handleSettingsChange);
muteMusicWhileDictatingToggle.addEventListener("change", handleSettingsChange);
backtrackToggle.addEventListener("change", handleSettingsChange);
removeFillersToggle.addEventListener("change", handleSettingsChange);
autoPunctuationToggle.addEventListener("change", handleSettingsChange);
numberedListsToggle.addEventListener("change", handleSettingsChange);

coquiVoiceSelect.addEventListener("change", () => {
  coquiVoiceIdInput.value = coquiVoiceSelect.value;
  handleSettingsChange();
});

providerModelCatalogSelect.addEventListener("change", () => {
  const selected = providerModelCatalogSelect.value.trim();
  if (!selected) {
    return;
  }
  aiModelInput.value = selected;
  handleSettingsChange();
});

coquiModelCatalogSelect.addEventListener("change", () => {
  const selected = coquiModelCatalogSelect.value.trim();
  if (!selected) {
    return;
  }
  coquiModelInput.value = selected;
  handleSettingsChange();
});

hotkeyInput.addEventListener("focus", () => {
  beginHotkeyCapture();
});

hotkeyInput.addEventListener("click", () => {
  beginHotkeyCapture();
});

hotkeyInput.addEventListener("blur", () => {
  if (hotkeyCaptureActive) {
    cancelHotkeyCapture();
  }
});

commandHotkeyInput.addEventListener("focus", () => {
  beginCommandHotkeyCapture();
});

commandHotkeyInput.addEventListener("click", () => {
  beginCommandHotkeyCapture();
});

commandHotkeyInput.addEventListener("blur", () => {
  if (commandHotkeyCaptureActive) {
    cancelCommandHotkeyCapture();
  }
});

dictionaryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addDictionaryTerm();
});

dictionaryAddBtnTop.addEventListener("click", () => {
  const nextCollapsed = !dictionaryForm.classList.contains("is-collapsed");
  dictionaryForm.classList.toggle("is-collapsed", nextCollapsed);
  dictionaryAddBtnTop.textContent = nextCollapsed ? "Add new" : "Close";
  if (!nextCollapsed) {
    dictionarySourceInput.focus();
  }
});

for (const button of dictionaryFilterButtons) {
  button.addEventListener("click", () => {
    const value = button.dataset.dictionaryFilter;
    if (value === "all" || value === "personal" || value === "shared") {
      activeDictionaryFilter = value;
      renderDictionaryList();
    }
  });
}

snippetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addSnippetEntry();
});

snippetsAddBtnTop.addEventListener("click", () => {
  const nextCollapsed = !snippetForm.classList.contains("is-collapsed");
  snippetForm.classList.toggle("is-collapsed", nextCollapsed);
  snippetsAddBtnTop.textContent = nextCollapsed ? "Add new" : "Close";
  if (!nextCollapsed) {
    snippetTriggerInput.focus();
  }
});

for (const button of snippetFilterButtons) {
  button.addEventListener("click", () => {
    const value = button.dataset.snippetFilter;
    if (value === "all" || value === "personal" || value === "shared") {
      activeSnippetFilter = value;
      renderSnippetsList();
    }
  });
}

notesQuickMicBtn.addEventListener("click", () => {
  if (settings.captureMode === "push-to-talk") {
    return;
  }

  void handleRecordToggle();
});

bindPushToTalkPointerHold(notesQuickMicBtn, "notes-button");

refreshMicsBtn.addEventListener("click", () => {
  void refreshMicrophones(true);
});

setupRuntimeBtn.addEventListener("click", () => {
  void handleAutoSetupRuntime();
});

validatePiperBtn.addEventListener("click", () => {
  void handleValidatePiper();
});

downloadVoiceBtn.addEventListener("click", () => {
  void handleDownloadVoice();
});

setupCoquiBtn.addEventListener("click", () => {
  void handleSetupCoquiRuntime();
});

validateCoquiBtn.addEventListener("click", () => {
  void handleValidateCoqui();
});

refreshCoquiVoicesBtn.addEventListener("click", () => {
  void refreshCoquiVoices();
});

refreshCoquiModelsBtn.addEventListener("click", () => {
  void refreshCoquiModels();
});

cloneCoquiVoiceBtn.addEventListener("click", () => {
  void handleCloneCoquiVoice();
});

testCoquiVoiceBtn.addEventListener("click", () => {
  void handleTestCoquiVoice();
});

setupAllTtsBtn.addEventListener("click", () => {
  void handleSetupAllTts();
});

fetchProviderModelsBtn.addEventListener("click", () => {
  void fetchProviderModels();
});

applyModelToAiBtn.addEventListener("click", () => {
  const selected = providerModelCatalogSelect.value.trim();
  if (!selected) {
    setNotice("Select a model from catalog first.", true);
    return;
  }
  aiModelInput.value = selected;
  handleSettingsChange();
  setNotice(`AI model set to "${selected}".`);
});

applyModelToSttBtn.addEventListener("click", () => {
  const selected = providerModelCatalogSelect.value.trim();
  if (!selected) {
    setNotice("Select a model from catalog first.", true);
    return;
  }
  sttModelInput.value = selected;
  handleSettingsChange();
  setNotice(`STT model set to "${selected}".`);
});

clearHistoryBtn.addEventListener("click", () => {
  homeHistoryEntries = [];
  persistHomeHistory();
  renderHomeHistory();
  recentTurns.length = 0;
});

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  void refreshMicrophones(false);
});

async function bootstrap(): Promise<void> {
  setStage("idle", "Loading assistant metadata...");

  try {
    const info = await invoke<AssistantInfoResponse>("get_assistant_info");
    renderAssistantInfo(info);

    if (info.piperInstalled && info.voiceInstalled) {
      setNotice(
        info.coquiInstalled
          ? "Runtime is ready (Piper main, Coqui beta available)."
          : "Piper runtime is ready. Coqui beta is optional.",
      );
      setStage("idle", "Ready for voice input.");
    } else {
      setNotice("Piper runtime incomplete. Open Settings > TTS and complete runtime setup.");
      setStage("idle", "Setup required.");
    }
  } catch (error) {
    const message = asErrorMessage(error);
    setNotice(`Failed to load assistant metadata: ${message}`, true);
    setStage("error", "Metadata load failed.");
  }

  if (settings.ttsEngine === "coqui") {
    await refreshCoquiStatusSafely();
    await refreshCoquiVoices();
  }
  await refreshMicrophones(false);
  try {
    await pollTtsSetupStatusOnce();
  } catch {
    // Ignore bootstrap poll failures and continue normal app startup.
  }
  syncActionAvailability();
}

function asMainPage(value: string | undefined): MainPage | null {
  if (value === "home" || value === "dictionary" || value === "snippets" || value === "notes") {
    return value;
  }

  return null;
}

function asSettingsPane(value: string | undefined): SettingsPane | null {
  if (value === "general" || value === "system" || value === "tts" || value === "pipeline") {
    return value;
  }

  return null;
}

function setActivePage(next: MainPage): void {
  activePage = next;
  for (const navButton of pageNavButtons) {
    const current = navButton.dataset.pageNav === next;
    navButton.classList.toggle("is-active", current);
    navButton.setAttribute("aria-current", current ? "page" : "false");
  }

  for (const panel of pagePanels) {
    const current = panel.dataset.page === next;
    panel.classList.toggle("is-active", current);
    panel.hidden = !current;
  }
}

function setActiveSettingsPane(next: SettingsPane): void {
  const titleMap: Record<SettingsPane, string> = {
    general: "General",
    system: "System",
    tts: "TTS",
    pipeline: "Pipeline",
  };

  settingsPaneTitle.textContent = titleMap[next];

  for (const navButton of settingsNavButtons) {
    const current = navButton.dataset.settingsPaneNav === next;
    navButton.classList.toggle("is-active", current);
    navButton.setAttribute("aria-current", current ? "page" : "false");
  }

  for (const panel of settingsPanels) {
    const current = panel.dataset.settingsPane === next;
    panel.classList.toggle("is-active", current);
    panel.hidden = !current;
  }
}

function setActiveTtsProfile(next: TtsProfilePane): void {
  const piperActive = next === "piper";
  ttsProfilePiperTab.classList.toggle("is-active", piperActive);
  ttsProfileCoquiTab.classList.toggle("is-active", !piperActive);
  ttsProfilePiperTab.setAttribute("aria-selected", piperActive ? "true" : "false");
  ttsProfileCoquiTab.setAttribute("aria-selected", piperActive ? "false" : "true");
  ttsProfilePiperPanel.hidden = !piperActive;
  ttsProfileCoquiPanel.hidden = piperActive;
}

function updateTtsSetupGate(): void {
  const piperReady = piperRuntimeReady;
  const coquiReady = coquiRuntimeInstalled;
  const showBootstrap = !piperReady || ttsSetupRunning;
  ttsBootstrapCard.hidden = !showBootstrap;
  ttsProfilesArea.hidden = !piperReady;

  if (piperReady && !coquiReady && !ttsSetupRunning && !ttsSetupStatus.textContent?.trim()) {
    ttsSetupStatus.textContent = "Piper is ready. Coqui beta is optional and loads only when selected.";
  } else if (piperReady && coquiReady && !ttsSetupRunning && !ttsSetupStatus.textContent?.trim()) {
    ttsSetupStatus.textContent = "Piper and Coqui runtimes are ready.";
  }
}

function openSettings(): void {
  settingsOverlay.hidden = false;
  settingsOverlay.classList.add("is-open");
}

function closeSettings(): void {
  settingsOverlay.classList.remove("is-open");
  settingsOverlay.hidden = true;
}

function loadSettings(): PersistedSettings {
  const defaults: PersistedSettings = {
    apiKey: "",
    apiBaseUrl: DEFAULT_API_BASE_URL,
    sttModelName: DEFAULT_STT_MODEL_NAME,
    aiModelName: DEFAULT_AI_MODEL_NAME,
    rememberApiKey: false,
    captureMode: DEFAULT_CAPTURE_MODE,
    piperPath: "",
    microphoneDeviceId: "",
    pushToTalkHotkey: DEFAULT_HOTKEY,
    commandHotkey: DEFAULT_COMMAND_HOTKEY,
    dictationLanguage: "",
    styleProfile: DEFAULT_STYLE_PROFILE,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    launchAtLogin: true,
    showFlowBar: false,
    showAppInDock: true,
    commandMode: true,
    wakeWordEnabled: true,
    assistantName: DEFAULT_ASSISTANT_NAME,
    autoPasteDictation: true,
    contextAwareness: true,
    copyToClipboard: false,
    incognitoMode: false,
    themeMode: "system",
    dictationSoundEffects: true,
    muteMusicWhileDictating: false,
    backtrackCorrection: true,
    removeFillers: true,
    autoPunctuation: true,
    numberedLists: true,
    ttsEngine: DEFAULT_TTS_ENGINE,
    piperSpeed: DEFAULT_PIPER_SPEED,
    piperQuality: DEFAULT_PIPER_QUALITY,
    piperEmotion: DEFAULT_PIPER_EMOTION,
    coquiPythonPath: "",
    coquiModelName: DEFAULT_COQUI_MODEL,
    coquiLanguage: DEFAULT_COQUI_LANGUAGE,
    coquiVoiceId: "",
    coquiSpeed: DEFAULT_COQUI_SPEED,
    coquiQuality: DEFAULT_COQUI_QUALITY,
    coquiEmotion: DEFAULT_COQUI_EMOTION,
    coquiUseGpu: true,
    coquiSplitSentences: false,
  };

  const rawCurrent = localStorage.getItem(SETTINGS_STORAGE_KEY);
  const rawLegacy = localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY);
  const raw = rawCurrent ?? rawLegacy;
  const fromLegacyOnly = !rawCurrent && Boolean(rawLegacy);
  if (!raw) {
    return defaults;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    const rememberApiKey = parsed.rememberApiKey === true;

    return {
      apiKey: rememberApiKey ? String(parsed.apiKey ?? "") : "",
      apiBaseUrl: String(parsed.apiBaseUrl ?? defaults.apiBaseUrl),
      sttModelName: String(parsed.sttModelName ?? defaults.sttModelName),
      aiModelName: String(parsed.aiModelName ?? defaults.aiModelName),
      rememberApiKey,
      captureMode: parsed.captureMode === "single-tap" ? "single-tap" : "push-to-talk",
      piperPath: String(parsed.piperPath ?? defaults.piperPath),
      microphoneDeviceId: String(parsed.microphoneDeviceId ?? defaults.microphoneDeviceId),
      pushToTalkHotkey: String(parsed.pushToTalkHotkey ?? defaults.pushToTalkHotkey),
      commandHotkey: String(parsed.commandHotkey ?? defaults.commandHotkey),
      dictationLanguage: String(parsed.dictationLanguage ?? defaults.dictationLanguage),
      styleProfile: asStyleProfile(parsed.styleProfile),
      systemPrompt: String(parsed.systemPrompt ?? defaults.systemPrompt),
      temperature: coerceNumber(parsed.temperature, defaults.temperature, 0, 1.2),
      maxTokens: coerceInteger(parsed.maxTokens, defaults.maxTokens, 64, 1024),
      launchAtLogin: coerceBoolean(parsed.launchAtLogin, defaults.launchAtLogin),
      showFlowBar: fromLegacyOnly
        ? false
        : coerceBoolean(parsed.showFlowBar, defaults.showFlowBar),
      showAppInDock: coerceBoolean(parsed.showAppInDock, defaults.showAppInDock),
      commandMode: coerceBoolean(parsed.commandMode, defaults.commandMode),
      wakeWordEnabled: coerceBoolean(parsed.wakeWordEnabled, defaults.wakeWordEnabled),
      assistantName:
        String(parsed.assistantName ?? defaults.assistantName).trim() || defaults.assistantName,
      autoPasteDictation: coerceBoolean(parsed.autoPasteDictation, defaults.autoPasteDictation),
      contextAwareness: coerceBoolean(parsed.contextAwareness, defaults.contextAwareness),
      copyToClipboard: coerceBoolean(parsed.copyToClipboard, defaults.copyToClipboard),
      incognitoMode: coerceBoolean(parsed.incognitoMode, defaults.incognitoMode),
      themeMode: asThemeMode(parsed.themeMode),
      dictationSoundEffects: coerceBoolean(
        parsed.dictationSoundEffects,
        defaults.dictationSoundEffects,
      ),
      muteMusicWhileDictating: coerceBoolean(
        parsed.muteMusicWhileDictating,
        defaults.muteMusicWhileDictating,
      ),
      backtrackCorrection: coerceBoolean(parsed.backtrackCorrection, defaults.backtrackCorrection),
      removeFillers: coerceBoolean(parsed.removeFillers, defaults.removeFillers),
      autoPunctuation: coerceBoolean(parsed.autoPunctuation, defaults.autoPunctuation),
      numberedLists: coerceBoolean(parsed.numberedLists, defaults.numberedLists),
      ttsEngine: asTtsEngine(parsed.ttsEngine),
      piperSpeed: coerceNumber(parsed.piperSpeed, defaults.piperSpeed, 0.5, 2),
      piperQuality: asPiperQuality(parsed.piperQuality),
      piperEmotion: asPiperEmotion(parsed.piperEmotion),
      coquiPythonPath: String(parsed.coquiPythonPath ?? defaults.coquiPythonPath),
      coquiModelName: String(parsed.coquiModelName ?? defaults.coquiModelName),
      coquiLanguage: String(parsed.coquiLanguage ?? defaults.coquiLanguage),
      coquiVoiceId: String(parsed.coquiVoiceId ?? defaults.coquiVoiceId),
      coquiSpeed: coerceNumber(parsed.coquiSpeed, defaults.coquiSpeed, 0.5, 2),
      coquiQuality: asCoquiQuality(parsed.coquiQuality),
      coquiEmotion: asCoquiEmotion(parsed.coquiEmotion),
      coquiUseGpu: coerceBoolean(parsed.coquiUseGpu, defaults.coquiUseGpu),
      coquiSplitSentences: coerceBoolean(parsed.coquiSplitSentences, defaults.coquiSplitSentences),
    };
  } catch {
    return defaults;
  }
}

function persistSettings(next: PersistedSettings): void {
  const payload: PersistedSettings = {
    ...next,
    apiKey: next.rememberApiKey ? next.apiKey : "",
  };

  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload));
}

function readSettingsFromForm(): PersistedSettings {
  return {
    apiKey: apiKeyInput.value.trim(),
    apiBaseUrl: apiBaseUrlInput.value.trim(),
    sttModelName: sttModelInput.value.trim(),
    aiModelName: aiModelInput.value.trim(),
    rememberApiKey: rememberApiKeyInput.checked,
    captureMode: captureModeSingleInput.checked ? "single-tap" : "push-to-talk",
    piperPath: piperPathInput.value.trim(),
    ttsEngine: asTtsEngine(ttsEngineSelect.value),
    piperSpeed: coerceNumber(Number(piperSpeedInput.value), DEFAULT_PIPER_SPEED, 0.5, 2),
    piperQuality: asPiperQuality(piperQualitySelect.value),
    piperEmotion: asPiperEmotion(piperEmotionSelect.value),
    coquiPythonPath: coquiPythonPathInput.value.trim(),
    coquiModelName: coquiModelInput.value.trim() || DEFAULT_COQUI_MODEL,
    coquiLanguage: coquiLanguageInput.value.trim() || DEFAULT_COQUI_LANGUAGE,
    coquiVoiceId: coquiVoiceIdInput.value.trim() || coquiVoiceSelect.value.trim(),
    coquiSpeed: coerceNumber(Number(coquiSpeedInput.value), DEFAULT_COQUI_SPEED, 0.5, 2),
    coquiQuality: asCoquiQuality(coquiQualitySelect.value),
    coquiEmotion: asCoquiEmotion(coquiEmotionSelect.value),
    coquiUseGpu: coquiUseGpuToggle.checked,
    coquiSplitSentences: coquiSplitSentencesToggle.checked,
    microphoneDeviceId: microphoneSelect.value,
    pushToTalkHotkey: hotkeyCaptureActive
      ? settings.pushToTalkHotkey
      : hotkeyInput.value.trim() || DEFAULT_HOTKEY,
    commandHotkey: commandHotkeyCaptureActive
      ? settings.commandHotkey
      : commandHotkeyInput.value.trim() || DEFAULT_COMMAND_HOTKEY,
    dictationLanguage: dictationLanguageSelect.value,
    styleProfile: asStyleProfile(styleProfileSelect.value),
    systemPrompt: systemPromptInput.value.trim() || DEFAULT_SYSTEM_PROMPT,
    temperature: coerceNumber(Number(temperatureInput.value), DEFAULT_TEMPERATURE, 0, 1.2),
    maxTokens: coerceInteger(Number(maxTokensInput.value), DEFAULT_MAX_TOKENS, 64, 1024),
    launchAtLogin: launchAtLoginToggle.checked,
    showFlowBar: showFlowBarToggle.checked,
    showAppInDock: showAppInDockToggle.checked,
    commandMode: commandModeToggle.checked,
    wakeWordEnabled: wakeWordEnabledToggle.checked,
    assistantName: assistantNameInput.value.trim() || DEFAULT_ASSISTANT_NAME,
    autoPasteDictation: autoPasteDictationToggle.checked,
    contextAwareness: contextAwarenessToggle.checked,
    copyToClipboard: copyToClipboardToggle.checked,
    incognitoMode: incognitoModeToggle.checked,
    themeMode: asThemeMode(themeModeSelect.value),
    dictationSoundEffects: dictationSoundEffectsToggle.checked,
    muteMusicWhileDictating: muteMusicWhileDictatingToggle.checked,
    backtrackCorrection: backtrackToggle.checked,
    removeFillers: removeFillersToggle.checked,
    autoPunctuation: autoPunctuationToggle.checked,
    numberedLists: numberedListsToggle.checked,
  };
}

function applySettingsToForm(next: PersistedSettings): void {
  apiKeyInput.value = next.apiKey;
  apiBaseUrlInput.value = next.apiBaseUrl;
  sttModelInput.value = next.sttModelName;
  aiModelInput.value = next.aiModelName;
  rememberApiKeyInput.checked = next.rememberApiKey;
  piperPathInput.value = next.piperPath;
  ttsEngineSelect.value = next.ttsEngine;
  piperSpeedInput.value = next.piperSpeed.toFixed(2);
  piperSpeedValue.textContent = `${next.piperSpeed.toFixed(2)}x`;
  piperQualitySelect.value = next.piperQuality;
  piperEmotionSelect.value = next.piperEmotion;
  coquiPythonPathInput.value = next.coquiPythonPath;
  coquiModelInput.value = next.coquiModelName;
  coquiLanguageInput.value = next.coquiLanguage;
  coquiVoiceIdInput.value = next.coquiVoiceId;
  coquiSpeedInput.value = next.coquiSpeed.toFixed(2);
  coquiSpeedValue.textContent = `${next.coquiSpeed.toFixed(2)}x`;
  coquiQualitySelect.value = next.coquiQuality;
  coquiEmotionSelect.value = next.coquiEmotion;
  coquiUseGpuToggle.checked = next.coquiUseGpu;
  coquiSplitSentencesToggle.checked = next.coquiSplitSentences;
  hotkeyInput.value = next.pushToTalkHotkey;
  commandHotkeyInput.value = next.commandHotkey;
  dictationLanguageSelect.value = next.dictationLanguage;
  styleProfileSelect.value = next.styleProfile;
  systemPromptInput.value = next.systemPrompt;
  temperatureInput.value = next.temperature.toFixed(2);
  maxTokensInput.value = String(next.maxTokens);
  captureModeSingleInput.checked = next.captureMode === "single-tap";
  captureModePushToTalkInput.checked = next.captureMode === "push-to-talk";
  launchAtLoginToggle.checked = next.launchAtLogin;
  showFlowBarToggle.checked = next.showFlowBar;
  showAppInDockToggle.checked = next.showAppInDock;
  commandModeToggle.checked = next.commandMode;
  wakeWordEnabledToggle.checked = next.wakeWordEnabled;
  assistantNameInput.value = next.assistantName;
  autoPasteDictationToggle.checked = next.autoPasteDictation;
  updateWakePhrasePreview(next.assistantName);
  contextAwarenessToggle.checked = next.contextAwareness;
  copyToClipboardToggle.checked = next.copyToClipboard;
  incognitoModeToggle.checked = next.incognitoMode;
  themeModeSelect.value = next.themeMode;
  dictationSoundEffectsToggle.checked = next.dictationSoundEffects;
  muteMusicWhileDictatingToggle.checked = next.muteMusicWhileDictating;
  backtrackToggle.checked = next.backtrackCorrection;
  removeFillersToggle.checked = next.removeFillers;
  autoPunctuationToggle.checked = next.autoPunctuation;
  numberedListsToggle.checked = next.numberedLists;
  temperatureValue.textContent = next.temperature.toFixed(2);

  const displayHotkey = formatHotkeyForDisplay(next.pushToTalkHotkey);
  hotkeyHint.textContent = displayHotkey;
  captureModeHint.textContent = captureModeLabel(next.captureMode);
  applyTheme(next.themeMode);
}

function handleSettingsChange(): void {
  const previousMode = settings.captureMode;
  const previousIncognito = settings.incognitoMode;
  const previousTtsEngine = settings.ttsEngine;
  const previousMuteMusicWhileDictating = settings.muteMusicWhileDictating;
  const previousLaunchAtLogin = settings.launchAtLogin;
  const previousShortcutSignature = buildShortcutSyncSignature(settings);
  const next = readSettingsFromForm();
  const parsed = parseHotkey(next.pushToTalkHotkey);
  const commandParsed = parseHotkey(next.commandHotkey);

  if (parsed) {
    next.pushToTalkHotkey = parsed.label;
    hotkeyInput.value = parsed.label;
  }

  if (commandParsed) {
    next.commandHotkey = commandParsed.label;
    commandHotkeyInput.value = commandParsed.label;
  }

  settings = next;
  temperatureValue.textContent = settings.temperature.toFixed(2);
  piperSpeedValue.textContent = `${settings.piperSpeed.toFixed(2)}x`;
  coquiSpeedValue.textContent = `${settings.coquiSpeed.toFixed(2)}x`;
  updateWakePhrasePreview(settings.assistantName);
  hotkeyHint.textContent = formatHotkeyForDisplay(settings.pushToTalkHotkey);
  captureModeHint.textContent = captureModeLabel(settings.captureMode);
  applyTheme(settings.themeMode);
  setActiveTtsProfile(settings.ttsEngine === "coqui" ? "coqui" : "piper");
  if (coquiModelCatalog.includes(settings.coquiModelName)) {
    coquiModelCatalogSelect.value = settings.coquiModelName;
  } else if (coquiModelCatalog.length > 0) {
    coquiModelCatalogSelect.value = "";
  }
  if (providerModelCatalog.includes(settings.aiModelName)) {
    providerModelCatalogSelect.value = settings.aiModelName;
  } else if (providerModelCatalog.includes(settings.sttModelName)) {
    providerModelCatalogSelect.value = settings.sttModelName;
  } else if (providerModelCatalog.length > 0) {
    providerModelCatalogSelect.value = "";
  }
  if (settings.coquiVoiceId) {
    coquiVoiceSelect.value = settings.coquiVoiceId;
  }
  if (latestAssistantInfoDefaults) {
    renderAssistantInfo(latestAssistantInfoDefaults);
  }

  if (previousMode !== settings.captureMode) {
    clearPushToTalkHolds();
  }

  if (!previousIncognito && settings.incognitoMode) {
    conversationLog.innerHTML = '<p class="empty-hint">Incognito mode enabled. History is hidden.</p>';
  } else if (previousIncognito && !settings.incognitoMode) {
    renderHomeHistory();
  }

  if (!previousMuteMusicWhileDictating && settings.muteMusicWhileDictating && stage === "recording") {
    pauseExternalMediaForDictation();
  } else if (previousMuteMusicWhileDictating && !settings.muteMusicWhileDictating) {
    resumeExternalMediaAfterDictation();
  }

  persistSettings(settings);
  refreshRecordButton();
  syncActionAvailability();
  updateMicrophoneSummary();
  renderNotesList();
  const nextShortcutSignature = buildShortcutSyncSignature(settings);
  if (previousShortcutSignature !== nextShortcutSignature) {
    requestGlobalShortcutSync();
  }
  if (previousLaunchAtLogin !== settings.launchAtLogin) {
    requestLaunchAtLoginSync(settings.launchAtLogin);
  }
  if (previousTtsEngine !== settings.ttsEngine) {
    interruptTtsPlaybackForCaptureIntent();
  }
  if (settings.ttsEngine === "coqui" && previousTtsEngine !== "coqui") {
    void refreshCoquiStatusSafely();
    void refreshCoquiVoices();
    void refreshCoquiModels({ quiet: true });
  }
  updateTtsSetupGate();
  publishDockState();
  void syncFloatingIndicatorWindow();
}

function captureModeLabel(mode: CaptureMode): string {
  return mode === "push-to-talk" ? "Push-To-Talk" : "Single Tap";
}

function buildShortcutSyncSignature(source: PersistedSettings): string {
  const captureMode = source.captureMode;
  const push = parseHotkey(source.pushToTalkHotkey)?.label ?? "";
  const commandEnabled = source.commandMode ? "1" : "0";
  const command = source.commandMode ? parseHotkey(source.commandHotkey)?.label ?? "" : "";
  return `${captureMode}|${push}|${commandEnabled}|${command}`;
}

function requestGlobalShortcutSync(force = false): void {
  if (force) {
    registeredShortcutSignature = "";
  }

  if (shortcutSyncInFlight) {
    shortcutSyncQueued = true;
    return;
  }

  shortcutSyncInFlight = syncGlobalShortcuts(force)
    .catch((error) => {
      setNotice(`Global hotkey sync failed: ${asErrorMessage(error)}`, true);
    })
    .finally(() => {
      shortcutSyncInFlight = null;
      if (shortcutSyncQueued) {
        shortcutSyncQueued = false;
        requestGlobalShortcutSync();
      }
    });
}

async function syncGlobalShortcuts(force = false): Promise<void> {
  if (!isTauriEnvironment()) {
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    publishDockState();
    return;
  }

  if (shortcutsSuppressedByBlockedApp) {
    if (globalShortcutsActive) {
      try {
        await unregisterAllGlobalShortcuts();
      } catch {
        // Ignore cleanup errors while blocked-app suppression is active.
      }
    }
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    publishDockState();
    return;
  }

  const pushSpec = parseHotkey(settings.pushToTalkHotkey);
  if (!pushSpec) {
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    publishDockState();
    return;
  }

  const pushShortcut = toGlobalShortcutString(pushSpec);
  const shortcuts = [pushShortcut];
  let commandShortcut = "";

  if (settings.commandMode) {
    const commandSpec = parseHotkey(settings.commandHotkey);
    if (commandSpec) {
      const normalizedPush = normalizeShortcutToken(pushShortcut);
      const normalizedCommand = normalizeShortcutToken(toGlobalShortcutString(commandSpec));
      if (normalizedPush !== normalizedCommand) {
        commandShortcut = toGlobalShortcutString(commandSpec);
        shortcuts.push(commandShortcut);
      }
    }
  }

  const desiredSignature = [
    settings.captureMode,
    normalizeShortcutToken(pushShortcut),
    settings.commandMode ? "1" : "0",
    normalizeShortcutToken(commandShortcut),
  ].join("|");

  if (!force && globalShortcutsActive && desiredSignature === registeredShortcutSignature) {
    return;
  }

  try {
    await unregisterAllGlobalShortcuts();
  } catch {
    // Ignore cleanup errors. We'll still try to register next.
  }

  try {
    await registerGlobalShortcut(shortcuts, handleGlobalShortcutEvent);
    registeredPushShortcut = pushShortcut;
    registeredCommandShortcut = commandShortcut;
    registeredShortcutSignature = desiredSignature;
    globalShortcutsActive = true;
    publishDockState();
  } catch (error) {
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    setNotice(`Global hotkeys unavailable. Using in-app hotkeys only: ${asErrorMessage(error)}`, true);
    publishDockState();
  }
}

function isTauriEnvironment(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

function requestLaunchAtLoginSync(enabled: boolean): void {
  if (!isTauriEnvironment()) {
    return;
  }

  const syncNonce = ++launchAtLoginSyncNonce;
  void invoke("configure_launch_at_login", { enabled }).catch((error) => {
    if (syncNonce !== launchAtLoginSyncNonce) {
      return;
    }
    setNotice(`Launch-at-login update failed: ${asErrorMessage(error)}`, true);
  });
}

function handleGlobalShortcutEvent(event: ShortcutEvent): void {
  if (hotkeyCaptureActive || commandHotkeyCaptureActive) {
    return;
  }

  if (event.state !== "Pressed" && event.state !== "Released") {
    return;
  }

  const shortcut = normalizeShortcutToken(event.shortcut);
  const pushShortcut = normalizeShortcutToken(registeredPushShortcut);
  const commandShortcut = normalizeShortcutToken(registeredCommandShortcut);

  if (pushShortcut && shortcut === pushShortcut) {
    if (event.state === "Pressed") {
      if (settings.captureMode === "push-to-talk") {
        if (pushToTalkHoldSources.has("hotkey")) {
          return;
        }
        void engagePushToTalk("hotkey");
      } else {
        void handleRecordToggle();
      }
    }
    if (event.state === "Released" && settings.captureMode === "push-to-talk") {
      releasePushToTalk("hotkey");
    }
    return;
  }

  if (
    commandShortcut &&
    shortcut === commandShortcut &&
    event.state === "Pressed"
  ) {
    void (async () => {
      if (await shouldBlockAssistantInputFromForegroundApp()) {
        return;
      }
      toggleCommandModeArmed();
    })();
  }
}

function toGlobalShortcutString(hotkey: HotkeySpec): string {
  const parts: string[] = [];
  if (hotkey.ctrl) parts.push("CommandOrControl");
  if (hotkey.shift) parts.push("Shift");
  if (hotkey.alt) parts.push("Alt");
  if (hotkey.meta) parts.push("Super");

  if (hotkey.key === "space") {
    parts.push("Space");
  } else if (hotkey.key === "enter") {
    parts.push("Enter");
  } else if (hotkey.key === "tab") {
    parts.push("Tab");
  } else if (hotkey.key === "escape") {
    parts.push("Escape");
  } else if (hotkey.key === "backspace") {
    parts.push("Backspace");
  } else if (hotkey.key.startsWith("f")) {
    parts.push(hotkey.key.toUpperCase());
  } else if (hotkey.key.length === 1) {
    parts.push(hotkey.key.toUpperCase());
  } else {
    parts.push(hotkey.key);
  }

  return parts.join("+");
}

function normalizeShortcutToken(value: string): string {
  const rawTokens = value
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  if (rawTokens.length === 0) {
    return "";
  }

  const normalized = rawTokens.map((token) => {
    if (token === "commandorcontrol" || token === "commandorctrl" || token === "ctrl" || token === "control") {
      return "ctrl";
    }
    if (token === "shift") {
      return "shift";
    }
    if (token === "alt" || token === "option" || token === "altgraph") {
      return "alt";
    }
    if (token === "super" || token === "meta" || token === "cmd" || token === "command" || token === "win" || token === "os") {
      return "meta";
    }
    if (token === "spacebar" || token === "space") {
      return "space";
    }
    if (token === "return" || token === "enter") {
      return "enter";
    }
    if (token === "esc" || token === "escape") {
      return "escape";
    }
    return token;
  });

  const modifiersOrder = ["ctrl", "shift", "alt", "meta"];
  const ordered: string[] = [];

  for (const modifier of modifiersOrder) {
    if (normalized.includes(modifier)) {
      ordered.push(modifier);
    }
  }

  for (const token of normalized) {
    if (!modifiersOrder.includes(token)) {
      ordered.push(token);
    }
  }

  return ordered.join("+");
}

function beginHotkeyCapture(): void {
  if (hotkeyInput.disabled || hotkeyCaptureActive) {
    return;
  }
  if (commandHotkeyCaptureActive) {
    cancelCommandHotkeyCapture();
  }

  hotkeyCaptureActive = true;
  hotkeyCaptureModifiers.ctrl = false;
  hotkeyCaptureModifiers.shift = false;
  hotkeyCaptureModifiers.alt = false;
  hotkeyCaptureModifiers.meta = false;
  hotkeyInput.classList.add("is-capturing-hotkey");
  hotkeyInput.value = "Press shortcut...";
  setNotice("Hotkey capture enabled. Use 2-3 keys total (1-2 modifiers + 1 main key).");
}

function cancelHotkeyCapture(): void {
  hotkeyCaptureActive = false;
  hotkeyCaptureModifiers.ctrl = false;
  hotkeyCaptureModifiers.shift = false;
  hotkeyCaptureModifiers.alt = false;
  hotkeyCaptureModifiers.meta = false;
  hotkeyInput.classList.remove("is-capturing-hotkey");
  hotkeyInput.value = settings.pushToTalkHotkey;
}

function handleHotkeyCaptureKeydown(event: KeyboardEvent): void {
  if (!hotkeyCaptureActive) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const normalizedKey = normalizeEventKey(event.key);
  if (normalizedKey === "escape") {
    cancelHotkeyCapture();
    setNotice("Hotkey capture canceled.");
    return;
  }

  hotkeyCaptureModifiers.ctrl = event.ctrlKey;
  hotkeyCaptureModifiers.shift = event.shiftKey;
  hotkeyCaptureModifiers.alt = event.altKey;
  hotkeyCaptureModifiers.meta = event.metaKey;

  if (isModifierKey(normalizedKey)) {
    hotkeyInput.value = formatHotkeyCapturePreview();
    return;
  }

  const candidateTokens: string[] = [];
  if (hotkeyCaptureModifiers.ctrl) candidateTokens.push("ctrl");
  if (hotkeyCaptureModifiers.shift) candidateTokens.push("shift");
  if (hotkeyCaptureModifiers.alt) candidateTokens.push("alt");
  if (hotkeyCaptureModifiers.meta) candidateTokens.push("meta");

  if (candidateTokens.length === 0) {
    hotkeyInput.value = "Press shortcut...";
    setNotice("Hotkey must use 2-3 keys total (1-2 modifiers + 1 main key).", true);
    return;
  }

  if (candidateTokens.length > 2) {
    hotkeyInput.value = formatHotkeyCapturePreview();
    setNotice("Hotkey can use at most 3 keys total (max 2 modifiers + 1 main key).", true);
    return;
  }

  candidateTokens.push(normalizedKey);

  const parsed = parseHotkey(candidateTokens.join("+"));
  if (!parsed) {
    hotkeyInput.value = formatHotkeyCapturePreview();
    setNotice(
      "Unsupported hotkey key. Use letters, numbers, F1-F12, Space, Enter, Tab, Esc, or Backspace.",
      true,
    );
    return;
  }

  hotkeyCaptureActive = false;
  hotkeyInput.classList.remove("is-capturing-hotkey");
  hotkeyInput.value = parsed.label;
  handleSettingsChange();
  setNotice(`Push-to-talk hotkey updated to ${formatHotkeyForDisplay(parsed.label)}.`);
  hotkeyInput.blur();
}

function handleHotkeyCaptureKeyup(event: KeyboardEvent): void {
  if (!hotkeyCaptureActive) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  hotkeyCaptureModifiers.ctrl = event.ctrlKey;
  hotkeyCaptureModifiers.shift = event.shiftKey;
  hotkeyCaptureModifiers.alt = event.altKey;
  hotkeyCaptureModifiers.meta = event.metaKey;

  if (isModifierKey(normalizeEventKey(event.key))) {
    hotkeyInput.value = formatHotkeyCapturePreview();
  }
}

function formatHotkeyCapturePreview(): string {
  const parts: string[] = [];
  if (hotkeyCaptureModifiers.ctrl) parts.push("Ctrl");
  if (hotkeyCaptureModifiers.shift) parts.push("Shift");
  if (hotkeyCaptureModifiers.alt) parts.push("Alt");
  if (hotkeyCaptureModifiers.meta) parts.push("Meta");

  if (parts.length === 0) {
    return "Press shortcut...";
  }

  return `${parts.join(" + ")} + ...`;
}

function isModifierKey(key: string): boolean {
  return key === "control" || key === "shift" || key === "alt" || key === "meta";
}

function beginCommandHotkeyCapture(): void {
  if (commandHotkeyInput.disabled || commandHotkeyCaptureActive) {
    return;
  }
  if (hotkeyCaptureActive) {
    cancelHotkeyCapture();
  }

  commandHotkeyCaptureActive = true;
  commandHotkeyCaptureModifiers.ctrl = false;
  commandHotkeyCaptureModifiers.shift = false;
  commandHotkeyCaptureModifiers.alt = false;
  commandHotkeyCaptureModifiers.meta = false;
  commandHotkeyInput.classList.add("is-capturing-hotkey");
  commandHotkeyInput.value = "Press shortcut...";
  setNotice("Command hotkey capture enabled. Use 2-3 keys total (1-2 modifiers + 1 main key).");
}

function cancelCommandHotkeyCapture(): void {
  commandHotkeyCaptureActive = false;
  commandHotkeyCaptureModifiers.ctrl = false;
  commandHotkeyCaptureModifiers.shift = false;
  commandHotkeyCaptureModifiers.alt = false;
  commandHotkeyCaptureModifiers.meta = false;
  commandHotkeyInput.classList.remove("is-capturing-hotkey");
  commandHotkeyInput.value = settings.commandHotkey;
}

function handleCommandHotkeyCaptureKeydown(event: KeyboardEvent): void {
  if (!commandHotkeyCaptureActive) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const normalizedKey = normalizeEventKey(event.key);
  if (normalizedKey === "escape") {
    cancelCommandHotkeyCapture();
    setNotice("Command hotkey capture canceled.");
    return;
  }

  commandHotkeyCaptureModifiers.ctrl = event.ctrlKey;
  commandHotkeyCaptureModifiers.shift = event.shiftKey;
  commandHotkeyCaptureModifiers.alt = event.altKey;
  commandHotkeyCaptureModifiers.meta = event.metaKey;

  if (isModifierKey(normalizedKey)) {
    commandHotkeyInput.value = formatModifierPreview(commandHotkeyCaptureModifiers);
    return;
  }

  const candidateTokens: string[] = [];
  if (commandHotkeyCaptureModifiers.ctrl) candidateTokens.push("ctrl");
  if (commandHotkeyCaptureModifiers.shift) candidateTokens.push("shift");
  if (commandHotkeyCaptureModifiers.alt) candidateTokens.push("alt");
  if (commandHotkeyCaptureModifiers.meta) candidateTokens.push("meta");

  if (candidateTokens.length === 0 || candidateTokens.length > 2) {
    commandHotkeyInput.value = formatModifierPreview(commandHotkeyCaptureModifiers);
    setNotice("Command hotkey must use 2-3 keys total (1-2 modifiers + 1 main key).", true);
    return;
  }

  candidateTokens.push(normalizedKey);
  const parsed = parseHotkey(candidateTokens.join("+"));
  if (!parsed) {
    commandHotkeyInput.value = formatModifierPreview(commandHotkeyCaptureModifiers);
    setNotice("Unsupported key for command hotkey.", true);
    return;
  }

  commandHotkeyCaptureActive = false;
  commandHotkeyInput.classList.remove("is-capturing-hotkey");
  commandHotkeyInput.value = parsed.label;
  handleSettingsChange();
  setNotice(`Command mode hotkey updated to ${formatHotkeyForDisplay(parsed.label)}.`);
  commandHotkeyInput.blur();
}

function handleCommandHotkeyCaptureKeyup(event: KeyboardEvent): void {
  if (!commandHotkeyCaptureActive) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  commandHotkeyCaptureModifiers.ctrl = event.ctrlKey;
  commandHotkeyCaptureModifiers.shift = event.shiftKey;
  commandHotkeyCaptureModifiers.alt = event.altKey;
  commandHotkeyCaptureModifiers.meta = event.metaKey;

  if (isModifierKey(normalizeEventKey(event.key))) {
    commandHotkeyInput.value = formatModifierPreview(commandHotkeyCaptureModifiers);
  }
}

function formatModifierPreview(modifiers: {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}): string {
  const parts: string[] = [];
  if (modifiers.ctrl) parts.push("Ctrl");
  if (modifiers.shift) parts.push("Shift");
  if (modifiers.alt) parts.push("Alt");
  if (modifiers.meta) parts.push("Meta");
  if (parts.length === 0) {
    return "Press shortcut...";
  }
  return `${parts.join(" + ")} + ...`;
}

function asStyleProfile(value: unknown): StyleProfile {
  if (
    value === "adaptive" ||
    value === "professional" ||
    value === "casual" ||
    value === "concise" ||
    value === "developer"
  ) {
    return value;
  }
  return DEFAULT_STYLE_PROFILE;
}

function asThemeMode(value: unknown): ThemeMode {
  if (value === "light" || value === "dark") {
    return value;
  }
  return "system";
}

function asTtsEngine(value: unknown): TtsEngine {
  return value === "coqui" ? "coqui" : "piper";
}

function asPiperQuality(value: unknown): PiperQuality {
  if (value === "fast" || value === "high") {
    return value;
  }
  return DEFAULT_PIPER_QUALITY;
}

function asPiperEmotion(value: unknown): PiperEmotion {
  if (
    value === "calm" ||
    value === "happy" ||
    value === "excited" ||
    value === "serious" ||
    value === "sad"
  ) {
    return value;
  }
  return DEFAULT_PIPER_EMOTION;
}

function asCoquiQuality(value: unknown): CoquiQuality {
  if (value === "fast" || value === "high") {
    return value;
  }
  return DEFAULT_COQUI_QUALITY;
}

function asCoquiEmotion(value: unknown): CoquiEmotion {
  if (
    value === "calm" ||
    value === "happy" ||
    value === "excited" ||
    value === "serious" ||
    value === "sad"
  ) {
    return value;
  }
  return DEFAULT_COQUI_EMOTION;
}

function updateWakePhrasePreview(name: string): void {
  const wakeName = name.trim() || DEFAULT_ASSISTANT_NAME;
  wakePhrasePreview.textContent = `Wake phrase examples: "Hey ${wakeName}", "Hi ${wakeName}", "Okay ${wakeName}"`;
}

function applyTheme(themeMode: ThemeMode): void {
  const root = document.documentElement;
  if (themeMode === "system") {
    root.removeAttribute("data-theme");
    return;
  }

  root.setAttribute("data-theme", themeMode);
}

function updateMicrophoneSummary(): void {
  const selected = microphoneSelect.selectedOptions.item(0);
  microphoneSummary.textContent = selected?.textContent?.trim() || "Auto-detect";
}

function loadDictionaryTerms(): DictionaryTerm[] {
  const raw = localStorage.getItem(DICTIONARY_STORAGE_KEY);
  if (!raw) {
    return [
      {
        id: createId(),
        source: "whispr",
        target: "Wispr",
        scope: "personal",
        createdAt: Date.now(),
      },
      {
        id: createId(),
        source: "slashy",
        target: "Slasshy",
        scope: "shared",
        createdAt: Date.now(),
      },
    ];
  }

  try {
    const parsed = JSON.parse(raw) as DictionaryTerm[];
    return parsed.filter((item) => item && item.source && item.target);
  } catch {
    return [];
  }
}

function persistDictionaryTerms(): void {
  localStorage.setItem(DICTIONARY_STORAGE_KEY, JSON.stringify(dictionaryTerms));
}

function loadSnippets(): SnippetEntry[] {
  const raw = localStorage.getItem(SNIPPETS_STORAGE_KEY);
  if (!raw) {
    return [
      {
        id: createId(),
        trigger: "intro email",
        expansion: "Hey, would love to find some time to chat later.",
        scope: "personal",
        createdAt: Date.now(),
      },
      {
        id: createId(),
        trigger: "my calendly link",
        expansion: "https://calendly.com/you/invite-name",
        scope: "shared",
        createdAt: Date.now(),
      },
    ];
  }

  try {
    const parsed = JSON.parse(raw) as SnippetEntry[];
    return parsed.filter((item) => item && item.trigger && item.expansion);
  } catch {
    return [];
  }
}

function persistSnippets(): void {
  localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));
}

function loadQuickNotes(): QuickNoteEntry[] {
  const raw = localStorage.getItem(NOTES_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as QuickNoteEntry[];
    return parsed.filter((item) => item && item.text);
  } catch {
    return [];
  }
}

function persistQuickNotes(): void {
  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(quickNotes));
}

function loadUsageStats(): UsageStats {
  const raw = localStorage.getItem(USAGE_STORAGE_KEY);
  if (!raw) {
    return { sessions: 0, words: 0, avgWpm: 0 };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UsageStats>;
    return {
      sessions: coerceInteger(parsed.sessions, 0, 0, 999_999),
      words: coerceInteger(parsed.words, 0, 0, 99_999_999),
      avgWpm: coerceNumber(parsed.avgWpm, 0, 0, 600),
    };
  } catch {
    return { sessions: 0, words: 0, avgWpm: 0 };
  }
}

function persistUsageStats(): void {
  localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usageStats));
}

function loadHomeHistory(): HomeHistoryEntry[] {
  const raw = localStorage.getItem(HOME_HISTORY_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as HomeHistoryEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item) => {
      if (!item || typeof item.speaker !== "string" || typeof item.content !== "string") {
        return false;
      }
      if (item.tone !== "assistant" && item.tone !== "user") {
        return false;
      }
      return Number.isFinite(item.timestamp);
    });
  } catch {
    return [];
  }
}

function persistHomeHistory(): void {
  localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(homeHistoryEntries));
}

function formatConversationTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createConversationEntryElement(entry: HomeHistoryEntry): HTMLElement {
  const row = document.createElement("article");
  row.className = `entry entry-${entry.tone}`;
  row.innerHTML = `
    <time>${formatConversationTime(entry.timestamp)}</time>
    <p><strong>${escapeHtml(entry.speaker)}</strong> ${escapeHtml(entry.content)}</p>
  `;
  return row;
}

function renderHomeHistory(): void {
  if (settings.incognitoMode) {
    conversationLog.innerHTML = '<p class="empty-hint">Incognito mode enabled. History is hidden.</p>';
    return;
  }

  if (homeHistoryEntries.length === 0) {
    conversationLog.innerHTML = `<p class="empty-hint">${EMPTY_HISTORY_HINT}</p>`;
    return;
  }

  conversationLog.innerHTML = "";
  for (const entry of homeHistoryEntries) {
    conversationLog.append(createConversationEntryElement(entry));
  }
}

function loadDockLayout(): DockLayout | null {
  const raw = localStorage.getItem(DOCK_LAYOUT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<DockLayout>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) {
      return null;
    }

    return {
      x: Math.round(Number(parsed.x)),
      y: Math.round(Number(parsed.y)),
    };
  } catch {
    return null;
  }
}

function persistDockLayout(layout: DockLayout): void {
  localStorage.setItem(DOCK_LAYOUT_STORAGE_KEY, JSON.stringify(layout));
}

function updateAndPersistDockLayout(x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }

  dockLayout = {
    x: Math.round(x),
    y: Math.round(y),
  };
  persistDockLayout(dockLayout);
}

async function persistDockPositionFromWindow(win: WebviewWindow | null): Promise<void> {
  if (!win) {
    return;
  }

  try {
    const position = await win.outerPosition();
    updateAndPersistDockLayout(position.x, position.y);
  } catch {
    // Best-effort snapshot only.
  }
}

function clampDockAxis(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return Math.round(min);
  }
  if (max < min) {
    return Math.round(min);
  }
  return Math.round(Math.min(Math.max(value, min), max));
}

function monitorWorkArea(monitor: Monitor): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const area = monitor.workArea ?? {
    position: monitor.position,
    size: monitor.size,
  };

  return {
    x: Math.round(area.position.x),
    y: Math.round(area.position.y),
    width: Math.max(0, Math.round(area.size.width)),
    height: Math.max(0, Math.round(area.size.height)),
  };
}

async function resolveDockPlacementBounds(
  dockWidth: number,
  dockHeight: number,
): Promise<DockPlacementBounds | null> {
  try {
    const monitors = await availableMonitors();
    if (monitors.length === 0) {
      return null;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const monitor of monitors) {
      const area = monitorWorkArea(monitor);
      const candidateMinX = area.x;
      const candidateMinY = area.y;
      const candidateMaxX = area.x + Math.max(0, area.width - dockWidth);
      const candidateMaxY = area.y + Math.max(0, area.height - dockHeight);

      minX = Math.min(minX, candidateMinX);
      minY = Math.min(minY, candidateMinY);
      maxX = Math.max(maxX, candidateMaxX);
      maxY = Math.max(maxY, candidateMaxY);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }

    return {
      minX: Math.round(minX),
      minY: Math.round(minY),
      maxX: Math.round(maxX),
      maxY: Math.round(maxY),
    };
  } catch {
    return null;
  }
}

async function resolveDefaultDockPosition(dockWidth: number, dockHeight: number): Promise<DockLayout> {
  try {
    const monitor = await currentMonitor();
    if (monitor) {
      const area = monitorWorkArea(monitor);
      return {
        x: Math.round(area.x + Math.max(0, area.width - dockWidth - 18)),
        y: Math.round(area.y + Math.max(0, area.height - dockHeight - 18)),
      };
    }
  } catch {
    // Fall back to browser screen metrics.
  }

  return {
    x: Math.max(0, Math.round(window.screen.availWidth - dockWidth - 18)),
    y: Math.max(0, Math.round(window.screen.availHeight - dockHeight - 18)),
  };
}

async function resolveDockStartPosition(dockWidth: number, dockHeight: number): Promise<DockLayout> {
  const fallback = await resolveDefaultDockPosition(dockWidth, dockHeight);
  const rawX = dockLayout?.x ?? fallback.x;
  const rawY = dockLayout?.y ?? fallback.y;
  const bounds = await resolveDockPlacementBounds(dockWidth, dockHeight);

  if (!bounds) {
    return {
      x: Math.round(rawX),
      y: Math.round(rawY),
    };
  }

  return {
    x: clampDockAxis(rawX, bounds.minX, bounds.maxX),
    y: clampDockAxis(rawY, bounds.minY, bounds.maxY),
  };
}

function renderDictionaryList(): void {
  for (const button of dictionaryFilterButtons) {
    button.classList.toggle("is-active", button.dataset.dictionaryFilter === activeDictionaryFilter);
  }

  const filtered = dictionaryTerms.filter(
    (term) => activeDictionaryFilter === "all" || term.scope === activeDictionaryFilter,
  );

  if (filtered.length === 0) {
    dictionaryList.innerHTML = "<p>No dictionary terms in this view.</p>";
    return;
  }

  dictionaryList.innerHTML = "";
  for (const term of filtered) {
    const row = document.createElement("div");
    row.className = "managed-row";
    row.innerHTML = `
      <p><strong>${escapeHtml(term.source)}</strong> → ${escapeHtml(term.target)}</p>
      <div class="managed-row-actions">
        <span>${term.scope === "shared" ? "Shared" : "Personal"}</span>
        <button type="button" class="inline-link" data-dictionary-delete="${term.id}">Delete</button>
      </div>
    `;
    dictionaryList.append(row);
  }

  dictionaryList.querySelectorAll<HTMLButtonElement>("[data-dictionary-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.dictionaryDelete;
      if (!id) return;
      dictionaryTerms = dictionaryTerms.filter((term) => term.id !== id);
      persistDictionaryTerms();
      renderDictionaryList();
    });
  });
}

function addDictionaryTerm(): void {
  const source = dictionarySourceInput.value.trim();
  const target = dictionaryTargetInput.value.trim();
  if (!source || !target) {
    setNotice("Dictionary requires both spoken and corrected term.", true);
    return;
  }

  dictionaryTerms.unshift({
    id: createId(),
    source,
    target,
    scope: dictionarySharedInput.checked ? "shared" : "personal",
    createdAt: Date.now(),
  });
  persistDictionaryTerms();
  renderDictionaryList();
  dictionarySourceInput.value = "";
  dictionaryTargetInput.value = "";
  dictionarySharedInput.checked = false;
  dictionaryForm.classList.add("is-collapsed");
  dictionaryAddBtnTop.textContent = "Add new";
  setNotice(`Dictionary term added: ${source} → ${target}`);
}

function renderSnippetsList(): void {
  for (const button of snippetFilterButtons) {
    button.classList.toggle("is-active", button.dataset.snippetFilter === activeSnippetFilter);
  }

  const filtered = snippets.filter(
    (item) => activeSnippetFilter === "all" || item.scope === activeSnippetFilter,
  );

  if (filtered.length === 0) {
    snippetsList.innerHTML = "<p>No snippets in this view.</p>";
    return;
  }

  snippetsList.innerHTML = "";
  for (const snippet of filtered) {
    const row = document.createElement("div");
    row.className = "managed-row";
    row.innerHTML = `
      <p><strong>${escapeHtml(snippet.trigger)}</strong> → ${escapeHtml(snippet.expansion)}</p>
      <div class="managed-row-actions">
        <span>${snippet.scope === "shared" ? "Shared" : "Personal"}</span>
        <button type="button" class="inline-link" data-snippet-delete="${snippet.id}">Delete</button>
      </div>
    `;
    snippetsList.append(row);
  }

  snippetsList.querySelectorAll<HTMLButtonElement>("[data-snippet-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.snippetDelete;
      if (!id) return;
      snippets = snippets.filter((snippet) => snippet.id !== id);
      persistSnippets();
      renderSnippetsList();
    });
  });
}

function addSnippetEntry(): void {
  const trigger = snippetTriggerInput.value.trim();
  const expansion = snippetExpansionInput.value.trim();
  if (!trigger || !expansion) {
    setNotice("Snippet requires both trigger and expansion text.", true);
    return;
  }

  snippets.unshift({
    id: createId(),
    trigger,
    expansion,
    scope: snippetSharedInput.checked ? "shared" : "personal",
    createdAt: Date.now(),
  });
  persistSnippets();
  renderSnippetsList();
  snippetTriggerInput.value = "";
  snippetExpansionInput.value = "";
  snippetSharedInput.checked = false;
  snippetForm.classList.add("is-collapsed");
  snippetsAddBtnTop.textContent = "Add new";
  setNotice(`Snippet added: ${trigger}`);
}

function addQuickNote(text: string): void {
  const clean = text.trim();
  if (!clean || settings.incognitoMode) {
    return;
  }

  quickNotes.unshift({
    id: createId(),
    text: clean,
    createdAt: Date.now(),
  });
  quickNotes = quickNotes.slice(0, 50);
  persistQuickNotes();
  renderNotesList();
}

function renderNotesList(): void {
  if (quickNotes.length === 0 || settings.incognitoMode) {
    notesList.innerHTML = '<p class="notes-empty">No notes found</p>';
    return;
  }

  notesList.innerHTML = "";
  for (const note of quickNotes) {
    const row = document.createElement("article");
    row.className = "managed-row";
    const time = new Date(note.createdAt).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    row.innerHTML = `
      <p>${escapeHtml(note.text)}</p>
      <div class="managed-row-actions">
        <span>${time}</span>
        <button type="button" class="inline-link" data-note-delete="${note.id}">Delete</button>
      </div>
    `;
    notesList.append(row);
  }

  notesList.querySelectorAll<HTMLButtonElement>("[data-note-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.noteDelete;
      if (!id) return;
      quickNotes = quickNotes.filter((note) => note.id !== id);
      persistQuickNotes();
      renderNotesList();
    });
  });
}

function updateUsageMetrics(): void {
  metricWords.textContent = `${usageStats.words} words`;
  metricWpm.textContent = `${Math.round(usageStats.avgWpm)} WPM`;
}

function trackUsage(transcript: string): void {
  const words = countWords(transcript);
  usageStats.sessions += 1;
  usageStats.words += words;
  const seconds = Math.max((Date.now() - recordingStartedAt) / 1000, 1);
  const currentWpm = (words / seconds) * 60;
  if (usageStats.sessions <= 1) {
    usageStats.avgWpm = currentWpm;
  } else {
    usageStats.avgWpm = usageStats.avgWpm * 0.8 + currentWpm * 0.2;
  }
  persistUsageStats();
  updateUsageMetrics();
}

function createId(): string {
  if ("crypto" in window && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildEffectiveSystemPrompt(activeSettings: PersistedSettings, commandMode: boolean): string {
  const agentName = activeSettings.assistantName.trim() || DEFAULT_ASSISTANT_NAME;
  const parts = [buildAgentOperatingCorePrompt(agentName)];
  const customPrompt = activeSettings.systemPrompt.trim();
  if (customPrompt && customPrompt !== LEGACY_DEFAULT_SYSTEM_PROMPT) {
    parts.push(`Custom user instructions:\n${customPrompt}`);
  }
  parts.push(styleProfileInstruction(activeSettings.styleProfile));

  if (activeSettings.contextAwareness && recentTurns.length > 0) {
    const contextLines = recentTurns
      .slice(0, 6)
      .reverse()
      .map((turn) => `${turn.speaker}: ${turn.content}`)
      .join("\n");
    parts.push(`Recent context:\n${contextLines}`);
  }

  if (commandMode) {
    parts.push(
      "Command mode is armed for this turn. Prioritize direct action on user intent instead of conversational filler.",
    );
  }

  return parts.filter(Boolean).join("\n\n");
}

function styleProfileInstruction(style: StyleProfile): string {
  if (style === "professional") {
    return "Style: professional and polished.";
  }
  if (style === "casual") {
    return "Style: casual and conversational.";
  }
  if (style === "concise") {
    return "Style: concise and high-signal.";
  }
  if (style === "developer") {
    return "Style: developer-focused with precise technical terminology.";
  }
  return "Style: adapt tone based on the request context.";
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

async function copyToClipboard(
  value: string,
  options: { quiet?: boolean; successMessage?: string; errorMessage?: string } = {},
): Promise<boolean> {
  try {
    if (isTauriEnvironment()) {
      await invoke("set_clipboard_text", { text: value });
    } else {
      await navigator.clipboard.writeText(value);
    }
    if (!options.quiet) {
      setNotice(options.successMessage ?? "Assistant response copied to clipboard.");
    }
    return true;
  } catch {
    if (!options.quiet) {
      setNotice(options.errorMessage ?? "Unable to copy response to clipboard in this environment.", true);
    }
    return false;
  }
}

async function triggerAutoPaste(text?: string): Promise<boolean> {
  if (!isTauriEnvironment()) {
    return false;
  }

  try {
    if (typeof text === "string" && text.trim().length > 0) {
      await invoke("paste_text_via_clipboard", { text });
    } else {
      await invoke("paste_clipboard_text");
    }
    return true;
  } catch (error) {
    setNotice(`Auto paste failed: ${asErrorMessage(error)}`, true);
    return false;
  }
}

async function captureSelectedTextForRewrite(options: { silent?: boolean } = {}): Promise<string> {
  if (!isTauriEnvironment()) {
    return "";
  }

  try {
    const selected = await invoke<string>("capture_selected_text");
    return String(selected ?? "");
  } catch (error) {
    if (!options.silent) {
      setNotice(`Unable to capture selected text: ${asErrorMessage(error)}`, true);
    }
    return "";
  }
}

async function primeSelectionSnapshotForCommandMode(): Promise<void> {
  const selected = (await captureSelectedTextForRewrite({ silent: true })).trim();
  commandSelectionSnapshot = selected || null;
  if (commandSelectionSnapshot) {
    logClientEvent(`selection.prime chars=${commandSelectionSnapshot.length}`);
  }
}

function setCommandModeArmed(next: boolean): void {
  commandModeArmed = next;
  if (commandModeArmed) {
    setNotice("Command mode armed for the next dictation.");
    void primeSelectionSnapshotForCommandMode();
  } else {
    commandSelectionSnapshot = null;
    setNotice("Command mode disabled for the next dictation.");
  }
  publishDockState();
}

function toggleCommandModeArmed(): void {
  setCommandModeArmed(!commandModeArmed);
}

async function refreshMicrophones(requestPermission: boolean): Promise<void> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    microphoneSelect.innerHTML = "<option value=''>Microphone listing not supported</option>";
    updateMicrophoneSummary();
    return;
  }

  try {
    if (requestPermission && !microphonePermissionGranted) {
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of tempStream.getTracks()) {
        track.stop();
      }
      microphonePermissionGranted = true;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter((device) => device.kind === "audioinput");

    if (microphones.length === 0) {
      microphoneSelect.innerHTML = "<option value=''>No microphones found</option>";
      settings.microphoneDeviceId = "";
      persistSettings(settings);
      updateMicrophoneSummary();
      return;
    }

    const currentId = settings.microphoneDeviceId;
    const hasCurrent = microphones.some((device) => device.deviceId === currentId);
    const selectedId = hasCurrent ? currentId : microphones[0]?.deviceId ?? "";

    microphoneSelect.innerHTML = microphones
      .map((device, index) => {
        const label = device.label?.trim() || `Microphone ${index + 1}`;
        const selected = device.deviceId === selectedId ? " selected" : "";
        return `<option value="${escapeHtml(device.deviceId)}"${selected}>${escapeHtml(label)}</option>`;
      })
      .join("");

    settings.microphoneDeviceId = selectedId;
    persistSettings(settings);
    updateMicrophoneSummary();

    if (!microphonePermissionGranted && microphones.every((device) => !device.label)) {
      setNotice("Click refresh in Settings > General to grant mic permission and show device names.");
    }
  } catch (error) {
    setNotice(`Unable to list microphones: ${asErrorMessage(error)}`, true);
  }
}

async function refreshAssistantInfo(): Promise<void> {
  const info = await invoke<AssistantInfoResponse>("get_assistant_info");
  renderAssistantInfo(info);
  renderProviderModelCatalog(providerModelCatalog, settings.aiModelName || settings.sttModelName);

  if (!piperPathInput.value.trim() && info.piperPath) {
    piperPathInput.value = info.piperPath;
    handleSettingsChange();
  }

  if (!coquiPythonPathInput.value.trim() && info.coquiPythonPath) {
    coquiPythonPathInput.value = info.coquiPythonPath;
    handleSettingsChange();
  }
}

async function handleAutoSetupRuntime(): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    return;
  }

  setStage("processing", "Downloading Piper runtime and voice model...");

  try {
    const result = await invoke<RuntimeSetupResponse>("setup_assistant_runtime");
    piperPathInput.value = result.piperPath;
    handleSettingsChange();

    piperStatusValue.textContent = "Installed";
    piperPathValue.textContent = result.piperPath;
    voiceStatusValue.textContent = "Installed";
    voicePathValue.textContent = result.voiceModelPath;

    setNotice("Runtime setup completed.");
    setStage("idle", "Runtime ready.");
  } catch (error) {
    setNotice(`Auto setup failed: ${asErrorMessage(error)}`, true);
    setStage("error", "Auto setup failed.");
  }

  await refreshAssistantInfoSafely();
  syncActionAvailability();
}

async function handleValidatePiper(): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    return;
  }

  const piperPath = piperPathInput.value.trim();
  setStage("processing", "Validating Piper executable...");

  try {
    const result = await invoke<PiperValidationResponse>("validate_piper", {
      request: {
        piperPath: piperPath || null,
      },
    });

    if (result.ok) {
      setNotice(`Piper is reachable: ${result.details || "help output received."}`);
      setStage("idle", "Piper validated.");
    } else {
      setNotice(`Piper check did not return success: ${result.details}`, true);
      setStage("error", "Piper validation failed.");
    }
  } catch (error) {
    setNotice(`Piper validation failed: ${asErrorMessage(error)}`, true);
    setStage("error", "Piper validation failed.");
  }

  await refreshAssistantInfoSafely();
  syncActionAvailability();
}

async function handleDownloadVoice(): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    return;
  }

  setStage("processing", "Downloading voice model...");

  try {
    const result = await invoke<VoiceInstallResponse>("ensure_voice_model");
    voiceStatusValue.textContent = "Installed";
    voicePathValue.textContent = result.modelPath;
    setNotice(`Voice model ready: ${result.modelPath}`);
    setStage("idle", "Voice model installed.");
  } catch (error) {
    setNotice(`Voice download failed: ${asErrorMessage(error)}`, true);
    setStage("error", "Voice download failed.");
  }

  await refreshAssistantInfoSafely();
  syncActionAvailability();
}

function renderTtsSetupLogs(logs: string[]): void {
  if (logs.length === 0) {
    ttsSetupLogs.innerHTML = '<p class="setup-log-item">No setup logs yet.</p>';
    return;
  }

  ttsSetupLogs.innerHTML = logs
    .slice(-200)
    .map((line) => `<p class="setup-log-item">${escapeHtml(line)}</p>`)
    .join("");
  ttsSetupLogs.scrollTop = ttsSetupLogs.scrollHeight;
}

function applyTtsSetupStatus(status: TtsSetupStatusResponse): void {
  ttsSetupRunning = status.running;
  setupAllTtsBtn.disabled = status.running || pipelineRunning || stage === "recording";
  ttsSetupStatus.textContent = status.stage || (status.running ? "Setting up..." : "Waiting for setup.");
  renderTtsSetupLogs(status.logs);
  updateTtsSetupGate();

  if (!status.running && status.completed) {
    if (status.success) {
      setNotice("All TTS runtimes are ready.");
      if (stage !== "recording") {
        setStage("idle", "TTS setup complete.");
      }
    } else {
      setNotice("TTS setup failed. Review logs in Settings > TTS.", true);
      setStage("error", "TTS setup failed.");
    }
  }
}

function stopTtsSetupPolling(): void {
  if (ttsSetupPollingId !== null) {
    window.clearInterval(ttsSetupPollingId);
    ttsSetupPollingId = null;
  }
}

async function pollTtsSetupStatusOnce(): Promise<void> {
  if (ttsSetupPollInFlight) {
    return;
  }
  ttsSetupPollInFlight = true;

  try {
    const status = await invoke<TtsSetupStatusResponse>("get_tts_runtime_setup_status");
    applyTtsSetupStatus(status);
    if (!status.running) {
      stopTtsSetupPolling();
      await refreshAssistantInfoSafely();
      if (status.completed || settings.ttsEngine === "coqui") {
        await refreshCoquiStatusSafely();
        await refreshCoquiVoices();
        if (settings.ttsEngine === "coqui") {
          await refreshCoquiModels({ quiet: true });
        }
      }
      syncActionAvailability();
    }
  } catch (error) {
    stopTtsSetupPolling();
    ttsSetupRunning = false;
    updateTtsSetupGate();
    setNotice(`Unable to poll TTS setup status: ${asErrorMessage(error)}`, true);
    syncActionAvailability();
  } finally {
    ttsSetupPollInFlight = false;
  }
}

function startTtsSetupPolling(): void {
  if (ttsSetupPollingId !== null) {
    return;
  }
  ttsSetupPollingId = window.setInterval(() => {
    void pollTtsSetupStatusOnce();
  }, 850);
}

async function handleSetupAllTts(): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    return;
  }

  setStage("processing", "Setting up Piper and Coqui runtimes...");
  setupAllTtsBtn.disabled = true;
  ttsSetupStatus.textContent = "Starting setup...";
  syncActionAvailability();

  try {
    const request = {
      pythonPath: coquiPythonPathInput.value.trim() || null,
      useGpu: coquiUseGpuToggle.checked,
    };
    const status = await invoke<TtsSetupStatusResponse>("start_tts_runtime_setup", { request });
    applyTtsSetupStatus(status);
    startTtsSetupPolling();
    await pollTtsSetupStatusOnce();
  } catch (error) {
    ttsSetupRunning = false;
    updateTtsSetupGate();
    setNotice(`Setup failed to start: ${asErrorMessage(error)}`, true);
    setStage("error", "Setup failed to start.");
    syncActionAvailability();
  }
}

function renderCoquiVoiceOptions(voices: string[], preferredVoiceId = ""): void {
  const safeVoices = Array.from(new Set(voices.map((voice) => voice.trim()).filter(Boolean))).sort();

  if (safeVoices.length === 0) {
    coquiVoiceSelect.innerHTML = '<option value="">No voices found</option>';
    coquiVoiceSelect.value = "";
    return;
  }

  const selected = safeVoices.includes(preferredVoiceId)
    ? preferredVoiceId
    : safeVoices[0];

  coquiVoiceSelect.innerHTML = safeVoices
    .map((voice) => {
      const active = voice === selected ? " selected" : "";
      return `<option value="${escapeHtml(voice)}"${active}>${escapeHtml(voice)}</option>`;
    })
    .join("");
  coquiVoiceSelect.value = selected;
  if (!coquiVoiceIdInput.value.trim() || !safeVoices.includes(coquiVoiceIdInput.value.trim())) {
    coquiVoiceIdInput.value = selected;
  }
}

function renderCoquiModelCatalog(models: string[], selectedModel = ""): void {
  const normalized = Array.from(new Set(models.map((model) => model.trim()).filter(Boolean))).sort();
  const fallbackModel =
    selectedModel.trim() ||
    coquiModelInput.value.trim() ||
    settings.coquiModelName.trim() ||
    DEFAULT_COQUI_MODEL;
  const finalModels =
    normalized.length > 0
      ? normalized
      : fallbackModel
        ? [fallbackModel]
        : [];
  coquiModelCatalog = finalModels;

  if (finalModels.length === 0) {
    coquiModelCatalogSelect.innerHTML = '<option value="">No models available</option>';
    return;
  }

  const selected = finalModels.includes(selectedModel)
    ? selectedModel
    : finalModels.includes(fallbackModel)
      ? fallbackModel
      : "";
  const options = ['<option value="">Select a model...</option>'];
  for (const model of finalModels) {
    const active = model === selected ? " selected" : "";
    options.push(`<option value="${escapeHtml(model)}"${active}>${escapeHtml(model)}</option>`);
  }
  coquiModelCatalogSelect.innerHTML = options.join("");
  coquiModelCatalogSelect.value = selected;
}

function renderProviderModelCatalog(models: string[], selectedModel = ""): void {
  const normalized = Array.from(new Set(models.map((model) => model.trim()).filter(Boolean))).sort();
  const fallbackModel =
    selectedModel.trim() ||
    aiModelInput.value.trim() ||
    sttModelInput.value.trim() ||
    settings.aiModelName.trim() ||
    settings.sttModelName.trim();
  const finalModels =
    normalized.length > 0
      ? normalized
      : fallbackModel
        ? [fallbackModel]
        : [];
  providerModelCatalog = finalModels;

  if (finalModels.length === 0) {
    providerModelCatalogSelect.innerHTML = '<option value="">No models available</option>';
    return;
  }

  const selected = finalModels.includes(selectedModel)
    ? selectedModel
    : finalModels.includes(fallbackModel)
      ? fallbackModel
      : "";
  const options = ['<option value="">Select a model...</option>'];
  for (const model of finalModels) {
    const active = model === selected ? " selected" : "";
    options.push(`<option value="${escapeHtml(model)}"${active}>${escapeHtml(model)}</option>`);
  }
  providerModelCatalogSelect.innerHTML = options.join("");
  providerModelCatalogSelect.value = selected;
}

async function fetchProviderModels(): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    return;
  }
  const activeSettings = readSettingsFromForm();
  if (!activeSettings.apiKey) {
    setNotice("API key is required to fetch model catalog.", true);
    setActiveSettingsPane("system");
    return;
  }

  setStage("processing", "Loading provider model catalog...");
  try {
    const request = {
      apiKey: activeSettings.apiKey,
      apiBaseUrl: activeSettings.apiBaseUrl || null,
    };
    const response = await invoke<ProviderModelsResponse>("fetch_provider_models", { request });
    renderProviderModelCatalog(response.models, activeSettings.aiModelName || activeSettings.sttModelName);
    setNotice(`Loaded ${response.models.length} provider models.`);
    setStage("idle", "Provider model list loaded.");
  } catch (error) {
    setNotice(`Unable to load provider model catalog: ${asErrorMessage(error)}`, true);
    setStage("idle", "Provider model list unavailable.");
  } finally {
    syncActionAvailability();
  }
}

function renderCoquiStatus(status: CoquiStatusResponse): void {
  coquiStatusValue.textContent = status.available ? "Ready" : "Unavailable";
  coquiPythonValue.textContent = status.pythonPath || "-";
  coquiVersionValue.textContent = status.ttsVersion || "-";
  coquiCudaValue.textContent = status.cudaAvailable ? "Available" : "Not available";
  coquiVoiceDirValue.textContent = status.voiceDir || "-";
  coquiRuntimeInstalled =
    coquiRuntimeInstalled ||
    Boolean(status.pythonPath && status.pythonPath.trim().length > 0);

  if (!coquiModelInput.value.trim()) {
    coquiModelInput.value = status.defaultModel || DEFAULT_COQUI_MODEL;
  }

  const preferred = coquiVoiceIdInput.value.trim() || settings.coquiVoiceId;
  renderCoquiVoiceOptions(status.voices, preferred);
  updateTtsSetupGate();
}

async function refreshCoquiStatus(): Promise<void> {
  if (coquiCloneInProgress) {
    return;
  }
  const request = {
    pythonPath: coquiPythonPathInput.value.trim() || null,
  };
  const status = await invoke<CoquiStatusResponse>("get_coqui_status", { request });
  renderCoquiStatus(status);
}

async function refreshCoquiVoices(): Promise<void> {
  if (coquiCloneInProgress) {
    return;
  }
  const request = {
    pythonPath: coquiPythonPathInput.value.trim() || null,
  };

  try {
    const response = await invoke<CoquiVoicesResponse>("list_coqui_voices", { request });
    coquiVoiceDirValue.textContent = response.voiceDir || coquiVoiceDirValue.textContent;
    const preferred = coquiVoiceIdInput.value.trim() || settings.coquiVoiceId;
    renderCoquiVoiceOptions(response.voices, preferred);

    if (coquiVoiceSelect.value) {
      coquiVoiceIdInput.value = coquiVoiceSelect.value;
      handleSettingsChange();
    }
  } catch (error) {
    setNotice(`Unable to list Coqui voices: ${asErrorMessage(error)}`, true);
  }
}

async function refreshCoquiModels(options: { quiet?: boolean } = {}): Promise<void> {
  if (coquiCloneInProgress) {
    return;
  }
  if (pipelineRunning || stage === "recording") {
    return;
  }
  const quiet = options.quiet === true;
  if (!quiet) {
    setStage("processing", "Loading Coqui model catalog...");
  }
  try {
    const request = {
      pythonPath: coquiPythonPathInput.value.trim() || null,
    };
    const response = await invoke<CoquiModelsResponse>("list_coqui_models", { request });
    renderCoquiModelCatalog(response.models, coquiModelInput.value.trim());
    if (!quiet) {
      setNotice(`Loaded ${response.models.length} Coqui models.`);
      setStage("idle", "Coqui model list loaded.");
    }
  } catch (error) {
    renderCoquiModelCatalog([], coquiModelInput.value.trim() || DEFAULT_COQUI_MODEL);
    if (!quiet) {
      setNotice(
        `Unable to load Coqui model catalog. Using manual/default model instead: ${asErrorMessage(error)}`,
        true,
      );
      setStage("idle", "Using manual Coqui model.");
    }
  } finally {
    syncActionAvailability();
  }
}

async function handleSetupCoquiRuntime(): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    return;
  }

  setStage("processing", "Setting up Coqui runtime...");
  try {
    const request = {
      pythonPath: coquiPythonPathInput.value.trim() || null,
      useGpu: coquiUseGpuToggle.checked,
    };
    const result = await invoke<CoquiSetupResponse>("setup_coqui_runtime", { request });
    if (!coquiPythonPathInput.value.trim()) {
      coquiPythonPathInput.value = result.pythonPath;
      handleSettingsChange();
    }
    await refreshCoquiStatus();
    await refreshCoquiVoices();
    await refreshCoquiModels({ quiet: true });
    setNotice(`Coqui setup completed. ${result.details}`);
    setStage("idle", "Coqui runtime ready.");
  } catch (error) {
    setNotice(`Coqui setup failed: ${asErrorMessage(error)}`, true);
    setStage("error", "Coqui setup failed.");
  } finally {
    syncActionAvailability();
  }
}

async function handleValidateCoqui(): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    return;
  }

  setStage("processing", "Validating Coqui runtime...");
  try {
    const request = {
      pythonPath: coquiPythonPathInput.value.trim() || null,
    };
    const result = await invoke<CoquiValidationResponse>("validate_coqui", { request });
    if (result.ok) {
      setNotice(result.details);
      setStage("idle", "Coqui validated.");
      await refreshCoquiStatusSafely();
    } else {
      setNotice(result.details, true);
      setStage("error", "Coqui validation failed.");
    }
  } catch (error) {
    setNotice(`Coqui validation failed: ${asErrorMessage(error)}`, true);
    setStage("error", "Coqui validation failed.");
  } finally {
    syncActionAvailability();
  }
}

async function getAudioDurationSeconds(file: File): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    audio.preload = "metadata";
    audio.src = objectUrl;

    const cleanup = (): void => {
      URL.revokeObjectURL(objectUrl);
      audio.removeAttribute("src");
    };

    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      cleanup();
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error("Unable to read audio metadata."));
    };
  });
}

async function decodeAudioSample(file: Blob): Promise<AudioBuffer> {
  const AudioCtor = window.AudioContext;
  if (!AudioCtor) {
    throw new Error("Audio decoding is not supported in this environment.");
  }

  const context = new AudioCtor();
  try {
    const data = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(data.slice(0));
    return decoded;
  } finally {
    void context.close().catch(() => {
      // Ignore close errors for short-lived decode contexts.
    });
  }
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function audioBufferToWavBlob(audioBuffer: AudioBuffer): Blob {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const frameCount = audioBuffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataSize = frameCount * numChannels * bytesPerSample;
  const wavBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let channel = 0; channel < numChannels; channel += 1) {
    channels.push(audioBuffer.getChannelData(channel));
  }

  let offset = 44;
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channels[channel]?.[frame] ?? 0));
      const pcmValue = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      view.setInt16(offset, pcmValue, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([wavBuffer], { type: "audio/wav" });
}

function withWavExtension(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "reference.wav";
  }

  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) {
    return `${trimmed}.wav`;
  }

  return `${trimmed.slice(0, dotIndex)}.wav`;
}

async function prepareCoquiReferenceSample(file: File): Promise<{
  sampleBlob: Blob;
  sampleFileName: string;
  durationSeconds: number;
  convertedToWav: boolean;
}> {
  const extension = file.name.split(".").pop()?.trim().toLowerCase() ?? "";
  const isWav = extension === "wav";

  let decoded: AudioBuffer | null = null;
  try {
    decoded = await decodeAudioSample(file);
  } catch {
    decoded = null;
  }

  const durationSeconds = decoded
    ? decoded.duration
    : await getAudioDurationSeconds(file).catch(() => 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("Unable to read voice sample duration.");
  }
  if (durationSeconds > MAX_COQUI_REFERENCE_SECONDS) {
    throw new Error(
      `Voice sample must be ${MAX_COQUI_REFERENCE_SECONDS} seconds or less. Current: ${durationSeconds.toFixed(2)}s.`,
    );
  }

  if (isWav) {
    return {
      sampleBlob: file,
      sampleFileName: file.name || "reference.wav",
      durationSeconds,
      convertedToWav: false,
    };
  }

  if (!decoded) {
    throw new Error("Unable to decode this audio format. Please upload WAV/MP3/WEBM with a standard codec.");
  }

  const wavBlob = audioBufferToWavBlob(decoded);
  return {
    sampleBlob: wavBlob,
    sampleFileName: withWavExtension(file.name || "reference.wav"),
    durationSeconds,
    convertedToWav: true,
  };
}

async function handleCloneCoquiVoice(): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    setCoquiCloneStatus("Clone blocked while pipeline is busy.", true);
    logClientEvent("coqui.clone blocked: pipeline busy");
    return;
  }

  const selectedFile = coquiVoiceFileInput.files?.item(0) ?? null;
  if (!selectedFile) {
    setCoquiCloneStatus("Select a reference sample file first.", true);
    setNotice("Select a voice sample file before cloning.", true);
    logClientEvent("coqui.clone blocked: no file selected");
    return;
  }

  let speakerId = coquiVoiceIdInput.value.trim();
  if (!speakerId) {
    speakerId = `voice_${Date.now()}`;
    coquiVoiceIdInput.value = speakerId;
    handleSettingsChange();
    setCoquiCloneStatus(`Voice profile ID was empty. Using "${speakerId}".`);
    logClientEvent(`coqui.clone speaker id auto-filled: ${speakerId}`);
  }

  let preparedSample:
    | {
        sampleBlob: Blob;
        sampleFileName: string;
        durationSeconds: number;
        convertedToWav: boolean;
      }
    | null = null;
  try {
    setCoquiCloneStatus("Reading and validating sample...");
    logClientEvent(
      `coqui.clone preparing sample file=${selectedFile.name} type=${selectedFile.type || "unknown"} size=${selectedFile.size}`,
    );
    preparedSample = await prepareCoquiReferenceSample(selectedFile);
  } catch (error) {
    setCoquiCloneStatus(`Sample processing failed: ${asErrorMessage(error)}`, true);
    setNotice(`Unable to process voice sample: ${asErrorMessage(error)}`, true);
    logClientEvent(`coqui.clone failed during sample prep: ${asErrorMessage(error)}`);
    return;
  }
  if (!preparedSample) {
    setCoquiCloneStatus("Sample processing returned no output.", true);
    setNotice("Unable to process voice sample.", true);
    logClientEvent("coqui.clone failed: prepared sample is null");
    return;
  }

  setCoquiCloneStatus("Sample ready. Sending clone request (first run can take a few minutes)...");
  setStage("processing", "Processing sample and cloning Coqui voice...");
  coquiCloneInProgress = true;
  try {
    const audioBase64 = await blobToBase64(preparedSample.sampleBlob);
    logClientEvent(
      `coqui.clone invoking backend speaker=${speakerId} duration=${preparedSample.durationSeconds.toFixed(2)} convertedToWav=${preparedSample.convertedToWav}`,
    );
    const request = {
      pythonPath: coquiPythonPathInput.value.trim() || null,
      modelName: coquiModelInput.value.trim() || DEFAULT_COQUI_MODEL,
      language: coquiLanguageInput.value.trim() || DEFAULT_COQUI_LANGUAGE,
      speakerId,
      audioBase64,
      fileName: preparedSample.sampleFileName,
      useGpu: coquiUseGpuToggle.checked,
    };

    const response = await invoke<CoquiVoiceCloneResponse>("clone_coqui_voice", { request });
    renderCoquiVoiceOptions(response.voices, response.speakerId);
    coquiVoiceIdInput.value = response.speakerId;
    if (response.previewAudioBase64) {
      coquiVoicePreview.src = `data:audio/wav;base64,${response.previewAudioBase64}`;
      coquiVoicePreview.currentTime = 0;
    }
    handleSettingsChange();
    setCoquiCloneStatus(
      `Voice cloned: "${response.speakerId}" (${response.durationSeconds.toFixed(2)}s).`,
    );
    setNotice(
      preparedSample.convertedToWav
        ? `Voice cloned as "${response.speakerId}" from ${response.durationSeconds.toFixed(2)}s sample (converted from ${selectedFile.name} to WAV).`
        : `Voice cloned as "${response.speakerId}" from ${response.durationSeconds.toFixed(2)}s sample.`,
    );
    logClientEvent(
      `coqui.clone success speaker=${response.speakerId} voices=${response.voices.length}`,
    );
    setStage("idle", "Coqui voice clone ready.");
  } catch (error) {
    setCoquiCloneStatus(`Clone failed: ${asErrorMessage(error)}`, true);
    setNotice(`Coqui voice cloning failed: ${asErrorMessage(error)}`, true);
    logClientEvent(`coqui.clone failed in backend: ${asErrorMessage(error)}`);
    setStage("error", "Coqui voice cloning failed.");
  } finally {
    coquiCloneInProgress = false;
    syncActionAvailability();
    coquiVoiceFileInput.value = "";
  }
}

async function handleTestCoquiVoice(): Promise<void> {
  if (pipelineRunning || stage === "recording" || coquiCloneInProgress) {
    setCoquiCloneStatus("Voice test is blocked while another task is running.", true);
    return;
  }

  const speakerId = (coquiVoiceIdInput.value.trim() || coquiVoiceSelect.value.trim()).trim();
  if (!speakerId) {
    setCoquiCloneStatus("Select a cloned voice before testing.", true);
    setNotice("Select a cloned Coqui voice profile before testing.", true);
    return;
  }

  if (coquiVoiceIdInput.value.trim() !== speakerId) {
    coquiVoiceIdInput.value = speakerId;
    handleSettingsChange();
  }

  setCoquiCloneStatus(`Generating preview for "${speakerId}"...`);
  setStage("processing", "Generating Coqui voice preview...");
  logClientEvent(`coqui.preview start speaker=${speakerId}`);

  try {
    const request = {
      pythonPath: coquiPythonPathInput.value.trim() || null,
      modelName: coquiModelInput.value.trim() || DEFAULT_COQUI_MODEL,
      language: coquiLanguageInput.value.trim() || DEFAULT_COQUI_LANGUAGE,
      speakerId,
      text: "Hello. This is a preview of your selected cloned voice.",
      speed: coquiSpeedInput.value ? Number(coquiSpeedInput.value) : DEFAULT_COQUI_SPEED,
      quality: coquiQualitySelect.value,
      emotion: coquiEmotionSelect.value,
      useGpu: coquiUseGpuToggle.checked,
      splitSentences: coquiSplitSentencesToggle.checked,
    };
    const response = await invoke<CoquiVoicePreviewResponse>("preview_coqui_voice", { request });

    coquiVoicePreview.src = `data:audio/wav;base64,${response.audioBase64}`;
    coquiVoicePreview.currentTime = 0;
    await coquiVoicePreview.play().catch(() => {
      // Playback can be blocked by autoplay policy; keep source loaded for manual play.
    });

    setCoquiCloneStatus(`Preview ready for "${speakerId}".`);
    setNotice(`Coqui preview generated for "${speakerId}".`);
    logClientEvent(`coqui.preview success speaker=${speakerId}`);
    setStage("idle", "Coqui voice preview ready.");
  } catch (error) {
    const message = asErrorMessage(error);
    setCoquiCloneStatus(`Voice preview failed: ${message}`, true);
    setNotice(`Coqui voice preview failed: ${message}`, true);
    logClientEvent(`coqui.preview failed speaker=${speakerId} error=${message}`);
    setStage("error", "Coqui voice preview failed.");
  } finally {
    syncActionAvailability();
  }
}

async function handleRecordToggle(): Promise<void> {
  if (stage === "recording") {
    stopRecording();
    return;
  }

  if (await shouldBlockAssistantInputFromForegroundApp()) {
    return;
  }

  interruptTtsPlaybackForCaptureIntent();

  if (pipelineRunning) {
    return;
  }

  await startRecording();
}

async function handleDockMicToggle(): Promise<void> {
  if (hotkeyCaptureActive || commandHotkeyCaptureActive) {
    return;
  }

  await handleRecordToggle();
}

function interruptTtsPlaybackForCaptureIntent(): boolean {
  const activePlayback = activeTtsPlayback;
  if (!activePlayback && stage !== "speaking") {
    return false;
  }

  if (activePlayback) {
    activePlayback.interrupted = true;
  }

  assistantAudio.pause();
  assistantAudio.currentTime = 0;
  assistantAudio.removeAttribute("src");
  assistantAudio.load();

  if (activePlayback) {
    activePlayback.finish(false);
  }

  if (stage === "speaking") {
    pipelineRunning = false;
    syncActionAvailability();
    setStage("idle", "Playback interrupted.");
  }

  return true;
}

async function startRecording(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    clearPushToTalkHolds();
    setNotice("This environment does not support microphone recording.", true);
    setStage("error", "Media APIs unavailable.");
    return;
  }

  if (await shouldBlockAssistantInputFromForegroundApp()) {
    clearPushToTalkHolds();
    return;
  }

  const activeSettings = readSettingsFromForm();
  if (commandModeArmed) {
    void primeSelectionSnapshotForCommandMode();
  }
  if (!activeSettings.apiKey) {
    clearPushToTalkHolds();
    setNotice("API key is required before recording.", true);
    openSettings();
    setActiveSettingsPane("system");
    return;
  }

  const recorderOptions: MediaRecorderOptions = {
    audioBitsPerSecond: 96_000,
  };

  const preferredMimeType = pickBestRecorderMimeType();
  if (preferredMimeType) {
    recorderOptions.mimeType = preferredMimeType;
  }

  try {
    const stream = await openMicrophoneStream(activeSettings.microphoneDeviceId);
    mediaStream = stream;
    microphonePermissionGranted = true;

    mediaRecorder = new MediaRecorder(stream, recorderOptions);
    recorderMimeType = mediaRecorder.mimeType || preferredMimeType || "audio/webm";
    recordedChunks = [];
    startAmplitudeMonitoring(stream);

    mediaRecorder.addEventListener("dataavailable", (event: BlobEvent) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("error", () => {
      clearPushToTalkHolds();
      setNotice("Recording failed due to media recorder error.", true);
      setStage("error", "Recording failed.");
      stopAmplitudeMonitoring();
      releaseMicrophone();
    });

    mediaRecorder.addEventListener("stop", () => {
      void finalizeRecording();
    });

    mediaRecorder.start(180);
    recordingStartedAt = Date.now();
    beginRecordingTicker();
    setStage("recording", "Listening...");
    if (settings.captureMode === "push-to-talk") {
      setNotice("Recording started. Release the hotkey or mic button to stop.");
    } else {
      setNotice("Recording started. Tap again to stop.");
    }
    syncActionAvailability();
  } catch (error) {
    clearPushToTalkHolds();
    stopAmplitudeMonitoring();
    releaseMicrophone();
    setNotice(`Microphone access failed: ${asErrorMessage(error)}`, true);
    setStage("error", "Microphone unavailable.");
    syncActionAvailability();
  }
}

async function openMicrophoneStream(preferredDeviceId: string): Promise<MediaStream> {
  const baseConstraints: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  if (preferredDeviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseConstraints,
          deviceId: { exact: preferredDeviceId },
        },
      });
    } catch {
      setNotice("Selected microphone is unavailable. Falling back to default device.", true);
    }
  }

  return navigator.mediaDevices.getUserMedia({ audio: baseConstraints });
}

function stopRecording(): void {
  clearPushToTalkHolds();

  if (!mediaRecorder) {
    return;
  }

  if (mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }

  stopRecordingTicker();
  releaseMicrophone();
  setStage("processing", "Preparing audio...");
  setNotice("Recording stopped. Running pipeline...");
  syncActionAvailability();
}

async function finalizeRecording(): Promise<void> {
  const blob = new Blob(recordedChunks, { type: recorderMimeType });
  recordedChunks = [];

  if (blob.size === 0) {
    setNotice("No usable audio captured. Please try again.", true);
    setStage("error", "No audio captured.");
    syncActionAvailability();
    return;
  }

  await runPipeline(blob, recorderMimeType);
}

async function runPipeline(audioBlob: Blob, audioMimeType: string): Promise<void> {
  const activeSettings = readSettingsFromForm();

  pipelineRunning = true;
  syncActionAvailability();
  setStage("processing", "Transcribing...");

  try {
    const audioBase64 = await blobToBase64(audioBlob);
    const systemPrompt = buildEffectiveSystemPrompt(activeSettings, commandModeArmed);
    const coquiVoiceId = activeSettings.coquiVoiceId || coquiVoiceSelect.value || "";
    let selectedTextForRewrite: string | null = null;
    if (commandModeArmed) {
      const primedSelected = (commandSelectionSnapshot ?? "").trim();
      const selected = primedSelected || (await captureSelectedTextForRewrite({ silent: true })).trim();
      if (selected) {
        selectedTextForRewrite = selected;
      } else {
        const explicitSelected = (await captureSelectedTextForRewrite()).trim();
        if (explicitSelected) {
          selectedTextForRewrite = explicitSelected;
        } else {
          setNotice("No selected text detected. Command mode will run without selection replace.", true);
        }
      }
    }
    logClientEvent(
      `pipeline.selection commandMode=${commandModeArmed} selectedChars=${selectedTextForRewrite ? selectedTextForRewrite.length : 0}`,
    );

    const response = await invoke<AssistantPipelineResponse>("run_assistant_pipeline", {
      request: {
        apiKey: activeSettings.apiKey,
        apiBaseUrl: activeSettings.apiBaseUrl || null,
        sttModel: activeSettings.sttModelName || null,
        aiModel: activeSettings.aiModelName || null,
        piperPath: activeSettings.piperPath || null,
        audioBase64,
        audioMimeType,
        language: activeSettings.dictationLanguage || null,
        systemPrompt,
        temperature: activeSettings.temperature,
        maxTokens: activeSettings.maxTokens,
        dictionaryEntries: dictionaryTerms.map((item) => ({
          source: item.source,
          target: item.target,
        })),
        snippetEntries: snippets.map((item) => ({
          trigger: item.trigger,
          expansion: item.expansion,
        })),
        applyBacktrack: activeSettings.backtrackCorrection,
        removeFillers: activeSettings.removeFillers,
        autoPunctuation: activeSettings.autoPunctuation,
        autoNumberedLists: activeSettings.numberedLists,
        commandMode: commandModeArmed,
        wakeWordEnabled: activeSettings.wakeWordEnabled,
        assistantName: activeSettings.assistantName || DEFAULT_ASSISTANT_NAME,
        selectedText: selectedTextForRewrite,
        ttsEngine: activeSettings.ttsEngine,
        piper:
          activeSettings.ttsEngine === "piper"
            ? {
                speed: activeSettings.piperSpeed,
                quality: activeSettings.piperQuality,
                emotion: activeSettings.piperEmotion,
              }
            : null,
        coqui:
          activeSettings.ttsEngine === "coqui"
            ? {
                pythonPath: activeSettings.coquiPythonPath || null,
                modelName: activeSettings.coquiModelName,
                language: activeSettings.coquiLanguage || DEFAULT_COQUI_LANGUAGE,
                speakerId: coquiVoiceId || null,
                speed: activeSettings.coquiSpeed,
                quality: activeSettings.coquiQuality,
                emotion: activeSettings.coquiEmotion,
                useGpu: activeSettings.coquiUseGpu,
                splitSentences: activeSettings.coquiSplitSentences,
              }
            : null,
      },
    });

    renderPipelineResponse(response);
    let playbackCompleted = true;
    const selectionPopupPayload = buildSelectionPopupPayload(response);
    if (!selectionPopupPayload) {
      latestSelectionPopupPayload = null;
      if (selectionAssistantWindow) {
        try {
          await selectionAssistantWindow.hide();
        } catch {
          // Ignore hide failures.
        }
      }
    }
    const selectionPopupOpened = selectionPopupPayload
      ? await showSelectionAssistantPopup(selectionPopupPayload)
      : false;

    if (!selectionPopupOpened && response.mode === "assistant" && response.audioBase64.trim()) {
      playbackCompleted = await playGeneratedAudio(response.audioBase64, activeSettings.ttsEngine);
    }

    let dictationPasted = false;
    if (response.mode === "dictation") {
      if (activeSettings.autoPasteDictation) {
        dictationPasted = await triggerAutoPaste(response.assistantResponse);
        if (dictationPasted) {
          setNotice("Dictation copied and pasted.");
        }
      }
    } else if (activeSettings.copyToClipboard && !response.selectionPending && !selectionPopupOpened) {
      await copyToClipboard(response.assistantResponse);
    }

    commandModeArmed = false;
    commandSelectionSnapshot = null;
    publishDockState();

    if (stage !== "recording") {
      if (response.mode === "dictation") {
        if (dictationPasted) {
          // Notice already set above.
        } else {
          setNotice("Dictation ready. Copy it from Home if needed.");
        }
      } else if (selectionPopupOpened || response.selectionRewrite || response.selectionPending) {
        // Notice already set above.
      } else {
        setNotice(playbackCompleted ? "Pipeline completed." : "Playback interrupted for new dictation.");
      }
      setStage("idle", "Ready for next request.");
    }
  } catch (error) {
    setNotice(`Pipeline failed: ${asErrorMessage(error)}`, true);
    commandModeArmed = false;
    commandSelectionSnapshot = null;
    publishDockState();
    setStage("error", "Pipeline failed.");
  } finally {
    pipelineRunning = false;
    await refreshAssistantInfoSafely();
    syncActionAvailability();
  }
}

function renderPipelineResponse(response: AssistantPipelineResponse): void {
  transcriptText.textContent = response.transcript;
  transcriptText.classList.remove("muted");

  assistantText.textContent = response.assistantResponse;
  assistantText.classList.remove("muted");

  sttLatency.textContent = formatLatency(response.sttLatencyMs);
  aiLatency.textContent = formatLatency(response.aiLatencyMs);
  ttsLatency.textContent = formatLatency(response.ttsLatencyMs);
  totalLatency.textContent = formatLatency(response.totalLatencyMs);

  if (!settings.incognitoMode) {
    appendConversationEntry("You", response.transcript, "user", { showInLog: false });
    if (response.selectionRewrite) {
      appendConversationEntry("Rewrite", response.assistantResponse, "assistant");
    } else if (response.selectionPending) {
      appendConversationEntry("Rewrite pending", response.assistantResponse, "assistant");
    } else if (response.selectionContextUsed) {
      appendConversationEntry("Selection", response.assistantResponse, "assistant");
    } else if (response.mode === "assistant") {
      appendConversationEntry("SlasshyWispr", response.assistantResponse, "assistant");
    } else {
      appendConversationEntry("Dictation", response.assistantResponse, "assistant");
    }
  }

  trackUsage(response.transcript);
  if (activePage === "notes") {
    addQuickNote(response.transcript);
  }
}

function appendConversationEntry(
  speaker: string,
  content: string,
  tone: "user" | "assistant",
  options: { showInLog?: boolean } = {},
): void {
  const showInLog = options.showInLog ?? true;
  if (showInLog) {
    const historyEntry: HomeHistoryEntry = {
      speaker,
      content,
      tone,
      timestamp: Date.now(),
    };

    const emptyHint = conversationLog.querySelector(".empty-hint");
    if (emptyHint) {
      emptyHint.remove();
    }

    conversationLog.prepend(createConversationEntryElement(historyEntry));
    homeHistoryEntries.unshift(historyEntry);
    persistHomeHistory();
  }

  recentTurns.unshift({ speaker, content });

  while (recentTurns.length > MAX_HISTORY_ITEMS) {
    recentTurns.pop();
  }
}

async function playGeneratedAudio(audioBase64: string, engine: TtsEngine): Promise<boolean> {
  setStage("speaking", `Playing ${engine === "coqui" ? "Coqui" : "Piper"} audio...`);

  let playback!: ActiveTtsPlayback;
  let settled = false;
  let completionResolve: ((completed: boolean) => void) | null = null;

  const completion = new Promise<boolean>((resolve) => {
    completionResolve = resolve;
  });

  const finishPlayback = (completed: boolean): void => {
    if (settled) {
      return;
    }
    settled = true;
    assistantAudio.removeEventListener("ended", onPlaybackDone);
    assistantAudio.removeEventListener("error", onPlaybackDone);
    if (activeTtsPlayback === playback) {
      activeTtsPlayback = null;
    }
    completionResolve?.(completed);
  };

  const onPlaybackDone = (): void => {
    finishPlayback(!playback.interrupted);
  };

  playback = {
    interrupted: false,
    finish: finishPlayback,
  };

  activeTtsPlayback = playback;
  assistantAudio.addEventListener("ended", onPlaybackDone);
  assistantAudio.addEventListener("error", onPlaybackDone);

  assistantAudio.src = `data:audio/wav;base64,${audioBase64}`;
  assistantAudio.currentTime = 0;
  try {
    await assistantAudio.play();
  } catch (error) {
    if (playback.interrupted) {
      finishPlayback(false);
      return false;
    }
    finishPlayback(false);
    throw error;
  }

  return completion;
}

function renderAssistantInfo(info: AssistantInfoResponse): void {
  latestAssistantInfoDefaults = info;
  const configuredBaseUrl = settings.apiBaseUrl.trim();
  const configuredSttModel = settings.sttModelName.trim();
  const configuredAiModel = settings.aiModelName.trim();

  baseUrlValue.textContent = configuredBaseUrl || info.baseUrl || "Not set";
  sttModelValue.textContent = configuredSttModel || info.sttModel || "Not set";
  aiModelValue.textContent = configuredAiModel || info.aiModel || "Not set";
  apiBaseUrlInput.placeholder = info.baseUrl || "Enter provider URL (example: https://api.example.com/v1)";
  sttModelInput.placeholder = info.sttModel || "Enter STT model id";
  aiModelInput.placeholder = info.aiModel || "Enter AI model id";
  piperStatusValue.textContent = info.piperInstalled ? "Installed" : "Missing";
  piperPathValue.textContent = info.piperPath || "-";
  voiceStatusValue.textContent = info.voiceInstalled ? "Installed" : "Missing";
  voicePathValue.textContent = info.voiceModelPath;
  piperRuntimeReady = Boolean(info.piperInstalled && info.voiceInstalled);
  coquiRuntimeInstalled = Boolean(info.coquiInstalled);
  if (!coquiPythonValue.textContent || coquiPythonValue.textContent === "-") {
    coquiPythonValue.textContent = info.coquiPythonPath || "-";
  }
  updateTtsSetupGate();
}

function playDictationSoundEffect(kind: "start" | "stop" | "error"): void {
  if (!settings.dictationSoundEffects) {
    return;
  }

  const AudioCtor = window.AudioContext;
  if (!AudioCtor) {
    return;
  }

  if (!effectAudioContext) {
    effectAudioContext = new AudioCtor();
  }

  if (effectAudioContext.state === "suspended") {
    void effectAudioContext.resume().catch(() => {
      // Ignore resume failures so recording flow is never blocked.
    });
  }

  const profile =
    kind === "start"
      ? { frequencies: [680, 920], durations: [0.06, 0.08], type: "sine" as OscillatorType }
      : kind === "stop"
        ? { frequencies: [580], durations: [0.1], type: "triangle" as OscillatorType }
        : { frequencies: [260, 190], durations: [0.1, 0.12], type: "square" as OscillatorType };

  let offset = 0;
  for (let index = 0; index < profile.frequencies.length; index += 1) {
    const frequency = profile.frequencies[index] ?? profile.frequencies[0] ?? 440;
    const duration = profile.durations[index] ?? 0.1;
    const startAt = effectAudioContext.currentTime + offset;
    offset += duration * 0.72;

    const oscillator = effectAudioContext.createOscillator();
    const gain = effectAudioContext.createGain();
    oscillator.type = profile.type;
    oscillator.frequency.setValueAtTime(frequency, startAt);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.07, startAt + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(gain);
    gain.connect(effectAudioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  }
}

async function invokeExternalMediaPlayback(action: "pause" | "play"): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }

  await invoke("control_media_playback", { action });
  externalMediaControlErrorShown = false;
}

async function fetchForegroundInputBlockStatus(force = false): Promise<ForegroundInputBlockStatus> {
  if (!isTauriEnvironment()) {
    return { blocked: false, processName: "" };
  }

  const now = Date.now();
  if (!force && now - foregroundBlockCheckedAt <= FOREGROUND_BLOCK_CHECK_CACHE_MS) {
    return foregroundBlockStatusCache;
  }

  if (foregroundBlockCheckInFlight) {
    return foregroundBlockCheckInFlight;
  }

  foregroundBlockCheckInFlight = (async () => {
    try {
      const status = await invoke<ForegroundInputBlockStatus>("get_foreground_input_block_status");
      const next: ForegroundInputBlockStatus = {
        blocked: Boolean(status?.blocked),
        processName: String(status?.processName ?? "").trim().toLowerCase(),
      };
      foregroundBlockStatusCache = next;
      foregroundBlockCheckedAt = Date.now();
      return next;
    } catch {
      const fallback: ForegroundInputBlockStatus = { blocked: false, processName: "" };
      foregroundBlockStatusCache = fallback;
      foregroundBlockCheckedAt = Date.now();
      return fallback;
    } finally {
      foregroundBlockCheckInFlight = null;
    }
  })();

  return foregroundBlockCheckInFlight;
}

function formatBlockedProcessLabel(processName: string): string {
  const normalized = processName.trim().toLowerCase();
  if (!normalized) {
    return "a blocked game";
  }

  const base = normalized.endsWith(".exe") ? normalized.slice(0, -4) : normalized;
  return base.replace(/[-_]+/g, " ");
}

function notifyBlockedForegroundInput(processName: string): void {
  const now = Date.now();
  const normalized = processName.trim().toLowerCase();
  if (
    normalized === lastBlockedInputProcess &&
    now - lastBlockedInputNoticeAt < BLOCKED_INPUT_NOTICE_COOLDOWN_MS
  ) {
    return;
  }

  lastBlockedInputProcess = normalized;
  lastBlockedInputNoticeAt = now;
  setNotice(`Assistant input blocked while ${formatBlockedProcessLabel(processName)} is focused.`);
}

async function shouldBlockAssistantInputFromForegroundApp(force = false): Promise<boolean> {
  const status = await fetchForegroundInputBlockStatus(force);
  if (!status.blocked) {
    return false;
  }

  notifyBlockedForegroundInput(status.processName);
  return true;
}

async function refreshBlockedAppShortcutSuppression(): Promise<void> {
  if (!isTauriEnvironment() || foregroundBlockMonitorInFlight) {
    return;
  }

  foregroundBlockMonitorInFlight = true;
  try {
    const status = await fetchForegroundInputBlockStatus(true);
    const shouldSuppress = status.blocked;
    if (shouldSuppress === shortcutsSuppressedByBlockedApp) {
      return;
    }

    shortcutsSuppressedByBlockedApp = shouldSuppress;
    if (shouldSuppress) {
      clearPushToTalkHolds();
      await syncGlobalShortcuts(true);
      return;
    }

    requestGlobalShortcutSync(true);
  } finally {
    foregroundBlockMonitorInFlight = false;
  }
}

function startBlockedAppShortcutSuppressionMonitor(): void {
  if (!isTauriEnvironment() || foregroundBlockMonitorId !== null) {
    return;
  }

  foregroundBlockMonitorId = window.setInterval(() => {
    void refreshBlockedAppShortcutSuppression();
  }, 1200);

  void refreshBlockedAppShortcutSuppression();
}

function queueExternalMediaControl(task: () => Promise<void>): void {
  const previous = externalMediaControlInFlight ?? Promise.resolve();
  const next = previous
    .then(task)
    .catch((error: unknown) => {
      if (!externalMediaControlErrorShown) {
        setNotice(`Unable to control media playback: ${asErrorMessage(error)}`, true);
        externalMediaControlErrorShown = true;
      }
    })
    .finally(() => {
      if (externalMediaControlInFlight === next) {
        externalMediaControlInFlight = null;
      }
    });
  externalMediaControlInFlight = next;
}

function pauseExternalMediaForDictation(): void {
  if (!settings.muteMusicWhileDictating || externalMediaMutedForDictation) {
    return;
  }

  queueExternalMediaControl(async () => {
    if (!settings.muteMusicWhileDictating || externalMediaMutedForDictation) {
      return;
    }
    await invokeExternalMediaPlayback("pause");
    externalMediaMutedForDictation = true;
  });
}

function resumeExternalMediaAfterDictation(): void {
  if (!externalMediaMutedForDictation) {
    return;
  }

  queueExternalMediaControl(async () => {
    if (!externalMediaMutedForDictation) {
      return;
    }
    await invokeExternalMediaPlayback("play");
    externalMediaMutedForDictation = false;
  });
}

function setStage(next: Stage, detail: string): void {
  const previousStage = stage;
  stage = next;
  statusPill.dataset.stage = next;
  statusPill.textContent = stageLabel(next);
  statusDetail.textContent = detail;
  refreshRecordButton();
  publishDockState();
  void syncFloatingIndicatorWindow();

  if (previousStage !== "recording" && next === "recording") {
    playDictationSoundEffect("start");
    if (settings.muteMusicWhileDictating) {
      pauseExternalMediaForDictation();
    }
    return;
  }

  if (previousStage === "recording" && next !== "recording") {
    playDictationSoundEffect("stop");
    if (externalMediaMutedForDictation) {
      resumeExternalMediaAfterDictation();
    }
    return;
  }

  if (
    previousStage !== "error" &&
    next === "error" &&
    (pipelineRunning || previousStage === "recording" || previousStage === "speaking")
  ) {
    playDictationSoundEffect("error");
  }
}

function stageLabel(next: Stage): string {
  if (next === "recording") return "Recording";
  if (next === "processing") return "Processing";
  if (next === "speaking") return "Speaking";
  if (next === "error") return "Error";
  return "Idle";
}

function setNotice(message: string, isError = false): void {
  noticeText.textContent = message;
  noticeText.dataset.tone = isError ? "error" : "normal";
}

function setCoquiCloneStatus(message: string, isError = false): void {
  coquiCloneStatus.textContent = message;
  coquiCloneStatus.dataset.tone = isError ? "error" : "normal";
}

function logClientEvent(message: string): void {
  const line = message.trim();
  if (!line || !isTauriEnvironment()) {
    return;
  }

  void invoke("log_client_event", { message: line }).catch(() => {
    // Ignore logging failures in UI flow.
  });
}

function shouldDisplayDock(): boolean {
  return (
    stage === "recording" ||
    stage === "processing" ||
    stage === "speaking"
  );
}

function resolvedDockTheme(): "light" | "dark" {
  if (settings.themeMode === "light" || settings.themeMode === "dark") {
    return settings.themeMode;
  }

  return systemThemeMediaQuery?.matches ? "light" : "dark";
}

function publishDockState(): void {
  try {
    dockChannel.postMessage({
      kind: "state",
      stage,
      visible: shouldDisplayDock(),
      theme: resolvedDockTheme(),
      amplitude: dockAmplitude,
      captureMode: settings.captureMode,
      hotkey: formatHotkeyForDisplay(settings.pushToTalkHotkey),
      showFlowBar: settings.showFlowBar,
      commandModeArmed,
      globalShortcutsActive,
    });
  } catch {
    // Ignore post errors to keep main flow resilient.
  }
}

function refreshRecordButton(): void {
  if (stage === "recording") {
    recordBtn.textContent =
      settings.captureMode === "push-to-talk" ? "Release to Stop" : "Stop Recording";
    recordBtn.classList.add("is-recording");
    recordBtn.disabled = false;
    notesQuickMicBtn.dataset.stage = "recording";
    notesQuickMicBtn.disabled = false;
    return;
  }

  if (pipelineRunning) {
    recordBtn.textContent = "Processing...";
    recordBtn.classList.remove("is-recording");
    recordBtn.disabled = true;
    notesQuickMicBtn.dataset.stage = "processing";
    notesQuickMicBtn.disabled = true;
    return;
  }

  recordBtn.textContent = settings.captureMode === "push-to-talk" ? "Hold to Talk" : "Start Recording";
  recordBtn.classList.remove("is-recording");
  recordBtn.disabled = false;
  notesQuickMicBtn.dataset.stage = "idle";
  notesQuickMicBtn.disabled = false;
}

function selectionAssistantUrl(): string {
  if (window.location.origin.startsWith("http")) {
    return `${window.location.origin}/selection-assistant.html`;
  }
  return "selection-assistant.html";
}

function clampSelectionPopupHeight(height: number): number {
  return Math.min(SELECTION_POPUP_MAX_HEIGHT, Math.max(SELECTION_POPUP_MIN_HEIGHT, Math.round(height)));
}

function estimateSelectionPopupHeight(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return SELECTION_POPUP_MIN_HEIGHT;
  }

  const lines = trimmed.split(/\r?\n/);
  let wrappedLines = 0;
  for (const line of lines) {
    const lineLength = line.trim().length > 0 ? line.length : 1;
    wrappedLines += Math.max(1, Math.ceil(lineLength / SELECTION_POPUP_CHARS_PER_LINE));
  }

  const contentHeight = wrappedLines * 24;
  const chromeHeight = 84;
  return clampSelectionPopupHeight(contentHeight + chromeHeight);
}

async function applySelectionPopupSize(win: WebviewWindow, payload: SelectionPopupPayload): Promise<void> {
  const nextHeight = estimateSelectionPopupHeight(payload.text);
  await win.setSize(new LogicalSize(SELECTION_POPUP_WIDTH, nextHeight));
}

function buildSelectionPopupPayload(response: AssistantPipelineResponse): SelectionPopupPayload | null {
  if (!response.selectionRewrite && !response.selectionPending) {
    return null;
  }

  const token = Date.now();

  if (response.selectionPending) {
    return {
      token,
      mode: "pending",
      title: "Rewrite Draft Ready",
      text: response.assistantResponse,
      audioBase64: "",
    };
  }

  if (response.selectionRewrite) {
    return {
      token,
      mode: "rewrite",
      title: "Rewrite Result",
      text: response.assistantResponse,
      audioBase64: "",
    };
  }

  return null;
}

async function ensureSelectionAssistantWindow(): Promise<WebviewWindow> {
  if (selectionAssistantWindow) {
    return selectionAssistantWindow;
  }

  const existing = await WebviewWindow.getByLabel("selection_assistant");
  if (existing) {
    try {
      await existing.close();
    } catch {
      // Ignore close errors and continue with a fresh window.
    }
  }

  const width = SELECTION_POPUP_WIDTH;
  const height = 260;
  const x = Math.max(32, Math.round((window.screen.availWidth - width) / 2));
  const y = Math.max(32, Math.round((window.screen.availHeight - height) / 2));

  const created = new WebviewWindow("selection_assistant", {
    title: "SlasshyWispr Selection Assistant",
    url: selectionAssistantUrl(),
    width,
    height,
    x,
    y,
    minWidth: SELECTION_POPUP_MIN_WIDTH,
    minHeight: SELECTION_POPUP_MIN_HEIGHT,
    resizable: false,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    visible: false,
    focus: true,
  });

  created.once("tauri://destroyed", () => {
    selectionAssistantWindow = null;
  });

  const creationReady = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finishResolve = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const finishReject = (reason: unknown): void => {
      if (settled) return;
      settled = true;
      reject(new Error(asErrorMessage(reason)));
    };
    created.once("tauri://created", () => {
      finishResolve();
    });
    created.once("tauri://error", (event) => {
      const payload = (event as { payload?: unknown }).payload ?? "unknown error";
      finishReject(payload);
    });
    window.setTimeout(() => {
      finishResolve();
    }, 900);
  });

  await creationReady;
  selectionAssistantWindow = created;
  return created;
}

async function showSelectionAssistantPopup(payload: SelectionPopupPayload): Promise<boolean> {
  latestSelectionPopupPayload = payload;

  if (!isTauriEnvironment()) {
    return false;
  }

  try {
    const win = await ensureSelectionAssistantWindow();
    try {
      await applySelectionPopupSize(win, payload);
    } catch (error) {
      logClientEvent(`selection.popup size update failed: ${asErrorMessage(error)}`);
    }
    await win.show();
    await win.setFocus();
    selectionPopupChannel.postMessage({
      kind: "payload",
      payload,
    });
    window.setTimeout(() => {
      selectionPopupChannel.postMessage({
        kind: "payload",
        payload,
      });
    }, 120);
    setNotice("Selection assistant popup opened.");
    return true;
  } catch (error) {
    setNotice(`Unable to open selection popup: ${asErrorMessage(error)}`, true);
    return false;
  }
}

function voiceIndicatorUrl(): string {
  if (window.location.origin.startsWith("http")) {
    return `${window.location.origin}/voice-indicator.html`;
  }
  return "voice-indicator.html";
}

async function ensureVoiceIndicatorWindow(): Promise<WebviewWindow> {
  if (voiceIndicatorWindow) {
    return voiceIndicatorWindow;
  }

  const existing = await WebviewWindow.getByLabel("voice_indicator");
  if (existing) {
    await persistDockPositionFromWindow(existing);
    try {
      await existing.close();
    } catch {
      // Ignore close errors and proceed with creation attempt.
    }
  }

  const dockWidth = 190;
  const dockHeight = 40;
  const dockPosition = await resolveDockStartPosition(dockWidth, dockHeight);

  const created = new WebviewWindow("voice_indicator", {
    title: "SlasshyWispr Voice Indicator",
    url: voiceIndicatorUrl(),
    width: dockWidth,
    height: dockHeight,
    x: dockPosition.x,
    y: dockPosition.y,
    minWidth: dockWidth,
    minHeight: dockHeight,
    maxWidth: dockWidth,
    maxHeight: dockHeight,
    resizable: false,
    decorations: false,
    transparent: true,
    shadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    visible: false,
    focus: false,
  });

  created.once("tauri://destroyed", () => {
    voiceIndicatorWindow = null;
  });

  const creationReady = new Promise<void>((resolve, reject) => {
    let settled = false;

    const finishResolve = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const finishReject = (reason: unknown): void => {
      if (settled) return;
      settled = true;
      reject(new Error(asErrorMessage(reason)));
    };

    created.once("tauri://created", () => {
      finishResolve();
    });

    created.once("tauri://error", (event) => {
      const payload = (event as { payload?: unknown }).payload ?? "unknown error";
      finishReject(payload);
    });

    // In some environments the creation event can race quickly, so this avoids a dead wait.
    window.setTimeout(() => {
      finishResolve();
    }, 900);
  });

  try {
    await creationReady;
  } catch (error) {
    reportDockRuntimeError(
      `Floating dock window failed to initialize: ${asErrorMessage(error)}`,
    );
    throw error;
  }

  try {
    await created.onMoved(({ payload }) => {
      updateAndPersistDockLayout(payload.x, payload.y);
    });
  } catch {
    // Keep dock usable even if move/resize listeners are unavailable.
  }

  voiceIndicatorWindow = created;
  return created;
}

function reportDockRuntimeError(message: string): void {
  if (!dockRuntimeErrorShown) {
    setNotice(message, true);
    dockRuntimeErrorShown = true;
  }
  console.error(message);
}

async function showVoiceIndicatorWindow(): Promise<void> {
  if (dockHideTimerId !== null) {
    window.clearTimeout(dockHideTimerId);
    dockHideTimerId = null;
  }

  try {
    const win = await ensureVoiceIndicatorWindow();
    await win.show();
    dockRuntimeErrorShown = false;
    publishDockState();
  } catch (error) {
    reportDockRuntimeError(`Unable to show floating dock: ${asErrorMessage(error)}`);
  }
}

async function hideVoiceIndicatorWindow(): Promise<void> {
  if (dockHideTimerId !== null) {
    window.clearTimeout(dockHideTimerId);
    dockHideTimerId = null;
  }

  if (!voiceIndicatorWindow) {
    return;
  }

  try {
    await persistDockPositionFromWindow(voiceIndicatorWindow);
    await voiceIndicatorWindow.hide();
  } catch (error) {
    reportDockRuntimeError(`Unable to hide floating dock: ${asErrorMessage(error)}`);
  }
}

async function syncFloatingIndicatorWindow(): Promise<void> {
  publishDockState();
  const shouldShow = shouldDisplayDock();

  if (shouldShow) {
    await showVoiceIndicatorWindow();
    return;
  }

  if (dockHideTimerId !== null) {
    return;
  }

  dockHideTimerId = window.setTimeout(() => {
    dockHideTimerId = null;
    void hideVoiceIndicatorWindow();
  }, 220);
}

function syncActionAvailability(): void {
  const busy = pipelineRunning || stage === "recording" || ttsSetupRunning;
  refreshMicsBtn.disabled = busy;
  setupRuntimeBtn.disabled = busy;
  validatePiperBtn.disabled = busy;
  downloadVoiceBtn.disabled = busy;
  setupCoquiBtn.disabled = busy;
  validateCoquiBtn.disabled = busy;
  refreshCoquiVoicesBtn.disabled = busy;
  refreshCoquiModelsBtn.disabled = busy;
  cloneCoquiVoiceBtn.disabled = busy;
  testCoquiVoiceBtn.disabled = busy;
  setupAllTtsBtn.disabled = busy;
  ttsProfilePiperTab.disabled = busy;
  ttsProfileCoquiTab.disabled = busy;
  clearHistoryBtn.disabled = busy;
  fetchProviderModelsBtn.disabled = busy;
  applyModelToAiBtn.disabled = busy;
  applyModelToSttBtn.disabled = busy;
  microphoneSelect.disabled = busy;
  dictationLanguageSelect.disabled = busy;
  styleProfileSelect.disabled = busy;
  apiBaseUrlInput.disabled = busy;
  sttModelInput.disabled = busy;
  aiModelInput.disabled = busy;
  providerModelCatalogSelect.disabled = busy;
  ttsEngineSelect.disabled = busy;
  piperPathInput.disabled = busy;
  piperQualitySelect.disabled = busy;
  piperEmotionSelect.disabled = busy;
  piperSpeedInput.disabled = busy;
  coquiPythonPathInput.disabled = busy;
  coquiModelInput.disabled = busy;
  coquiLanguageInput.disabled = busy;
  coquiVoiceIdInput.disabled = busy;
  coquiVoiceSelect.disabled = busy;
  coquiModelCatalogSelect.disabled = busy;
  coquiQualitySelect.disabled = busy;
  coquiEmotionSelect.disabled = busy;
  coquiSpeedInput.disabled = busy;
  coquiUseGpuToggle.disabled = busy;
  coquiSplitSentencesToggle.disabled = busy;
  coquiVoiceFileInput.disabled = busy;
  hotkeyInput.disabled = busy;
  commandHotkeyInput.disabled = busy;
  captureModeSingleInput.disabled = busy;
  captureModePushToTalkInput.disabled = busy;
  commandModeToggle.disabled = busy;
  wakeWordEnabledToggle.disabled = busy;
  assistantNameInput.disabled = busy;
  autoPasteDictationToggle.disabled = busy;
  contextAwarenessToggle.disabled = busy;
  copyToClipboardToggle.disabled = busy;
  incognitoModeToggle.disabled = busy;
  themeModeSelect.disabled = busy;
  backtrackToggle.disabled = busy;
  removeFillersToggle.disabled = busy;
  autoPunctuationToggle.disabled = busy;
  numberedListsToggle.disabled = busy;
  toggleMicEditorBtn.disabled = busy;
  toggleHotkeyEditorBtn.disabled = busy;
  dictionaryAddBtn.disabled = busy;
  dictionaryAddBtnTop.disabled = busy;
  snippetAddBtn.disabled = busy;
  snippetsAddBtnTop.disabled = busy;

  const piperSelected = settings.ttsEngine === "piper";
  const coquiSelected = settings.ttsEngine === "coqui";
  setupRuntimeBtn.disabled = setupRuntimeBtn.disabled || !piperSelected;
  validatePiperBtn.disabled = validatePiperBtn.disabled || !piperSelected;
  downloadVoiceBtn.disabled = downloadVoiceBtn.disabled || !piperSelected;
  piperPathInput.disabled = piperPathInput.disabled || !piperSelected;
  piperQualitySelect.disabled = piperQualitySelect.disabled || !piperSelected;
  piperEmotionSelect.disabled = piperEmotionSelect.disabled || !piperSelected;
  piperSpeedInput.disabled = piperSpeedInput.disabled || !piperSelected;

  setupCoquiBtn.disabled = setupCoquiBtn.disabled || !coquiSelected;
  validateCoquiBtn.disabled = validateCoquiBtn.disabled || !coquiSelected;
  refreshCoquiVoicesBtn.disabled = refreshCoquiVoicesBtn.disabled || !coquiSelected;
  refreshCoquiModelsBtn.disabled = refreshCoquiModelsBtn.disabled || !coquiSelected;
  cloneCoquiVoiceBtn.disabled = cloneCoquiVoiceBtn.disabled || !coquiSelected;
  testCoquiVoiceBtn.disabled = testCoquiVoiceBtn.disabled || !coquiSelected;
  coquiPythonPathInput.disabled = coquiPythonPathInput.disabled || !coquiSelected;
  coquiModelInput.disabled = coquiModelInput.disabled || !coquiSelected;
  coquiLanguageInput.disabled = coquiLanguageInput.disabled || !coquiSelected;
  coquiVoiceIdInput.disabled = coquiVoiceIdInput.disabled || !coquiSelected;
  coquiVoiceSelect.disabled = coquiVoiceSelect.disabled || !coquiSelected;
  coquiModelCatalogSelect.disabled = coquiModelCatalogSelect.disabled || !coquiSelected;
  coquiQualitySelect.disabled = coquiQualitySelect.disabled || !coquiSelected;
  coquiEmotionSelect.disabled = coquiEmotionSelect.disabled || !coquiSelected;
  coquiSpeedInput.disabled = coquiSpeedInput.disabled || !coquiSelected;
  coquiUseGpuToggle.disabled = coquiUseGpuToggle.disabled || !coquiSelected;
  coquiSplitSentencesToggle.disabled = coquiSplitSentencesToggle.disabled || !coquiSelected;
  coquiVoiceFileInput.disabled = coquiVoiceFileInput.disabled || !coquiSelected;
}

async function engagePushToTalk(source: HoldSource): Promise<void> {
  if (settings.captureMode !== "push-to-talk") {
    return;
  }

  if (pushToTalkHoldSources.has(source)) {
    return;
  }

  if (await shouldBlockAssistantInputFromForegroundApp()) {
    return;
  }

  pushToTalkHoldSources.add(source);

  interruptTtsPlaybackForCaptureIntent();

  if (pipelineRunning || stage === "recording") {
    return;
  }

  await startRecording();

  if (mediaRecorder?.state !== "recording") {
    pushToTalkHoldSources.delete(source);
  }
}

function releasePushToTalk(source: HoldSource): void {
  if (!pushToTalkHoldSources.delete(source)) {
    return;
  }

  if (settings.captureMode !== "push-to-talk") {
    return;
  }

  if (stage === "recording" && pushToTalkHoldSources.size === 0) {
    stopRecording();
  }
}

function clearPushToTalkHolds(): void {
  pushToTalkHoldSources.clear();
}

function bindPushToTalkPointerHold(button: HTMLButtonElement, source: HoldSource): void {
  button.addEventListener("pointerdown", (event) => {
    if (settings.captureMode !== "push-to-talk") {
      return;
    }
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    void engagePushToTalk(source);
  });

  const release = (event: PointerEvent): void => {
    if (event.type === "pointerup" && event.button !== 0) {
      return;
    }

    if (button.hasPointerCapture(event.pointerId)) {
      button.releasePointerCapture(event.pointerId);
    }
    releasePushToTalk(source);
  };

  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("lostpointercapture", () => {
    releasePushToTalk(source);
  });
}

function isHotkeyReleaseEvent(event: KeyboardEvent, hotkey: HotkeySpec): boolean {
  const key = normalizeEventKey(event.key);
  if (key === hotkey.key) return true;
  if (hotkey.ctrl && key === "control") return true;
  if (hotkey.shift && key === "shift") return true;
  if (hotkey.alt && key === "alt") return true;
  if (hotkey.meta && key === "meta") return true;
  return false;
}

function startAmplitudeMonitoring(stream: MediaStream): void {
  stopAmplitudeMonitoring(false);

  const AudioCtor = window.AudioContext;
  if (!AudioCtor) {
    return;
  }

  if (!audioContext) {
    audioContext = new AudioCtor();
  }

  if (audioContext.state === "suspended") {
    void audioContext.resume().catch(() => {
      // Ignore resume failures to keep dictation flow resilient.
    });
  }

  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 1024;
  analyserNode.smoothingTimeConstant = 0.75;
  amplitudeSourceNode = audioContext.createMediaStreamSource(stream);
  amplitudeSourceNode.connect(analyserNode);
  amplitudeBuffer = new Float32Array(analyserNode.fftSize) as Float32Array<ArrayBuffer>;
  dockAmplitude = 0;
  lastDockAmplitudePublishAt = 0;
  publishDockState();

  const tick = (now: number): void => {
    if (!analyserNode || !amplitudeBuffer) {
      return;
    }

    analyserNode.getFloatTimeDomainData(amplitudeBuffer);

    let sumSquares = 0;
    for (let index = 0; index < amplitudeBuffer.length; index += 1) {
      const sample = amplitudeBuffer[index] ?? 0;
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / amplitudeBuffer.length);
    const normalized = Math.min(1, Math.max(0, (rms - 0.008) * 11.5));
    dockAmplitude = dockAmplitude * 0.72 + normalized * 0.28;

    if (now - lastDockAmplitudePublishAt >= 16) {
      publishDockState();
      lastDockAmplitudePublishAt = now;
    }

    amplitudeFrameId = window.requestAnimationFrame(tick);
  };

  amplitudeFrameId = window.requestAnimationFrame(tick);
}

function stopAmplitudeMonitoring(resetLevel = true): void {
  if (amplitudeFrameId !== null) {
    window.cancelAnimationFrame(amplitudeFrameId);
    amplitudeFrameId = null;
  }

  if (amplitudeSourceNode) {
    try {
      amplitudeSourceNode.disconnect();
    } catch {
      // Ignore disconnect failures.
    }
    amplitudeSourceNode = null;
  }

  if (analyserNode) {
    try {
      analyserNode.disconnect();
    } catch {
      // Ignore disconnect failures.
    }
    analyserNode = null;
  }

  amplitudeBuffer = null;

  if (resetLevel && dockAmplitude !== 0) {
    dockAmplitude = 0;
    publishDockState();
  }
}

function beginRecordingTicker(): void {
  stopRecordingTicker();
  recordTimer.textContent = "00.0s";

  recordingTickerId = window.setInterval(() => {
    const elapsedMs = Date.now() - recordingStartedAt;
    recordTimer.textContent = formatTimer(elapsedMs);

    if (settings.captureMode !== "push-to-talk" && elapsedMs >= MAX_RECORDING_MS) {
      setNotice("Recording auto-stopped at 45 seconds.");
      stopRecording();
    }
  }, 100);
}

function stopRecordingTicker(): void {
  if (recordingTickerId !== null) {
    window.clearInterval(recordingTickerId);
    recordingTickerId = null;
  }
}

function releaseMicrophone(): void {
  stopAmplitudeMonitoring();
  if (!mediaStream) return;
  for (const track of mediaStream.getTracks()) {
    track.stop();
  }
  mediaStream = null;
}

function formatTimer(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000);
  const tenths = Math.floor((elapsedMs % 1000) / 100);
  return `${String(seconds).padStart(2, "0")}.${tenths}s`;
}

function formatLatency(value: number): string {
  return `${Math.round(value)} ms`;
}

function formatHotkeyForDisplay(hotkey: string): string {
  return hotkey
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" + ");
}

function pickBestRecorderMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];

  for (const mimeType of candidates) {
    if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
  }

  return "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onerror = () => reject(new Error("Failed to convert audio blob to base64"));

    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected FileReader output"));
        return;
      }

      const markerIndex = result.indexOf(",");
      if (markerIndex < 0) {
        reject(new Error("Unexpected base64 data URL format"));
        return;
      }

      resolve(result.slice(markerIndex + 1));
    };

    reader.readAsDataURL(blob);
  });
}

function parseHotkey(raw: string): HotkeySpec | null {
  const source = raw.trim();
  if (!source) return null;

  const tokens = source
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0) return null;

  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  let key = "";

  for (const token of tokens) {
    if (token === "ctrl" || token === "control") {
      ctrl = true;
      continue;
    }
    if (token === "shift") {
      shift = true;
      continue;
    }
    if (token === "alt" || token === "option") {
      alt = true;
      continue;
    }
    if (token === "meta" || token === "cmd" || token === "command" || token === "win") {
      meta = true;
      continue;
    }

    if (key) return null;

    key = normalizeHotkeyKeyToken(token);
    if (!key) return null;
  }

  if (!key) return null;

  const modifierCount = Number(ctrl) + Number(shift) + Number(alt) + Number(meta);
  const comboSize = modifierCount + 1;
  if (comboSize < 2 || comboSize > 3) {
    return null;
  }

  const parts: string[] = [];
  if (ctrl) parts.push("Ctrl");
  if (shift) parts.push("Shift");
  if (alt) parts.push("Alt");
  if (meta) parts.push("Meta");
  parts.push(displayHotkeyKey(key));

  return {
    ctrl,
    shift,
    alt,
    meta,
    key,
    label: parts.join("+"),
  };
}

function normalizeHotkeyKeyToken(token: string): string {
  if (token.length === 1 && /[a-z0-9]/.test(token)) return token;
  if (/^f([1-9]|1[0-2])$/.test(token)) return token;

  const map: Record<string, string> = {
    space: "space",
    spacebar: "space",
    enter: "enter",
    return: "enter",
    tab: "tab",
    esc: "escape",
    escape: "escape",
    backspace: "backspace",
  };

  return map[token] ?? "";
}

function displayHotkeyKey(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  if (key === "space") return "Space";
  if (key.startsWith("f")) return key.toUpperCase();
  if (key === "escape") return "Esc";
  return key.slice(0, 1).toUpperCase() + key.slice(1);
}

function matchesHotkey(event: KeyboardEvent, hotkey: HotkeySpec): boolean {
  return (
    event.ctrlKey === hotkey.ctrl &&
    event.shiftKey === hotkey.shift &&
    event.altKey === hotkey.alt &&
    event.metaKey === hotkey.meta &&
    normalizeEventKey(event.key) === hotkey.key
  );
}

function normalizeEventKey(value: string): string {
  const lower = value.toLowerCase();
  if (lower === " ") return "space";
  if (lower === "spacebar") return "space";
  if (lower === "return") return "enter";
  if (lower === "esc") return "escape";
  if (lower === "control" || lower === "ctrl") return "control";
  if (lower === "altgraph") return "alt";
  if (lower === "os" || lower === "command" || lower === "win") return "meta";
  return lower;
}

function isTypingElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function coerceNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < min) return min;
  if (numeric > max) return max;
  return numeric;
}

function coerceInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(coerceNumber(value, fallback, min, max));
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function refreshAssistantInfoSafely(): Promise<void> {
  try {
    await refreshAssistantInfo();
  } catch (error) {
    setNotice(`Unable to refresh runtime status: ${asErrorMessage(error)}`, true);
  }
}

async function refreshCoquiStatusSafely(): Promise<void> {
  try {
    await refreshCoquiStatus();
  } catch (error) {
    setNotice(`Unable to refresh Coqui status: ${asErrorMessage(error)}`, true);
  }
}

void bootstrap();
