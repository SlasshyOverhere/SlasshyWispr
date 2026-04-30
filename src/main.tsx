
import "./style.css";
import "./settings.css";
import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  LogicalSize,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  type Monitor,
} from "@tauri-apps/api/window";
import {
  register as registerGlobalShortcut,
  unregisterAll as unregisterAllGlobalShortcuts,
  type ShortcutEvent,
} from "@tauri-apps/plugin-global-shortcut";
import {
  buildAgentOperatingCorePrompt,
  captureModeLabel,
} from "./utils";

import {
  SELECTION_POPUP_WIDTH,
  SELECTION_POPUP_MIN_WIDTH,
  SELECTION_POPUP_MIN_HEIGHT,
  SELECTION_POPUP_MAX_HEIGHT,
  SELECTION_POPUP_CHARS_PER_LINE,
  SETTINGS_STORAGE_KEY,
  LEGACY_SETTINGS_STORAGE_KEY,
  DICTIONARY_STORAGE_KEY,
  SNIPPETS_STORAGE_KEY,
  NOTES_STORAGE_KEY,
  USAGE_STORAGE_KEY,
  DOCK_LAYOUT_STORAGE_KEY,
  HOME_HISTORY_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  LOCAL_STT_HARDWARE_ADVISOR_STORAGE_KEY,
  EMPTY_HISTORY_HINT,
  LEGACY_DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_API_BASE_URL,
  DEFAULT_STT_MODEL_NAME,
  DEFAULT_AI_MODEL_NAME,
  DEFAULT_RUNTIME_MODE,
  DEFAULT_LOCAL_OLLAMA_BASE_URL,
  DEFAULT_HOTKEY,
  DEFAULT_COMMAND_HOTKEY,
  DEFAULT_CAPTURE_MODE,
  DEFAULT_STYLE_PROFILE,
  DEFAULT_TTS_ENGINE,
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_PIPER_SPEED,
  DEFAULT_PIPER_QUALITY,
  DEFAULT_PIPER_EMOTION,
  DEFAULT_COQUI_MODEL,
  DEFAULT_COQUI_LANGUAGE,
  DEFAULT_COQUI_SPEED,
  DEFAULT_COQUI_QUALITY,
  DEFAULT_COQUI_EMOTION,
  ZERO_PYTHON_MODE,
  ZERO_PYTHON_TTS_NOTICE,
  DEFAULT_DICTATION_LANGUAGE_MODE,
  DICTATION_LANGUAGE_LABELS,
  LOCAL_STT_MODEL_SIZE_LABELS,
  MAX_COQUI_REFERENCE_SECONDS,
  MAX_RECORDING_MS,
  ACCIDENTAL_PTT_HOTKEY_MAX_HOLD_MS,
  MAX_HISTORY_ITEMS,
  FOREGROUND_BLOCK_CHECK_CACHE_MS,
  BLOCKED_INPUT_NOTICE_COOLDOWN_MS,
} from "./constants";

import type {
  Stage,
  ThemeMode,
  StyleProfile,
  MainPage,
  SettingsPane,
  TtsEngine,
  RuntimeMode,
  DictationLanguageMode,
  PiperQuality,
  PiperEmotion,
  CoquiQuality,
  CoquiEmotion,
  TtsProfilePane,
  HoldSource,
  TeamScope,
  LocalSttHardwareAdvisorChoice,
  AssistantInfoResponse,
  RuntimeSetupResponse,
  VoiceInstallResponse,
  PiperValidationResponse,
  CoquiStatusResponse,
  CoquiSetupResponse,
  CoquiValidationResponse,
  CoquiVoicesResponse,
  CoquiModelsResponse,
  ProviderModelsResponse,
  OllamaPullResponse,
  OllamaStatusResponse,
  LocalSttDownloadResponse,
  LocalSttDeleteResponse,
  LocalSttOpenPathResponse,
  LocalSttWarmupResponse,
  LocalSttDeactivateResponse,
  LocalSttRuntimeStateResponse,
  LocalSttHardwareAdviceResponse,
  LocalSttDownloadStatusResponse,
  CoquiVoiceCloneResponse,
  CoquiVoicePreviewResponse,
  TtsSetupStatusResponse,
  AssistantPipelineResponse,
  AppUpdateCheckResponse,
  InstallAppUpdateRequest,
  PersistedSettings,
  HotkeySpec,
  DictionaryTerm,
  SnippetEntry,
  QuickNoteEntry,
  UsageStats,
  DockLayout,
  ForegroundInputBlockStatus,
  HomeHistoryEntry,
  DockPlacementBounds,
  ActiveTtsPlayback,
  SelectionPopupPayload,
} from "./types";

type StopRecordingOptions = {
  cancelPipeline?: boolean;
  cancelNotice?: string;
  cancelStatus?: string;
};


const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) {
  throw new Error("Missing #app root element");
}

document.body.classList.add("shadcn-ui");
document.body.classList.add("mono-ui");
document.body.classList.add("overhaul-v3");

import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App } from './App';

flushSync(() => {
  createRoot(appRoot).render(<App />);
});


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
  const sidebarActionLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
  toggleSidebarBtn.setAttribute("aria-label", sidebarActionLabel);
  toggleSidebarBtn.dataset.label = sidebarActionLabel;
  syncSidebarHoverTitles(collapsed);
}

const settingsOverlay = requiredElement<HTMLDivElement>("#settingsOverlay");
const toggleSidebarBtn = requiredElement<HTMLButtonElement>("#toggleSidebarBtn");
const openSettingsBtn = requiredElement<HTMLButtonElement>("#openSettingsBtn");
const sidebarToggleLocalSttBtn = requiredElement<HTMLButtonElement>("#sidebarToggleLocalSttBtn");
const sidebarToggleLocalSttGlyph = requiredElement<HTMLSpanElement>("#sidebarToggleLocalSttGlyph");
const sidebarToggleLocalSttLabel = requiredElement<HTMLSpanElement>("#sidebarToggleLocalSttLabel");
const sttLoadOverlay = requiredElement<HTMLDivElement>("#sttLoadOverlay");
const sttLoadModel = requiredElement<HTMLParagraphElement>("#sttLoadModel");
const sttLoadDetail = requiredElement<HTMLParagraphElement>("#sttLoadDetail");
const sttHardwareAdvisorOverlay = requiredElement<HTMLDivElement>("#sttHardwareAdvisorOverlay");
const sttHardwareAdvisorHardware = requiredElement<HTMLParagraphElement>("#sttHardwareAdvisorHardware");
const sttHardwareAdvisorSuggestion = requiredElement<HTMLParagraphElement>("#sttHardwareAdvisorSuggestion");
const sttHardwareAdvisorWarning = requiredElement<HTMLParagraphElement>("#sttHardwareAdvisorWarning");
const sttHardwareAdvisorList = requiredElement<HTMLParagraphElement>("#sttHardwareAdvisorList");
const sttHardwareAdvisorUseSuggestionBtn = requiredElement<HTMLButtonElement>(
  "#sttHardwareAdvisorUseSuggestionBtn",
);
const sttHardwareAdvisorContinueBtn = requiredElement<HTMLButtonElement>(
  "#sttHardwareAdvisorContinueBtn",
);
const sttHardwareAdvisorCancelBtn = requiredElement<HTMLButtonElement>("#sttHardwareAdvisorCancelBtn");
const closeSettingsBtn = requiredElement<HTMLButtonElement>("#closeSettingsBtn");
const settingsPaneTitle = requiredElement<HTMLElement>("#settingsPaneTitle");
const ttsBootstrapCard = requiredElement<HTMLDivElement>("#ttsBootstrapCard");
const ttsProfilesArea = requiredElement<HTMLDivElement>("#ttsProfilesArea");
const ttsSetupStatus = requiredElement<HTMLParagraphElement>("#ttsSetupStatus");
const ttsSetupLogs = requiredElement<HTMLDivElement>("#ttsSetupLogs");
const setupAllTtsBtn = requiredElement<HTMLButtonElement>("#setupAllTtsBtn");
const ttsProfilePiperTab = requiredElement<HTMLButtonElement>("#ttsProfilePiperTab");
const ttsProfileCoquiTab = requiredElement<HTMLButtonElement>("#ttsProfileCoquiTab");
const ttsProfilePiperPanel = requiredElement<HTMLDivElement>("#ttsProfilePiperPanel");
const ttsProfileCoquiPanel = requiredElement<HTMLDivElement>("#ttsProfileCoquiPanel");
const appTitlebarDrag = requiredElement<HTMLDivElement>("#appTitlebarDrag");
const windowMinimizeBtn = requiredElement<HTMLButtonElement>("#windowMinimizeBtn");
const windowMaximizeBtn = requiredElement<HTMLButtonElement>("#windowMaximizeBtn");
const windowMaximizeGlyph = requiredElement<HTMLElement>("#windowMaximizeGlyph");
const windowCloseBtn = requiredElement<HTMLButtonElement>("#windowCloseBtn");

const pageNavButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-page-nav]"));
const pagePanels = Array.from(document.querySelectorAll<HTMLElement>("[data-page]"));
const settingsNavButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-settings-pane-nav]"),
);
const settingsPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-settings-pane]"));
const sidebarLabeledButtons = Array.from(
  document.querySelectorAll<HTMLElement>(".flow-sidebar [data-label]"),
);

const statusPill = requiredElement<HTMLDivElement>("#statusPill");
const statusDetail = requiredElement<HTMLParagraphElement>("#statusDetail");
const hotkeyHint = requiredElement<HTMLElement>("#hotkeyHint");
const captureModeHint = requiredElement<HTMLElement>("#captureModeHint");
const noticeText = requiredElement<HTMLParagraphElement>("#noticeText");
const activityDate = requiredElement<HTMLElement>("#activityDate");
const metricWords = requiredElement<HTMLElement>("#metricWords");
const metricSpeakingTime = requiredElement<HTMLElement>("#metricSpeakingTime");
const metricSessions = requiredElement<HTMLElement>("#metricSessions");
const metricWpm = requiredElement<HTMLElement>("#metricWpm");

function syncSidebarHoverTitles(collapsed: boolean): void {
  for (const target of sidebarLabeledButtons) {
    const label = target.dataset.label?.trim();
    if (!label) {
      continue;
    }

    if (collapsed) {
      target.setAttribute("title", label);
      continue;
    }

    target.removeAttribute("title");
  }
}

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
const settingsVersionText = requiredElement<HTMLParagraphElement>("#settingsVersionText");

const apiKeyInput = requiredElement<HTMLInputElement>("#apiKeyInput");
const apiBaseUrlInput = requiredElement<HTMLInputElement>("#apiBaseUrlInput");
const sttModelInput = requiredElement<HTMLInputElement>("#sttModelInput");
const aiModelInput = requiredElement<HTMLInputElement>("#aiModelInput");
const onlineProviderSection = requiredElement<HTMLDivElement>("#onlineProviderSection");
const onlineProviderModeNotice = requiredElement<HTMLParagraphElement>("#onlineProviderModeNotice");
const onlineSttModelField = requiredElement<HTMLElement>('[data-online-field="stt-model"]');
const onlineAiModelField = requiredElement<HTMLElement>('[data-online-field="ai-model"]');
const providerModelCatalogSelect = requiredElement<HTMLSelectElement>("#providerModelCatalogSelect");
const localOllamaBaseUrlInput = requiredElement<HTMLInputElement>("#localOllamaBaseUrlInput");
const localOllamaModelInput = requiredElement<HTMLInputElement>("#localOllamaModelInput");
const offlineOllamaSection = requiredElement<HTMLDivElement>("#offlineOllamaSection");
const offlineSttSection = requiredElement<HTMLDivElement>("#offlineSttSection");
const offlineRuntimeModeNotice = requiredElement<HTMLParagraphElement>("#offlineRuntimeModeNotice");
const localOllamaModelCatalogSelect = requiredElement<HTMLSelectElement>(
  "#localOllamaModelCatalogSelect",
);
const localSttModelInput = requiredElement<HTMLInputElement>("#localSttModelInput");
const localSttModelCatalogSelect = requiredElement<HTMLSelectElement>("#localSttModelCatalogSelect");
const rememberApiKeyInput = requiredElement<HTMLInputElement>("#rememberApiKeyInput");
const captureModeSingleInput = requiredElement<HTMLInputElement>("#captureModeSingle");
const captureModePushToTalkInput = requiredElement<HTMLInputElement>("#captureModePushToTalk");
const microphoneSelect = requiredElement<HTMLSelectElement>("#microphoneSelect");
const microphoneSummary = requiredElement<HTMLElement>("#microphoneSummary");
const hotkeyInput = requiredElement<HTMLInputElement>("#hotkeyInput");
const commandHotkeyInput = requiredElement<HTMLInputElement>("#commandHotkeyInput");
const dictationLanguageSelect = requiredElement<HTMLSelectElement>("#dictationLanguageSelect");
const dictationLanguageModeSingleInput = requiredElement<HTMLInputElement>(
  "#dictationLanguageModeSingle",
);
const dictationLanguageModeMultipleInput = requiredElement<HTMLInputElement>(
  "#dictationLanguageModeMultiple",
);
const dictationLanguageSummary = requiredElement<HTMLParagraphElement>("#dictationLanguageSummary");
const dictationLanguageMultiWrap = requiredElement<HTMLDivElement>("#dictationLanguageMultiWrap");
const dictationLanguageOptionInputs = Array.from(
  document.querySelectorAll<HTMLInputElement>("[data-dictation-lang-option]"),
);
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
const sttRuntimeModeOnlineInput = requiredElement<HTMLInputElement>("#sttRuntimeModeOnline");
const sttRuntimeModeOfflineInput = requiredElement<HTMLInputElement>("#sttRuntimeModeOffline");
const aiRuntimeModeOnlineInput = requiredElement<HTMLInputElement>("#aiRuntimeModeOnline");
const aiRuntimeModeOfflineInput = requiredElement<HTMLInputElement>("#aiRuntimeModeOffline");
const runtimeModeNotice = requiredElement<HTMLParagraphElement>("#runtimeModeNotice");
const ollamaStatusNotice = requiredElement<HTMLParagraphElement>("#ollamaStatusNotice");
const localSttDownloadNotice = requiredElement<HTMLParagraphElement>("#localSttDownloadNotice");
const localSttDownloadProgressBar = requiredElement<HTMLSpanElement>("#localSttDownloadProgressBar");
const localSttDownloadProgressText = requiredElement<HTMLParagraphElement>("#localSttDownloadProgressText");
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
const updateStatusPill = requiredElement<HTMLDivElement>("#updateStatusPill");
const updateStatusText = requiredElement<HTMLParagraphElement>("#updateStatusText");
const updateCurrentVersion = requiredElement<HTMLElement>("#updateCurrentVersion");
const updateLatestVersion = requiredElement<HTMLElement>("#updateLatestVersion");
const updatePublishedAt = requiredElement<HTMLElement>("#updatePublishedAt");
const checkUpdatesBtn = requiredElement<HTMLButtonElement>("#checkUpdatesBtn");
const installUpdateBtn = requiredElement<HTMLButtonElement>("#installUpdateBtn");

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
const checkOllamaStatusBtn = requiredElement<HTMLButtonElement>("#checkOllamaStatusBtn");
const installOllamaBtn = requiredElement<HTMLButtonElement>("#installOllamaBtn");
const fetchOllamaModelsBtn = requiredElement<HTMLButtonElement>("#fetchOllamaModelsBtn");
const useOllamaModelBtn = requiredElement<HTMLButtonElement>("#useOllamaModelBtn");
const pullOllamaModelBtn = requiredElement<HTMLButtonElement>("#pullOllamaModelBtn");
const downloadLocalSttModelBtn = requiredElement<HTMLButtonElement>("#downloadLocalSttModelBtn");
const deleteLocalSttModelBtn = requiredElement<HTMLButtonElement>("#deleteLocalSttModelBtn");
const openLocalSttModelPathBtn = requiredElement<HTMLButtonElement>("#openLocalSttModelPathBtn");
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
const clearHistoryBtnFull = requiredElement<HTMLButtonElement>("#clearHistoryBtnFull");
const viewFullHistoryBtn = requiredElement<HTMLButtonElement>("#viewFullHistoryBtn");
const clearStatsBtn = requiredElement<HTMLButtonElement>("#clearStatsBtn");
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
const fullHistoryLog = requiredElement<HTMLDivElement>("#fullHistoryLog");
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
let skipPipelineAfterRecorderStop = false;
let skipPipelineAfterRecorderStopNotice = "";
let skipPipelineAfterRecorderStopStatus = "";
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
const pushToTalkHoldStartedAt = new Map<HoldSource, number>();
let activeTtsPlayback: ActiveTtsPlayback | null = null;
let voiceIndicatorWindow: WebviewWindow | null = null;
let selectionAssistantWindow: WebviewWindow | null = null;
let latestSelectionPopupPayload: SelectionPopupPayload | null = null;
let selectionPopupTokenCounter = 0;
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
let lastGlobalShortcutToken = "";
let lastGlobalShortcutState: "pressed" | "released" | "" = "";
let lastGlobalShortcutHandledAt = 0;
let shortcutSyncInFlight: Promise<void> | null = null;
let shortcutSyncQueued = false;
let dockRuntimeErrorShown = false;
let coquiModelCatalog: string[] = [];
let providerModelCatalog: string[] = [];
let localOllamaModelCatalog: string[] = [];
let localSttModelCatalog: string[] = [];
let latestAssistantInfoDefaults: AssistantInfoResponse | null = null;
let piperRuntimeReady = false;
let coquiRuntimeInstalled = false;
let coquiCloneInProgress = false;
let ollamaStatusInFlight = false;
let ollamaInstallInFlight = false;
let ollamaPullInFlight = false;
let localSttDownloadInFlight = false;
let localSttDeleteInFlight = false;
let localSttDeactivateInFlight = false;
let localSttDownloadActive = false;
let localSttDownloadStatusPollingId: number | null = null;
let localSttDownloadStatusPollInFlight = false;
let localSttWarmupInFlight = false;
let lastWarmedLocalSttModel = "";
let localSttRuntimeLoaded = false;
let localSttRuntimeStateInFlight = false;
let runtimeModeSyncInFlight = false;
let pendingRuntimeModeSyncTarget: RuntimeMode | null = null;
let pendingRuntimeModeSyncShowLoadOverlay = false;
let localSttLoadOverlayTickerId: number | null = null;
let localSttLoadOverlayStartedAt = 0;
let localSttHardwareAdvisorOpen = false;
let localSttHardwareAdvisorSelectedModel = "";
let localSttHardwareAdvisorSuggestionModel = "";
let localSttHardwareAdvisorResolver: ((choice: LocalSttHardwareAdvisorChoice) => void) | null = null;
let ttsSetupPollingId: number | null = null;
let ttsSetupRunning = false;
let ttsSetupPollInFlight = false;
let effectAudioContext: AudioContext | null = null;
let externalMediaMutedForDictation = false;
let externalMediaControlInFlight: Promise<void> | null = null;
let externalMediaControlErrorShown = false;
let launchAtLoginSyncNonce = 0;
let updateCheckInFlight = false;
let cachedUpdateResult: AppUpdateCheckResponse | null = null;
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
let persistSettingsTimer: number | null = null;
let pendingSettingsToPersist: PersistedSettings | null = null;
let lastPersistDiagnosticsSignature = "";
let notificationPermissionRequested = false;
const dockChannel = new BroadcastChannel("slasshywispr-dock");
const selectionPopupChannel = new BroadcastChannel("slasshywispr-selection-popup");
const ENABLE_FOREGROUND_SHORTCUT_SUPPRESSION = false;

const ACTIVITY_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});

const UPDATE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const CONVERSATION_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

const NOTE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const systemThemeMediaQuery =
  typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;
enforceZeroPythonUi();

let settings = loadSettings();
if (ZERO_PYTHON_MODE && settings.ttsEngine === "coqui") {
  settings.ttsEngine = "piper";
}
settings.pushToTalkHotkey = settings.pushToTalkHotkey.trim() || DEFAULT_HOTKEY;
settings.commandHotkey = settings.commandHotkey.trim() || DEFAULT_COMMAND_HOTKEY;
let cachedHotkeyDisplay = formatHotkeyForDisplay(settings.pushToTalkHotkey);
applySettingsToForm(settings);
renderSidebarLocalSttToggle();
renderCoquiModelCatalog([], settings.coquiModelName);
renderProviderModelCatalog([], settings.aiModelName || settings.sttModelName);
renderLocalOllamaModelCatalog([], settings.localOllamaModel);
renderLocalSttModelCatalog([], settings.localSttModel);
renderCoquiVoiceOptions([], settings.coquiVoiceId);
setActiveTtsProfile("piper");
updateTtsSetupGate();
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
    } else {
      selectionPopupChannel.postMessage({
        kind: "clear",
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
initializeUpdaterPanel();
setupCustomWindowControls();
hotkeyInput.readOnly = true;
commandHotkeyInput.readOnly = true;
requestLaunchAtLoginSync(settings.launchAtLogin);
startBlockedAppShortcutSuppressionMonitor();
applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1");
activityDate.textContent = ACTIVITY_DATE_FORMATTER.format(Date.now());

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
  if (ZERO_PYTHON_MODE) {
    setNotice(ZERO_PYTHON_TTS_NOTICE, true);
    return;
  }
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

openSettingsBtn.addEventListener("click", () => {
  openSettings("user-click-settings-button");
  setActiveSettingsPane("general", "user-click-settings-button");
});

sidebarToggleLocalSttBtn.addEventListener("click", () => {
  void (async () => {
    const activeSettings = readSettingsFromForm();
    if (activeSettings.sttRuntimeMode !== "local") {
      await syncLocalSttRuntimeForMode("online");
      const onlineSttModel = activeSettings.sttModelName.trim() || "the configured online STT model";
      setNotice(
        `STT runtime is Online. Using ${onlineSttModel}. Switch STT to Offline in Settings > Models to load a local STT model.`,
      );
      return;
    }

    await refreshLocalSttRuntimeState({ quiet: true });
    if (isSelectedLocalSttModelLoaded()) {
      await deactivateLocalSttModel();
    } else {
      await activateSelectedLocalSttModel();
    }
    await refreshLocalSttRuntimeState({ quiet: true });
  })();
});

checkUpdatesBtn.addEventListener("click", () => {
  void handleCheckForUpdates();
});

installUpdateBtn.addEventListener("click", () => {
  void handleInstallUpdate();
});

closeSettingsBtn.addEventListener("click", () => {
  closeSettings();
});

settingsOverlay.addEventListener("click", (event) => {
  if (event.target === settingsOverlay) {
    closeSettings();
  }
});

sttHardwareAdvisorOverlay.addEventListener("click", (event) => {
  if (event.target === sttHardwareAdvisorOverlay) {
    resolveLocalSttHardwareAdvisorChoice("cancel");
  }
});

sttHardwareAdvisorUseSuggestionBtn.addEventListener("click", () => {
  resolveLocalSttHardwareAdvisorChoice("suggestion");
});

sttHardwareAdvisorContinueBtn.addEventListener("click", () => {
  resolveLocalSttHardwareAdvisorChoice("selected");
});

sttHardwareAdvisorCancelBtn.addEventListener("click", () => {
  resolveLocalSttHardwareAdvisorChoice("cancel");
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

  if (event.key === "Escape" && localSttHardwareAdvisorOpen) {
    resolveLocalSttHardwareAdvisorChoice("cancel");
    return;
  }

  if (event.key === "Escape" && !settingsOverlay.hidden) {
    closeSettings();
    return;
  }

  if (isTypingElement(event.target)) {
    return;
  }

  const commandHotkey = parseHotkey(settings.commandHotkey);
  if (settings.commandMode && commandHotkey && matchesHotkey(event, commandHotkey)) {
    const commandShortcutToken = normalizeShortcutToken(toGlobalShortcutString(commandHotkey));
    logClientEvent(
      `[hotkey.local.command] keydown shortcut=${commandShortcutToken} repeat=${boolFlag(
        event.repeat,
      )}`,
    );
    if (shouldIgnoreLocalShortcutFromRecentGlobal(commandShortcutToken, "pressed")) {
      return;
    }
    if (event.repeat) {
      logClientEvent("[hotkey.local.command] ignored repeated keydown");
      return;
    }
    event.preventDefault();
    void (async () => {
      if (await shouldBlockAssistantInputFromForegroundApp()) {
        logClientEvent("[hotkey.local.command] blocked by foreground app policy");
        return;
      }
      toggleCommandModeArmed();
      logClientEvent(`[hotkey.local.command] toggled commandModeArmed=${boolFlag(commandModeArmed)}`);
    })();
    return;
  }

  const parsed = parseHotkey(settings.pushToTalkHotkey);
  if (!parsed || !matchesHotkey(event, parsed)) {
    return;
  }
  const pushShortcutToken = normalizeShortcutToken(toGlobalShortcutString(parsed));
  logClientEvent(
    `[hotkey.local.push] keydown shortcut=${pushShortcutToken} capture=${settings.captureMode} repeat=${boolFlag(
      event.repeat,
    )}`,
  );
  if (shouldIgnoreLocalShortcutFromRecentGlobal(pushShortcutToken, "pressed")) {
    return;
  }

  if (settings.captureMode === "push-to-talk") {
    if (event.repeat) {
      logClientEvent("[hotkey.local.push] ignored repeated keydown in push-to-talk mode");
      return;
    }

    event.preventDefault();
    void engagePushToTalk("hotkey");
    return;
  }

  if (event.repeat) {
    logClientEvent("[hotkey.local.push] ignored repeated keydown in single-tap mode");
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

  if (!pushToTalkHoldSources.has("hotkey")) {
    return;
  }

  const parsed = parseHotkey(settings.pushToTalkHotkey);
  if (!parsed || !isHotkeyReleaseEvent(event, parsed)) {
    return;
  }
  const pushShortcutToken = normalizeShortcutToken(toGlobalShortcutString(parsed));
  logClientEvent(
    `[hotkey.local.push] keyup shortcut=${pushShortcutToken} capture=${settings.captureMode}`,
  );
  if (shouldIgnoreLocalShortcutFromRecentGlobal(pushShortcutToken, "released")) {
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

  logClientEvent(
    `[record.ptt.blur] clearing holds=${pushToTalkHoldSources.size} stage=${stage}`,
  );
  clearPushToTalkHolds();
  if (stage === "recording") {
    logClientEvent("[record.ptt.blur] window blurred during recording -> stopRecording()");
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
  stopLocalSttDownloadStatusPolling();
  if (dockHideTimerId !== null) {
    window.clearTimeout(dockHideTimerId);
    dockHideTimerId = null;
  }
  if (persistSettingsTimer !== null) {
    window.clearTimeout(persistSettingsTimer);
    persistSettingsTimer = null;
  }
  if (pendingSettingsToPersist) {
    performPersistSettings(pendingSettingsToPersist);
    pendingSettingsToPersist = null;
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
  toggleHotkeyEditorBtn.textContent = hotkeyEditor.hidden ? "Change" : "Done";
});

toggleMicEditorBtn.addEventListener("click", () => {
  microphoneEditor.hidden = !microphoneEditor.hidden;
  toggleMicEditorBtn.textContent = microphoneEditor.hidden ? "Change" : "Done";
});

apiKeyInput.addEventListener("input", handleSettingsChange);
apiBaseUrlInput.addEventListener("input", handleSettingsChange);
sttModelInput.addEventListener("input", handleSettingsChange);
aiModelInput.addEventListener("input", handleSettingsChange);
localOllamaBaseUrlInput.addEventListener("input", handleSettingsChange);
localOllamaModelInput.addEventListener("input", handleSettingsChange);
localSttModelInput.addEventListener("input", handleSettingsChange);
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
dictationLanguageModeSingleInput.addEventListener("change", handleSettingsChange);
dictationLanguageModeMultipleInput.addEventListener("change", handleSettingsChange);
for (const option of dictationLanguageOptionInputs) {
  option.addEventListener("change", handleSettingsChange);
}
styleProfileSelect.addEventListener("change", handleSettingsChange);
captureModeSingleInput.addEventListener("change", handleSettingsChange);
captureModePushToTalkInput.addEventListener("change", handleSettingsChange);
launchAtLoginToggle.addEventListener("change", handleSettingsChange);
showFlowBarToggle.addEventListener("change", handleSettingsChange);
showAppInDockToggle.addEventListener("change", handleSettingsChange);
commandModeToggle.addEventListener("change", handleSettingsChange);
wakeWordEnabledToggle.addEventListener("change", handleSettingsChange);
assistantNameInput.addEventListener("input", handleSettingsChange);
sttRuntimeModeOnlineInput.addEventListener("change", handleSettingsChange);
sttRuntimeModeOfflineInput.addEventListener("change", handleSettingsChange);
aiRuntimeModeOnlineInput.addEventListener("change", handleSettingsChange);
aiRuntimeModeOfflineInput.addEventListener("change", handleSettingsChange);
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

localOllamaModelCatalogSelect.addEventListener("change", () => {
  const selected = localOllamaModelCatalogSelect.value.trim();
  if (!selected) {
    return;
  }
  localOllamaModelInput.value = selected;
  handleSettingsChange();
});

localSttModelCatalogSelect.addEventListener("change", () => {
  const selected = localSttModelCatalogSelect.value.trim();
  if (!selected) {
    return;
  }
  localSttModelInput.value = selected;
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

checkOllamaStatusBtn.addEventListener("click", () => {
  void refreshOllamaStatus();
});

installOllamaBtn.addEventListener("click", () => {
  void installOllama();
});

fetchOllamaModelsBtn.addEventListener("click", () => {
  void fetchOllamaModels();
});

useOllamaModelBtn.addEventListener("click", () => {
  const selected = localOllamaModelCatalogSelect.value.trim();
  if (!selected) {
    setNotice("Select an Ollama model from catalog first.", true);
    return;
  }
  localOllamaModelInput.value = selected;
  handleSettingsChange();
  setNotice(`Local Ollama model set to "${selected}".`);
});

pullOllamaModelBtn.addEventListener("click", () => {
  void pullOllamaModel();
});

downloadLocalSttModelBtn.addEventListener("click", () => {
  void downloadLocalSttModel();
});

deleteLocalSttModelBtn.addEventListener("click", () => {
  void deleteLocalSttModel();
});

openLocalSttModelPathBtn.addEventListener("click", () => {
  void openLocalSttModelPath();
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
  clearAllHistory();
});

clearHistoryBtnFull.addEventListener("click", () => {
  clearAllHistory();
});

viewFullHistoryBtn.addEventListener("click", () => {
  setActivePage("history");
});

clearStatsBtn.addEventListener("click", () => {
  usageStats = { sessions: 0, words: 0, avgWpm: 0, speakingSeconds: 0 };
  persistUsageStats();
  updateUsageMetrics();
  setNotice("Statistics have been reset.");
});

function clearAllHistory(): void {
  homeHistoryEntries = [];
  persistHomeHistory();
  renderHomeHistory();
  renderFullHistory();
  recentTurns.length = 0;
}

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  void refreshMicrophones(false);
});

async function bootstrap(): Promise<void> {
  logClientEvent("[bootstrap] start");
  await hydrateSettingsFromNativeStorage();
  logClientEvent(`[bootstrap] settings after hydrate ${summarizeSettingsForDiagnostics(settings)}`);
  setStage("idle", "Loading assistant metadata...");

  try {
    const info = await invoke<AssistantInfoResponse>("get_assistant_info");
    renderAssistantInfo(info);

    if (info.piperInstalled && info.voiceInstalled) {
      setNotice(
        ZERO_PYTHON_MODE
          ? "Runtime is ready (Piper only, zero-Python mode)."
          : info.coquiInstalled
          ? "Runtime is ready (Piper main, Coqui beta available)."
          : "Piper runtime is ready. Coqui beta is optional.",
      );
      setStage("idle", "Ready for voice input.");
    } else {
      setNotice("Piper runtime incomplete. Open Settings > Models and complete runtime setup.");
      setStage("idle", "Setup required.");
    }
  } catch (error) {
    const message = asErrorMessage(error);
    setNotice(`Failed to load assistant metadata: ${message}`, true);
    setStage("error", "Metadata load failed.");
  }

  if (!ZERO_PYTHON_MODE && settings.ttsEngine === "coqui") {
    await refreshCoquiStatusSafely();
    await refreshCoquiVoices();
  }
  await refreshMicrophones(false);
  await refreshOllamaStatus({ quiet: true });
  await fetchOllamaModels({ quiet: true, autoSelect: true });
  await fetchLocalSttModels({ quiet: true });
  await pollLocalSttDownloadStatusOnce({ quiet: true });
  await syncLocalSttRuntimeForMode(settings.sttRuntimeMode);
  try {
    await pollTtsSetupStatusOnce();
  } catch {
    // Ignore bootstrap poll failures and continue normal app startup.
  }
  syncActionAvailability();
  requestGlobalShortcutSync(true);
  logClientEvent("[bootstrap] completed");
}

function asMainPage(value: string | undefined): MainPage | null {
  if (value === "home" || value === "history" || value === "dictionary" || value === "snippets" || value === "notes") {
    return value;
  }

  return null;
}

function asSettingsPane(value: string | undefined): SettingsPane | null {
  if (
    value === "general" ||
    value === "models" ||
    value === "online" ||
    value === "offline" ||
    value === "hybrid" ||
    value === "update-security" ||
    value === "pipeline"
  ) {
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

  if (next === "home") {
    renderHomeHistory();
  } else if (next === "history") {
    renderFullHistory();
  }
}

function setActiveSettingsPane(next: SettingsPane, reason = "unspecified"): void {
  let resolved = next;
  if (resolved === "online" || resolved === "offline" || resolved === "hybrid") {
    resolved = "models";
  }
  logClientEvent(
    `[ui.settings.pane] requested=${next} resolved=${resolved} reason=${reason}`,
  );

  const titleMap: Record<SettingsPane, string> = {
    general: "General",
    models: "Models",
    online: "Models",
    offline: "Models",
    hybrid: "Models",
    "update-security": "Update and Security",
    pipeline: "Pipeline",
  };

  settingsPaneTitle.textContent = titleMap[resolved];

  for (const navButton of settingsNavButtons) {
    const current = navButton.dataset.settingsPaneNav === resolved;
    navButton.classList.toggle("is-active", current);
    navButton.setAttribute("aria-current", current ? "page" : "false");
  }

  for (const panel of settingsPanels) {
    const current = panel.dataset.settingsPane === resolved;
    panel.classList.toggle("is-active", current);
    panel.hidden = !current;
  }
}

function enforceZeroPythonUi(): void {
  if (!ZERO_PYTHON_MODE) {
    return;
  }

  const coquiOption = ttsEngineSelect.querySelector('option[value="coqui"]');
  if (coquiOption instanceof HTMLOptionElement) {
    coquiOption.disabled = true;
    coquiOption.hidden = true;
  }

  if (ttsEngineSelect.value === "coqui") {
    ttsEngineSelect.value = "piper";
  }
  ttsProfileCoquiTab.hidden = true;
  ttsProfileCoquiTab.disabled = true;
  coquiStatusValue.textContent = "Disabled";
  coquiPythonValue.textContent = "-";
  coquiVersionValue.textContent = "-";
  coquiCudaValue.textContent = "-";
  setCoquiCloneStatus(ZERO_PYTHON_TTS_NOTICE);
}

function setActiveTtsProfile(next: TtsProfilePane): void {
  const piperActive = ZERO_PYTHON_MODE ? true : next === "piper";
  ttsProfilePiperTab.classList.toggle("is-active", piperActive);
  ttsProfileCoquiTab.classList.toggle("is-active", !piperActive);
  ttsProfilePiperTab.setAttribute("aria-selected", piperActive ? "true" : "false");
  ttsProfileCoquiTab.setAttribute("aria-selected", piperActive ? "false" : "true");
  ttsProfilePiperPanel.hidden = !piperActive;
  ttsProfileCoquiPanel.hidden = piperActive;
}

function updateTtsSetupGate(): void {
  const piperReady = piperRuntimeReady;
  const coquiReady = ZERO_PYTHON_MODE ? false : coquiRuntimeInstalled;
  const showBootstrap = !piperReady || ttsSetupRunning;
  ttsBootstrapCard.hidden = !showBootstrap;
  ttsProfilesArea.hidden = !piperReady;

  if (ZERO_PYTHON_MODE && piperReady && !ttsSetupRunning && !ttsSetupStatus.textContent?.trim()) {
    ttsSetupStatus.textContent = "Piper is ready. Coqui is disabled in zero-Python mode.";
  } else if (piperReady && !coquiReady && !ttsSetupRunning && !ttsSetupStatus.textContent?.trim()) {
    ttsSetupStatus.textContent = "Piper is ready. Coqui beta is optional and loads only when selected.";
  } else if (piperReady && coquiReady && !ttsSetupRunning && !ttsSetupStatus.textContent?.trim()) {
    ttsSetupStatus.textContent = "Piper and Coqui runtimes are ready.";
  }
}

function openSettings(reason = "unspecified"): void {
  logClientEvent(`[ui.settings.open] reason=${reason}`);
  settingsOverlay.hidden = false;
  settingsOverlay.classList.add("is-open");
  settingsOverlay.scrollTop = 0;
  for (const panel of settingsPanels) {
    panel.scrollTop = 0;
  }
}

function closeSettings(): void {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && settingsOverlay.contains(activeElement)) {
    activeElement.blur();
  }
  settingsOverlay.classList.remove("is-open");
  settingsOverlay.hidden = true;
}

function loadSettings(): PersistedSettings {
  const defaults: PersistedSettings = {
    apiKey: "",
    apiBaseUrl: DEFAULT_API_BASE_URL,
    sttModelName: DEFAULT_STT_MODEL_NAME,
    aiModelName: DEFAULT_AI_MODEL_NAME,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    sttRuntimeMode: DEFAULT_RUNTIME_MODE,
    aiRuntimeMode: DEFAULT_RUNTIME_MODE,
    localOllamaBaseUrl: DEFAULT_LOCAL_OLLAMA_BASE_URL,
    localOllamaModel: "",
    localSttModel: "",
    rememberApiKey: false,
    captureMode: DEFAULT_CAPTURE_MODE,
    piperPath: "",
    microphoneDeviceId: "",
    pushToTalkHotkey: DEFAULT_HOTKEY,
    commandHotkey: DEFAULT_COMMAND_HOTKEY,
    dictationLanguage: "",
    dictationLanguageMode: DEFAULT_DICTATION_LANGUAGE_MODE,
    dictationLanguageAllowList: [],
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
    const parsed = JSON.parse(raw) as Partial<PersistedSettings> & { localMode?: boolean };
    const rememberApiKey = parsed.rememberApiKey === true;
    const dictationLanguage = normalizeDictationLanguageCode(
      String(parsed.dictationLanguage ?? defaults.dictationLanguage),
    );
    const parsedLanguageAllowList = normalizeDictationLanguageAllowList(
      parsed.dictationLanguageAllowList,
    );
    let dictationLanguageMode = asDictationLanguageMode(parsed.dictationLanguageMode);
    if (parsedLanguageAllowList.length > 1) {
      dictationLanguageMode = "multiple";
    }
    const dictationLanguageAllowList =
      dictationLanguageMode === "multiple"
        ? parsedLanguageAllowList.length > 0
          ? parsedLanguageAllowList
          : dictationLanguage
            ? [dictationLanguage]
            : []
        : [];

    const legacyRuntimeMode = asRuntimeMode(
      parsed.runtimeMode ?? (parsed.localMode === true ? "local" : defaults.runtimeMode),
    );
    const sttRuntimeMode = asRuntimeMode(parsed.sttRuntimeMode ?? legacyRuntimeMode);
    const aiRuntimeMode = asRuntimeMode(parsed.aiRuntimeMode ?? legacyRuntimeMode);
    const runtimeMode =
      sttRuntimeMode === "local" && aiRuntimeMode === "local" ? "local" : "online";

    return {
      apiKey: rememberApiKey ? String(parsed.apiKey ?? "") : "",
      apiBaseUrl: String(parsed.apiBaseUrl ?? defaults.apiBaseUrl),
      sttModelName: String(parsed.sttModelName ?? defaults.sttModelName),
      aiModelName: String(parsed.aiModelName ?? defaults.aiModelName),
      runtimeMode,
      sttRuntimeMode,
      aiRuntimeMode,
      localOllamaBaseUrl: String(parsed.localOllamaBaseUrl ?? defaults.localOllamaBaseUrl),
      localOllamaModel: String(parsed.localOllamaModel ?? defaults.localOllamaModel),
      localSttModel: String(parsed.localSttModel ?? defaults.localSttModel),
      rememberApiKey,
      captureMode: parsed.captureMode === "single-tap" ? "single-tap" : "push-to-talk",
      piperPath: String(parsed.piperPath ?? defaults.piperPath),
      microphoneDeviceId: String(parsed.microphoneDeviceId ?? defaults.microphoneDeviceId),
      pushToTalkHotkey: String(parsed.pushToTalkHotkey ?? defaults.pushToTalkHotkey),
      commandHotkey: String(parsed.commandHotkey ?? defaults.commandHotkey),
      dictationLanguage,
      dictationLanguageMode,
      dictationLanguageAllowList,
      styleProfile: asStyleProfile(parsed.styleProfile),
      systemPrompt:
        parsed.systemPrompt !== undefined ? String(parsed.systemPrompt) : defaults.systemPrompt,
      temperature: coerceNumber(parsed.temperature, defaults.temperature, 0, 1.2),
      maxTokens: coerceInteger(parsed.maxTokens, defaults.maxTokens, 64, 4096),
      launchAtLogin: coerceBoolean(parsed.launchAtLogin, defaults.launchAtLogin),
      showFlowBar: fromLegacyOnly
        ? false
        : coerceBoolean(parsed.showFlowBar, defaults.showFlowBar),
      showAppInDock: coerceBoolean(parsed.showAppInDock, defaults.showAppInDock),
      commandMode: coerceBoolean(parsed.commandMode, defaults.commandMode),
      wakeWordEnabled: coerceBoolean(parsed.wakeWordEnabled, defaults.wakeWordEnabled),
      assistantName:
        parsed.assistantName !== undefined ? String(parsed.assistantName) : defaults.assistantName,
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
  pendingSettingsToPersist = next;
  if (persistSettingsTimer === null) {
    performPersistSettings(next);
    pendingSettingsToPersist = null;
  } else {
    window.clearTimeout(persistSettingsTimer);
  }

  persistSettingsTimer = window.setTimeout(() => {
    persistSettingsTimer = null;
    if (pendingSettingsToPersist) {
      performPersistSettings(pendingSettingsToPersist);
      pendingSettingsToPersist = null;
    }
  }, 800);
}

function performPersistSettings(next: PersistedSettings): void {
  const nativePayload: PersistedSettings = {
    ...next,
    apiKey: next.rememberApiKey ? next.apiKey : "",
  };

  const localPayload: PersistedSettings = isTauriEnvironment()
    ? {
        ...nativePayload,
        // Keep API keys out of webview localStorage in desktop builds.
        apiKey: "",
      }
    : nativePayload;
  const serializedLocal = JSON.stringify(localPayload);
  localStorage.setItem(SETTINGS_STORAGE_KEY, serializedLocal);
  const diagnosticsSignature = [
    next.captureMode,
    next.sttRuntimeMode,
    next.aiRuntimeMode,
    boolFlag(next.rememberApiKey),
    boolFlag(next.apiKey.trim().length > 0),
    buildShortcutSyncSignature(next),
  ].join("|");
  if (diagnosticsSignature !== lastPersistDiagnosticsSignature) {
    lastPersistDiagnosticsSignature = diagnosticsSignature;
    logClientEvent(
      `[settings.persist] tauri=${boolFlag(isTauriEnvironment())} ${summarizeSettingsForDiagnostics(
        next,
      )} nativeApiKeyPresent=${boolFlag(nativePayload.apiKey.trim().length > 0)} localApiKeyPresent=${boolFlag(
        localPayload.apiKey.trim().length > 0,
      )}`,
    );
  }

  if (!isTauriEnvironment()) {
    return;
  }

  const serializedNative = JSON.stringify(nativePayload);
  logClientEvent(
    `[settings.persist.native] payloadBytes=${serializedNative.length} remember=${boolFlag(
      nativePayload.rememberApiKey,
    )} apiKeyPresent=${boolFlag(nativePayload.apiKey.trim().length > 0)}`,
  );
  void invoke("save_persisted_local_settings", { payload: serializedNative }).catch((error) => {
    setNotice(
      `Unable to securely save settings: ${asErrorMessage(error)}. Check keyring access and try again.`,
      true,
    );
    logClientEvent(`[settings.persist.native] failed: ${asErrorMessage(error)}`);
    console.warn(`[settings] failed to persist local settings: ${asErrorMessage(error)}`);
  });
}

async function hydrateSettingsFromNativeStorage(): Promise<void> {
  if (!isTauriEnvironment()) {
    logClientEvent("[settings.hydrate] skipped because app is not running in tauri");
    return;
  }

  logClientEvent("[settings.hydrate] start");
  try {
    const raw = await invoke<string>("load_persisted_local_settings");
    const trimmed = raw.trim();
    logClientEvent(`[settings.hydrate] rawBytes=${raw.length} trimmedBytes=${trimmed.length}`);
    if (!trimmed) {
      logClientEvent("[settings.hydrate] empty payload; leaving local settings unchanged");
      return;
    }

    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      logClientEvent("[settings.hydrate] payload is not a valid settings object");
      return;
    }
    const parsedObject = parsed as Partial<PersistedSettings>;
    const parsedRemember = parsedObject.rememberApiKey === true;
    const parsedApiKeyPresent =
      typeof parsedObject.apiKey === "string" && parsedObject.apiKey.trim().length > 0;
    logClientEvent(
      `[settings.hydrate] parsed remember=${boolFlag(parsedRemember)} apiKeyPresent=${boolFlag(
        parsedApiKeyPresent,
      )}`,
    );

    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parsed));
    const hydrated = loadSettings();
    settings = hydrated;
    applySettingsToForm(settings);
    logClientEvent(`[settings.hydrate] applied ${summarizeSettingsForDiagnostics(hydrated)}`);
    handleSettingsChange();
  } catch (error) {
    logClientEvent(`[settings.hydrate] failed: ${asErrorMessage(error)}`);
    console.warn(`[settings] failed to hydrate local settings: ${asErrorMessage(error)}`);
  }
}

function readSettingsFromForm(): PersistedSettings {
  const dictationLanguageMode: DictationLanguageMode = dictationLanguageModeMultipleInput.checked
    ? "multiple"
    : "single";
  const primaryDictationLanguage = normalizeDictationLanguageCode(dictationLanguageSelect.value);
  let dictationLanguageAllowList =
    dictationLanguageMode === "multiple"
      ? normalizeDictationLanguageAllowList(
          dictationLanguageOptionInputs
            .filter((option) => option.checked)
            .map((option) => option.value),
        )
      : [];

  if (
    dictationLanguageMode === "multiple" &&
    primaryDictationLanguage &&
    !dictationLanguageAllowList.includes(primaryDictationLanguage)
  ) {
    dictationLanguageAllowList = [primaryDictationLanguage, ...dictationLanguageAllowList];
  }

  const dictationLanguage =
    dictationLanguageMode === "multiple"
      ? primaryDictationLanguage || dictationLanguageAllowList[0] || ""
      : primaryDictationLanguage;
  const resolvedTtsEngine: TtsEngine = ZERO_PYTHON_MODE ? "piper" : asTtsEngine(ttsEngineSelect.value);

  return {
    apiKey: apiKeyInput.value.trim(),
    apiBaseUrl: apiBaseUrlInput.value.trim(),
    sttModelName: sttModelInput.value.trim(),
    aiModelName: aiModelInput.value.trim(),
    runtimeMode:
      sttRuntimeModeOfflineInput.checked && aiRuntimeModeOfflineInput.checked ? "local" : "online",
    sttRuntimeMode: sttRuntimeModeOfflineInput.checked ? "local" : "online",
    aiRuntimeMode: aiRuntimeModeOfflineInput.checked ? "local" : "online",
    localOllamaBaseUrl: localOllamaBaseUrlInput.value.trim() || DEFAULT_LOCAL_OLLAMA_BASE_URL,
    localOllamaModel: localOllamaModelInput.value.trim(),
    localSttModel: localSttModelInput.value.trim(),
    rememberApiKey: rememberApiKeyInput.checked,
    captureMode: captureModeSingleInput.checked ? "single-tap" : "push-to-talk",
    piperPath: piperPathInput.value.trim(),
    ttsEngine: resolvedTtsEngine,
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
    dictationLanguage,
    dictationLanguageMode,
    dictationLanguageAllowList,
    styleProfile: asStyleProfile(styleProfileSelect.value),
    systemPrompt: systemPromptInput.value,
    temperature: coerceNumber(Number(temperatureInput.value), DEFAULT_TEMPERATURE, 0, 1.2),
    maxTokens: coerceInteger(Number(maxTokensInput.value), DEFAULT_MAX_TOKENS, 64, 4096),
    launchAtLogin: launchAtLoginToggle.checked,
    showFlowBar: showFlowBarToggle.checked,
    showAppInDock: showAppInDockToggle.checked,
    commandMode: commandModeToggle.checked,
    wakeWordEnabled: wakeWordEnabledToggle.checked,
    assistantName: assistantNameInput.value,
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
  const effectiveTtsEngine: TtsEngine = ZERO_PYTHON_MODE ? "piper" : next.ttsEngine;
  apiKeyInput.value = next.apiKey;
  apiBaseUrlInput.value = next.apiBaseUrl;
  sttModelInput.value = next.sttModelName;
  aiModelInput.value = next.aiModelName;
  sttRuntimeModeOnlineInput.checked = next.sttRuntimeMode !== "local";
  sttRuntimeModeOfflineInput.checked = next.sttRuntimeMode === "local";
  aiRuntimeModeOnlineInput.checked = next.aiRuntimeMode !== "local";
  aiRuntimeModeOfflineInput.checked = next.aiRuntimeMode === "local";
  localOllamaBaseUrlInput.value = next.localOllamaBaseUrl || DEFAULT_LOCAL_OLLAMA_BASE_URL;
  localOllamaModelInput.value = next.localOllamaModel;
  localSttModelInput.value = next.localSttModel;
  rememberApiKeyInput.checked = next.rememberApiKey;
  // Bug fix: explicitly sync microphone selection to avoid UI desync on startup
  if (next.microphoneDeviceId) {
    microphoneSelect.value = next.microphoneDeviceId;
  }
  piperPathInput.value = next.piperPath;
  ttsEngineSelect.value = effectiveTtsEngine;
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
  applyDictationLanguageSettingsToForm(next);
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
  updateRuntimeModeNotice(next.sttRuntimeMode, next.aiRuntimeMode);
  syncRuntimeModePaneVisibility(next.sttRuntimeMode, next.aiRuntimeMode);
  syncHybridRuntimeFieldVisibility(next.sttRuntimeMode, next.aiRuntimeMode);
}

function handleSettingsChange(): void {
  const previousSettings = settings;
  const previousMode = settings.captureMode;
  const previousIncognito = settings.incognitoMode;
  const previousTtsEngine = settings.ttsEngine;
  const previousSttRuntimeMode = settings.sttRuntimeMode;
  const previousAiRuntimeMode = settings.aiRuntimeMode;
  const previousMuteMusicWhileDictating = settings.muteMusicWhileDictating;
  const previousLaunchAtLogin = settings.launchAtLogin;
  const previousShortcutSignature = buildShortcutSyncSignature(settings);
  const next = readSettingsFromForm();
  if (settingsOverlay.hidden && next.captureMode !== previousSettings.captureMode) {
    logClientEvent(
      `[settings.captureMode] ignored hidden-overlay flip from=${previousSettings.captureMode} to=${next.captureMode}`,
    );
    next.captureMode = previousSettings.captureMode;
    captureModeSingleInput.checked = next.captureMode === "single-tap";
    captureModePushToTalkInput.checked = next.captureMode === "push-to-talk";
  }
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

  if (ZERO_PYTHON_MODE && next.ttsEngine === "coqui") {
    next.ttsEngine = "piper";
    ttsEngineSelect.value = "piper";
  }

  settings = next;
  cachedHotkeyDisplay = formatHotkeyForDisplay(settings.pushToTalkHotkey);
  const previousDiagnosticsSignature = [
    previousSettings.captureMode,
    previousSettings.sttRuntimeMode,
    previousSettings.aiRuntimeMode,
    boolFlag(previousSettings.rememberApiKey),
    boolFlag(previousSettings.apiKey.trim().length > 0),
    buildShortcutSyncSignature(previousSettings),
    boolFlag(previousSettings.commandMode),
  ].join("|");
  const nextDiagnosticsSignature = [
    settings.captureMode,
    settings.sttRuntimeMode,
    settings.aiRuntimeMode,
    boolFlag(settings.rememberApiKey),
    boolFlag(settings.apiKey.trim().length > 0),
    buildShortcutSyncSignature(settings),
    boolFlag(settings.commandMode),
  ].join("|");
  if (previousDiagnosticsSignature !== nextDiagnosticsSignature) {
    logClientEvent(
      `[settings.change] from="${summarizeSettingsForDiagnostics(
        previousSettings,
      )}" to="${summarizeSettingsForDiagnostics(settings)}"`,
    );
  }
  applyDictationLanguageSettingsToForm(settings);
  temperatureValue.textContent = settings.temperature.toFixed(2);
  piperSpeedValue.textContent = `${settings.piperSpeed.toFixed(2)}x`;
  coquiSpeedValue.textContent = `${settings.coquiSpeed.toFixed(2)}x`;
  updateWakePhrasePreview(settings.assistantName);
  hotkeyHint.textContent = cachedHotkeyDisplay;
  captureModeHint.textContent = captureModeLabel(settings.captureMode);
  applyTheme(settings.themeMode);
  updateRuntimeModeNotice(settings.sttRuntimeMode, settings.aiRuntimeMode);
  syncRuntimeModePaneVisibility(settings.sttRuntimeMode, settings.aiRuntimeMode);
  syncHybridRuntimeFieldVisibility(settings.sttRuntimeMode, settings.aiRuntimeMode);
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
  if (localOllamaModelCatalog.includes(settings.localOllamaModel)) {
    localOllamaModelCatalogSelect.value = settings.localOllamaModel;
  } else if (localOllamaModelCatalog.length > 0) {
    localOllamaModelCatalogSelect.value = "";
  }
  if (localSttModelCatalog.includes(settings.localSttModel)) {
    localSttModelCatalogSelect.value = settings.localSttModel;
  } else if (localSttModelCatalog.length > 0) {
    localSttModelCatalogSelect.value = "";
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

  if (previousIncognito !== settings.incognitoMode) {
    renderHomeHistory();
  }

  if (!previousMuteMusicWhileDictating && settings.muteMusicWhileDictating && stage === "recording") {
    pauseExternalMediaForDictation();
  } else if (previousMuteMusicWhileDictating && !settings.muteMusicWhileDictating) {
    resumeExternalMediaAfterDictation();
  }

  persistSettings(settings);
  renderSidebarLocalSttToggle();
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
  const sttRuntimeModeChanged = previousSttRuntimeMode !== settings.sttRuntimeMode;
  const aiRuntimeModeChanged = previousAiRuntimeMode !== settings.aiRuntimeMode;
  if (sttRuntimeModeChanged || aiRuntimeModeChanged) {
    if (settings.sttRuntimeMode === settings.aiRuntimeMode) {
      setNotice(
        settings.sttRuntimeMode === "local"
          ? "Offline mode enabled for both STT and AI."
          : "Online mode enabled for both STT and AI.",
      );
    } else {
      setNotice(
        `Hybrid mode enabled (STT: ${settings.sttRuntimeMode}, AI: ${settings.aiRuntimeMode}).`,
      );
    }
  }
  if (sttRuntimeModeChanged) {
    requestLocalSttRuntimeSyncForMode(settings.sttRuntimeMode, {
      showLoadOverlay: settings.sttRuntimeMode === "local",
    });
  }
  if (!ZERO_PYTHON_MODE && settings.ttsEngine === "coqui" && previousTtsEngine !== "coqui") {
    void refreshCoquiStatusSafely();
    void refreshCoquiVoices();
    void refreshCoquiModels({ quiet: true });
  }
  updateTtsSetupGate();
  publishDockState();
  void syncFloatingIndicatorWindow();
}

function updateRuntimeModeNotice(sttMode: RuntimeMode, aiMode: RuntimeMode): void {
  if (sttMode === "local" && aiMode === "local") {
    runtimeModeNotice.textContent =
      "Offline mode is active for both STT and AI (local Parakeet + local Ollama).";
    return;
  }
  if (sttMode === "online" && aiMode === "online") {
    runtimeModeNotice.textContent =
      "Online mode is active for both STT and AI (provider API base URL + API key).";
    return;
  }
  runtimeModeNotice.textContent = `Hybrid mode: STT is ${sttMode}, AI is ${aiMode}.`;
}

function syncHybridRuntimeFieldVisibility(sttMode: RuntimeMode, aiMode: RuntimeMode): void {
  const sttOnline = sttMode === "online";
  const aiOnline = aiMode === "online";
  const sttLocal = sttMode === "local";
  const aiLocal = aiMode === "local";
  const anyOnline = sttOnline || aiOnline;
  const anyLocal = sttLocal || aiLocal;

  onlineProviderSection.hidden = !anyOnline;
  onlineSttModelField.hidden = !sttOnline;
  onlineAiModelField.hidden = !aiOnline;
  offlineOllamaSection.hidden = !aiLocal;
  offlineSttSection.hidden = !sttLocal;
  onlineProviderModeNotice.hidden = !anyOnline;
  offlineRuntimeModeNotice.hidden = !anyLocal;

  if (sttOnline && aiOnline) {
    onlineProviderModeNotice.textContent =
      "Online routing active for STT + AI. Configure API base URL, key, and provider models.";
  } else if (sttOnline) {
    onlineProviderModeNotice.textContent =
      "Online routing active for STT. Configure API base URL, key, and online STT model.";
  } else if (aiOnline) {
    onlineProviderModeNotice.textContent =
      "Online routing active for AI. Configure API base URL, key, and online AI model.";
  }

  if (!anyLocal) {
    return;
  }

  if (sttLocal && aiLocal) {
    offlineRuntimeModeNotice.textContent =
      "Offline routing active for STT + AI. Configure local STT model and local Ollama model.";
  } else if (aiLocal) {
    offlineRuntimeModeNotice.textContent =
      "Offline routing active for AI. Configure local Ollama model. STT stays online.";
  } else {
    offlineRuntimeModeNotice.textContent =
      "Offline routing active for STT. Configure local STT model download/load. AI stays online.";
  }
}

function syncRuntimeModePaneVisibility(_sttMode: RuntimeMode, _aiMode: RuntimeMode): void {
  const activePane = settingsPanels.find((panel) => panel.classList.contains("is-active"));
  const activePaneId = activePane?.dataset.settingsPane;
  if (activePaneId === "online" || activePaneId === "offline" || activePaneId === "hybrid") {
    setActiveSettingsPane("models");
  }
}

function pickDefaultLocalSttModelFromCatalog(): string {
  if (localSttModelCatalog.length === 0) {
    return "";
  }
  const preferredOrder = ["nvidia/parakeet-tdt_ctc-110m", "nvidia/parakeet-tdt-0.6b-v3"];
  for (const candidate of preferredOrder) {
    if (localSttModelCatalog.includes(candidate)) {
      return candidate;
    }
  }
  return localSttModelCatalog[0] ?? "";
}

const EMBEDDING_MARKERS = [
  "embed",
  "embedding",
  "nomic-embed",
  "bge-",
  "e5-",
  "minilm",
];

function containsAnyFragment(text: string, fragments: readonly string[]): boolean {
  for (const fragment of fragments) {
    if (text.includes(fragment)) {
      return true;
    }
  }
  return false;
}

function isEmbeddingOnlyNormalizedModel(normalizedModel: string): boolean {
  return normalizedModel.length > 0 && containsAnyFragment(normalizedModel, EMBEDDING_MARKERS);
}

function looksLikeEmbeddingOnlyOllamaModel(model: string): boolean {
  return isEmbeddingOnlyNormalizedModel(model.trim().toLowerCase());
}

const PREFERRED_CHAT_FAMILIES = [
  "llama",
  "qwen",
  "mistral",
  "gemma",
  "phi",
  "deepseek",
  "command-r",
];

function pickDefaultLocalOllamaModelFromCatalog(): string {
  if (localOllamaModelCatalog.length === 0) {
    return "";
  }
  let firstNonEmbeddingModel = "";
  for (const model of localOllamaModelCatalog) {
    const normalized = model.trim().toLowerCase();
    if (isEmbeddingOnlyNormalizedModel(normalized)) {
      continue;
    }
    if (!firstNonEmbeddingModel) {
      firstNonEmbeddingModel = model;
    }
    if (containsAnyFragment(normalized, PREFERRED_CHAT_FAMILIES)) {
      return model;
    }
  }
  return firstNonEmbeddingModel || localOllamaModelCatalog[0] || "";
}

function requestLocalSttRuntimeSyncForMode(
  targetMode: RuntimeMode,
  options: { showLoadOverlay?: boolean } = {},
): void {
  pendingRuntimeModeSyncTarget = targetMode;
  if (targetMode === "local" && options.showLoadOverlay === true) {
    pendingRuntimeModeSyncShowLoadOverlay = true;
  }
  if (runtimeModeSyncInFlight) {
    return;
  }

  runtimeModeSyncInFlight = true;
  void (async () => {
    while (pendingRuntimeModeSyncTarget) {
      const nextTarget = pendingRuntimeModeSyncTarget;
      const nextShowLoadOverlay =
        nextTarget === "local" && pendingRuntimeModeSyncShowLoadOverlay;
      pendingRuntimeModeSyncTarget = null;
      pendingRuntimeModeSyncShowLoadOverlay = false;
      await syncLocalSttRuntimeForMode(nextTarget, { showLoadOverlay: nextShowLoadOverlay });
    }
    runtimeModeSyncInFlight = false;
  })();
}

async function syncLocalSttRuntimeForMode(
  mode: RuntimeMode,
  options: { showLoadOverlay?: boolean } = {},
): Promise<void> {
  if (mode === "local") {
    let model = readSettingsFromForm().localSttModel.trim() || localSttModelCatalogSelect.value.trim();
    if (!model) {
      const fallbackModel = pickDefaultLocalSttModelFromCatalog();
      if (fallbackModel) {
        localSttModelInput.value = fallbackModel;
        if (localSttModelCatalog.includes(fallbackModel)) {
          localSttModelCatalogSelect.value = fallbackModel;
        }
        handleSettingsChange();
        model = fallbackModel;
      }
    }

    const showLoadOverlay = options.showLoadOverlay === true && Boolean(model);
    if (showLoadOverlay) {
      showLocalSttLoadOverlay(model);
      localSttDownloadNotice.textContent = `Loading local STT model "${model}"...`;
      setNotice(`Loading local STT model "${model}"...`);
    }

    try {
      await refreshLocalSttRuntimeState({ quiet: true });
      if (isSelectedLocalSttModelLoaded()) {
        return;
      }

      await warmupActiveLocalSttModel({ quiet: true, force: true, explicit: true });
      await refreshLocalSttRuntimeState({ quiet: true });
      if (isSelectedLocalSttModelLoaded()) {
        return;
      }

      const activeSettings = readSettingsFromForm();
      const selectedModel =
        activeSettings.localSttModel.trim() || localSttModelCatalogSelect.value.trim();
      if (!selectedModel) {
        setNotice(
          "Local STT runtime is active but no local STT model is selected. Open Settings > Models and select a model, then click Load STT.",
          true,
        );
      } else {
        setNotice(
          `Local STT runtime is active but local STT model "${selectedModel}" could not be loaded. Open Settings > Models and click Load STT.`,
          true,
        );
      }
      setActiveSettingsPane("offline");
      return;
    } finally {
      if (showLoadOverlay) {
        hideLocalSttLoadOverlay();
      }
    }
  }

  await refreshLocalSttRuntimeState({ quiet: true });
  if (!localSttRuntimeLoaded) {
    return;
  }

  const activeSettings = readSettingsFromForm();
  const modelToUnload =
    activeSettings.localSttModel.trim() ||
    localSttModelCatalogSelect.value.trim() ||
    lastWarmedLocalSttModel.trim();
  try {
    const response = await invoke<LocalSttDeactivateResponse>("deactivate_local_stt_model", {
      request: { model: modelToUnload || null },
    });
    localSttDownloadNotice.textContent = response.details;
    if (response.deactivated) {
      lastWarmedLocalSttModel = "";
    }
  } catch (error) {
    setNotice(`Unable to unload local STT runtime: ${asErrorMessage(error)}`, true);
  } finally {
    await refreshLocalSttRuntimeState({ quiet: true });
  }
}

function buildShortcutSyncSignature(source: PersistedSettings): string {
  const captureMode = source.captureMode;
  const push = parseHotkey(source.pushToTalkHotkey)?.label ?? "";
  const commandEnabled = source.commandMode ? "1" : "0";
  const command = source.commandMode ? parseHotkey(source.commandHotkey)?.label ?? "" : "";
  return `${captureMode}|${push}|${commandEnabled}|${command}`;
}

function boolFlag(value: boolean): "1" | "0" {
  return value ? "1" : "0";
}

function summarizeSettingsForDiagnostics(source: PersistedSettings): string {
  const pushLabel = parseHotkey(source.pushToTalkHotkey)?.label ?? source.pushToTalkHotkey.trim();
  const commandLabel = source.commandMode
    ? parseHotkey(source.commandHotkey)?.label ?? source.commandHotkey.trim()
    : "disabled";
  const apiKeyPresent = source.apiKey.trim().length > 0;
  return [
    `capture=${source.captureMode}`,
    `stt=${source.sttRuntimeMode}`,
    `ai=${source.aiRuntimeMode}`,
    `remember=${boolFlag(source.rememberApiKey)}`,
    `apiKeyPresent=${boolFlag(apiKeyPresent)}`,
    `commandMode=${boolFlag(source.commandMode)}`,
    `push=${pushLabel || "-"}`,
    `command=${commandLabel || "-"}`,
  ].join(" ");
}

function requestGlobalShortcutSync(force = false): void {
  logClientEvent(
    `[hotkey.sync.request] force=${boolFlag(force)} inFlight=${boolFlag(
      Boolean(shortcutSyncInFlight),
    )} queued=${boolFlag(shortcutSyncQueued)} sig=${buildShortcutSyncSignature(settings)}`,
  );
  if (force) {
    registeredShortcutSignature = "";
  }

  if (shortcutSyncInFlight) {
    shortcutSyncQueued = true;
    logClientEvent("[hotkey.sync.request] queued=1 because sync is already running");
    return;
  }

  shortcutSyncInFlight = syncGlobalShortcuts(force)
    .catch((error) => {
      logClientEvent(`[hotkey.sync.error] ${asErrorMessage(error)}`);
      setNotice(`Global hotkey sync failed: ${asErrorMessage(error)}`, true);
    })
    .finally(() => {
      logClientEvent(
        `[hotkey.sync.finally] queued=${boolFlag(shortcutSyncQueued)} active=${boolFlag(
          globalShortcutsActive,
        )} push=${registeredPushShortcut || "-"} command=${registeredCommandShortcut || "-"}`,
      );
      shortcutSyncInFlight = null;
      if (shortcutSyncQueued) {
        shortcutSyncQueued = false;
        logClientEvent("[hotkey.sync.finally] draining queued sync request");
        requestGlobalShortcutSync();
      }
    });
}

async function syncGlobalShortcuts(force = false): Promise<void> {
  logClientEvent(
    `[hotkey.sync.run] force=${boolFlag(force)} tauri=${boolFlag(
      isTauriEnvironment(),
    )} suppressed=${boolFlag(shortcutsSuppressedByBlockedApp)} ${summarizeSettingsForDiagnostics(
      settings,
    )}`,
  );
  if (!isTauriEnvironment()) {
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    publishDockState();
    logClientEvent("[hotkey.sync.run] skipped because app is not running in tauri");
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
    logClientEvent("[hotkey.sync.run] shortcuts disabled by blocked foreground app");
    return;
  }

  const pushSpec = parseHotkey(settings.pushToTalkHotkey);
  if (!pushSpec) {
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    publishDockState();
    logClientEvent(
      `[hotkey.sync.run] skipped because push-to-talk hotkey is invalid: "${settings.pushToTalkHotkey}"`,
    );
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
  logClientEvent(
    `[hotkey.sync.plan] push=${pushShortcut} command=${
      commandShortcut || "-"
    } desired=${desiredSignature} current=${registeredShortcutSignature || "-"}`,
  );

  if (!force && globalShortcutsActive && desiredSignature === registeredShortcutSignature) {
    logClientEvent("[hotkey.sync.plan] skipped because registered shortcuts already match");
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
    logClientEvent(
      `[hotkey.sync.success] registered=${shortcuts.join(",")} signature=${registeredShortcutSignature}`,
    );
  } catch (error) {
    registeredPushShortcut = "";
    registeredCommandShortcut = "";
    registeredShortcutSignature = "";
    globalShortcutsActive = false;
    logClientEvent(`[hotkey.sync.failure] ${asErrorMessage(error)}`);
    setNotice(`Global hotkeys unavailable. Using in-app hotkeys only: ${asErrorMessage(error)}`, true);
    publishDockState();
  }
}

function isTauriEnvironment(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

function initializeUpdaterPanel(): void {
  updateCurrentVersion.textContent = "-";
  updateLatestVersion.textContent = "-";
  updatePublishedAt.textContent = "-";
  setUpdaterStatus("idle", "Check to see if a new version is available.");

  if (!isTauriEnvironment()) {
    checkUpdatesBtn.disabled = true;
    installUpdateBtn.disabled = true;
    setUpdaterStatus("error", "Updater works only inside the desktop app build.");
  }
}

function setupCustomWindowControls(): void {
  if (!isTauriEnvironment()) {
    windowMinimizeBtn.disabled = true;
    windowMaximizeBtn.disabled = true;
    windowCloseBtn.disabled = true;
    return;
  }

  const appWindow = getCurrentWindow();
  void syncTitlebarMaximizeState(appWindow);

  windowMinimizeBtn.addEventListener("click", () => {
    void appWindow.minimize().catch((error) => {
      setNotice(`Minimize failed: ${asErrorMessage(error)}`, true);
    });
  });

  windowMaximizeBtn.addEventListener("click", () => {
    void toggleWindowMaximize(appWindow);
  });

  windowCloseBtn.addEventListener("click", () => {
    void appWindow.close().catch((error) => {
      setNotice(`Close failed: ${asErrorMessage(error)}`, true);
    });
  });

  appTitlebarDrag.addEventListener("dblclick", () => {
    void toggleWindowMaximize(appWindow);
  });

  window.addEventListener("resize", () => {
    void syncTitlebarMaximizeState(appWindow);
  });
}

async function toggleWindowMaximize(appWindow = getCurrentWindow()): Promise<void> {
  try {
    const maximized = await appWindow.isMaximized();
    if (maximized) {
      await appWindow.unmaximize();
    } else {
      await appWindow.maximize();
    }
    await syncTitlebarMaximizeState(appWindow);
  } catch (error) {
    setNotice(`Window maximize toggle failed: ${asErrorMessage(error)}`, true);
  }
}

async function syncTitlebarMaximizeState(appWindow = getCurrentWindow()): Promise<void> {
  try {
    const maximized = isTauriEnvironment() ? await appWindow.isMaximized() : false;
    windowMaximizeBtn.setAttribute("aria-label", maximized ? "Restore" : "Maximize");

    if (maximized) {
      windowMaximizeGlyph.innerHTML = '<rect x="8" y="4" width="12" height="12" rx="1" ry="1"></rect><path d="M4 8V20H16V16"></path>';
    } else {
      windowMaximizeGlyph.innerHTML = '<rect x="4" y="4" width="16" height="16" rx="1" ry="1"></rect>';
    }
  } catch {
    windowMaximizeGlyph.innerHTML = '<rect x="4" y="4" width="16" height="16" rx="1" ry="1"></rect>';
  }
}

function setUpdaterStatus(stage: "idle" | "processing" | "speaking" | "error", message: string): void {
  updateStatusPill.dataset.stage = stage;
  if (stage === "idle") {
    updateStatusPill.textContent = "Idle";
  } else if (stage === "processing") {
    updateStatusPill.textContent = "Checking";
  } else if (stage === "speaking") {
    updateStatusPill.textContent = "Update";
  } else {
    updateStatusPill.textContent = "Error";
  }
  updateStatusText.textContent = message;
}

function formatPublishedDate(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) {
    return "-";
  }

  const parsed = new Date(cleaned);
  if (Number.isNaN(parsed.getTime())) {
    return cleaned;
  }
  return UPDATE_DATE_FORMATTER.format(parsed);
}

async function handleCheckForUpdates(): Promise<void> {
  if (!isTauriEnvironment() || updateCheckInFlight) {
    return;
  }

  updateCheckInFlight = true;
  cachedUpdateResult = null;
  checkUpdatesBtn.disabled = true;
  installUpdateBtn.disabled = true;
  setUpdaterStatus("processing", "Checking GitHub release channel...");

  try {
    const result = await invoke<AppUpdateCheckResponse>("check_for_app_update");
    cachedUpdateResult = result;

    updateCurrentVersion.textContent = result.currentVersion || "-";
    updateLatestVersion.textContent = result.latestVersion || "-";
    updatePublishedAt.textContent = formatPublishedDate(result.publishedAt);

    if (result.available && result.installerDownloadUrl) {
      installUpdateBtn.disabled = false;
      setUpdaterStatus(
        "speaking",
        `Update ${result.latestVersion} is available. Click "Download & install".`,
      );
      return;
    }

    if (result.latestVersion && result.latestVersion !== result.currentVersion) {
      setUpdaterStatus(
        "error",
        "A newer release exists, but no Windows installer package was detected for auto-update.",
      );
      return;
    }

    setUpdaterStatus("idle", "You are already on the latest version.");
  } catch (error) {
    setUpdaterStatus("error", `Update check failed: ${asErrorMessage(error)}`);
  } finally {
    updateCheckInFlight = false;
    checkUpdatesBtn.disabled = !isTauriEnvironment();
  }
}

async function handleInstallUpdate(): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }

  if (!cachedUpdateResult || !cachedUpdateResult.available || !cachedUpdateResult.installerDownloadUrl) {
    setUpdaterStatus("error", "No update package is ready. Run check first.");
    return;
  }

  const request: InstallAppUpdateRequest = {
    downloadUrl: cachedUpdateResult.installerDownloadUrl,
    assetName: cachedUpdateResult.installerAssetName || undefined,
    silent: true,
  };

  installUpdateBtn.disabled = true;
  checkUpdatesBtn.disabled = true;
  setUpdaterStatus("processing", "Downloading update installer...");

  try {
    await invoke("download_and_install_app_update", { request });
    setUpdaterStatus("processing", "Installer started. The app will close now.");
  } catch (error) {
    setUpdaterStatus("error", `Installer launch failed: ${asErrorMessage(error)}`);
    checkUpdatesBtn.disabled = false;
  }
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
  logClientEvent(
    `[hotkey.global.event] shortcut=${event.shortcut || "-"} state=${String(
      (event as { state?: unknown }).state ?? "",
    )}`,
  );
  if (hotkeyCaptureActive || commandHotkeyCaptureActive) {
    logClientEvent("[hotkey.global.event] ignored because hotkey capture UI is active");
    return;
  }

  const rawState = String((event as { state?: unknown }).state ?? "")
    .trim()
    .toLowerCase();
  const pressed = rawState === "pressed";
  const released = rawState === "released";
  if (!pressed && !released) {
    logClientEvent(`[hotkey.global.event] ignored because state="${rawState}" is unsupported`);
    return;
  }

  const shortcut = normalizeShortcutToken(event.shortcut);
  const pushShortcut = normalizeShortcutToken(registeredPushShortcut);
  const commandShortcut = normalizeShortcutToken(registeredCommandShortcut);
  logClientEvent(
    `[hotkey.global.event] normalized shortcut=${shortcut || "-"} push=${
      pushShortcut || "-"
    } command=${commandShortcut || "-"} capture=${settings.captureMode}`,
  );

  if (pushShortcut && shortcut === pushShortcut) {
    if (pressed) {
      markGlobalShortcutHandled(shortcut, "pressed");
      logClientEvent(
        `[hotkey.global.push] pressed capture=${settings.captureMode} holdCount=${pushToTalkHoldSources.size}`,
      );
      const activeSettings = readSettingsFromForm();
      if (missingApiKeyForOnlineRuntime(activeSettings)) {
        logClientEvent(
          "[hotkey.global.push] blocked before reveal because API key is missing for online runtime",
        );
        showMissingApiKeyNotice("global-hotkey");
        return;
      }
      if (settings.captureMode === "push-to-talk") {
        if (pushToTalkHoldSources.has("hotkey")) {
          logClientEvent("[hotkey.global.push] ignored repeated press because hold is already active");
          return;
        }
        void engagePushToTalk("hotkey");
      } else {
        void handleRecordToggle();
      }
    }
    if (released && (settings.captureMode === "push-to-talk" || pushToTalkHoldSources.has("hotkey"))) {
      markGlobalShortcutHandled(shortcut, "released");
      logClientEvent("[hotkey.global.push] released -> release push-to-talk hold");
      releasePushToTalk("hotkey");
    }
    return;
  }

  if (
    commandShortcut &&
    shortcut === commandShortcut &&
    pressed
  ) {
    markGlobalShortcutHandled(shortcut, "pressed");
    logClientEvent("[hotkey.global.command] pressed -> toggling command mode");
    void (async () => {
      if (await shouldBlockAssistantInputFromForegroundApp()) {
        logClientEvent("[hotkey.global.command] blocked by foreground app policy");
        return;
      }
      toggleCommandModeArmed();
      logClientEvent(`[hotkey.global.command] toggled commandModeArmed=${boolFlag(commandModeArmed)}`);
    })();
    return;
  }

  logClientEvent("[hotkey.global.event] no handler matched the incoming shortcut");
}

function normalizeHotkeyModifierToken(token: string): "ctrl" | "shift" | "alt" | "meta" | "" {
  const normalized = token.trim().toLowerCase();
  if (
    normalized === "commandorcontrol" ||
    normalized === "commandorctrl" ||
    normalized === "cmdorctrl" ||
    normalized === "cmdorcontrol" ||
    normalized === "ctrl" ||
    normalized === "control"
  ) {
    return "ctrl";
  }
  if (normalized === "shift") {
    return "shift";
  }
  if (normalized === "alt" || normalized === "option" || normalized === "altgraph") {
    return "alt";
  }
  if (
    normalized === "super" ||
    normalized === "meta" ||
    normalized === "cmd" ||
    normalized === "command" ||
    normalized === "win" ||
    normalized === "os"
  ) {
    return "meta";
  }
  return "";
}

const GLOBAL_SHORTCUT_KEY_MAP: Record<string, string> = {
  space: "Space",
  enter: "Enter",
  tab: "Tab",
  escape: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  insert: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  capslock: "CapsLock",
  numlock: "NumLock",
  scrolllock: "ScrollLock",
  printscreen: "PrintScreen",
  pause: "Pause",
  plus: "Plus",
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
  "[": "BracketLeft",
  "]": "BracketRight",
  numpadadd: "NumpadAdd",
  numpadsubtract: "NumpadSubtract",
  numpadmultiply: "NumpadMultiply",
  numpaddivide: "Numpaddivide",
  numpaddecimal: "NumpadDecimal",
  numpadenter: "NumpadEnter",
};

const FUNCTION_KEY_PATTERN = /^f([1-9]|1[0-9]|2[0-4])$/;
function isFunctionKeyToken(value: string): boolean {
  return FUNCTION_KEY_PATTERN.test(value);
}

const NUMPAD_DIGIT_PATTERN = /^numpad[0-9]$/;
function isNumpadDigitToken(value: string): boolean {
  return NUMPAD_DIGIT_PATTERN.test(value);
}

function isAsciiLowerAlphaNumeric(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 97 && code <= 122) || (code >= 48 && code <= 57);
}

function toGlobalShortcutKeyToken(key: string): string {
  if (isFunctionKeyToken(key)) {
    return key.toUpperCase();
  }
  if (isNumpadDigitToken(key)) {
    return `Numpad${key.slice(-1)}`;
  }
  if (key.length === 1 && isAsciiLowerAlphaNumeric(key)) {
    return key.toUpperCase();
  }
  const mappedKey = GLOBAL_SHORTCUT_KEY_MAP[key];
  return typeof mappedKey === "string" ? mappedKey : key;
}

function toGlobalShortcutString(hotkey: HotkeySpec): string {
  const parts: string[] = [];
  if (hotkey.ctrl) parts.push("CommandOrControl");
  if (hotkey.shift) parts.push("Shift");
  if (hotkey.alt) parts.push("Alt");
  if (hotkey.meta) parts.push("Super");
  parts.push(toGlobalShortcutKeyToken(hotkey.key));
  return parts.join("+");
}

function markGlobalShortcutHandled(shortcutToken: string, state: "pressed" | "released"): void {
  lastGlobalShortcutToken = shortcutToken;
  lastGlobalShortcutState = state;
  lastGlobalShortcutHandledAt = Date.now();
}

function shouldIgnoreLocalShortcutFromRecentGlobal(
  shortcutToken: string,
  state: "pressed" | "released",
): boolean {
  if (!globalShortcutsActive) {
    return false;
  }

  if (lastGlobalShortcutState !== state || lastGlobalShortcutToken !== shortcutToken) {
    return false;
  }

  const elapsed = Date.now() - lastGlobalShortcutHandledAt;
  const shouldIgnore = elapsed >= 0 && elapsed <= 180;
  if (shouldIgnore) {
    logClientEvent(
      `[hotkey.local.dedupe] ignored state=${state} shortcut=${shortcutToken} elapsedMs=${elapsed}`,
    );
  }
  return shouldIgnore;
}

function normalizeShortcutToken(value: string): string {
  const rawTokens = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (rawTokens.length === 0) {
    return "";
  }

  let ctrl = false;
  let shift = false;
  let alt = false;
  let meta = false;
  let key = "";

  for (const token of rawTokens) {
    const modifier = normalizeHotkeyModifierToken(token);
    if (modifier) {
      if (modifier === "ctrl") ctrl = true;
      if (modifier === "shift") shift = true;
      if (modifier === "alt") alt = true;
      if (modifier === "meta") meta = true;
      continue;
    }

    if (!key) {
      key = normalizeHotkeyKeyToken(token) || token.trim().toLowerCase();
    }
  }

  if (!key) {
    return "";
  }

  const ordered: string[] = [];
  if (ctrl) ordered.push("ctrl");
  if (shift) ordered.push("shift");
  if (alt) ordered.push("alt");
  if (meta) ordered.push("meta");
  ordered.push(key);
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
  setNotice("Hotkey capture enabled. Press your shortcut combination now.");
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
  hotkeyCaptureModifiers.ctrl = event.ctrlKey;
  hotkeyCaptureModifiers.shift = event.shiftKey;
  hotkeyCaptureModifiers.alt = event.altKey;
  hotkeyCaptureModifiers.meta = event.metaKey;
  if (
    normalizedKey === "escape" &&
    !hotkeyCaptureModifiers.ctrl &&
    !hotkeyCaptureModifiers.shift &&
    !hotkeyCaptureModifiers.alt &&
    !hotkeyCaptureModifiers.meta
  ) {
    cancelHotkeyCapture();
    setNotice("Hotkey capture canceled.");
    return;
  }

  if (isModifierKey(normalizedKey)) {
    hotkeyInput.value = formatHotkeyCapturePreview();
    return;
  }

  const candidateTokens: string[] = [];
  if (hotkeyCaptureModifiers.ctrl) candidateTokens.push("ctrl");
  if (hotkeyCaptureModifiers.shift) candidateTokens.push("shift");
  if (hotkeyCaptureModifiers.alt) candidateTokens.push("alt");
  if (hotkeyCaptureModifiers.meta) candidateTokens.push("meta");

  candidateTokens.push(normalizedKey);

  const parsed = parseHotkey(candidateTokens.join("+"));
  if (!parsed) {
    hotkeyInput.value = formatHotkeyCapturePreview();
    setNotice("Unsupported hotkey key. Try another combination.", true);
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
  setNotice("Command hotkey capture enabled. Press your shortcut combination now.");
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
  commandHotkeyCaptureModifiers.ctrl = event.ctrlKey;
  commandHotkeyCaptureModifiers.shift = event.shiftKey;
  commandHotkeyCaptureModifiers.alt = event.altKey;
  commandHotkeyCaptureModifiers.meta = event.metaKey;
  if (
    normalizedKey === "escape" &&
    !commandHotkeyCaptureModifiers.ctrl &&
    !commandHotkeyCaptureModifiers.shift &&
    !commandHotkeyCaptureModifiers.alt &&
    !commandHotkeyCaptureModifiers.meta
  ) {
    cancelCommandHotkeyCapture();
    setNotice("Command hotkey capture canceled.");
    return;
  }

  if (isModifierKey(normalizedKey)) {
    commandHotkeyInput.value = formatModifierPreview(commandHotkeyCaptureModifiers);
    return;
  }

  const candidateTokens: string[] = [];
  if (commandHotkeyCaptureModifiers.ctrl) candidateTokens.push("ctrl");
  if (commandHotkeyCaptureModifiers.shift) candidateTokens.push("shift");
  if (commandHotkeyCaptureModifiers.alt) candidateTokens.push("alt");
  if (commandHotkeyCaptureModifiers.meta) candidateTokens.push("meta");

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
  if (ZERO_PYTHON_MODE) {
    return "piper";
  }
  return value === "coqui" ? "coqui" : "piper";
}

function asRuntimeMode(value: unknown): RuntimeMode {
  return value === "local" ? "local" : "online";
}

function asDictationLanguageMode(value: unknown): DictationLanguageMode {
  return value === "multiple" ? "multiple" : "single";
}

function normalizeDictationLanguageCode(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");
  if (!raw) {
    return "";
  }

  const [base] = raw.split("-", 1);
  return DICTATION_LANGUAGE_LABELS[base] ? base : "";
}

function normalizeDictationLanguageAllowList(value: unknown): string[] {
  const rawValues: unknown[] = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];

  const next: string[] = [];
  for (const item of rawValues) {
    const normalized = normalizeDictationLanguageCode(item);
    if (!normalized || next.includes(normalized)) {
      continue;
    }
    next.push(normalized);
  }
  return next;
}

function formatDictationLanguageLabel(languageCode: string): string {
  return DICTATION_LANGUAGE_LABELS[languageCode] ?? languageCode;
}

function applyDictationLanguageSettingsToForm(next: PersistedSettings): void {
  const primaryLanguage = normalizeDictationLanguageCode(next.dictationLanguage);
  let mode = asDictationLanguageMode(next.dictationLanguageMode);
  let allowList = normalizeDictationLanguageAllowList(next.dictationLanguageAllowList);
  if (mode === "multiple" && allowList.length === 0 && primaryLanguage) {
    allowList = [primaryLanguage];
  }
  if (allowList.length > 1) {
    mode = "multiple";
  }

  dictationLanguageSelect.value = primaryLanguage;
  dictationLanguageModeSingleInput.checked = mode === "single";
  dictationLanguageModeMultipleInput.checked = mode === "multiple";
  dictationLanguageMultiWrap.hidden = mode !== "multiple";

  for (const option of dictationLanguageOptionInputs) {
    option.checked = mode === "multiple" && allowList.includes(option.value);
  }

  if (mode === "multiple") {
    if (allowList.length === 0) {
      dictationLanguageSummary.textContent = "Whisper language mode: Multiple (choose at least one language).";
    } else {
      const labels = allowList.map((code) => formatDictationLanguageLabel(code)).join(", ");
      dictationLanguageSummary.textContent = `Whisper language mode: Multiple (${labels}).`;
    }
  } else if (primaryLanguage) {
    dictationLanguageSummary.textContent = `Whisper language mode: Single (${formatDictationLanguageLabel(primaryLanguage)}).`;
  } else {
    dictationLanguageSummary.textContent = "Whisper language mode: Auto-detect.";
  }
}

function resolveSttLanguageConfig(next: PersistedSettings): {
  language: string | null;
  allowedLanguages: string[] | null;
} {
  const primaryLanguage = normalizeDictationLanguageCode(next.dictationLanguage);
  const mode = asDictationLanguageMode(next.dictationLanguageMode);
  let allowedLanguages =
    mode === "multiple"
      ? normalizeDictationLanguageAllowList(next.dictationLanguageAllowList)
      : primaryLanguage
        ? [primaryLanguage]
        : [];

  if (mode === "multiple" && primaryLanguage && !allowedLanguages.includes(primaryLanguage)) {
    allowedLanguages = [primaryLanguage, ...allowedLanguages];
  }

  const language =
    mode === "multiple"
      ? primaryLanguage || allowedLanguages[0] || null
      : primaryLanguage || null;

  return {
    language,
    allowedLanguages: allowedLanguages.length > 0 ? allowedLanguages : null,
  };
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
    return { sessions: 0, words: 0, avgWpm: 0, speakingSeconds: 0 };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UsageStats>;
    return {
      sessions: coerceInteger(parsed.sessions, 0, 0, 999_999),
      words: coerceInteger(parsed.words, 0, 0, 99_999_999),
      avgWpm: coerceNumber(parsed.avgWpm, 0, 0, 600),
      speakingSeconds: coerceInteger(parsed.speakingSeconds, 0, 0, 99_999_999),
    };
  } catch {
    return { sessions: 0, words: 0, avgWpm: 0, speakingSeconds: 0 };
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
  return CONVERSATION_TIME_FORMATTER.format(timestamp);
}

function createConversationEntryElement(entry: HomeHistoryEntry): HTMLElement {
  const row = document.createElement("article");
  row.className = `entry entry-${entry.tone}`;

  const timeEl = document.createElement("time");
  timeEl.className = "entry-time";
  timeEl.textContent = formatConversationTime(entry.timestamp);

  const speakerEl = document.createElement("p");
  speakerEl.className = "entry-speaker";
  speakerEl.textContent = entry.speaker;

  const contentEl = document.createElement("p");
  contentEl.className = "entry-content";
  contentEl.textContent = entry.content;

  const actionsEl = document.createElement("div");
  actionsEl.className = "entry-actions";

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "entry-action";
  copyBtn.textContent = "Copy";
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(entry.content);
    const originalText = copyBtn.textContent;
    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = originalText;
    }, 2000);
  };

  actionsEl.append(copyBtn);
  row.append(timeEl, speakerEl, contentEl, actionsEl);
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
  const fragment = document.createDocumentFragment();
  const recent = homeHistoryEntries.slice(0, 5);
  for (const entry of recent) {
    fragment.append(createConversationEntryElement(entry));
  }
  conversationLog.append(fragment);
}

function renderFullHistory(): void {
  if (settings.incognitoMode) {
    fullHistoryLog.innerHTML = '<p class="empty-hint">Incognito mode enabled. History is hidden.</p>';
    return;
  }

  if (homeHistoryEntries.length === 0) {
    fullHistoryLog.innerHTML = `<p class="empty-hint">${EMPTY_HISTORY_HINT}</p>`;
    return;
  }

  fullHistoryLog.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const entry of homeHistoryEntries) {
    fragment.append(createConversationEntryElement(entry));
  }
  fullHistoryLog.append(fragment);
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
  const fragment = document.createDocumentFragment();
  for (const term of filtered) {
    const row = document.createElement("div");
    row.className = "managed-row managed-row-grid";

    const mainEl = document.createElement("p");
    mainEl.className = "managed-row-main";
    const strongEl = document.createElement("strong");
    strongEl.textContent = term.source;
    const spanEl = document.createElement("span");
    spanEl.textContent = term.target;
    mainEl.append(strongEl, spanEl);

    const metaEl = document.createElement("span");
    metaEl.className = "managed-row-meta";
    metaEl.textContent = term.scope === "shared" ? "Shared" : "Personal";

    const actionsEl = document.createElement("div");
    actionsEl.className = "managed-row-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "inline-link";
    deleteBtn.dataset.dictionaryDelete = term.id;
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      dictionaryTerms = dictionaryTerms.filter((entry) => entry.id !== term.id);
      persistDictionaryTerms();
      renderDictionaryList();
    });
    actionsEl.append(deleteBtn);

    row.append(mainEl, metaEl, actionsEl);
    fragment.append(row);
  }
  dictionaryList.append(fragment);
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
  const fragment = document.createDocumentFragment();
  for (const snippet of filtered) {
    const row = document.createElement("div");
    row.className = "managed-row managed-row-grid";

    const mainEl = document.createElement("p");
    mainEl.className = "managed-row-main";
    const strongEl = document.createElement("strong");
    strongEl.textContent = snippet.trigger;
    const spanEl = document.createElement("span");
    spanEl.textContent = snippet.expansion;
    mainEl.append(strongEl, spanEl);

    const metaEl = document.createElement("span");
    metaEl.className = "managed-row-meta";
    metaEl.textContent = snippet.scope === "shared" ? "Shared" : "Personal";

    const actionsEl = document.createElement("div");
    actionsEl.className = "managed-row-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "inline-link";
    deleteBtn.dataset.snippetDelete = snippet.id;
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      snippets = snippets.filter((entry) => entry.id !== snippet.id);
      persistSnippets();
      renderSnippetsList();
    });
    actionsEl.append(deleteBtn);

    row.append(mainEl, metaEl, actionsEl);
    fragment.append(row);
  }
  snippetsList.append(fragment);
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
  const fragment = document.createDocumentFragment();
  for (const note of quickNotes) {
    const row = document.createElement("article");
    row.className = "managed-row managed-row-grid managed-row-note";
    const time = NOTE_TIME_FORMATTER.format(note.createdAt);

    const mainEl = document.createElement("p");
    mainEl.className = "managed-row-main";
    const strongEl = document.createElement("strong");
    strongEl.textContent = "Quick note";
    const spanEl = document.createElement("span");
    spanEl.textContent = note.text;
    mainEl.append(strongEl, spanEl);

    const metaEl = document.createElement("span");
    metaEl.className = "managed-row-meta";
    metaEl.textContent = time;

    const actionsEl = document.createElement("div");
    actionsEl.className = "managed-row-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "inline-link";
    deleteBtn.dataset.noteDelete = note.id;
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      quickNotes = quickNotes.filter((entry) => entry.id !== note.id);
      persistQuickNotes();
      renderNotesList();
    });
    actionsEl.append(deleteBtn);

    row.append(mainEl, metaEl, actionsEl);
    fragment.append(row);
  }
  notesList.append(fragment);
}

function formatSpeakingTime(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours <= 0) {
    return `${minutes}m`;
  }

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function updateUsageMetrics(): void {
  metricWords.textContent = `${usageStats.words} words`;
  metricSpeakingTime.textContent = formatSpeakingTime(usageStats.speakingSeconds);
  metricSessions.textContent = `${usageStats.sessions}`;
  metricWpm.innerHTML = `${Math.round(usageStats.avgWpm)} <span class="stat-unit">wpm</span>`;
}

function trackUsage(transcript: string): void {
  const words = countWords(transcript);
  usageStats.sessions += 1;
  usageStats.words += words;
  const seconds = Math.max((Date.now() - recordingStartedAt) / 1000, 1);
  usageStats.speakingSeconds += Math.round(seconds);
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
  renderLocalOllamaModelCatalog(localOllamaModelCatalog, settings.localOllamaModel);
  renderLocalSttModelCatalog(localSttModelCatalog, settings.localSttModel);

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
      setNotice(ZERO_PYTHON_MODE ? "Piper runtime is ready." : "All TTS runtimes are ready.");
      if (stage !== "recording") {
        setStage("idle", "TTS setup complete.");
      }
    } else {
      setNotice("TTS setup failed. Review logs in Settings > Models.", true);
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
      if (!ZERO_PYTHON_MODE && (status.completed || settings.ttsEngine === "coqui")) {
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

  setStage("processing", ZERO_PYTHON_MODE ? "Setting up Piper runtime..." : "Setting up Piper and Coqui runtimes...");
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

function renderLocalOllamaModelCatalog(models: string[], selectedModel = ""): void {
  const normalized = Array.from(new Set(models.map((model) => model.trim()).filter(Boolean))).sort();
  const fallbackModel =
    selectedModel.trim() || localOllamaModelInput.value.trim() || settings.localOllamaModel.trim();
  const finalModels =
    normalized.length > 0
      ? normalized
      : fallbackModel
        ? [fallbackModel]
        : [];
  localOllamaModelCatalog = finalModels;

  if (finalModels.length === 0) {
    localOllamaModelCatalogSelect.innerHTML = '<option value="">No models available</option>';
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
  localOllamaModelCatalogSelect.innerHTML = options.join("");
  localOllamaModelCatalogSelect.value = selected;
}

function renderLocalSttModelCatalog(models: string[], selectedModel = ""): void {
  const normalized = Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));
  localSttModelCatalog = normalized;

  if (normalized.length === 0) {
    localSttModelCatalogSelect.innerHTML = '<option value="">No models available</option>';
    return;
  }

  const selected = normalized.includes(selectedModel.trim()) ? selectedModel.trim() : "";
  const currentInputModel = localSttModelInput.value.trim();
  const selectedOrCurrent = selected || (normalized.includes(currentInputModel) ? currentInputModel : "");
  if (currentInputModel && !normalized.includes(currentInputModel)) {
    localSttModelInput.value = "";
  }
  const options = ['<option value="">Select a model...</option>'];
  for (const model of normalized) {
    const active = model === selectedOrCurrent ? " selected" : "";
    const label = LOCAL_STT_MODEL_SIZE_LABELS[model] || model;
    options.push(`<option value="${escapeHtml(model)}"${active}>${escapeHtml(label)}</option>`);
  }
  localSttModelCatalogSelect.innerHTML = options.join("");
  localSttModelCatalogSelect.value = selectedOrCurrent;
}

async function fetchProviderModels(): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    return;
  }
  const activeSettings = readSettingsFromForm();
  const anyOnlineRuntime =
    activeSettings.sttRuntimeMode === "online" || activeSettings.aiRuntimeMode === "online";
  if (!anyOnlineRuntime) {
    setNotice("Enable online STT or online AI mode to fetch provider models.", true);
    return;
  }
  if (!activeSettings.apiKey) {
    setNotice("API key is required to fetch model catalog.", true);
    setActiveSettingsPane("online");
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

function renderOllamaStatus(status: OllamaStatusResponse): void {
  const versionSuffix = status.version ? ` (${status.version})` : "";
  if (status.installed && status.running) {
    ollamaStatusNotice.textContent = `Ollama is ready${versionSuffix}. ${status.details || ""}`.trim();
    return;
  }
  if (status.installed) {
    ollamaStatusNotice.textContent =
      `Ollama is installed${versionSuffix} but the local service is not reachable. ` +
      (status.details || "Start Ollama to enable local AI models.");
    return;
  }
  ollamaStatusNotice.textContent = status.details || "Ollama is not installed.";
}

async function refreshOllamaStatus(options: { quiet?: boolean } = {}): Promise<void> {
  if (ollamaStatusInFlight || ollamaInstallInFlight) {
    return;
  }
  if (pipelineRunning || stage === "recording") {
    return;
  }

  const quiet = options.quiet === true;
  const activeSettings = readSettingsFromForm();
  ollamaStatusInFlight = true;
  syncActionAvailability();
  if (!quiet) {
    setStage("processing", "Checking Ollama status...");
  }

  try {
    const request = {
      baseUrl: activeSettings.localOllamaBaseUrl || null,
    };
    const status = await invoke<OllamaStatusResponse>("get_ollama_status", { request });
    renderOllamaStatus(status);
    if (!quiet) {
      setNotice(status.details || "Ollama status updated.");
      setStage("idle", "Ollama status checked.");
    }
  } catch (error) {
    const message = asErrorMessage(error);
    ollamaStatusNotice.textContent = `Unable to determine Ollama status: ${message}`;
    if (!quiet) {
      setNotice(`Unable to determine Ollama status: ${message}`, true);
      setStage("idle", "Ollama status unavailable.");
    }
  } finally {
    ollamaStatusInFlight = false;
    syncActionAvailability();
  }
}

async function installOllama(): Promise<void> {
  if (ollamaInstallInFlight || pipelineRunning || stage === "recording") {
    return;
  }

  ollamaInstallInFlight = true;
  syncActionAvailability();
  setStage("processing", "Installing Ollama...");

  try {
    const status = await invoke<OllamaStatusResponse>("install_ollama");
    renderOllamaStatus(status);
    if (status.running) {
      setNotice("Ollama installation completed and service is reachable.");
      setStage("idle", "Ollama installed.");
      await fetchOllamaModels();
    } else if (status.installed) {
      setNotice(
        "Ollama installer finished. Start Ollama once to bring up the local service endpoint.",
      );
      setStage("idle", "Ollama install finished.");
    } else {
      setNotice(status.details || "Ollama install did not complete yet.", true);
      setStage("idle", "Ollama install needs attention.");
    }
  } catch (error) {
    setNotice(`Unable to install Ollama from app: ${asErrorMessage(error)}`, true);
    setStage("idle", "Ollama install failed.");
  } finally {
    ollamaInstallInFlight = false;
    syncActionAvailability();
  }
}

async function fetchOllamaModels(
  options: { quiet?: boolean; autoSelect?: boolean } = {},
): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    return;
  }
  const quiet = options.quiet === true;
  const autoSelect = options.autoSelect === true;
  const activeSettings = readSettingsFromForm();
  if (!quiet) {
    setStage("processing", "Loading Ollama model catalog...");
  }
  try {
    const request = {
      baseUrl: activeSettings.localOllamaBaseUrl || null,
    };
    const response = await invoke<ProviderModelsResponse>("fetch_ollama_models", { request });
    renderLocalOllamaModelCatalog(response.models, activeSettings.localOllamaModel);
    if (
      autoSelect &&
      !activeSettings.localOllamaModel.trim() &&
      response.models.length > 0
    ) {
      const fallback = pickDefaultLocalOllamaModelFromCatalog();
      if (fallback) {
        localOllamaModelInput.value = fallback;
        if (localOllamaModelCatalog.includes(fallback)) {
          localOllamaModelCatalogSelect.value = fallback;
        }
        handleSettingsChange();
        if (!quiet) {
          setNotice(`Auto-selected local Ollama model "${fallback}".`);
        }
      }
    } else if (!quiet) {
      setNotice(`Loaded ${response.models.length} Ollama models.`);
    }
    if (!quiet) {
      setStage("idle", "Ollama model list loaded.");
    }
  } catch (error) {
    if (!quiet) {
      setNotice(`Unable to load Ollama model catalog: ${asErrorMessage(error)}`, true);
      setStage("idle", "Ollama model list unavailable.");
    }
  } finally {
    syncActionAvailability();
  }
}

async function ensureLocalOllamaModelSelected(options: { quiet?: boolean } = {}): Promise<string> {
  const quiet = options.quiet === true;
  const activeSettings = readSettingsFromForm();
  let selected = activeSettings.localOllamaModel.trim() || localOllamaModelCatalogSelect.value.trim();
  if (selected && !looksLikeEmbeddingOnlyOllamaModel(selected)) {
    return selected;
  }

  await fetchOllamaModels({ quiet: true, autoSelect: true });
  const refreshed = readSettingsFromForm();
  selected = refreshed.localOllamaModel.trim() || localOllamaModelCatalogSelect.value.trim();
  if (selected && looksLikeEmbeddingOnlyOllamaModel(selected)) {
    const fallback = pickDefaultLocalOllamaModelFromCatalog();
    if (fallback && fallback !== selected) {
      localOllamaModelInput.value = fallback;
      if (localOllamaModelCatalog.includes(fallback)) {
        localOllamaModelCatalogSelect.value = fallback;
      }
      handleSettingsChange();
      selected = fallback;
    }
  }
  if (selected && looksLikeEmbeddingOnlyOllamaModel(selected) && !quiet) {
    setNotice(
      `Selected Ollama model "${selected}" appears embedding-only. Choose a chat model (for example llama, qwen, mistral, gemma).`,
      true,
    );
    setActiveSettingsPane("offline");
  }
  if (!selected && !quiet) {
    setNotice(
      "No local Ollama model is selected. Open Settings > Models and pull/download a model.",
      true,
    );
    setActiveSettingsPane("offline");
  }
  return selected;
}

async function pullOllamaModel(): Promise<void> {
  if (pipelineRunning || stage === "recording" || ollamaPullInFlight) {
    return;
  }
  const activeSettings = readSettingsFromForm();
  const model = activeSettings.localOllamaModel.trim() || localOllamaModelCatalogSelect.value.trim();
  if (!model) {
    setNotice("Enter or select an Ollama model to pull/download.", true);
    setActiveSettingsPane("offline");
    return;
  }

  setStage("processing", `Pulling Ollama model "${model}"...`);
  ollamaPullInFlight = true;
  syncActionAvailability();

  try {
    const request = {
      baseUrl: activeSettings.localOllamaBaseUrl || null,
      model,
    };
    const response = await invoke<OllamaPullResponse>("pull_ollama_model", { request });
    localOllamaModelInput.value = response.model;
    handleSettingsChange();
    setNotice(`Ollama pull complete: ${response.status || response.model}.`);
    await fetchOllamaModels();
  } catch (error) {
    setNotice(`Unable to pull Ollama model: ${asErrorMessage(error)}`, true);
    setStage("idle", "Ollama pull failed.");
  } finally {
    ollamaPullInFlight = false;
    syncActionAvailability();
  }
}

async function fetchLocalSttModels(options: { quiet?: boolean } = {}): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    return;
  }
  const activeSettings = readSettingsFromForm();
  const quiet = options.quiet === true;

  if (!quiet) {
    setStage("processing", "Loading local STT model catalog...");
  }
  try {
    const response = await invoke<ProviderModelsResponse>("fetch_local_stt_models");
    renderLocalSttModelCatalog(response.models, activeSettings.localSttModel);
    if (!quiet) {
      setNotice(`Loaded ${response.models.length} local STT models.`);
      setStage("idle", "Local STT model list loaded.");
    }
  } catch (error) {
    if (!quiet) {
      setNotice(`Unable to load local STT model catalog: ${asErrorMessage(error)}`, true);
      setStage("idle", "Local STT model list unavailable.");
    }
  } finally {
    syncActionAvailability();
  }
}

function renderSidebarLocalSttToggle(): void {
  const activeSettings = readSettingsFromForm();
  const isLocalMode = activeSettings.sttRuntimeMode === "local";

  // Hide the button completely when STT mode is Online
  if (!isLocalMode) {
    sidebarToggleLocalSttBtn.hidden = true;
    return;
  }

  // Only show button in Local mode
  sidebarToggleLocalSttBtn.hidden = false;

  const loaded = isSelectedLocalSttModelLoaded();
  const hasModel = !!activeSettings.localSttModel.trim();

  if (!hasModel) {
    // No model selected/downloaded
    sidebarToggleLocalSttGlyph.textContent = "⬇️";
    sidebarToggleLocalSttLabel.textContent = "Download Model";
    const actionText = "Download offline model first";
    sidebarToggleLocalSttBtn.setAttribute("data-label", actionText);
    sidebarToggleLocalSttBtn.setAttribute("aria-label", actionText);
    sidebarToggleLocalSttBtn.title = "No offline model downloaded. Click for instructions.";
    sidebarToggleLocalSttBtn.style.opacity = "0.7";
  } else if (loaded) {
    // Model is loaded
    sidebarToggleLocalSttGlyph.textContent = "⏻";
    sidebarToggleLocalSttLabel.textContent = "Unload STT";
    const actionText = "Unload local STT model";
    sidebarToggleLocalSttBtn.setAttribute("data-label", actionText);
    sidebarToggleLocalSttBtn.setAttribute("aria-label", actionText);
    sidebarToggleLocalSttBtn.title = `Local STT model loaded: ${activeSettings.localSttModel}`;
    sidebarToggleLocalSttBtn.style.opacity = "1";
  } else {
    // Model exists but not loaded yet
    sidebarToggleLocalSttGlyph.textContent = "▶";
    sidebarToggleLocalSttLabel.textContent = "Load STT";
    const actionText = "Load local STT model";
    sidebarToggleLocalSttBtn.setAttribute("data-label", actionText);
    sidebarToggleLocalSttBtn.setAttribute("aria-label", actionText);
    sidebarToggleLocalSttBtn.title = `Load model: ${activeSettings.localSttModel || 'Select from Settings'}`;
    sidebarToggleLocalSttBtn.style.opacity = "1";
  }
}

function getSelectedLocalSttModel(): string {
  const activeSettings = readSettingsFromForm();
  return activeSettings.localSttModel.trim() || localSttModelCatalogSelect.value.trim();
}

function isSelectedLocalSttModelLoaded(): boolean {
  const selectedModel = getSelectedLocalSttModel();
  if (!selectedModel || !localSttRuntimeLoaded) {
    return false;
  }
  return lastWarmedLocalSttModel.trim() === selectedModel;
}

function localSttModelLabel(model: string): string {
  const normalized = model.trim();
  if (!normalized) {
    return "-";
  }
  return LOCAL_STT_MODEL_SIZE_LABELS[normalized] || normalized;
}

function localSttPerformanceTierLabel(tier: string): string {
  const normalized = tier.trim().toLowerCase();
  if (normalized === "performance") {
    return "Performance";
  }
  if (normalized === "balanced") {
    return "Balanced";
  }
  return "Basic";
}

function hasShownLocalSttHardwareAdvisor(): boolean {
  return localStorage.getItem(LOCAL_STT_HARDWARE_ADVISOR_STORAGE_KEY) === "1";
}

function markLocalSttHardwareAdvisorShown(): void {
  localStorage.setItem(LOCAL_STT_HARDWARE_ADVISOR_STORAGE_KEY, "1");
}

function resolveLocalSttHardwareAdvisorChoice(choice: LocalSttHardwareAdvisorChoice): void {
  if (localSttHardwareAdvisorResolver) {
    const resolver = localSttHardwareAdvisorResolver;
    localSttHardwareAdvisorResolver = null;
    localSttHardwareAdvisorOpen = false;
    sttHardwareAdvisorOverlay.hidden = true;
    syncActionAvailability();
    resolver(choice);
    return;
  }
  localSttHardwareAdvisorOpen = false;
  sttHardwareAdvisorOverlay.hidden = true;
  syncActionAvailability();
}

async function suggestLocalSttModelForHardwareIfNeeded(selectedModel: string): Promise<string | null> {
  if (hasShownLocalSttHardwareAdvisor()) {
    return selectedModel;
  }

  let advice: LocalSttHardwareAdviceResponse;
  try {
    advice = await invoke<LocalSttHardwareAdviceResponse>("get_local_stt_hardware_advice", {
      request: { selectedModel },
    });
  } catch (error) {
    markLocalSttHardwareAdvisorShown();
    setNotice(
      `Hardware recommendation check failed. Continuing with selected model: ${asErrorMessage(error)}`,
      true,
    );
    return selectedModel;
  }

  const suggestionModel = advice.slasshySuggestionModel?.trim() || selectedModel;
  localSttHardwareAdvisorSelectedModel = selectedModel;
  localSttHardwareAdvisorSuggestionModel = suggestionModel;

  const cpuLabel = advice.cpuName?.trim() || "Unknown CPU";
  const ramLabel =
    advice.totalRamGb > 0 ? `${advice.totalRamGb.toFixed(1)} GB RAM` : "Unknown RAM capacity";
  const coreLabel =
    advice.logicalCores > 0 ? `${advice.logicalCores} logical cores` : "Unknown core count";
  const gpuLabel = advice.nvidiaGpuDetected
    ? advice.gpuVramGb > 0
      ? `${advice.gpuName || "NVIDIA GPU"} (${advice.gpuVramGb.toFixed(1)} GB VRAM)`
      : advice.gpuName || "NVIDIA GPU"
    : "No NVIDIA GPU detected";

  sttHardwareAdvisorHardware.textContent =
    `Detected hardware: ${cpuLabel} • ${coreLabel} • ${ramLabel} • ${gpuLabel}. ` +
    `Tier: ${localSttPerformanceTierLabel(advice.performanceTier)}.`;
  sttHardwareAdvisorSuggestion.textContent =
    `SlasshyWispr Suggestion: ${localSttModelLabel(suggestionModel)}`;

  const suggestedLabels = advice.suggestedModels
    .map((model) => localSttModelLabel(model))
    .filter((label) => label !== "-");
  sttHardwareAdvisorList.textContent =
    suggestedLabels.length > 0
      ? `Recommended for your hardware: ${suggestedLabels.join(", ")}.`
      : "Recommended for your hardware: start with smaller models first.";

  const cautionLabels = advice.cautionModels
    .map((model) => localSttModelLabel(model))
    .filter((label) => label !== "-");
  const warningLead =
    advice.selectedModelWarning?.trim() ||
    "Warning: Higher models can be system-hungry and can feel slow on basic hardware.";
  sttHardwareAdvisorWarning.textContent =
    cautionLabels.length > 0
      ? `${warningLead} Heavy options on this hardware: ${cautionLabels.join(", ")}.`
      : warningLead;

  sttHardwareAdvisorUseSuggestionBtn.textContent =
    `Use suggestion (${localSttModelLabel(suggestionModel)})`;
  sttHardwareAdvisorContinueBtn.textContent =
    `Continue selected (${localSttModelLabel(selectedModel)})`;

  localSttHardwareAdvisorOpen = true;
  sttHardwareAdvisorOverlay.hidden = false;
  syncActionAvailability();

  const choice = await new Promise<LocalSttHardwareAdvisorChoice>((resolve) => {
    localSttHardwareAdvisorResolver = resolve;
  });
  markLocalSttHardwareAdvisorShown();

  if (choice === "cancel") {
    localSttDownloadNotice.textContent = "Local STT model download canceled.";
    setNotice("Local STT model download canceled.");
    return null;
  }
  if (choice === "suggestion") {
    return localSttHardwareAdvisorSuggestionModel || selectedModel;
  }
  return localSttHardwareAdvisorSelectedModel || selectedModel;
}

function updateLocalSttLoadOverlayDetail(): void {
  if (sttLoadOverlay.hidden) {
    return;
  }
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - localSttLoadOverlayStartedAt) / 1000));
  let phase = "Starting local STT runtime...";
  if (elapsedSeconds >= 8 && elapsedSeconds < 24) {
    phase = "Loading model into memory...";
  } else if (elapsedSeconds >= 24) {
    phase = "Still loading. Larger models and slower hardware take longer.";
  }
  sttLoadDetail.textContent = `${phase} (${elapsedSeconds}s elapsed). Time depends on your CPU/GPU, RAM, and selected model size.`;
}

function showLocalSttLoadOverlay(model: string): void {
  localSttLoadOverlayStartedAt = Date.now();
  sttLoadModel.textContent = `Model: ${model}`;
  sttLoadOverlay.hidden = false;
  updateLocalSttLoadOverlayDetail();
  if (localSttLoadOverlayTickerId !== null) {
    window.clearInterval(localSttLoadOverlayTickerId);
  }
  localSttLoadOverlayTickerId = window.setInterval(() => {
    updateLocalSttLoadOverlayDetail();
  }, 350);
}

function hideLocalSttLoadOverlay(): void {
  if (localSttLoadOverlayTickerId !== null) {
    window.clearInterval(localSttLoadOverlayTickerId);
    localSttLoadOverlayTickerId = null;
  }
  sttLoadOverlay.hidden = true;
}

async function refreshLocalSttRuntimeState(options: { quiet?: boolean } = {}): Promise<void> {
  if (localSttRuntimeStateInFlight) {
    return;
  }
  localSttRuntimeStateInFlight = true;
  syncActionAvailability();
  try {
    const response = await invoke<LocalSttRuntimeStateResponse>("get_local_stt_runtime_state");
    localSttRuntimeLoaded = response.loaded;
    if (!response.loaded) {
      lastWarmedLocalSttModel = "";
    }
    renderSidebarLocalSttToggle();
  } catch (error) {
    if (!options.quiet) {
      setNotice(`Unable to check local STT runtime state: ${asErrorMessage(error)}`, true);
    }
  } finally {
    localSttRuntimeStateInFlight = false;
    syncActionAvailability();
  }
}

async function activateSelectedLocalSttModel(): Promise<void> {
  if (
    pipelineRunning ||
    stage === "recording" ||
    localSttDownloadInFlight ||
    localSttDeleteInFlight ||
    localSttDeactivateInFlight ||
    localSttWarmupInFlight ||
    localSttRuntimeStateInFlight ||
    localSttDownloadActive
  ) {
    return;
  }

  const activeSettings = readSettingsFromForm();

  // DIAGNOSTIC #1: Check if STT mode is set to local
  if (activeSettings.sttRuntimeMode !== "local") {
    showOfflineModeDiagnostic('wrong-stt-mode', {
      model: activeSettings.localSttModel || undefined
    });
    return;
  }

  // Get selected model
  const model = activeSettings.localSttModel.trim() || localSttModelCatalogSelect.value.trim();

  // DIAGNOSTIC #2: Check if a model is selected
  if (!model) {
    showOfflineModeDiagnostic('no-model-downloaded');
    return;
  }

  localSttModelInput.value = model;
  if (localSttModelCatalog.includes(model)) {
    localSttModelCatalogSelect.value = model;
  }
  handleSettingsChange();
  localSttDownloadNotice.textContent = "Loading model...";
  setNotice("Loading model...");
  showLocalSttLoadOverlay(model);
  syncActionAvailability();

  try {
    // DIAGNOSTIC #3: Check if model file exists before attempting to load
    const modelExists = await checkModelFileExists(model);
    if (!modelExists) {
      hideLocalSttLoadOverlay();
      showOfflineModeDiagnostic('model-file-missing', { model });
      return;
    }

    // DIAGNOSTIC #4: Check Python dependencies
    const pythonReady = await checkPythonDependencies();
    if (!pythonReady) {
      hideLocalSttLoadOverlay();
      showOfflineModeDiagnostic('python-deps-missing', { model });
      return;
    }

    // DIAGNOSTIC #5: Check available memory
    const memoryOk = await checkAvailableMemory(model);
    if (!memoryOk.sufficient) {
      hideLocalSttLoadOverlay();
      showOfflineModeDiagnostic('insufficient-memory', {
        model,
        availableMemory: memoryOk.availableMB
      });
      return;
    }

    // All checks passed, attempt to warmup
    await warmupActiveLocalSttModel({ quiet: true, force: true, explicit: true });
    await refreshLocalSttRuntimeState({ quiet: true });
    const selectedModelLoaded = isSelectedLocalSttModelLoaded();
    if (selectedModelLoaded) {
      localSttDownloadNotice.textContent = "Model loaded.";
      setNotice("Model loaded.");
    } else {
      localSttDownloadNotice.textContent = "Unable to load model.";
      showOfflineModeDiagnostic('load-timeout', { model });
    }
  } catch (error) {
    const message = asErrorMessage(error);
    localSttDownloadNotice.textContent = `Load failed: ${message}`;
    showOfflineModeDiagnostic(message, { model });
  } finally {
    hideLocalSttLoadOverlay();
    syncActionAvailability();
  }
}

async function warmupActiveLocalSttModel(
  options: { quiet?: boolean; force?: boolean; explicit?: boolean } = {},
): Promise<void> {
  if (localSttWarmupInFlight) {
    return;
  }

  const activeSettings = readSettingsFromForm();
  const explicit = options.explicit === true;
  if (!explicit && activeSettings.sttRuntimeMode !== "local") {
    return;
  }

  const model = activeSettings.localSttModel.trim() || localSttModelCatalogSelect.value.trim();
  if (!model) {
    return;
  }

  const force = options.force === true;
  if (!force && localSttRuntimeLoaded && lastWarmedLocalSttModel === model) {
    return;
  }

  localSttWarmupInFlight = true;
  syncActionAvailability();
  const quiet = options.quiet === true;
  try {
    const response = await invoke<LocalSttWarmupResponse>("warmup_local_stt_model", {
      request: { model },
    });
    if (response.warmed) {
      lastWarmedLocalSttModel = response.model;
      localSttRuntimeLoaded = true;
      renderSidebarLocalSttToggle();
      if (!quiet) {
        setNotice(response.details || `Local STT model warmed: ${response.model}.`);
      }
    } else if (!quiet) {
      setNotice(response.details || `Local STT model warmup skipped: ${response.model}.`, true);
    }
  } catch (error) {
    if (!quiet) {
      setNotice(`Local STT warmup failed: ${asErrorMessage(error)}`, true);
    }
  } finally {
    localSttWarmupInFlight = false;
    void refreshLocalSttRuntimeState({ quiet: true });
    syncActionAvailability();
  }
}

async function deactivateLocalSttModel(): Promise<void> {
  if (
    pipelineRunning ||
    stage === "recording" ||
    localSttDownloadInFlight ||
    localSttDeleteInFlight ||
    localSttDeactivateInFlight ||
    localSttDownloadActive
  ) {
    return;
  }

  const activeSettings = readSettingsFromForm();
  const model =
    activeSettings.localSttModel.trim() ||
    localSttModelCatalogSelect.value.trim() ||
    lastWarmedLocalSttModel.trim();

  localSttDeactivateInFlight = true;
  syncActionAvailability();
  try {
    const request = { model: model || null };
    const response = await invoke<LocalSttDeactivateResponse>("deactivate_local_stt_model", {
      request,
    });
    if (response.deactivated) {
      lastWarmedLocalSttModel = "";
      localSttRuntimeLoaded = false;
      renderSidebarLocalSttToggle();
      localSttDownloadNotice.textContent = response.details;
      setNotice(response.details);
    } else {
      localSttDownloadNotice.textContent = response.details;
      setNotice(response.details, true);
    }
  } catch (error) {
    const message = asErrorMessage(error);
    setNotice(`Unable to deactivate local STT model: ${message}`, true);
  } finally {
    localSttDeactivateInFlight = false;
    void refreshLocalSttRuntimeState({ quiet: true });
    syncActionAvailability();
  }
}

function formatBytes(value: number): string {
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

function applyLocalSttDownloadStatus(status: LocalSttDownloadStatusResponse): void {
  const rawPercent = Number.isFinite(status.progressPercent) ? status.progressPercent : 0;
  const boundedPercent = Math.max(
    0,
    Math.min(100, status.completed && status.success ? 100 : rawPercent),
  );
  localSttDownloadActive = status.active;
  localSttDownloadProgressBar.style.width = `${boundedPercent}%`;
  const progressTrack = localSttDownloadProgressBar.parentElement;
  progressTrack?.setAttribute("aria-valuenow", boundedPercent.toFixed(1));

  const filesSegment =
    status.filesTotal > 0 ? `${status.filesCompleted}/${status.filesTotal} files` : "Preparing";
  const bytesSegment =
    status.totalBytes > 0
      ? `${formatBytes(status.downloadedBytes)} / ${formatBytes(status.totalBytes)}`
      : `${formatBytes(status.downloadedBytes)}`;

  if (status.active) {
    localSttDownloadProgressText.textContent =
      `${status.stage || "Downloading..."} ${boundedPercent.toFixed(1)}% • ${filesSegment} • ${bytesSegment}`;
    return;
  }

  if (status.completed) {
    localSttDownloadProgressText.textContent = status.success
      ? "Model loaded."
      : status.message || status.stage || "Download finished.";
    return;
  }

  localSttDownloadProgressText.textContent =
    status.message || "No local STT download in progress.";
}

function stopLocalSttDownloadStatusPolling(): void {
  if (localSttDownloadStatusPollingId !== null) {
    window.clearInterval(localSttDownloadStatusPollingId);
    localSttDownloadStatusPollingId = null;
  }
}

function startLocalSttDownloadStatusPolling(): void {
  if (localSttDownloadStatusPollingId !== null) {
    return;
  }
  localSttDownloadStatusPollingId = window.setInterval(() => {
    void pollLocalSttDownloadStatusOnce({ quiet: true });
  }, 240);
}

async function pollLocalSttDownloadStatusOnce(options: { quiet?: boolean } = {}): Promise<void> {
  if (localSttDownloadStatusPollInFlight) {
    return;
  }
  localSttDownloadStatusPollInFlight = true;
  const wasActive = localSttDownloadActive;

  try {
    const status = await invoke<LocalSttDownloadStatusResponse>("get_local_stt_download_status");
    applyLocalSttDownloadStatus(status);
    if (status.active) {
      startLocalSttDownloadStatusPolling();
    } else {
      stopLocalSttDownloadStatusPolling();
    }

    const justFinished = status.completed && !status.active && (wasActive || localSttDownloadInFlight);
    if (justFinished) {
      const completionMessage =
        status.success ? "Model loaded." : status.message || "Local STT model download failed.";
      localSttDownloadNotice.textContent = completionMessage;
      if (status.success) {
        if (status.model.trim()) {
          lastWarmedLocalSttModel = status.model.trim();
        }
        setNotice(completionMessage);
        await fetchLocalSttModels({ quiet: true });
      } else {
        setNotice(completionMessage, true);
      }
    }
  } catch (error) {
    stopLocalSttDownloadStatusPolling();
    if (!options.quiet) {
      setNotice(`Unable to poll local STT download status: ${asErrorMessage(error)}`, true);
    }
  } finally {
    localSttDownloadStatusPollInFlight = false;
    syncActionAvailability();
  }
}

async function downloadLocalSttModel(): Promise<void> {
  if (
    pipelineRunning ||
    stage === "recording" ||
    localSttDownloadInFlight ||
    localSttDeleteInFlight ||
    localSttDeactivateInFlight ||
    localSttDownloadActive ||
    localSttHardwareAdvisorOpen
  ) {
    return;
  }
  const activeSettings = readSettingsFromForm();
  let model = activeSettings.localSttModel.trim() || localSttModelCatalogSelect.value.trim();
  if (!model) {
    setNotice("Enter or select a local STT model to download.", true);
    setActiveSettingsPane("offline");
    return;
  }

  const advisedModel = await suggestLocalSttModelForHardwareIfNeeded(model);
  if (!advisedModel) {
    return;
  }
  model = advisedModel.trim();
  if (!model) {
    setNotice("Select a local STT model from catalog first.", true);
    return;
  }
  if (localSttModelInput.value.trim() !== model) {
    localSttModelInput.value = model;
  }
  if (localSttModelCatalog.includes(model)) {
    localSttModelCatalogSelect.value = model;
  }
  handleSettingsChange();

  localSttDownloadInFlight = true;
  syncActionAvailability();

  try {
    const request = {
      model,
    };
    const response = await invoke<LocalSttDownloadResponse>("download_local_stt_model", { request });
    localSttModelInput.value = response.model;
    handleSettingsChange();
    localSttDownloadNotice.textContent = "Downloading model...";
    setNotice("Downloading model...");
    startLocalSttDownloadStatusPolling();
    await pollLocalSttDownloadStatusOnce({ quiet: true });
  } catch (error) {
    const message = asErrorMessage(error);
    setNotice(`Unable to download local STT model: ${message}`, true);
    localSttDownloadNotice.textContent = `Download failed: ${message}`;
  } finally {
    localSttDownloadInFlight = false;
    syncActionAvailability();
  }
}

async function deleteLocalSttModel(): Promise<void> {
  if (
    pipelineRunning ||
    stage === "recording" ||
    localSttDownloadInFlight ||
    localSttDeleteInFlight ||
    localSttDeactivateInFlight ||
    localSttDownloadActive
  ) {
    return;
  }

  const activeSettings = readSettingsFromForm();
  const model = activeSettings.localSttModel.trim() || localSttModelCatalogSelect.value.trim();
  if (!model) {
    setNotice("Select a local STT model first.", true);
    setActiveSettingsPane("offline");
    return;
  }

  localSttDeleteInFlight = true;
  syncActionAvailability();

  try {
    const request = { model };
    const response = await invoke<LocalSttDeleteResponse>("delete_local_stt_model", { request });
    localSttDownloadNotice.textContent = response.details;
    if (response.removed) {
      if (lastWarmedLocalSttModel === response.model) {
        lastWarmedLocalSttModel = "";
      }
      if (localSttModelInput.value.trim() === model) {
        localSttModelInput.value = "";
        localSttModelCatalogSelect.value = "";
        handleSettingsChange();
      }
      setNotice(`Deleted local STT model "${response.model}".`);
      await fetchLocalSttModels({ quiet: true });
    } else {
      setNotice(response.details, true);
    }
  } catch (error) {
    const message = asErrorMessage(error);
    setNotice(`Unable to delete local STT model: ${message}`, true);
  } finally {
    localSttDeleteInFlight = false;
    syncActionAvailability();
  }
}

async function openLocalSttModelPath(): Promise<void> {
  if (
    pipelineRunning ||
    stage === "recording" ||
    localSttDownloadInFlight ||
    localSttDeleteInFlight ||
    localSttDeactivateInFlight ||
    localSttDownloadActive
  ) {
    return;
  }

  const activeSettings = readSettingsFromForm();
  const model = activeSettings.localSttModel.trim() || localSttModelCatalogSelect.value.trim();

  // DIAGNOSTIC: Check if a model is selected first
  if (!model) {
    showOfflineModeDiagnostic('no-model-downloaded');
    return;
  }

  try {
    const request = { model };
    const response = await invoke<LocalSttOpenPathResponse>("open_local_stt_model_path", { request });

    if (response.opened) {
      localSttDownloadNotice.textContent = `Opened: ${response.localPath}`;
      setNotice(`✅ Opened model folder successfully!`);
    } else {
      // Model path doesn't exist - offer to download
      localSttDownloadNotice.textContent = response.details || "Model not found";
      showOfflineModeDiagnostic('model-file-missing', {
        model,
        expectedPath: response.localPath
      });
    }
  } catch (error) {
    const message = asErrorMessage(error);
    localSttDownloadNotice.textContent = `Failed to open: ${message}`;

    // Check if it's a backend command not found error
    if (message.includes("command not found") || message.includes("not implemented")) {
      setNotice("⚠️ Open folder feature not available in this version. Please use Online mode for now.", true);
    } else {
      setNotice(`Unable to open model folder: ${message}`, true);
    }
  }
}

function renderCoquiStatus(status: CoquiStatusResponse): void {
  coquiStatusValue.textContent = ZERO_PYTHON_MODE ? "Disabled" : status.available ? "Ready" : "Unavailable";
  coquiPythonValue.textContent = status.pythonPath || "-";
  coquiVersionValue.textContent = status.ttsVersion || "-";
  coquiCudaValue.textContent = status.cudaAvailable ? "Available" : "Not available";
  coquiVoiceDirValue.textContent = status.voiceDir || "-";
  coquiRuntimeInstalled = ZERO_PYTHON_MODE
    ? false
    :
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
  if (ZERO_PYTHON_MODE) {
    return;
  }
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
  if (ZERO_PYTHON_MODE) {
    return;
  }
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
  if (ZERO_PYTHON_MODE) {
    return;
  }
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
  if (ZERO_PYTHON_MODE) {
    setNotice(ZERO_PYTHON_TTS_NOTICE, true);
    return;
  }
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
  if (ZERO_PYTHON_MODE) {
    setNotice(ZERO_PYTHON_TTS_NOTICE, true);
    return;
  }
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

  // Optimization: use Int16Array view on the same buffer for faster PCM writing
  // Offset 44 is where the data chunk starts.
  const pcmData = new Int16Array(wavBuffer, 44, dataSize / 2);

  let pcmIndex = 0;
  if (numChannels === 2) {
    const left = channels[0];
    const right = channels[1];
    for (let frame = 0; frame < frameCount; frame += 1) {
      let sL = left[frame];
      if (sL > 1) sL = 1;
      else if (sL < -1) sL = -1;
      pcmData[pcmIndex++] = sL < 0 ? Math.round(sL * 0x8000) : Math.round(sL * 0x7fff);

      let sR = right[frame];
      if (sR > 1) sR = 1;
      else if (sR < -1) sR = -1;
      pcmData[pcmIndex++] = sR < 0 ? Math.round(sR * 0x8000) : Math.round(sR * 0x7fff);
    }
  } else if (numChannels === 1) {
    const channelData = channels[0];
    for (let frame = 0; frame < frameCount; frame += 1) {
      let sample = channelData[frame];
      if (sample > 1) sample = 1;
      else if (sample < -1) sample = -1;
      pcmData[frame] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
    }
  } else {
    for (let frame = 0; frame < frameCount; frame += 1) {
      for (let channel = 0; channel < numChannels; channel += 1) {
        let sample = channels[channel]?.[frame] ?? 0;
        if (sample > 1) sample = 1;
        else if (sample < -1) sample = -1;
        pcmData[pcmIndex++] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      }
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
  if (ZERO_PYTHON_MODE) {
    setCoquiCloneStatus(ZERO_PYTHON_TTS_NOTICE, true);
    setNotice(ZERO_PYTHON_TTS_NOTICE, true);
    return;
  }
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
  if (ZERO_PYTHON_MODE) {
    setCoquiCloneStatus(ZERO_PYTHON_TTS_NOTICE, true);
    setNotice(ZERO_PYTHON_TTS_NOTICE, true);
    return;
  }
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

function missingApiKeyForOnlineRuntime(activeSettings: PersistedSettings): boolean {
  const anyOnlineRuntime =
    activeSettings.sttRuntimeMode === "online" || activeSettings.aiRuntimeMode === "online";
  const apiKeyPresent = activeSettings.apiKey.trim().length > 0;
  return anyOnlineRuntime && !apiKeyPresent;
}

function showMissingApiKeyNotice(source: string): void {
  const message =
    "Recording blocked: API key is missing for online mode. Add API key in Settings > Models > Online provider.";
  setNotice(message, true);
  setStage("error", "Missing API key for online runtime.");
  logClientEvent(`[record.start.blocked] missing-api-key notice source=${source}`);

  if (typeof Notification === "undefined") {
    return;
  }

  if (Notification.permission === "granted") {
    try {
      new Notification("SlasshyWispr", { body: message });
    } catch {
      // Ignore notification failures; notice is still shown in-app.
    }
    return;
  }

  if (Notification.permission !== "default" || notificationPermissionRequested) {
    return;
  }

  notificationPermissionRequested = true;
  void Notification.requestPermission()
    .then((permission) => {
      if (permission !== "granted") {
        return;
      }
      try {
        new Notification("SlasshyWispr", { body: message });
      } catch {
        // Ignore notification failures; notice is still shown in-app.
      }
    })
    .catch(() => {
      // Ignore notification permission errors.
    });
}

async function handleRecordToggle(): Promise<void> {
  logClientEvent(
    `[record.toggle] stage=${stage} pipelineRunning=${boolFlag(
      pipelineRunning,
    )} holdCount=${pushToTalkHoldSources.size}`,
  );
  if (stage === "recording") {
    logClientEvent("[record.toggle] stage is recording -> stopRecording()");
    stopRecording();
    return;
  }

  if (await shouldBlockAssistantInputFromForegroundApp()) {
    logClientEvent("[record.toggle] blocked by foreground app policy");
    return;
  }

  const interruptedPlayback = interruptTtsPlaybackForCaptureIntent();
  if (interruptedPlayback) {
    logClientEvent("[record.toggle] interrupted active TTS playback before recording");
  }

  if (pipelineRunning) {
    logClientEvent("[record.toggle] blocked because pipeline is already running");
    return;
  }

  logClientEvent("[record.toggle] invoking startRecording()");
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
  logClientEvent(
    `[record.start] requested stage=${stage} pipelineRunning=${boolFlag(
      pipelineRunning,
    )} holdCount=${pushToTalkHoldSources.size} commandModeArmed=${boolFlag(commandModeArmed)}`,
  );
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    logClientEvent("[record.start] blocked because browser media recording APIs are unavailable");
    clearPushToTalkHolds();
    setNotice("This environment does not support microphone recording.", true);
    setStage("error", "Media APIs unavailable.");
    return;
  }

  if (await shouldBlockAssistantInputFromForegroundApp()) {
    logClientEvent("[record.start] blocked by foreground app policy");
    clearPushToTalkHolds();
    return;
  }

  const activeSettings = readSettingsFromForm();
  logClientEvent(`[record.start] settings ${summarizeSettingsForDiagnostics(activeSettings)}`);
  if (commandModeArmed) {
    logClientEvent("[record.start] command mode was armed; capturing selection snapshot");
    void primeSelectionSnapshotForCommandMode();
  }
  if (missingApiKeyForOnlineRuntime(activeSettings)) {
    logClientEvent(
      `[record.start.blocked] missing-api-key stt=${activeSettings.sttRuntimeMode} ai=${activeSettings.aiRuntimeMode} remember=${boolFlag(
        activeSettings.rememberApiKey,
      )}`,
    );
    clearPushToTalkHolds();
    showMissingApiKeyNotice("record-start");
    return;
  }

  const recorderOptions: MediaRecorderOptions = {
    audioBitsPerSecond: 96_000,
  };

  const preferredMimeType = pickBestRecorderMimeType();
  if (preferredMimeType) {
    recorderOptions.mimeType = preferredMimeType;
  }
  logClientEvent(
    `[record.start] opening microphone device=${
      activeSettings.microphoneDeviceId || "default"
    } preferredMime=${preferredMimeType || "auto"}`,
  );

  try {
    const stream = await openMicrophoneStream(activeSettings.microphoneDeviceId);
    mediaStream = stream;
    microphonePermissionGranted = true;
    logClientEvent(
      `[record.start] microphone stream opened tracks=${stream.getAudioTracks().length}`,
    );

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
      logClientEvent("[record.start] media recorder emitted error event");
      clearPushToTalkHolds();
      setNotice("Recording failed due to media recorder error.", true);
      setStage("error", "Recording failed.");
      stopAmplitudeMonitoring();
      releaseMicrophone();
    });

    mediaRecorder.addEventListener("stop", () => {
      logClientEvent("[record.start] media recorder stop event received");
      void finalizeRecording();
    });

    mediaRecorder.start(180);
    logClientEvent(`[record.start] media recorder started mime=${recorderMimeType}`);
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
    logClientEvent(`[record.start] failed to open microphone: ${asErrorMessage(error)}`);
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

function stopRecording(options: StopRecordingOptions = {}): void {
  const cancelPipeline = Boolean(options.cancelPipeline);
  const cancelNotice = options.cancelNotice?.trim();
  const cancelStatus = options.cancelStatus?.trim();
  logClientEvent(
    `[record.stop] requested stage=${stage} recorderState=${mediaRecorder?.state || "none"}`,
  );
  clearPushToTalkHolds();

  if (!mediaRecorder) {
    skipPipelineAfterRecorderStop = false;
    skipPipelineAfterRecorderStopNotice = "";
    skipPipelineAfterRecorderStopStatus = "";
    logClientEvent("[record.stop] no active mediaRecorder");
    return;
  }

  const recorderWasActive = mediaRecorder.state !== "inactive";
  skipPipelineAfterRecorderStop = cancelPipeline && recorderWasActive;
  skipPipelineAfterRecorderStopNotice = cancelPipeline && recorderWasActive ? cancelNotice || "" : "";
  skipPipelineAfterRecorderStopStatus = cancelPipeline && recorderWasActive ? cancelStatus || "" : "";

  if (recorderWasActive) {
    logClientEvent("[record.stop] invoking mediaRecorder.stop()");
    mediaRecorder.stop();
  }

  stopRecordingTicker();
  releaseMicrophone();
  if (cancelPipeline) {
    setStage("idle", skipPipelineAfterRecorderStopStatus || "Canceled before transcription.");
    setNotice(skipPipelineAfterRecorderStopNotice || "Short hotkey tap detected. STT request canceled.");
  } else {
    setStage("processing", "Preparing audio...");
    setNotice("Recording stopped. Running pipeline...");
  }
  syncActionAvailability();
}

async function finalizeRecording(): Promise<void> {
  const skipPipeline = skipPipelineAfterRecorderStop;
  const skipNotice = skipPipelineAfterRecorderStopNotice;
  const skipStatus = skipPipelineAfterRecorderStopStatus;
  skipPipelineAfterRecorderStop = false;
  skipPipelineAfterRecorderStopNotice = "";
  skipPipelineAfterRecorderStopStatus = "";

  if (skipPipeline) {
    recordedChunks = [];
    logClientEvent("[record.finalize] pipeline canceled before transcription");
    if (skipNotice) {
      setNotice(skipNotice);
    }
    if (stage !== "idle") {
      setStage("idle", skipStatus || "Canceled before transcription.");
    }
    syncActionAvailability();
    return;
  }

  const blob = new Blob(recordedChunks, { type: recorderMimeType });
  recordedChunks = [];
  logClientEvent(`[record.finalize] blobSize=${blob.size} mime=${recorderMimeType}`);

  if (blob.size === 0) {
    logClientEvent("[record.finalize] blocked because captured blob is empty");
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
    let pipelineAudioBlob = audioBlob;
    let pipelineAudioMimeType = audioMimeType;
    if (activeSettings.sttRuntimeMode === "local") {
      try {
        const decoded = await decodeAudioSample(audioBlob);
        pipelineAudioBlob = audioBufferToWavBlob(decoded);
        pipelineAudioMimeType = "audio/wav";
      } catch (error) {
        logClientEvent(`local.stt wav conversion skipped: ${asErrorMessage(error)}`);
      }
    }

    const audioBase64 = await blobToBase64(pipelineAudioBlob);
    const systemPrompt = buildEffectiveSystemPrompt(activeSettings, commandModeArmed);
    const coquiVoiceId = activeSettings.coquiVoiceId || coquiVoiceSelect.value || "";
    const pipelineTtsEngine: TtsEngine = ZERO_PYTHON_MODE ? "piper" : activeSettings.ttsEngine;
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

    let resolvedLocalOllamaModel = activeSettings.localOllamaModel.trim();
    if (activeSettings.sttRuntimeMode === "local") {
      let selectedLocalSttModel = activeSettings.localSttModel.trim();
      if (!selectedLocalSttModel) {
        const fallbackLocalSttModel = pickDefaultLocalSttModelFromCatalog();
        if (fallbackLocalSttModel) {
          localSttModelInput.value = fallbackLocalSttModel;
          if (localSttModelCatalog.includes(fallbackLocalSttModel)) {
            localSttModelCatalogSelect.value = fallbackLocalSttModel;
          }
          handleSettingsChange();
          selectedLocalSttModel = fallbackLocalSttModel;
        }
      }
      if (!selectedLocalSttModel) {
        logClientEvent("pipeline.blocked reason=missing-local-stt-model");
        setNotice(
          "Local STT mode needs a local STT model (Parakeet). Open Settings > Models and select one.",
          true,
        );
        setActiveSettingsPane("offline");
        setStage("idle", "Local setup required.");
        return;
      }

      await refreshLocalSttRuntimeState({ quiet: true });
      const needsWarmup =
        !localSttRuntimeLoaded ||
        !selectedLocalSttModel ||
        lastWarmedLocalSttModel.trim() !== selectedLocalSttModel;
      if (needsWarmup) {
        await warmupActiveLocalSttModel({ quiet: true, explicit: true });
        await refreshLocalSttRuntimeState({ quiet: true });
      } else if (selectedLocalSttModel) {
        lastWarmedLocalSttModel = selectedLocalSttModel;
      }
      if (!isSelectedLocalSttModelLoaded()) {
        logClientEvent("pipeline.blocked reason=local-stt-not-loaded");
        setNotice("Local STT is not loaded. Click Load STT in the left sidebar.", true);
        setStage("idle", "Local setup required.");
        return;
      }
    }
    if (activeSettings.aiRuntimeMode === "local") {
      resolvedLocalOllamaModel = await ensureLocalOllamaModelSelected({ quiet: true });
      if (!resolvedLocalOllamaModel) {
        logClientEvent("pipeline.blocked reason=missing-local-ollama-model");
        setNotice(
          "Local AI mode needs a local Ollama model. Open Settings > Models and pull/download one.",
          true,
        );
        setActiveSettingsPane("offline");
        setStage("idle", "Local setup required.");
        return;
      }
    }

    const sttLanguageConfig = resolveSttLanguageConfig(activeSettings);

    const response = await invoke<AssistantPipelineResponse>("run_assistant_pipeline", {
      request: {
        apiKey: activeSettings.apiKey,
        apiBaseUrl: activeSettings.apiBaseUrl || null,
        sttModel: activeSettings.sttModelName || null,
        aiModel: activeSettings.aiModelName || null,
        localMode:
          activeSettings.sttRuntimeMode === "local" && activeSettings.aiRuntimeMode === "local",
        sttLocalMode: activeSettings.sttRuntimeMode === "local",
        aiLocalMode: activeSettings.aiRuntimeMode === "local",
        localOllamaBaseUrl: activeSettings.localOllamaBaseUrl || null,
        localOllamaModel: resolvedLocalOllamaModel || null,
        localSttModel: activeSettings.localSttModel || null,
        piperPath: activeSettings.piperPath || null,
        audioBase64,
        audioMimeType: pipelineAudioMimeType,
        language: sttLanguageConfig.language,
        allowedLanguages: sttLanguageConfig.allowedLanguages,
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
        ttsEngine: pipelineTtsEngine,
        piper:
          pipelineTtsEngine === "piper"
            ? {
                speed: activeSettings.piperSpeed,
                quality: activeSettings.piperQuality,
                emotion: activeSettings.piperEmotion,
              }
            : null,
        coqui:
          pipelineTtsEngine === "coqui"
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
        } catch (hideError) {
          logClientEvent(`selection.popup hide failed: ${asErrorMessage(hideError)}`);
          try {
            await selectionAssistantWindow.close();
          } catch (closeError) {
            logClientEvent(`selection.popup close fallback failed: ${asErrorMessage(closeError)}`);
          } finally {
            selectionAssistantWindow = null;
          }
        }
      }
    }
    const selectionPopupOpened = selectionPopupPayload
      ? await showSelectionAssistantPopup(selectionPopupPayload)
      : false;

    if (!selectionPopupOpened && response.mode === "assistant" && response.audioBase64.trim()) {
      playbackCompleted = await playGeneratedAudio(response.audioBase64, pipelineTtsEngine);
    }

    let dictationPasted = false;
    if (response.mode === "dictation") {
      if (activeSettings.autoPasteDictation) {
        dictationPasted = await triggerAutoPaste(response.assistantResponse);
        if (dictationPasted) {
          setNotice("Dictation copied and pasted.");
        }
      }
      // Bug fix: also copy dictation to clipboard when copyToClipboard is enabled
      // and autoPaste is disabled (previously transcriptions were silently lost)
      if (!dictationPasted && activeSettings.copyToClipboard && !response.selectionPending && !selectionPopupOpened) {
        await copyToClipboard(response.assistantResponse);
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

    homeHistoryEntries.unshift(historyEntry);
    while (homeHistoryEntries.length > MAX_HISTORY_ITEMS) {
      homeHistoryEntries.pop();
    }
    persistHomeHistory();
    renderHomeHistory();
    if (activePage === "history") {
      renderFullHistory();
    }
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
  const appVersion = info.appVersion?.trim();
  settingsVersionText.textContent = appVersion ? `SlasshyWispr v${appVersion}` : "SlasshyWispr";
  const sttLocalMode = settings.sttRuntimeMode === "local";
  const aiLocalMode = settings.aiRuntimeMode === "local";
  const configuredBaseUrl =
    sttLocalMode && aiLocalMode
      ? settings.localOllamaBaseUrl.trim() || DEFAULT_LOCAL_OLLAMA_BASE_URL
      : settings.apiBaseUrl.trim();
  const configuredSttModel = sttLocalMode ? settings.localSttModel.trim() : settings.sttModelName.trim();
  const configuredAiModel = aiLocalMode ? settings.localOllamaModel.trim() : settings.aiModelName.trim();

  baseUrlValue.textContent = configuredBaseUrl || info.baseUrl || "Not set";
  sttModelValue.textContent = configuredSttModel || info.sttModel || "Not set";
  aiModelValue.textContent = configuredAiModel || info.aiModel || "Not set";
  apiBaseUrlInput.placeholder = info.baseUrl || "Enter provider URL (example: https://api.example.com/v1)";
  sttModelInput.placeholder = info.sttModel || "Enter STT model id";
  aiModelInput.placeholder = info.aiModel || "Enter AI model id";
  localOllamaBaseUrlInput.placeholder = DEFAULT_LOCAL_OLLAMA_BASE_URL;
  updateRuntimeModeNotice(settings.sttRuntimeMode, settings.aiRuntimeMode);
  piperStatusValue.textContent = info.piperInstalled ? "Installed" : "Missing";
  piperPathValue.textContent = info.piperPath || "-";
  voiceStatusValue.textContent = info.voiceInstalled ? "Installed" : "Missing";
  voicePathValue.textContent = info.voiceModelPath;
  piperRuntimeReady = Boolean(info.piperInstalled && info.voiceInstalled);
  coquiRuntimeInstalled = ZERO_PYTHON_MODE ? false : Boolean(info.coquiInstalled);
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
  if (!ENABLE_FOREGROUND_SHORTCUT_SUPPRESSION) {
    const fallback: ForegroundInputBlockStatus = { blocked: false, processName: "" };
    foregroundBlockStatusCache = fallback;
    foregroundBlockCheckedAt = Date.now();
    return fallback;
  }

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
    return "a blocked app";
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
  if (!ENABLE_FOREGROUND_SHORTCUT_SUPPRESSION) {
    return false;
  }

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
  if (!ENABLE_FOREGROUND_SHORTCUT_SUPPRESSION) {
    return;
  }

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
      hotkey: cachedHotkeyDisplay,
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

function nextSelectionPopupToken(): number {
  selectionPopupTokenCounter += 1;
  return selectionPopupTokenCounter;
}

const NON_ALNUM_INTENT_CHAR_PATTERN = /[^\p{L}\p{N}\s]/gu;
const MULTI_SPACE_PATTERN = /\s+/g;

function normalizeIntentText(value: string): string {
  return value
    .toLowerCase()
    .replace(NON_ALNUM_INTENT_CHAR_PATTERN, " ")
    .replace(MULTI_SPACE_PATTERN, " ")
    .trim();
}

function includesAnyIntentPhrase(text: string, phrases: readonly string[]): boolean {
  return containsAnyFragment(text, phrases);
}

const COMPOSE_VERBS = [
  "write",
  "draft",
  "compose",
  "create",
  "generate",
  "make",
  "prepare",
];

const COMPOSE_TARGETS = [
  "email",
  "mail",
  "message",
  "reply",
  "letter",
  "review",
  "proposal",
  "summary",
  "description",
  "caption",
  "post",
  "bio",
  "application",
];

const DRAFT_EDIT_VERB_PATTERN = /\b(make|rewrite|edit|improve|polish|refine|fix)\b/;
const DRAFT_EDIT_TARGET_PATTERN = /\b(this|it|text|review|email|message|paragraph|sentence)\b/;

function looksLikeDraftingRequest(transcript: string): boolean {
  const normalized = normalizeIntentText(transcript);
  if (!normalized) {
    return false;
  }

  const hasComposeVerb = includesAnyIntentPhrase(normalized, COMPOSE_VERBS);
  const hasComposeTarget = includesAnyIntentPhrase(normalized, COMPOSE_TARGETS);
  if (hasComposeVerb && hasComposeTarget) {
    return true;
  }

  if (DRAFT_EDIT_VERB_PATTERN.test(normalized) && DRAFT_EDIT_TARGET_PATTERN.test(normalized)) {
    return true;
  }

  return false;
}

const DRAFT_RESPONSE_START_PATTERN = /^(subject:|dear\s|hello\s|hi\s|to:)/i;

function looksLikeDraftResponse(assistantResponse: string): boolean {
  const trimmed = assistantResponse.trim();
  if (trimmed.length < 24) {
    return false;
  }

  if (DRAFT_RESPONSE_START_PATTERN.test(trimmed)) {
    return true;
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length >= 3) {
    return true;
  }

  return trimmed.length >= 120;
}

function inferAnswerPopupTitle(transcript: string): string {
  const normalized = normalizeIntentText(transcript);
  if (normalized.includes("email") || normalized.includes("mail")) {
    return "Email Draft Ready";
  }
  if (normalized.includes("review")) {
    return "Review Draft Ready";
  }
  return "Draft Ready";
}

function shouldOpenAnswerPopup(response: AssistantPipelineResponse): boolean {
  if (response.mode !== "assistant") {
    return false;
  }
  if (response.selectionRewrite || response.selectionPending || response.selectionContextUsed) {
    return false;
  }
  if (!response.assistantResponse.trim()) {
    return false;
  }

  return looksLikeDraftingRequest(response.transcript) && looksLikeDraftResponse(response.assistantResponse);
}

function buildSelectionPopupPayload(response: AssistantPipelineResponse): SelectionPopupPayload | null {
  if (!response.selectionRewrite && !response.selectionPending && !shouldOpenAnswerPopup(response)) {
    return null;
  }

  const token = nextSelectionPopupToken();

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

  if (shouldOpenAnswerPopup(response)) {
    return {
      token,
      mode: "answer",
      title: inferAnswerPopupTitle(response.transcript),
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

  const dockWidth = 126;
  const dockHeight = 48;
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
  const busy =
    pipelineRunning ||
    stage === "recording" ||
    ttsSetupRunning ||
    ollamaStatusInFlight ||
    ollamaInstallInFlight ||
    ollamaPullInFlight ||
    localSttDownloadInFlight ||
    localSttDeleteInFlight ||
    localSttDeactivateInFlight ||
    localSttWarmupInFlight ||
    localSttRuntimeStateInFlight ||
    localSttHardwareAdvisorOpen;
  const localSttBusy = busy || localSttDownloadActive;
  const sttRuntimeIsLocal = settings.sttRuntimeMode === "local";
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
  checkOllamaStatusBtn.disabled = busy;
  installOllamaBtn.disabled = busy;
  fetchOllamaModelsBtn.disabled = busy;
  useOllamaModelBtn.disabled = busy;
  pullOllamaModelBtn.disabled = busy;
  sidebarToggleLocalSttBtn.disabled = localSttBusy || !sttRuntimeIsLocal;
  downloadLocalSttModelBtn.disabled = localSttBusy;
  deleteLocalSttModelBtn.disabled = localSttBusy;
  openLocalSttModelPathBtn.disabled = localSttBusy;
  sttRuntimeModeOnlineInput.disabled = busy;
  sttRuntimeModeOfflineInput.disabled = busy;
  aiRuntimeModeOnlineInput.disabled = busy;
  aiRuntimeModeOfflineInput.disabled = busy;
  microphoneSelect.disabled = busy;
  dictationLanguageSelect.disabled = busy;
  dictationLanguageModeSingleInput.disabled = busy;
  dictationLanguageModeMultipleInput.disabled = busy;
  for (const option of dictationLanguageOptionInputs) {
    option.disabled = busy;
  }
  styleProfileSelect.disabled = busy;
  apiKeyInput.disabled = busy;
  rememberApiKeyInput.disabled = busy;
  apiBaseUrlInput.disabled = busy;
  sttModelInput.disabled = busy;
  aiModelInput.disabled = busy;
  providerModelCatalogSelect.disabled = busy;
  localOllamaBaseUrlInput.disabled = busy;
  localOllamaModelInput.disabled = busy;
  localOllamaModelCatalogSelect.disabled = busy;
  localSttModelInput.disabled = localSttBusy;
  localSttModelCatalogSelect.disabled = localSttBusy;
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
  const allRuntimeLocal = settings.sttRuntimeMode === "local" && settings.aiRuntimeMode === "local";
  fetchProviderModelsBtn.disabled = fetchProviderModelsBtn.disabled || allRuntimeLocal;
  applyModelToAiBtn.disabled = applyModelToAiBtn.disabled || allRuntimeLocal;
  applyModelToSttBtn.disabled = applyModelToSttBtn.disabled || allRuntimeLocal;
  apiKeyInput.disabled = apiKeyInput.disabled || allRuntimeLocal;
  rememberApiKeyInput.disabled = rememberApiKeyInput.disabled || allRuntimeLocal;
  apiBaseUrlInput.disabled = apiBaseUrlInput.disabled || allRuntimeLocal;
  sttModelInput.disabled = sttModelInput.disabled || allRuntimeLocal;
  aiModelInput.disabled = aiModelInput.disabled || allRuntimeLocal;
  providerModelCatalogSelect.disabled = providerModelCatalogSelect.disabled || allRuntimeLocal;
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
  logClientEvent(
    `[record.ptt.engage] source=${source} capture=${settings.captureMode} stage=${stage} pipelineRunning=${boolFlag(
      pipelineRunning,
    )} holds=${pushToTalkHoldSources.size}`,
  );
  if (settings.captureMode !== "push-to-talk") {
    logClientEvent("[record.ptt.engage] ignored because capture mode is not push-to-talk");
    return;
  }

  if (pushToTalkHoldSources.has(source)) {
    logClientEvent("[record.ptt.engage] ignored because this hold source is already active");
    return;
  }

  if (await shouldBlockAssistantInputFromForegroundApp()) {
    logClientEvent("[record.ptt.engage] blocked by foreground app policy");
    return;
  }

  const holdStartedAt = Date.now();
  pushToTalkHoldSources.add(source);
  pushToTalkHoldStartedAt.set(source, holdStartedAt);
  logClientEvent(`[record.ptt.engage] hold added source=${source} holds=${pushToTalkHoldSources.size}`);

  const interruptedPlayback = interruptTtsPlaybackForCaptureIntent();
  if (interruptedPlayback) {
    logClientEvent("[record.ptt.engage] interrupted active TTS playback");
  }

  if (pipelineRunning || stage === "recording") {
    logClientEvent(
      `[record.ptt.engage] delayed because pipelineRunning=${boolFlag(
        pipelineRunning,
      )} stage=${stage}`,
    );
    return;
  }

  logClientEvent("[record.ptt.engage] invoking startRecording()");
  await startRecording();

  if (mediaRecorder?.state !== "recording") {
    logClientEvent(
      `[record.ptt.engage] startRecording did not reach recording state (state=${
        mediaRecorder?.state || "none"
      }); removing hold`,
    );
    pushToTalkHoldSources.delete(source);
    pushToTalkHoldStartedAt.delete(source);
    return;
  }

  if (!pushToTalkHoldSources.has(source) && pushToTalkHoldSources.size === 0) {
    const holdDurationMs = Date.now() - holdStartedAt;
    const cancelShortHotkeyTap =
      source === "hotkey" && holdDurationMs <= ACCIDENTAL_PTT_HOTKEY_MAX_HOLD_MS;
    logClientEvent(
      `[record.ptt.engage] hold released before recording stabilized source=${source} holdMs=${holdDurationMs} cancel=${boolFlag(
        cancelShortHotkeyTap,
      )}`,
    );
    stopRecording(
      cancelShortHotkeyTap
        ? {
            cancelPipeline: true,
            cancelNotice: "Short hotkey tap detected. STT request canceled.",
            cancelStatus: "Hotkey tap canceled.",
          }
        : undefined,
    );
  }
}

function releasePushToTalk(source: HoldSource): void {
  const holdStartedAt = pushToTalkHoldStartedAt.get(source) ?? 0;
  pushToTalkHoldStartedAt.delete(source);
  if (!pushToTalkHoldSources.delete(source)) {
    logClientEvent(`[record.ptt.release] ignored because hold source is not active: ${source}`);
    return;
  }
  const holdDurationMs = holdStartedAt > 0 ? Date.now() - holdStartedAt : -1;
  const cancelShortHotkeyTap =
    source === "hotkey" &&
    holdDurationMs >= 0 &&
    holdDurationMs <= ACCIDENTAL_PTT_HOTKEY_MAX_HOLD_MS;
  logClientEvent(
    `[record.ptt.release] source=${source} remainingHolds=${pushToTalkHoldSources.size} holdMs=${holdDurationMs} cancel=${boolFlag(
      cancelShortHotkeyTap,
    )}`,
  );

  if (stage === "recording" && pushToTalkHoldSources.size === 0) {
    logClientEvent("[record.ptt.release] no holds left while recording -> stopRecording()");
    stopRecording(
      cancelShortHotkeyTap
        ? {
            cancelPipeline: true,
            cancelNotice: "Short hotkey tap detected. STT request canceled.",
            cancelStatus: "Hotkey tap canceled.",
          }
        : undefined,
    );
    return;
  }

  if (settings.captureMode !== "push-to-talk") {
    logClientEvent("[record.ptt.release] capture mode changed; nothing to stop");
  }
}

function clearPushToTalkHolds(): void {
  if (pushToTalkHoldSources.size > 0) {
    logClientEvent(`[record.ptt.clear] clearing holds=${pushToTalkHoldSources.size}`);
  }
  pushToTalkHoldSources.clear();
  pushToTalkHoldStartedAt.clear();
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

    // Throttle visualization updates to ~30fps (33ms) to reduce IPC/CPU overhead
    // for this peripheral background visualizer.
    if (now - lastDockAmplitudePublishAt < 33) {
      amplitudeFrameId = window.requestAnimationFrame(tick);
      return;
    }

    analyserNode.getFloatTimeDomainData(amplitudeBuffer);

    let sumSquares = 0;
    for (let index = 0; index < amplitudeBuffer.length; index += 1) {
      const sample = amplitudeBuffer[index];
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / amplitudeBuffer.length);
    const normalized = Math.min(1, Math.max(0, (rms - 0.008) * 11.5));
    // Adjusted smoothing factor for lower update rate (0.72^2 ≈ 0.52) to maintain visual decay.
    dockAmplitude = dockAmplitude * 0.52 + normalized * 0.48;

    publishDockState();
    lastDockAmplitudePublishAt = now;

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
    const modifier = normalizeHotkeyModifierToken(token);
    if (modifier) {
      if (modifier === "ctrl") ctrl = true;
      if (modifier === "shift") shift = true;
      if (modifier === "alt") alt = true;
      if (modifier === "meta") meta = true;
      continue;
    }

    if (key) return null;

    key = normalizeHotkeyKeyToken(token);
    if (!key) return null;
  }

  if (!key) return null;

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

const SHIFTED_ALIASES_MAP: Record<string, string> = {
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "plus",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
  "~": "`",
};

const ALLOWED_PUNCTUATION_KEYS = new Set([",", ".", "/", "\\", ";", "'", "`", "-", "=", "[", "]"]);

const NORMALIZED_HOTKEY_MAP: Record<string, string> = {
  space: "space",
  spacebar: "space",
  enter: "enter",
  return: "enter",
  tab: "tab",
  esc: "escape",
  escape: "escape",
  backspace: "backspace",
  delete: "delete",
  del: "delete",
  insert: "insert",
  ins: "insert",
  home: "home",
  end: "end",
  pageup: "pageup",
  pgup: "pageup",
  pagedown: "pagedown",
  pgdown: "pagedown",
  arrowup: "up",
  up: "up",
  arrowdown: "down",
  down: "down",
  arrowleft: "left",
  left: "left",
  arrowright: "right",
  right: "right",
  capslock: "capslock",
  numlock: "numlock",
  scrolllock: "scrolllock",
  printscreen: "printscreen",
  prtsc: "printscreen",
  pause: "pause",
  break: "pause",
  comma: ",",
  period: ".",
  dot: ".",
  slash: "/",
  forwardslash: "/",
  backslash: "\\",
  semicolon: ";",
  quote: "'",
  apostrophe: "'",
  backquote: "`",
  grave: "`",
  graveaccent: "`",
  minus: "-",
  dash: "-",
  hyphen: "-",
  equal: "=",
  equals: "=",
  plus: "plus",
  leftbracket: "[",
  bracketleft: "[",
  lbracket: "[",
  rightbracket: "]",
  bracketright: "]",
  rbracket: "]",
  numpadadd: "numpadadd",
  add: "numpadadd",
  numpadsubtract: "numpadsubtract",
  subtract: "numpadsubtract",
  numpadmultiply: "numpadmultiply",
  multiply: "numpadmultiply",
  numpaddivide: "numpaddivide",
  divide: "numpaddivide",
  numpaddecimal: "numpaddecimal",
  decimal: "numpaddecimal",
  numpadenter: "numpadenter",
};

function normalizeHotkeyKeyToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return "";
  if (normalized.length === 1) {
    if (isAsciiLowerAlphaNumeric(normalized)) return normalized;
    const shiftedAlias = SHIFTED_ALIASES_MAP[normalized];
    if (typeof shiftedAlias === "string") {
      return shiftedAlias;
    }
    if (ALLOWED_PUNCTUATION_KEYS.has(normalized)) {
      return normalized;
    }
  }
  if (isFunctionKeyToken(normalized)) return normalized;
  if (isNumpadDigitToken(normalized)) return normalized;

  const mappedKey = NORMALIZED_HOTKEY_MAP[normalized];
  return typeof mappedKey === "string" ? mappedKey : "";
}

const DISPLAY_HOTKEY_LOWERCASE_PATTERN = /[a-z]/;
const DISPLAY_HOTKEY_DIGIT_PATTERN = /[0-9]/;

function displayHotkeyKey(key: string): string {
  if (key.length === 1) {
    return DISPLAY_HOTKEY_LOWERCASE_PATTERN.test(key) ? key.toUpperCase() : key;
  }
  if (key === "plus") return "Plus";
  if (key === "space") return "Space";
  if (key === "delete") return "Delete";
  if (key === "insert") return "Insert";
  if (key === "home") return "Home";
  if (key === "end") return "End";
  if (key === "pageup") return "PageUp";
  if (key === "pagedown") return "PageDown";
  if (key === "up") return "Up";
  if (key === "down") return "Down";
  if (key === "left") return "Left";
  if (key === "right") return "Right";
  if (key === "capslock") return "CapsLock";
  if (key === "numlock") return "NumLock";
  if (key === "scrolllock") return "ScrollLock";
  if (key === "printscreen") return "PrintScreen";
  if (key === "pause") return "Pause";
  if (key.startsWith("numpad")) {
    if (key.length === 7 && DISPLAY_HOTKEY_DIGIT_PATTERN.test(key.slice(-1))) {
      return `Numpad${key.slice(-1)}`;
    }
    const suffix = key.slice("numpad".length);
    return `Numpad${suffix.slice(0, 1).toUpperCase()}${suffix.slice(1)}`;
  }
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
  const normalized = normalizeHotkeyKeyToken(value);
  if (normalized) {
    return normalized;
  }

  const lower = value.toLowerCase();
  if (lower === " ") return "space";
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

// ============================================================================
// OFFLINE MODE DIAGNOSTICS - User-Friendly Error Handling
// ============================================================================

/**
 * Checks if a model file exists on disk
 */
async function checkModelFileExists(_model: string): Promise<boolean> {
  try {
    await invoke<LocalSttRuntimeStateResponse>("get_local_stt_runtime_state");
    // If runtime state returns successfully but model not loaded, file likely missing
    return true; // Backend will handle file existence check during warmup
  } catch (error) {
    console.error("Model file check failed:", error);
    return false;
  }
}

/**
 * Checks if Python dependencies are installed
 */
async function checkPythonDependencies(): Promise<boolean> {
  try {
    // Try to get local STT hardware advice which requires Python
    await invoke("get_local_stt_hardware_advice", {
      request: { selectedModel: null }
    });
    return true;
  } catch (error) {
    const msg = asErrorMessage(error).toLowerCase();
    // Check for common Python dependency errors
    if (msg.includes("python") || msg.includes("module") || msg.includes("nemo")) {
      return false;
    }
    return true; // Other errors are not Python-related
  }
}

/**
 * Checks available system memory
 */
async function checkAvailableMemory(model: string): Promise<{ sufficient: boolean; availableMB?: number }> {
  try {
    // Get hardware advice which includes memory info
    const advice = await invoke<LocalSttHardwareAdviceResponse>("get_local_stt_hardware_advice", {
      request: { selectedModel: model }
    });

    // Parakeet v3 needs ~600MB, v2 needs ~500MB
    // const requiredMB = model.includes("parakeet-tdt-0.6b") ? 600 : 500;
    // const availableMB = advice.totalRamGb * 1024; // Convert GB to MB

    // Consider sufficient if at least 1GB free (conservative)
    return {
      sufficient: advice.totalRamGb >= 2,
      availableMB: Math.round(advice.totalRamGb * 1024)
    };
  } catch (error) {
    console.warn("Memory check failed:", error);
    return { sufficient: true }; // Assume OK if we can't check
  }
}

/**
 * Shows a detailed diagnostic dialog when offline mode setup fails
 */
function showOfflineModeDiagnostic(issue: string, details?: {
  model?: string;
  expectedPath?: string;
  availableMemory?: number;
  pythonInstalled?: boolean;
}): void {
  const diagnostics = getOfflineDiagnosticData(issue, details);

  const overlay = document.createElement("div");
  overlay.className = "offline-diagnostic-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.2s ease-out;
  `;

  const dialog = document.createElement("div");
  dialog.className = "offline-diagnostic-dialog";
  dialog.style.cssText = `
    background: var(--surface-elevated, #1e1e1e);
    border: 1px solid var(--border-subtle, #333);
    border-radius: 12px;
    padding: 24px;
    max-width: 560px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    animation: slideUp 0.3s ease-out;
  `;

  dialog.innerHTML = `
    <div style="margin-bottom: 20px;">
      <div style="font-size: 32px; margin-bottom: 12px;">${diagnostics.icon}</div>
      <h3 style="margin: 0 0 8px 0; font-size: 18px; color: var(--text-primary, #fff);">${diagnostics.title}</h3>
      <p style="margin: 0; color: var(--text-secondary, #aaa); font-size: 14px; line-height: 1.5;">${diagnostics.description}</p>
    </div>

    ${details?.model ? `
    <div style="background: var(--surface-raised, #2a2a2a); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
      <div style="font-size: 12px; color: var(--text-muted, #888); margin-bottom: 4px;">Model</div>
      <div style="font-family: monospace; font-size: 13px; color: var(--text-primary, #fff); word-break: break-all;">${escapeHtml(details?.model)}</div>
    </div>
    ` : ''}

    <div style="margin-bottom: 20px;">
      <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary, #fff);">How to fix:</div>
      <ol style="margin: 0; padding-left: 20px; color: var(--text-secondary, #aaa); font-size: 13px; line-height: 1.6;">
        ${diagnostics.steps.map(step => `<li style="margin-bottom: 6px;">${step}</li>`).join('')}
      </ol>
    </div>

    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      ${diagnostics.actions.map(action => `
        <button
          data-action="${action.id}"
          class="diagnostic-action-btn"
          style="
            padding: 8px 16px;
            border: 1px solid ${action.primary ? '#3b82f6' : 'var(--border-subtle, #444)'};
            background: ${action.primary ? '#3b82f6' : 'transparent'};
            color: #ffffff;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.15s ease;
          "
        >
          ${action.label}
        </button>
      `).join('')}
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Add hover effects
  const buttons = dialog.querySelectorAll('.diagnostic-action-btn');
  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      if (!btn.textContent?.includes('Cancel')) {
        (btn as HTMLElement).style.transform = 'translateY(-1px)';
        (btn as HTMLElement).style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.3)';
      }
    });
    btn.addEventListener('mouseleave', () => {
      (btn as HTMLElement).style.transform = 'translateY(0)';
      (btn as HTMLElement).style.boxShadow = 'none';
    });
  });

  // Handle actions
  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const actionId = btn.getAttribute('data-action');
      const action = diagnostics.actions.find(a => a.id === actionId);

      overlay.style.animation = 'fadeOut 0.2s ease-in';
      setTimeout(() => overlay.remove(), 200);

      if (action?.handler) {
        await action.handler();
      }
    });
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.style.animation = 'fadeOut 0.2s ease-in';
      setTimeout(() => overlay.remove(), 200);
    }
  });
}

/**
 * Returns diagnostic data for specific offline mode issues
 */
function getOfflineDiagnosticData(issue: string, details?: any): {
  icon: string;
  title: string;
  description: string;
  steps: string[];
  actions: Array<{ id: string; label: string; primary?: boolean; handler?: () => Promise<void> | void }>;
} {
  switch (issue) {
    case 'no-model-downloaded':
      return {
        icon: '⬇️',
        title: 'No Offline Model Downloaded',
        description: 'To use offline mode, you need to download a speech recognition model first.',
        steps: [
          'Open Settings → Models tab',
          'Scroll to "Offline STT Model" section',
          'Select a model (e.g., "Parakeet v3 - 478 MB")',
          'Click "Download & install selected model"',
          'Wait for download to complete (~2-5 minutes)',
          'Then click "Load STT" again'
        ],
        actions: [
          {
            id: 'open-settings',
            label: 'Open Settings',
            primary: true,
            handler: () => {
              openSettings('user-click');
              setActiveSettingsPane('models');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    case 'wrong-stt-mode':
      return {
        icon: '🔄',
        title: 'STT Mode is Currently "Online"',
        description: 'To load an offline STT model, you need to switch from Online to Local mode.',
        steps: [
          'Open Settings → Models tab',
          'Find "STT Runtime Mode" section',
          'Click the "Offline" radio button',
          'Select a model from "Local STT Model" dropdown',
          'If no models appear, download one first',
          'Click "Save Settings"',
          'Then click "Load STT" button'
        ],
        actions: [
          {
            id: 'switch-now',
            label: 'Switch to Offline Now',
            primary: true,
            handler: async () => {
              const currentSettings = readSettingsFromForm();
              currentSettings.sttRuntimeMode = 'local';
              applySettingsToForm(currentSettings);
              persistSettings(currentSettings);
              setNotice('Switched to Offline mode. Now select a model and click "Load STT".');
            }
          },
          {
            id: 'open-settings',
            label: 'Open Settings',
            handler: () => {
              openSettings('user-click');
              setActiveSettingsPane('models');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    case 'model-file-missing':
      return {
        icon: '❌',
        title: 'Model File Not Found',
        description: `The selected model file appears to be missing or incomplete.${details?.model ? `\n\nExpected: ${details?.model}` : ''}`,
        steps: [
          'The model may not have been downloaded yet',
          'Download was interrupted or corrupted',
          'Antivirus may have quarantined the files',
          '',
          'Solution:',
          'Delete and re-download the model from Settings → Models'
        ],
        actions: [
          {
            id: 'redownload',
            label: 'Download Model',
            primary: true,
            handler: () => {
              openSettings('user-click');
              setActiveSettingsPane('models');
              setTimeout(() => {
                const downloadBtn = document.getElementById('downloadLocalSttModelBtn');
                if (downloadBtn) {
                  (downloadBtn as HTMLButtonElement).click();
                }
              }, 100);
            }
          },
          {
            id: 'use-online',
            label: 'Use Online Mode',
            handler: () => {
              const currentSettings = readSettingsFromForm();
              currentSettings.sttRuntimeMode = 'online';
              applySettingsToForm(currentSettings);
              persistSettings(currentSettings);
              setNotice('Switched to Online mode.');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    case 'python-deps-missing':
      return {
        icon: '🐍',
        title: 'Python Dependencies Not Installed',
        description: 'Offline STT requires Python packages that aren\'t installed.',
        steps: [
          'Missing: nemo-toolkit (for Parakeet) OR transformers + faster-whisper',
          '',
          'Quick Fix:',
          'Click "Install Dependencies" to run the automatic setup script',
          '',
          'Manual Fix:',
          '1. Ensure Python 3.9+ is installed',
          '2. Run: pip install torch torchaudio nemo-toolkit',
          '3. Restart the app'
        ],
        actions: [
          {
            id: 'install-deps',
            label: 'Install Dependencies',
            primary: true,
            handler: async () => {
              setNotice('Running dependency installation script...');
              try {
                await invoke('setup_coqui_runtime', {
                  request: {
                    pythonPath: null,
                    useGpu: false
                  }
                });
                setNotice('Dependencies installed successfully! Try loading STT again.');
              } catch (error) {
                setNotice(`Installation failed: ${asErrorMessage(error)}`, true);
              }
            }
          },
          {
            id: 'guide',
            label: 'Setup Guide',
            handler: () => {
              window.open('https://github.com/SlasshyOverhere/SlasshyWispr#quick-setup', '_blank');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    case 'insufficient-memory':
      return {
        icon: '💾',
        title: 'Insufficient Memory for Offline Model',
        description: `Your system doesn't have enough free memory to load this model safely.${details.availableMemory ? `\nAvailable: ~${Math.round(details.availableMemory / 1024)}MB` : ''}`,
        steps: [
          'Required: ~600MB RAM for Parakeet v3',
          '',
          'Options:',
          '1. Use a smaller model (Parakeet v2: 473MB or Moonshine: 58MB)',
          '2. Close other applications to free memory',
          '3. Use Online mode instead (no local model needed)',
          '4. Update CUDA drivers if you have NVIDIA GPU'
        ],
        actions: [
          {
            id: 'try-smaller',
            label: 'Try Smaller Model',
            primary: true,
            handler: () => {
              const currentSettings = readSettingsFromForm();
              currentSettings.localSttModel = 'nvidia/parakeet-tdt_ctc-110m';
              applySettingsToForm(currentSettings);
              persistSettings(currentSettings);
              setNotice('Switched to smaller model. Click "Load STT" to try again.');
            }
          },
          {
            id: 'use-online',
            label: 'Use Online Mode',
            handler: () => {
              const currentSettings = readSettingsFromForm();
              currentSettings.sttRuntimeMode = 'online';
              applySettingsToForm(currentSettings);
              persistSettings(currentSettings);
              setNotice('Switched to Online mode.');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    case 'load-timeout':
      return {
        icon: '⏱️',
        title: 'Model Loading Taking Longer Than Expected',
        description: 'The model is still loading. This can happen on slower systems.',
        steps: [
          `Current wait time: ${details.waitTime || 'unknown'}`,
          'Expected: 15-30 seconds',
          '',
          'This is normal for first-time loads on HDD or low-RAM systems.',
          'The model will eventually load, but you can also:'
        ],
        actions: [
          {
            id: 'wait-longer',
            label: 'Keep Waiting',
            primary: true,
            handler: () => {
              setNotice('Continuing to load... Please wait.');
            }
          },
          {
            id: 'try-smaller',
            label: 'Try Smaller Model',
            handler: () => {
              const currentSettings = readSettingsFromForm();
              currentSettings.localSttModel = 'nvidia/parakeet-tdt_ctc-110m';
              applySettingsToForm(currentSettings);
              persistSettings(currentSettings);
              setNotice('Switched to smaller model. Click "Load STT" to try again.');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    default:
      return {
        icon: '⚠️',
        title: 'Offline Mode Setup Failed',
        description: issue || 'An unknown error occurred while setting up offline mode.',
        steps: [
          'Check that you have a stable internet connection',
          'Verify the model is properly downloaded',
          'Try restarting the application',
          'If problem persists, use Online mode'
        ],
        actions: [
          {
            id: 'retry',
            label: 'Retry',
            primary: true,
            handler: () => {
              activateSelectedLocalSttModel();
            }
          },
          {
            id: 'use-online',
            label: 'Use Online Mode',
            handler: () => {
              const currentSettings = readSettingsFromForm();
              currentSettings.sttRuntimeMode = 'online';
              applySettingsToForm(currentSettings);
              persistSettings(currentSettings);
              setNotice('Switched to Online mode.');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };
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
  if (ZERO_PYTHON_MODE) {
    return;
  }
  try {
    await refreshCoquiStatus();
  } catch (error) {
    setNotice(`Unable to refresh Coqui status: ${asErrorMessage(error)}`, true);
  }
}

void bootstrap();
