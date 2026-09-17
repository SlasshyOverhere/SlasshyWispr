import "@fontsource/inter/300.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import "./style.css";
import "./settings.css";
import {
  captureSelectedText as ipcCaptureSelectedText,
  configureLaunchAtLogin as ipcConfigureLaunchAtLogin,
  deactivateLocalSttModel as ipcDeactivateLocalSttModel,
  deleteLocalSttModel as ipcDeleteLocalSttModel,
  downloadLocalSttModel as ipcDownloadLocalSttModel,
  fetchLocalSttModels as ipcFetchLocalSttModels,
  getAssistantInfo as ipcGetAssistantInfo,
  getForegroundInputBlockStatus as ipcGetForegroundInputBlockStatus,
  getLocalSttDownloadStatus as ipcGetLocalSttDownloadStatus,
  getLocalSttHardwareAdvice as ipcGetLocalSttHardwareAdvice,
  getLocalSttModelStatus as ipcGetLocalSttModelStatus,
  getLocalSttRuntimeState as ipcGetLocalSttRuntimeState,
  launchAtLoginStatus as ipcLaunchAtLoginStatus,
  loadPersistedLocalSettings as ipcLoadPersistedLocalSettings,
  listDictationRecordingIds as ipcListDictationRecordingIds,
  openLocalSttModelPath as ipcOpenLocalSttModelPath,
  pasteClipboardText as ipcPasteClipboardText,
  pasteTextViaClipboard as ipcPasteTextViaClipboard,
  runAssistantPipeline as ipcRunAssistantPipeline,
  saveDictationRecording as ipcSaveDictationRecording,
  setClipboardText as ipcSetClipboardText,
  setupCoquiRuntime as ipcSetupCoquiRuntime,
  warmupLocalSttModel as ipcWarmupLocalSttModel,
} from "./ipc/client";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  LogicalSize,
  PhysicalPosition,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  type Monitor,
} from "@tauri-apps/api/window";
import {
  unregisterAll as unregisterAllGlobalShortcuts,
  type ShortcutEvent,
} from "@tauri-apps/plugin-global-shortcut";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";
import {
  asErrorMessage,
  boolFlag,
  escapeHtml,
  expandSnippetsInText,
  formatBytes,
  normalizeDictionaryEntries,
  normalizeSnippetEntries,
  validateDictionaryEntry,
  validateQuickNote,
  validateSnippetEntry,
} from "./utils";
import { matchHistoryToRecordings } from "./store";
import { ACHIEVEMENT_DEFS } from "./state/achievements";
import { loadHistory } from "./state/history";
import { loadDictionary as loadDictionaryFromState, loadSnippets as loadSnippetsFromState, loadNotes as loadNotesFromState } from "./state/collections";
import { loadAnalyticsSessions as loadCanonicalAnalyticsSessions } from "./state/usage";
import {
  loadSettings,
  coerceNumber,
  coerceInteger,
  asThemeMode,
  resolveSttLanguageConfig,
} from "./state/settings-store";
import {
  applySettingsPatchToForm as applySettingsPatchToFormService,
  applySettingsToForm as applySettingsToFormService,
  buildShortcutSyncSignature,
  flushPendingSettings,
  persistSettings,
  readSettingsFromForm as readSettingsFromFormService,
  hydrateSettingsFromNativeStorage as hydrateSettingsFromNativeStorageService,
  runSettingsHandlePipeline,
  setPersistErrorReporter,
  summarizeSettingsForDiagnostics,
  updateRuntimeModeNotice as updateRuntimeModeNoticeService,
  wireSettingsFormInputs as wireSettingsFormInputsService,
  type SettingsCoreDeps,
  type SettingsHandleEffects,
} from "./settings/settings-service";
import { querySettingsFormRefs } from "./settings/settings-form-refs";
import {
  SETTINGS_PATCH_EVENT,
  initSettingsState,
  markPaneConverted,
  setSettingsSnapshot,
} from "./settings/settings-state";
import { APP_UPDATE_AUTO_CHECK_CHANGED_EVENT } from "./updater/updater-client-shim";
import {
  initializeUpdaterPanel as initializeUpdaterPanelService,
  initUpdaterView,
} from "./updater/updater-view";
import {
  getCachedUpdateResult,
  handleCheckForUpdates as handleCheckForUpdatesService,
  handleInstallUpdate as handleInstallUpdateService,
  initUpdaterFlow,
  registerUpdateInstallProgressListener as registerUpdateInstallProgressListenerService,
  startAutomaticUpdateChecks as startAutomaticUpdateChecksService,
  stopAutomaticUpdateChecks,
  syncUpdaterButtons as syncUpdaterButtonsService,
} from "./updater/updater-flow";
import {
  buildEffectiveSystemPrompt,
  initPipelinePrompt,
} from "./pipeline/pipeline-prompt";
import {
  initPipelineRender,
  renderPipelineResponse as renderPipelineResponseService,
} from "./pipeline/pipeline-render";
import {
  initPlayback,
  interruptTtsPlaybackForCaptureIntent as interruptTtsPlaybackService,
  playGeneratedAudio as playGeneratedAudioService,
} from "./recording/playback";
import {
  canPreWarmMicrophone as canPreWarmMicrophoneService,
  initMicStream,
  preWarmMicrophoneStream as preWarmMicrophoneStreamService,
  releasePreWarmedStream as releasePreWarmedStreamService,
} from "./recording/mic-stream";
import {
  clearPushToTalkHolds as clearPushToTalkHoldsService,
  engagePushToTalk as engagePushToTalkService,
  getPushToTalkHoldCount,
  handleDockMicToggle as handleDockMicToggleService,
  handleRecordToggle as handleRecordToggleService,
  hasPushToTalkHold,
  initCaptureTriggers,
  releasePushToTalk as releasePushToTalkService,
} from "./recording/capture-triggers";
import {
  beginRecordingTicker as beginRecordingTickerService,
  initCaptureMonitors,
  releaseMicrophone as releaseMicrophoneService,
  stopAmplitudeMonitoring as stopAmplitudeMonitoringService,
  stopRecordingTicker as stopRecordingTickerService,
} from "./recording/capture-monitors";
import {
  initRecordingController,
  stopRecording as stopRecordingService,
} from "./recording/recording-controller";
import {
  isExternalMediaMutedForDictation,
  pauseExternalMediaForDictation as pauseExternalMediaForDictationService,
  resumeExternalMediaAfterDictation as resumeExternalMediaAfterDictationService,
  setExternalMediaMutedForDictation,
} from "./shell/media-control";
import { playDictationSoundEffect as playDictationSoundEffectService } from "./shell/sound-effects";
import {
  initMicrophones,
  refreshMicrophones as refreshMicrophonesService,
  setMicrophonePermissionGranted,
  updateMicrophoneSummary as updateMicrophoneSummaryService,
} from "./shell/microphones";
import {
  initModelCatalogs,
  renderLocalOllamaModelCatalog as renderLocalOllamaModelCatalogService,
  renderLocalSttModelCatalog as renderLocalSttModelCatalogService,
  renderProviderModelCatalog as renderProviderModelCatalogService,
} from "./shell/model-catalogs";
import {
  initTtsClient,
  pollTtsSetupStatusOnce as pollTtsSetupStatusOnceService,
  startTtsSetupPolling as startTtsSetupPollingService,
  stopTtsSetupPolling as stopTtsSetupPollingService,
} from "./tts/tts-client";
import {
  initRecordings,
  refreshRecordingsStorageHint as refreshRecordingsStorageHintService,
} from "./shell/recordings";
import {
  initDiagnostics,
  logClientEvent as logClientEventService,
  setNotice as setNoticeService,
} from "./shell/diagnostics";
import { parseJson } from "./state/storage";
import {
  initAnalyticsRender,
  updateUsageMetrics as updateUsageMetricsService,
} from "./analytics/analytics-render";
import {
  initUsageTracker,
  trackUsage as trackUsageService,
} from "./analytics/usage-tracker";
import { buildSelectionPopupPayload } from "./windows/selection-intent";
import {
  inferLocalSttProviderFromModel,
  pickDefaultLocalSttModelFromCatalog as pickDefaultLocalSttModelFromList,
} from "./stt/provider-inference";
import {
  ensureLocalOllamaModelSelected as ensureLocalOllamaModelSelectedService,
  fetchOllamaModels as fetchOllamaModelsService,
  initOllamaClient,
  refreshOllamaStatus as refreshOllamaStatusService,
  renderOllamaStatus as renderOllamaStatusService,
} from "./stt/ollama-client";
import {
  toGlobalShortcutString,
  normalizeShortcutToken,
  formatHotkeyForDisplay,
  parseHotkey,
  matchesHotkey,
  normalizeEventKey,
  isTypingElement,
} from "./hotkeys/hotkey-service";
import {
  beginCommandHotkeyCapture,
  beginHotkeyCapture,
  cancelCommandHotkeyCapture,
  cancelHotkeyCapture,
  handleCommandHotkeyCaptureKeydown,
  handleCommandHotkeyCaptureKeyup,
  handleHotkeyCaptureKeydown,
  handleHotkeyCaptureKeyup,
  initHotkeyCapture,
  isAnyHotkeyCaptureActive,
  isCommandHotkeyCaptureActive,
  isHotkeyCaptureActive,
} from "./hotkeys/hotkey-capture";
import {
  getNormalizedRegisteredShortcuts,
  initHotkeySync,
  isGlobalShortcutsActive,
  isShortcutSuppressionActive,
  markGlobalShortcutHandled as markGlobalShortcutHandledService,
  requestGlobalShortcutSync as requestGlobalShortcutSyncService,
  setShortcutSuppressionActive,
  shouldBypassLocalShortcutHandling as shouldBypassLocalShortcutHandlingService,
  shouldIgnoreLocalShortcutFromRecentGlobal as shouldIgnoreLocalShortcutFromRecentGlobalService,
  syncGlobalShortcuts as syncGlobalShortcutsService,
} from "./hotkeys/hotkey-sync";
import {
  decodeAudioSample,
  audioBufferToWavBlob,
  shouldOptimizeOnlineSttUpload,
  resolvePreferredOnlineSttBitrate,
  blobToBase64,
  missingApiKeyForOnlineRuntime,
} from "./recording/audio-utils";
import {
  processEvent,
} from "./recording-state-machine";
import type {
  MachineEvent,
  MachineState,
  MachineConfig,
  TransitionResult,
} from "./recording-state-machine";

import {
  ACHIEVEMENTS_STATE_KEY,
  ACTIVE_PAGE_STORAGE_KEY,
  ANALYTICS_SESSIONS_KEY,
  SELECTION_POPUP_WIDTH,
  SELECTION_POPUP_MIN_WIDTH,
  SELECTION_POPUP_MIN_HEIGHT,
  SELECTION_POPUP_MAX_HEIGHT,
  SELECTION_POPUP_CHARS_PER_LINE,
  DICTIONARY_STORAGE_KEY,
  HOME_HISTORY_STORAGE_KEY,
  NOTES_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  SNIPPETS_STORAGE_KEY,
  USAGE_STORAGE_KEY,
  DOCK_LAYOUT_STORAGE_KEY,
  LOCAL_STT_HARDWARE_ADVISOR_STORAGE_KEY,
  APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY,
  APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY,
  LOCAL_STT_MODEL_SIZE_LABELS,
  FOREGROUND_BLOCK_CHECK_CACHE_MS,
  BLOCKED_INPUT_NOTICE_COOLDOWN_MS,
  DEFAULT_LOCAL_OLLAMA_BASE_URL,
  DEFAULT_HOTKEY,
  DEFAULT_COMMAND_HOTKEY,
  DEFAULT_ASSISTANT_NAME,
} from "./constants";

import type {
  Stage,
  MainPage,
  SettingsPane,
  TtsEngine,
  RuntimeMode,
  TtsProfilePane,
  HoldSource,

  LocalSttHardwareAdvisorChoice,
  AssistantInfoResponse,
  LocalSttDownloadStatusResponse,
  LocalSttModelStatusResponse,
  LocalSttHardwareAdviceResponse,
  LocalSttWarmupResponse,
  AssistantPipelineResponse,
  PersistedSettings,
  HotkeySpec,
  UsageStats,
  AnalyticsSessionDetail,
  AchievementState,
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

const BASE_WINDOW_WIDTH = 1280;
const BASE_WINDOW_HEIGHT = 832;
const BASE_DPI = 96;

async function initializeDpiAwareWindowSize(): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }

  try {
    const monitor = await currentMonitor();
    if (!monitor) {
      return;
    }

    const dpi = monitor.scaleFactor * BASE_DPI;
    const scaleFactor = dpi / BASE_DPI;

    const appWindow = getCurrentWindow();
    const size = new LogicalSize(
      Math.round(BASE_WINDOW_WIDTH * scaleFactor),
      Math.round(BASE_WINDOW_HEIGHT * scaleFactor),
    );

    await appWindow.setSize(size);

    const monitors = await availableMonitors();
    const isPrimary = monitors.some((m) => m.position.x === 0 && m.position.y === 0 && m.size.width === monitor.size.width && m.size.height === monitor.size.height);
    if (isPrimary) {
      const x = Math.round((monitor.size.width - size.width) / 2);
      const y = Math.round((monitor.size.height - size.height) / 2);
      const { x: curX, y: curY } = await appWindow.outerPosition();
      if (curX !== x || curY !== y) {
        await appWindow.setPosition(new PhysicalPosition(x, y));
      }
    }
  } catch (error) {
    console.warn("[dpi] failed to adjust window size:", error);
  }
}

void initializeDpiAwareWindowSize();


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

const ACTIVE_SETTINGS_PANE_STORAGE_KEY = "slasshy-wispr-active-settings-pane-v1";

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
const sttHardwareAdvisorUseSuggestionBtn = requiredElement<HTMLButtonElement>(
  "#sttHardwareAdvisorUseSuggestionBtn",
);
const sttHardwareAdvisorContinueBtn = requiredElement<HTMLButtonElement>(
  "#sttHardwareAdvisorContinueBtn",
);
const sttHardwareAdvisorCancelBtn = requiredElement<HTMLButtonElement>("#sttHardwareAdvisorCancelBtn");
const closeSettingsBtn = requiredElement<HTMLButtonElement>("#closeSettingsBtn");
const settingsPaneTitle = requiredElement<HTMLElement>("#settingsPaneTitle");
const settingsMain = requiredElement<HTMLElement>(".settings-modal");
const ttsBootstrapCard = requiredElement<HTMLDivElement>("#ttsBootstrapCard");
const ttsProfilesArea = requiredElement<HTMLDivElement>("#ttsProfilesArea");
const ttsSetupStatus = requiredElement<HTMLParagraphElement>("#ttsSetupStatus");
const ttsSetupLogs = requiredElement<HTMLDivElement>("#ttsSetupLogs");
const setupAllTtsBtn = requiredElement<HTMLButtonElement>("#setupAllTtsBtn");
const ttsProfilePiperPanel = requiredElement<HTMLDivElement>("#ttsProfilePiperPanel");
const ttsProfilePiperTab = requiredElement<HTMLButtonElement>("#ttsProfilePiperTab");
const windowMinimizeBtn = requiredElement<HTMLButtonElement>("#windowMinimizeBtn");
const windowCloseBtn = requiredElement<HTMLButtonElement>("#windowCloseBtn");

const pageNavButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-page-nav]"));
const settingsNavButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-settings-pane-nav]"),
);
const settingsPanels = Array.from(document.querySelectorAll<HTMLElement>("[data-settings-pane]"));
const sidebarLabeledButtons = Array.from(
  document.querySelectorAll<HTMLElement>(".flow-sidebar [data-label]"),
);

const statusPill = requiredElement<HTMLDivElement>("#statusPill");
const statusDetail = requiredElement<HTMLParagraphElement>("#statusDetail");
const noticeText = requiredElement<HTMLParagraphElement>("#noticeText");
const metricWords = requiredElement<HTMLElement>("#metricWords");
const metricSpeakingTime = requiredElement<HTMLElement>("#metricSpeakingTime");
const metricSessions = requiredElement<HTMLElement>("#metricSessions");
const metricWpm = requiredElement<HTMLElement>("#metricWpm");
const wordsTrend = requiredElement<HTMLElement>("#wordsTrend");
const timeTrend = requiredElement<HTMLElement>("#timeTrend");
const sessionsTrend = requiredElement<HTMLElement>("#sessionsTrend");
const wpmTrend = requiredElement<HTMLElement>("#wpmTrend");

function syncSidebarHoverTitles(collapsed: boolean): void {
  for (const target of sidebarLabeledButtons) {
    let label = target.dataset.label?.trim();
    if (!label) {
      continue;
    }

    const hotkey = target.dataset.hotkey?.trim();
    if (collapsed && hotkey) {
      label = `${label} (${hotkey})`;
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
const dictionaryFormCard = requiredElement<HTMLElement>("#dictionaryFormCard");
const dictionaryFormCloseBtn = requiredElement<HTMLButtonElement>("#dictionaryFormCloseBtn");
const dictionaryCount = requiredElement<HTMLSpanElement>("#dictionaryCount");
const dictionarySourceInput = requiredElement<HTMLInputElement>("#dictionarySourceInput");
const dictionaryTargetInput = requiredElement<HTMLInputElement>("#dictionaryTargetInput");
const dictionaryAddBtn = requiredElement<HTMLButtonElement>("#dictionaryAddBtn");
const dictionaryAddBtnTop = requiredElement<HTMLButtonElement>("#dictionaryAddBtnTop");


const snippetsList = requiredElement<HTMLDivElement>("#snippetsList");
const snippetFormContainer = requiredElement<HTMLElement>("#snippetFormContainer");
const snippetForm = requiredElement<HTMLFormElement>("#snippetForm");
const snippetTriggerInput = requiredElement<HTMLInputElement>("#snippetTriggerInput");
const snippetExpansionInput = requiredElement<HTMLInputElement>("#snippetExpansionInput");
const snippetAddBtn = requiredElement<HTMLButtonElement>("#snippetAddBtn");
const snippetsAddBtnTop = requiredElement<HTMLButtonElement>("#snippetsAddBtnTop");



const notesList = requiredElement<HTMLDivElement>("#notesList");
const settingsVersionText = requiredElement<HTMLParagraphElement>("#settingsVersionText");

const providerModelCatalogSelect = requiredElement<HTMLSelectElement>("#providerModelCatalogSelect");
const localOllamaModelInput = requiredElement<HTMLInputElement>("#localOllamaModelInput");
const localOllamaModelCatalogSelect = requiredElement<HTMLSelectElement>(
  "#localOllamaModelCatalogSelect",
);
const localSttModelInput = requiredElement<HTMLInputElement>("#localSttModelInput");
const localSttModelCatalogSelect = requiredElement<HTMLSelectElement>("#localSttModelCatalogSelect");
const microphoneSelect = requiredElement<HTMLSelectElement>("#microphoneSelect");
const microphoneSummary = requiredElement<HTMLElement>("#microphoneSummary");
const hotkeyInput = requiredElement<HTMLInputElement>("#hotkeyInput");
const commandHotkeyInput = requiredElement<HTMLInputElement>("#commandHotkeyInput");
const ttsEngineSelect = requiredElement<HTMLSelectElement>("#ttsEngineSelect");
const ollamaStatusNotice = requiredElement<HTMLParagraphElement>("#ollamaStatusNotice");
const localSttStatusBadge = requiredElement<HTMLSpanElement>("#localSttStatusBadge");
const localSttStatusDetail = requiredElement<HTMLParagraphElement>("#localSttStatusDetail");
const localSttDownloadNotice = requiredElement<HTMLParagraphElement>("#localSttDownloadNotice");
const localSttDownloadProgressBar = requiredElement<HTMLSpanElement>("#localSttDownloadProgressBar");
const localSttDownloadProgressText = requiredElement<HTMLParagraphElement>("#localSttDownloadProgressText");
const settingsFormRefs = querySettingsFormRefs();
const pushToTalkSoundSelect = requiredElement<HTMLSelectElement>("#pushToTalkSoundSelect");
const pushToTalkEndSoundSelect = requiredElement<HTMLSelectElement>("#pushToTalkEndSoundSelect");
const previewPttSoundBtn = requiredElement<HTMLButtonElement>("#previewPttSoundBtn");
const previewPttEndSoundBtn = requiredElement<HTMLButtonElement>("#previewPttEndSoundBtn");
const updateStatusPill = requiredElement<HTMLDivElement>("#updateStatusPill");
const updateStatusText = requiredElement<HTMLParagraphElement>("#updateStatusText");
const updateCurrentVersion = requiredElement<HTMLElement>("#updateCurrentVersion");
const updateLatestVersion = requiredElement<HTMLElement>("#updateLatestVersion");
const updatePublishedAt = requiredElement<HTMLElement>("#updatePublishedAt");
const updateLastCheckedText = requiredElement<HTMLParagraphElement>("#updateLastCheckedText");
const autoCheckUpdatesToggle = requiredElement<HTMLInputElement>("#autoCheckUpdatesToggle");
const checkUpdatesBtn = requiredElement<HTMLButtonElement>("#checkUpdatesBtn");
const installUpdateBtn = requiredElement<HTMLButtonElement>("#installUpdateBtn");
const updateReleaseCard = requiredElement<HTMLDivElement>("#updateReleaseCard");
const updateReleaseName = requiredElement<HTMLParagraphElement>("#updateReleaseName");
const updateReleaseNotes = requiredElement<HTMLParagraphElement>("#updateReleaseNotes");
const updateReleaseLink = requiredElement<HTMLAnchorElement>("#updateReleaseLink");
const updateInstallProgressWrap = requiredElement<HTMLDivElement>("#updateInstallProgressWrap");
const updateInstallProgressTrack = requiredElement<HTMLDivElement>("#updateInstallProgressTrack");
const updateInstallProgressBar = requiredElement<HTMLSpanElement>("#updateInstallProgressBar");
const updateInstallProgressText = requiredElement<HTMLParagraphElement>("#updateInstallProgressText");
const updateManualDownloadRow = requiredElement<HTMLDivElement>("#updateManualDownloadRow");
const updateManualDownloadText = requiredElement<HTMLParagraphElement>("#updateManualDownloadText");
const openGithubReleasesBtn = requiredElement<HTMLButtonElement>("#openGithubReleasesBtn");
const skipUpdateVersionBtn = requiredElement<HTMLButtonElement>("#skipUpdateVersionBtn");
const snoozeUpdateBtn = requiredElement<HTMLButtonElement>("#snoozeUpdateBtn");

const baseUrlValue = requiredElement<HTMLElement>("#baseUrlValue");
const sttModelValue = requiredElement<HTMLElement>("#sttModelValue");
const aiModelValue = requiredElement<HTMLElement>("#aiModelValue");
const piperStatusValue = requiredElement<HTMLElement>("#piperStatusValue");
const piperPathValue = requiredElement<HTMLElement>("#piperPathValue");
const voiceStatusValue = requiredElement<HTMLElement>("#voiceStatusValue");
const voicePathValue = requiredElement<HTMLElement>("#voicePathValue");

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

const assistantAudio = requiredElement<HTMLAudioElement>("#assistantAudio");

let stage: Stage = "idle";
let pipelineRunning = false;
let mediaRecorder: MediaRecorder | null = null;
let mediaStream: MediaStream | null = null;
let recorderMimeType = "audio/webm";
let recordedChunks: Blob[] = [];
let recordingStartedAt = 0;
let lastSavedRecordingId: string | null = null;
let skipPipelineAfterRecorderStop = false;
let skipPipelineAfterRecorderStopNotice = "";
let dockAmplitude = 0;
let dockHideTimerId: number | null = null;
let activeTtsPlayback: ActiveTtsPlayback | null = null;
let voiceIndicatorWindow: WebviewWindow | null = null;
let selectionAssistantWindow: WebviewWindow | null = null;
let latestSelectionPopupPayload: SelectionPopupPayload | null = null;
let selectionPopupTokenCounter = 0;
let dockLayout = loadDockLayout();

let dictionaryTerms = loadDictionaryFromState();
let snippets = loadSnippetsFromState();
let quickNotes = loadNotesFromState();
let usageStats = loadUsageStats();
let analyticsSessionDetails: AnalyticsSessionDetail[] = loadCanonicalAnalyticsSessions();
let achievementStates: AchievementState[] = loadAchievementStates();
let homeHistoryEntries = loadHistory();
let commandModeArmed = false;
let commandSelectionSnapshot: string | null = null;
const recentTurns: Array<{ speaker: string; content: string }> = [];
let activePage: MainPage = loadPersistedMainPage();
let activeSettingsPane: SettingsPane = loadPersistedSettingsPane();
let settingsCloseTimer: number | null = null;
let settingsPaneTransitionTimer: number | null = null;
let dockRuntimeErrorShown = false;
let providerModelCatalog: string[] = [];
let localOllamaModelCatalog: string[] = [];
let localSttModelCatalog: string[] = [];
let latestAssistantInfoDefaults: AssistantInfoResponse | null = null;
let piperRuntimeReady = false;
let localSttDownloadInFlight = false;
let localSttDeleteInFlight = false;
let localSttDeactivateInFlight = false;
let localSttDownloadActive = false;
let localSttDownloadStatusPollingId: number | null = null;
let localSttDownloadStatusPollInFlight = false;
let localSttWarmupInFlight = false;
let lastWarmedLocalSttModel = "";
let localSttRuntimeLoaded = false;
let localSttSelectedModelDownloaded = false;
let localSttStatusChecked = false;
let localSttRuntimeStateInFlight = false;
let runtimeModeSyncInFlight = false;
let pendingRuntimeModeSyncTarget: RuntimeMode | null = null;
let pendingRuntimeModeSyncShowLoadOverlay = false;
let localSttLoadOverlayTickerId: number | null = null;
let localSttLoadOverlayStartedAt = 0;
let localSttDownloadOverlay: HTMLDivElement | null = null;
let lastLocalSttDownloadStatus: LocalSttDownloadStatusResponse | null = null;

function syncLocalSttDownloadOverlayVisibility(): void {
  if (!localSttDownloadOverlay) {
    return;
  }
  const shouldShow =
    lastLocalSttDownloadStatus !== null &&
    lastLocalSttDownloadStatus.active &&
    !isSettingsOpen();
  localSttDownloadOverlay.hidden = !shouldShow;
}
let localSttHardwareAdvisorOpen = false;
let localSttHardwareAdvisorResolver: ((choice: LocalSttHardwareAdvisorChoice) => void) | null = null;
let ttsSetupRunning = false;
let launchAtLoginSyncNonce = 0;
let foregroundBlockStatusCache: ForegroundInputBlockStatus = {
  blocked: false,
  processName: "",
  reason: "",
  fullscreen: false,
};
let foregroundBlockCheckedAt = 0;
let foregroundBlockCheckInFlight: Promise<ForegroundInputBlockStatus> | null = null;
let lastBlockedInputNoticeAt = 0;
let lastBlockedInputProcess = "";
let foregroundBlockMonitorId: number | null = null;
let foregroundBlockMonitorInFlight = false;
let lastCaptureIntentStartedAt = 0;
let lastCaptureIntentLabel = "";
let mainWindowHiddenToTray = false;
let notificationPermissionRequested = false;
const dockChannel = new BroadcastChannel("slasshywispr-dock");
const selectionPopupChannel = new BroadcastChannel("slasshywispr-selection-popup");
const ENABLE_FOREGROUND_SHORTCUT_SUPPRESSION = true;
const MAIN_WINDOW_VISIBILITY_EVENT = "slasshy://main-window-visibility";
import {
  snoozeUpdateFor24Hours,
} from "./updater/updater-client";

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
let settings = loadSettings();
settings.pushToTalkHotkey = settings.pushToTalkHotkey.trim() || DEFAULT_HOTKEY;
settings.commandHotkey = settings.commandHotkey.trim() || DEFAULT_COMMAND_HOTKEY;
initSettingsState(settings);
setPersistErrorReporter((message) => setNotice(message, true));
initPipelinePrompt({ getRecentTurns: () => recentTurns });
initPipelineRender(
  { sttLatency, aiLatency, ttsLatency, totalLatency },
  {
    isIncognito: () => settings.incognitoMode,
    now: () => Date.now(),
    getRecordingStartedAt: () => recordingStartedAt,
    getLastSavedRecordingId: () => lastSavedRecordingId,
    getLastCaptureIntentLabel: () => lastCaptureIntentLabel,
    trackUsage: (transcript) => trackUsage(transcript),
    addQuickNote: (text) => addQuickNote(text),
    getHomeHistory: () => homeHistoryEntries,
    setHomeHistory: (entries) => {
      homeHistoryEntries = entries;
    },
    persistHomeHistory: () => persistHomeHistory(),
    notifyStoreUpdated: () => {
      window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
    },
    getRecentTurns: () => recentTurns,
  },
);
initPlayback(assistantAudio, {
  getActivePlayback: () => activeTtsPlayback,
  setActivePlayback: (playback) => {
    activeTtsPlayback = playback;
  },
  getStage: () => stage,
  transition: (event) => {
    transitionRecordingState(event);
  },
  syncAvailability: () => syncActionAvailability(),
});
initMicStream({
  notify: (message, isError) => setNotice(message, isError),
  log: (message) => logClientEvent(message),
});
initCaptureMonitors(
  { recordTimer },
  {
    getAmplitude: () => dockAmplitude,
    setAmplitude: (level) => {
      dockAmplitude = level;
    },
    publishDockState: () => publishDockState(),
    now: () => Date.now(),
    getRecordingStartedAt: () => recordingStartedAt,
    getMediaStream: () => mediaStream,
    setMediaStream: (stream) => {
      mediaStream = stream;
    },
  },
);
initCaptureTriggers({
  getStage: () => stage,
  isPipelineRunning: () => pipelineRunning,
  getCaptureMode: () => settings.captureMode,
  setNotice: (message, isError) => setNotice(message, isError),
  log: (message) => logClientEvent(message),
  shouldBlockFromForegroundApp: () => shouldBlockAssistantInputFromForegroundApp(),
  interruptPlayback: () => interruptTtsPlaybackForCaptureIntent(),
  setCaptureIntent: (startedAt, label) => {
    lastCaptureIntentStartedAt = startedAt;
    lastCaptureIntentLabel = label;
  },
  getRecorderState: () => mediaRecorder?.state ?? null,
  syncAvailability: () => syncActionAvailability(),
  isHotkeyCaptureActive: () => isAnyHotkeyCaptureActive(),
  performanceNow: () => performance.now(),
  now: () => Date.now(),
});
initRecordingController(
  {
    getStage: () => stage,
    isPipelineRunning: () => pipelineRunning,
    getHoldCount: () => getPushToTalkHoldCount(),
    getCommandModeArmed: () => commandModeArmed,
    getCaptureMode: () => settings.captureMode,
    readSettings: () => readSettingsFromForm(),
    readLiveSettings: () => settings,
    summarizeSettings: (next) => summarizeSettingsForDiagnostics(next),
    shouldBlockFromForegroundApp: () => shouldBlockAssistantInputFromForegroundApp(),
    primeSelectionSnapshot: () => {
      void primeSelectionSnapshotForCommandMode();
    },
    clearPushToTalkHolds: () => clearPushToTalkHolds(),
    showMissingApiKeyNotice: (source) => showMissingApiKeyNotice(source),
    setNotice: (message, isError) => setNotice(message, isError),
    log: (message) => logClientEvent(message),
    transition: (event) => {
      transitionRecordingState(event);
    },
    syncAvailability: () => syncActionAvailability(),
    getRecordingStartedAt: () => recordingStartedAt,
    clearCaptureIntent: () => {
      lastCaptureIntentStartedAt = 0;
      lastCaptureIntentLabel = "";
    },
    getCaptureIntentStartedAt: () => lastCaptureIntentStartedAt,
    getCaptureIntentLabel: () => lastCaptureIntentLabel,
    setCaptureIntent: (startedAt, label) => {
      lastCaptureIntentStartedAt = startedAt;
      lastCaptureIntentLabel = label;
    },
    setMicrophonePermissionGranted: (granted) => setMicrophonePermissionGranted(granted),
    refreshRecordingsStorageHint: () => {
      void refreshRecordingsStorageHint();
    },
    isTauri: isTauriEnvironment,
    now: () => Date.now(),
    performanceNow: () => performance.now(),
    runPipeline: (blob, mimeType) => runPipeline(blob, mimeType),
    createId: () => createId(),
    saveDictationRecording: (args) => ipcSaveDictationRecording(args),
  },
  {
    getMediaRecorder: () => mediaRecorder,
    setMediaRecorder: (recorder) => {
      mediaRecorder = recorder;
    },
    getMediaStream: () => mediaStream,
    setMediaStream: (stream) => {
      mediaStream = stream;
    },
    getRecorderMimeType: () => recorderMimeType,
    setRecorderMimeType: (mimeType) => {
      recorderMimeType = mimeType;
    },
    getRecordedChunks: () => recordedChunks,
    setRecordedChunks: (chunks) => {
      recordedChunks = chunks;
    },
    pushRecordedChunk: (chunk) => {
      recordedChunks.push(chunk);
    },
    getSkipPipeline: () => skipPipelineAfterRecorderStop,
    setSkipPipeline: (skip) => {
      skipPipelineAfterRecorderStop = skip;
    },
    getSkipNotice: () => skipPipelineAfterRecorderStopNotice,
    setSkipNotice: (notice) => {
      skipPipelineAfterRecorderStopNotice = notice;
    },
    setLastSavedRecordingId: (id) => {
      lastSavedRecordingId = id;
    },
  },
);
initDiagnostics(noticeText, { isTauri: isTauriEnvironment });
initMicrophones(
  { select: microphoneSelect, summary: microphoneSummary },
  {
    getMicrophoneDeviceId: () => settings.microphoneDeviceId,
    setMicrophoneDeviceId: (id) => {
      settings.microphoneDeviceId = id;
    },
    persist: () => persistSettings(settings),
    getStage: () => stage,
    getShowFlowBar: () => settings.showFlowBar,
    primeCapture: (deviceId, showFlowBar) => {
      void primeCaptureReadiness(deviceId, showFlowBar);
    },
    notify: (message, isError) => setNotice(message, isError),
  },
);
function updateMicrophoneSummary(): void {
  updateMicrophoneSummaryService();
}
async function refreshMicrophones(requestPermission: boolean): Promise<void> {
  await refreshMicrophonesService(requestPermission);
}
const soundDeps = {
  currentSettings: getSettingsSnapshot,
  previewVolume: () => Number(settingsFormRefs.pushToTalkSoundVolumeRange.value),
};
function playDictationSoundEffect(kind: "start" | "stop" | "error", previewSoundId?: string): void {
  playDictationSoundEffectService(soundDeps, kind, previewSoundId);
}
const mediaControlDeps = {
  isMutingEnabled: () => settings.muteMusicWhileDictating,
  isTauri: isTauriEnvironment,
  notify: (message: string, isError?: boolean) => setNotice(message, isError),
};
function pauseExternalMediaForDictation(): void {
  pauseExternalMediaForDictationService(mediaControlDeps);
}
function resumeExternalMediaAfterDictation(): void {
  resumeExternalMediaAfterDictationService(mediaControlDeps);
}
initRecordings(
  {
    clearButton: settingsFormRefs.clearRecordingsBtn,
    storageHint: settingsFormRefs.recordingsStorageHint,
    storageHintWeb: settingsFormRefs.recordingsStorageHintWeb,
  },
  {
    isTauri: isTauriEnvironment,
    notify: (message, isError) => setNotice(message, isError),
    log: (message) => logClientEvent(message),
    notifyStoreUpdated: () => {
      window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
    },
  },
);
async function refreshRecordingsStorageHint(): Promise<void> {
  await refreshRecordingsStorageHintService();
}
initUpdaterView(
  {
    statusPill: updateStatusPill,
    statusText: updateStatusText,
    currentVersion: updateCurrentVersion,
    latestVersion: updateLatestVersion,
    publishedAt: updatePublishedAt,
    lastCheckedText: updateLastCheckedText,
    releaseCard: updateReleaseCard,
    releaseName: updateReleaseName,
    releaseNotes: updateReleaseNotes,
    releaseLink: updateReleaseLink,
    installProgressWrap: updateInstallProgressWrap,
    installProgressTrack: updateInstallProgressTrack,
    installProgressBar: updateInstallProgressBar,
    installProgressText: updateInstallProgressText,
    manualDownloadRow: updateManualDownloadRow,
    manualDownloadText: updateManualDownloadText,
    openGithubReleasesBtn: openGithubReleasesBtn,
    autoCheckUpdatesToggle: autoCheckUpdatesToggle,
  },
  {
    isTauri: isTauriEnvironment,
    openExternal: (url) => openInSystemBrowser(url),
  },
);
function initializeUpdaterPanel(): void {
  initializeUpdaterPanelService();
  syncUpdaterButtons();
}
initUpdaterFlow(
  {
    checkUpdatesBtn,
    installUpdateBtn,
    skipUpdateVersionBtn,
    snoozeUpdateBtn,
  },
  {
    isTauri: isTauriEnvironment,
    notify: (message, isError) => setNotice(message, isError),
    log: (message) => logClientEvent(message),
    openUpdateSettings: (reason) => {
      openSettings(reason);
      setActiveSettingsPane("update-security", reason);
    },
    confirmInstall: (version) =>
      confirmDestructiveAction(
        `Install ${version} now? The installer will download, this app will close, and any unsaved work in the current session may be lost.`,
      ),
    getNotificationPermissionRequested: () => notificationPermissionRequested,
    setNotificationPermissionRequested: (requested) => {
      notificationPermissionRequested = requested;
    },
  },
);
function syncUpdaterButtons(): void {
  syncUpdaterButtonsService();
}
async function handleCheckForUpdates(options?: {
  silent?: boolean;
  source?: "manual" | "startup" | "interval";
}): Promise<void> {
  await handleCheckForUpdatesService(options);
}
async function handleInstallUpdate(): Promise<void> {
  await handleInstallUpdateService();
}
async function registerUpdateInstallProgressListener(): Promise<void> {
  await registerUpdateInstallProgressListenerService();
}
function startAutomaticUpdateChecks(): void {
  startAutomaticUpdateChecksService();
}
initOllamaClient(
  {
    statusNotice: ollamaStatusNotice,
    providerCatalogSelect: providerModelCatalogSelect,
    localOllamaCatalogSelect: localOllamaModelCatalogSelect,
    fetchProviderModelsBtn,
    checkOllamaStatusBtn,
    installOllamaBtn,
    fetchOllamaModelsBtn,
    useOllamaModelBtn,
    pullOllamaModelBtn,
    applyModelToAiBtn,
    applyModelToSttBtn,
  },
  {
    readSettings: () => readSettingsFromForm(),
    commitSettings: () => {
      void handleSettingsChange();
    },
    isBusy: () => pipelineRunning || stage === "recording",
    isInstallBusy: () => ollamaInstallBusy || pipelineRunning || stage === "recording",
    isPullBusy: () => pipelineRunning || stage === "recording" || ollamaPullBusy,
    setStatusBusy: (busy) => {
      ollamaStatusBusy = busy;
    },
    setInstallBusy: (busy) => {
      ollamaInstallBusy = busy;
    },
    setPullBusy: (busy) => {
      ollamaPullBusy = busy;
    },
    getCatalog: () => localOllamaModelCatalog,
    setCatalogInput: (value) => {
      settingsFormRefs.localOllamaModelInput.value = value;
    },
    getCatalogInput: () => settingsFormRefs.localOllamaModelInput.value,
    getCatalogSelection: () => localOllamaModelCatalogSelect.value,
    setCatalogSelection: (value) => {
      localOllamaModelCatalogSelect.value = value;
    },
    renderProviderCatalog: (models, selected) => renderProviderModelCatalog(models, selected),
    renderOllamaCatalog: (models, selected) => renderLocalOllamaModelCatalog(models, selected),
    renderStatus: (status) => renderOllamaStatusService(status),
    setNotice: (message, isError) => setNotice(message, isError),
    setStage: (next, detail) => setStage(next, detail),
    syncAvailability: () => syncActionAvailability(),
    openModelsPane: () => setActiveSettingsPane("models"),
  },
);
let ollamaStatusBusy = false;
let ollamaInstallBusy = false;
let ollamaPullBusy = false;
async function refreshOllamaStatus(options: { quiet?: boolean } = {}): Promise<void> {
  await refreshOllamaStatusService(options);
}
async function fetchOllamaModels(
  options: { quiet?: boolean; autoSelect?: boolean } = {},
): Promise<void> {
  await fetchOllamaModelsService(options);
}
async function ensureLocalOllamaModelSelected(options: { quiet?: boolean } = {}): Promise<string> {
  return ensureLocalOllamaModelSelectedService(options);
}
initTtsClient(
  {
    setupLogs: ttsSetupLogs,
    setupAllBtn: setupAllTtsBtn,
    setupStatus: ttsSetupStatus,
    setupRuntimeBtn,
    validatePiperBtn,
    downloadVoiceBtn,
    piperStatusValue,
    piperPathValue,
    voiceStatusValue,
    voicePathValue,
  },
  {
    isBusy: () => pipelineRunning || stage === "recording",
    readSettings: () => readSettingsFromForm(),
    getPiperPathInput: () => settingsFormRefs.piperPathInput.value,
    setPiperPathInput: (value) => {
      settingsFormRefs.piperPathInput.value = value;
    },
    commitSettings: () => {
      void handleSettingsChange();
    },
    setNotice: (message, isError) => setNotice(message, isError),
    setStage: (next, detail) => setStage(next, detail),
    getStage: () => stage,
    refreshAssistantInfo: () => refreshAssistantInfoSafely(),
    syncAvailability: () => syncActionAvailability(),
    updateGate: () => updateTtsSetupGate(),
    isSetupRunning: () => ttsSetupRunning,
    setSetupRunning: (running) => {
      ttsSetupRunning = running;
    },
    isPollInFlight: () => ttsSetupPollInFlight,
    setPollInFlight: (inFlight) => {
      ttsSetupPollInFlight = inFlight;
    },
  },
);
let ttsSetupPollInFlight = false;
const settingsCoreDeps: SettingsCoreDeps = {
  isCapturingHotkey: () => isHotkeyCaptureActive(),
  isCapturingCommandHotkey: () => isCommandHotkeyCaptureActive(),
  currentSettings: getSettingsSnapshot,
  refreshRecordingsStorageHint: () => {
    void refreshRecordingsStorageHint();
  },
  isTauri: isTauriEnvironment,
  showStaleRuntimePane: () => setActiveSettingsPane("models"),
};
function readSettingsFromForm(): PersistedSettings {
  return readSettingsFromFormService(settingsFormRefs, settingsCoreDeps);
}
function applySettingsToForm(next: PersistedSettings): void {
  applySettingsToFormService(settingsFormRefs, settingsCoreDeps, next);
}
let cachedHotkeyDisplay = formatHotkeyForDisplay(settings.pushToTalkHotkey);
applySettingsToForm(settings);
renderSidebarLocalSttToggle();
initModelCatalogs(
  {
    providerSelect: providerModelCatalogSelect,
    localOllamaSelect: localOllamaModelCatalogSelect,
    localSttSelect: localSttModelCatalogSelect,
  },
  {
    getAiModelInput: () => settingsFormRefs.aiModelInput.value,
    getSttModelInput: () => settingsFormRefs.sttModelInput.value,
    getAiModelName: () => settings.aiModelName,
    getSttModelName: () => settings.sttModelName,
    getLocalOllamaModelInput: () => localOllamaModelInput.value,
    getLocalOllamaModelName: () => settings.localOllamaModel,
    getLocalSttModelInput: () => localSttModelInput.value,
    setProviderCatalog: (models) => {
      providerModelCatalog = models;
    },
    setLocalOllamaCatalog: (models) => {
      localOllamaModelCatalog = models;
    },
    setLocalSttCatalog: (models) => {
      localSttModelCatalog = models;
    },
    setLocalSttModelInput: (value) => {
      localSttModelInput.value = value;
    },
  },
);
function renderProviderModelCatalog(models: string[], selectedModel = ""): void {
  renderProviderModelCatalogService(models, selectedModel);
}
function renderLocalOllamaModelCatalog(models: string[], selectedModel = ""): void {
  renderLocalOllamaModelCatalogService(models, selectedModel);
}
function renderLocalSttModelCatalog(models: string[], selectedModel = ""): void {
  renderLocalSttModelCatalogService(models, selectedModel);
}
renderProviderModelCatalog([], settings.aiModelName || settings.sttModelName);
renderLocalOllamaModelCatalog([], settings.localOllamaModel);
renderLocalSttModelCatalog([], settings.localSttModel);
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
  } else if (payload.action === "open-app") {
    void (async () => {
      const win = getCurrentWindow();
      await win.show();
      await win.unminimize();
      await win.setFocus();
    })();
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

setActivePage(activePage);
setActiveSettingsPane(activeSettingsPane);
renderDictionaryList();
renderSnippetsList();
renderNotesList();
initAnalyticsRender(
  {
    words: metricWords,
    speakingTime: metricSpeakingTime,
    sessions: metricSessions,
    wpm: metricWpm,
    wordsTrend,
    timeTrend,
    sessionsTrend,
    wpmTrend,
  },
  { getStats: () => usageStats },
);
updateUsageMetrics();
refreshRecordButton();
syncActionAvailability();
initializeUpdaterPanel();
void registerUpdateInstallProgressListener();
setupCustomWindowControls();
void initializeTrayBackgroundLifecycle();
hotkeyInput.readOnly = true;
commandHotkeyInput.readOnly = true;
requestLaunchAtLoginSync(settings.launchAtLogin);
void reconcileLaunchAtLoginWithOs();
startBlockedAppShortcutSuppressionMonitor();
applySidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1");


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

toggleSidebarBtn.addEventListener("click", () => {
  const collapsed = !document.body.classList.contains("sidebar-collapsed");
  applySidebarCollapsed(collapsed);
  localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
});

openSettingsBtn.addEventListener("click", () => {
  openSettings("user-click-settings-button");
});

sidebarToggleLocalSttBtn.addEventListener("click", () => {
  void (async () => {
    const activeSettings = readSettingsFromForm();
    if (activeSettings.sttRuntimeMode !== "local") {
      try {
        await syncLocalSttRuntimeForMode("online");
      } catch (error) {
        setNotice(`Unable to switch local STT runtime: ${asErrorMessage(error)}`, true);
        return;
      }
      const onlineSttModel = activeSettings.sttModelName.trim() || "the configured online STT model";
      setNotice(
        `STT runtime is Online. Using ${onlineSttModel}. Switch STT to Offline in Settings > Models to load a local STT model.`,
      );
      return;
    }

    const selectedModel = await ensureSelectedLocalSttModel({ quiet: true });
    if (!selectedModel) {
      showOfflineModeDiagnostic('no-model-downloaded');
      return;
    }

    const modelDownloaded = await refreshSelectedLocalSttModelAvailability({ quiet: true });
    if (!modelDownloaded) {
      await downloadLocalSttModel();
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

markPaneConverted("update-security");
window.addEventListener(APP_UPDATE_AUTO_CHECK_CHANGED_EVENT, (event) => {
  const enabled = (event as CustomEvent<boolean>).detail;
  autoCheckUpdatesToggle.checked = enabled;
  localStorage.setItem(
    APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY,
    enabled ? "1" : "0",
  );
  startAutomaticUpdateChecks();
  setNotice(
    enabled
      ? "Automatic update checks enabled."
      : "Automatic update checks disabled.",
  );
});

installUpdateBtn.addEventListener("click", () => {
  void handleInstallUpdate();
});

skipUpdateVersionBtn.addEventListener("click", () => {
  const latestVersion = getCachedUpdateResult()?.latestVersion;
  if (latestVersion) {
    localStorage.setItem(APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY, latestVersion);
    setNotice(`Version ${latestVersion} will be skipped. You won't be notified about this version again.`);
    syncUpdaterButtons();
  }
});

snoozeUpdateBtn.addEventListener("click", () => {
  snoozeUpdateFor24Hours();
  setNotice("Update notifications snoozed for 24 hours.");
  syncUpdaterButtons();
});

window.addEventListener("beforeunload", () => {
  stopAutomaticUpdateChecks();
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
  if (isHotkeyCaptureActive()) {
    handleHotkeyCaptureKeydown(event);
    return;
  }
  if (isCommandHotkeyCaptureActive()) {
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

  if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
    const digit = event.key;
    if (digit >= "1" && digit <= "6") {
      const pageIndex = parseInt(digit, 10) - 1;
      const pages: MainPage[] = ["home", "history", "dictionary", "snippets", "notes", "analytics"];
      const page = pages[pageIndex];
      if (page) {
        event.preventDefault();
        setActivePage(page);
        return;
      }
    }

    if (event.key === "b" || event.key === "B") {
      event.preventDefault();
      toggleSidebarBtn.click();
      return;
    }

    if (event.key === "d" || event.key === "D") {
      event.preventDefault();
      sidebarToggleLocalSttBtn.click();
      return;
    }

    if (event.key === "s" || event.key === "S") {
      event.preventDefault();
      openSettingsBtn.click();
      return;
    }
  }

  const commandHotkey = parseHotkey(settings.commandHotkey);
  if (settings.commandMode && commandHotkey && matchesHotkey(event, commandHotkey)) {
    const commandShortcutToken = normalizeShortcutToken(toGlobalShortcutString(commandHotkey));
    logClientEvent(
      `[hotkey.local.command] keydown shortcut=${commandShortcutToken} repeat=${boolFlag(
        event.repeat,
      )}`,
    );
    if (shouldBypassLocalShortcutHandling(commandShortcutToken)) {
      return;
    }
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
  if (shouldBypassLocalShortcutHandling(pushShortcutToken)) {
    return;
  }
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
  if (isHotkeyCaptureActive()) {
    handleHotkeyCaptureKeyup(event);
    return;
  }
  if (isCommandHotkeyCaptureActive()) {
    handleCommandHotkeyCaptureKeyup(event);
    return;
  }

  if (!hasPushToTalkHold("hotkey")) {
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
  if (shouldBypassLocalShortcutHandling(pushShortcutToken)) {
    return;
  }
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

  if (getPushToTalkHoldCount() === 0) {
    return;
  }

  logClientEvent(
    `[record.ptt.blur] clearing holds=${getPushToTalkHoldCount()} stage=${stage}`,
  );
  clearPushToTalkHolds();
  if (stage === "recording") {
    logClientEvent("[record.ptt.blur] window blurred during recording -> stopRecording()");
    stopRecording();
  }
});

window.addEventListener("focus", () => {
  if (!isGlobalShortcutsActive() && !isAnyHotkeyCaptureActive()) {
    requestGlobalShortcutSync();
  }
});

window.addEventListener("beforeunload", () => {
  stopTtsSetupPollingService();
  stopLocalSttDownloadStatusPolling();
  if (dockHideTimerId !== null) {
    window.clearTimeout(dockHideTimerId);
    dockHideTimerId = null;
  }
  flushPendingSettings();
  if (foregroundBlockMonitorId !== null) {
    window.clearInterval(foregroundBlockMonitorId);
    foregroundBlockMonitorId = null;
  }
  if (isExternalMediaMutedForDictation()) {
    resumeExternalMediaAfterDictationService({
      ...mediaControlDeps,
      notify: () => {},
    });
    setExternalMediaMutedForDictation(false);
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

markPaneConverted("pipeline");
markPaneConverted("general");
markPaneConverted("models");
window.addEventListener(SETTINGS_PATCH_EVENT, (event) => {
  const patch = (event as CustomEvent<Partial<PersistedSettings>>).detail;
  if (!patch || typeof patch !== "object") {
    return;
  }
  applySettingsPatchToFormService(settingsFormRefs, patch);
  void handleSettingsChange();
});

initHotkeyCapture(
  { hotkeyInput, commandHotkeyInput },
  {
    getPushHotkey: () => settings.pushToTalkHotkey,
    getCommandHotkey: () => settings.commandHotkey,
    notify: (message, isError) => setNotice(message, isError),
    onCommitted: () => {
      void handleSettingsChange();
    },
  },
);

initHotkeySync({
  isTauri: isTauriEnvironment,
  getSettings: getSettingsSnapshot,
  notify: (message, isError) => setNotice(message, isError),
  log: (message) => logClientEvent(message),
  publishDockState: () => publishDockState(),
  onShortcutEvent: (event) => handleGlobalShortcutEvent(event),
});
function requestGlobalShortcutSync(force = false): void {
  requestGlobalShortcutSyncService(force);
}
async function syncGlobalShortcuts(force = false): Promise<void> {
  await syncGlobalShortcutsService(force);
}
function markGlobalShortcutHandled(shortcutToken: string, state: "pressed" | "released"): void {
  markGlobalShortcutHandledService(shortcutToken, state);
}
function shouldBypassLocalShortcutHandling(shortcutToken: string): boolean {
  return shouldBypassLocalShortcutHandlingService(shortcutToken);
}
function shouldIgnoreLocalShortcutFromRecentGlobal(
  shortcutToken: string,
  state: "pressed" | "released",
): boolean {
  return shouldIgnoreLocalShortcutFromRecentGlobalService(shortcutToken, state);
}
wireSettingsFormInputsService({
  refs: settingsFormRefs,
  onFieldChange: () => {
    void handleSettingsChange();
  },
  onThemeCardChange: (value) => {
    const next = asThemeMode(value);
    if (settingsFormRefs.themeModeSelect.value !== next) {
      settingsFormRefs.themeModeSelect.value = next;
    }
    void handleSettingsChange();
  },
  onVolumePreview: (value) => {
    settingsFormRefs.pttVolumeHint.textContent = `${value}%`;
  },
});

previewPttSoundBtn.addEventListener("click", () => {
  playDictationSoundEffect("start", pushToTalkSoundSelect.value);
});
previewPttEndSoundBtn.addEventListener("click", () => {
  playDictationSoundEffect("stop", pushToTalkEndSoundSelect.value);
});

providerModelCatalogSelect.addEventListener("change", () => {
  const selected = providerModelCatalogSelect.value.trim();
  if (!selected) {
    return;
  }
  settingsFormRefs.aiModelInput.value = selected;
  handleSettingsChange();
});

localOllamaModelCatalogSelect.addEventListener("change", () => {
  const selected = localOllamaModelCatalogSelect.value.trim();
  if (!selected) {
    return;
  }
  settingsFormRefs.localOllamaModelInput.value = selected;
  handleSettingsChange();
});

localSttModelCatalogSelect.addEventListener("change", () => {
  const selected = localSttModelCatalogSelect.value.trim();
  if (!selected) {
    localSttSelectedModelDownloaded = false;
    localSttStatusChecked = true;
    renderSidebarLocalSttToggle();
    renderLocalSttSettingsStatus();
    return;
  }
  localSttModelInput.value = selected;
  localSttStatusChecked = false;
  handleSettingsChange();
  void refreshSelectedLocalSttModelAvailability({ quiet: true });
});

hotkeyInput.addEventListener("focus", () => {
  beginHotkeyCapture();
});

hotkeyInput.addEventListener("click", () => {
  beginHotkeyCapture();
});

hotkeyInput.addEventListener("blur", () => {
  if (isHotkeyCaptureActive()) {
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
  if (isCommandHotkeyCaptureActive()) {
    cancelCommandHotkeyCapture();
  }
});

dictionaryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addDictionaryTerm();
});

dictionaryAddBtnTop.addEventListener("click", () => {
  const isCollapsed = dictionaryFormCard.classList.contains("is-collapsed");
  if (isCollapsed) {
    dictionaryFormCard.classList.remove("is-collapsed");
    dictionaryAddBtnTop.classList.add("is-active");
    dictionarySourceInput.focus();
  } else {
    dictionaryFormCard.classList.add("is-collapsed");
    dictionaryAddBtnTop.classList.remove("is-active");
  }
});

dictionaryFormCloseBtn.addEventListener("click", () => {
  dictionaryFormCard.classList.add("is-collapsed");
  dictionaryAddBtnTop.classList.remove("is-active");
});



snippetForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addSnippetEntry();
});

snippetsAddBtnTop.addEventListener("click", () => {
  const isCollapsed = snippetFormContainer.classList.contains("is-collapsed");
  if (isCollapsed) {
    snippetFormContainer.classList.remove("is-collapsed");
    snippetsAddBtnTop.classList.add("is-active");
    snippetsAddBtnTop.textContent = "Close";
    snippetTriggerInput.focus();
  } else {
    snippetFormContainer.classList.add("is-collapsed");
    snippetsAddBtnTop.classList.remove("is-active");
    snippetsAddBtnTop.textContent = "Add new";
  }
});



notesQuickMicBtn.addEventListener("click", () => {
  if (settings.captureMode === "push-to-talk") {
    setNotice("Hold the note button while speaking in push-to-talk mode.");
    return;
  }

  void handleRecordToggle();
});

bindPushToTalkPointerHold(notesQuickMicBtn, "notes-button");
bindPushToTalkKeyboardHold(notesQuickMicBtn, "notes-button");

refreshMicsBtn.addEventListener("click", () => {
  void refreshMicrophones(true);
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
  settingsFormRefs.aiModelInput.value = selected;
  handleSettingsChange();
  setNotice(`AI model set to "${selected}".`);
});

applyModelToSttBtn.addEventListener("click", () => {
  const selected = providerModelCatalogSelect.value.trim();
  if (!selected) {
    setNotice("Select a model from catalog first.", true);
    return;
  }
  settingsFormRefs.sttModelInput.value = selected;
  handleSettingsChange();
  setNotice(`STT model set to "${selected}".`);
});

clearHistoryBtn.addEventListener("click", async () => {
  if (await confirmDestructiveAction("Clear all transcription history from this device?")) {
    clearAllHistory();
  }
});

clearHistoryBtnFull.addEventListener("click", async () => {
  if (await confirmDestructiveAction("Clear all transcription history from this device?")) {
    clearAllHistory();
  }
});

viewFullHistoryBtn.addEventListener("click", () => {
  setActivePage("history");
});

/* Home tab search-button → switch to History and focus the search
   input. rAF ensures the React tree has time to mount the History
   section before the input exists in the DOM. */
window.addEventListener("slasshy:focus-history-search", () => {
  setActivePage("history");
  requestAnimationFrame(() => {
    const input = document.getElementById("historySearchInput");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  });
});

/* Home rail — Open analytics card-link. */
window.addEventListener("slasshy:focus-analytics", () => {
  setActivePage("analytics");
});

/* Home rail — Edit (Settings) card-link. The settings modal is
   mounted at all times; we open it via the global openSettings
   button that already exists in the sidebar. */
window.addEventListener("slasshy:focus-settings", () => {
  const btn = document.getElementById("openSettingsBtn");
  if (btn instanceof HTMLButtonElement) {
    btn.click();
  }
});

document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const filter = btn.getAttribute("data-filter") as "all" | "day" | "week" | "month";
    renderFullHistory(filter);
  });
});

const datePickerBtn = requiredElement<HTMLElement>("#datePickerBtn");
const customDatePicker = requiredElement<HTMLDivElement>("#customDatePicker");
const datePickerDays = requiredElement<HTMLDivElement>("#datePickerDays");
const currentMonthYear = requiredElement<HTMLElement>("#currentMonthYear");
const prevMonthBtn = requiredElement<HTMLElement>("#prevMonthBtn");
const nextMonthBtn = requiredElement<HTMLElement>("#nextMonthBtn");

let currentPickerDate = new Date();
let selectedDate: string | null = null;

datePickerBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  customDatePicker.hidden = !customDatePicker.hidden;
  renderDatePicker();
});

document.addEventListener("click", (e) => {
  if (!customDatePicker.contains(e.target as Node) && e.target !== datePickerBtn) {
    customDatePicker.hidden = true;
  }
});

prevMonthBtn.addEventListener("click", () => {
  currentPickerDate = new Date(currentPickerDate.getFullYear(), currentPickerDate.getMonth() - 1, 1);
  renderDatePicker();
});

nextMonthBtn.addEventListener("click", () => {
  currentPickerDate = new Date(currentPickerDate.getFullYear(), currentPickerDate.getMonth() + 1, 1);
  renderDatePicker();
});

function renderDatePicker(): void {
  const year = currentPickerDate.getFullYear();
  const month = currentPickerDate.getMonth();
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  currentMonthYear.textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  let html = "";
  for (let i = 0; i < firstDay; i++) {
    html += '<div class="date-picker-day empty"></div>';
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isSelected = selectedDate === dateStr;
    const isToday = dateStr === todayStr;
    const classes = ["date-picker-day"];
    if (isSelected) classes.push("selected");
    if (isToday) classes.push("today");
    html += `<div class="${classes.join(" ")}" data-date="${dateStr}">${day}</div>`;
  }
  datePickerDays.innerHTML = html;

  datePickerDays.querySelectorAll(".date-picker-day:not(.empty)").forEach(dayEl => {
    dayEl.addEventListener("click", () => {
      selectedDate = dayEl.getAttribute("data-date");
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      datePickerBtn.classList.add("active");
      renderFullHistory("all", selectedDate!);
      customDatePicker.hidden = true;
      renderDatePicker();
    });
  });
}

clearStatsBtn.addEventListener("click", async () => {
  if (!await confirmDestructiveAction("Reset all usage statistics for this device?")) {
    return;
  }
  usageStats = { sessions: 0, words: 0, avgWpm: 0, speakingSeconds: 0, prevSessions: 0, prevWords: 0, prevWpm: 0, prevSpeakingSeconds: 0, lastPeriodReset: Date.now() };
  persistUsageStats();
  analyticsSessionDetails = [];
  persistAnalyticsSessionDetails();
  achievementStates = [];
  persistAchievementStates();
  updateUsageMetrics();
  window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
  setNotice("Statistics have been reset.");
});

function clearAllHistory(): void {
  homeHistoryEntries = [];
  persistHomeHistory();
  // Notify React to re-render with cleared history.
  window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
  recentTurns.length = 0;
  setNotice("History cleared.");
}

navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  void refreshMicrophones(false);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    void releasePreWarmedStream();
  } else if (stage === "idle") {
    void preWarmMicrophoneStream(settings.microphoneDeviceId);
  }
});

function updateUsageMetrics(): void {
  updateUsageMetricsService();
}
initUsageTracker({
  getStats: () => usageStats,
  setStats: (stats) => {
    usageStats = stats;
  },
  getSessions: () => analyticsSessionDetails,
  setSessions: (sessions) => {
    analyticsSessionDetails = sessions;
  },
  getAchievements: () => achievementStates,
  appendAchievements: (unlocked) => {
    achievementStates.push(...unlocked);
  },
  getRecordingStartedAt: () => recordingStartedAt,
  persistStats: () => persistUsageStats(),
  persistSessions: () => persistAnalyticsSessionDetails(),
  persistAchievements: () => persistAchievementStates(),
  renderMetrics: () => updateUsageMetrics(),
  notifyStoreUpdated: () => {
    window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
  },
});
function trackUsage(transcript: string): void {
  trackUsageService(transcript);
}
async function bootstrap(): Promise<void> {
  logClientEvent("[bootstrap] start");
  await hydrateSettingsFromNativeStorage();
  logClientEvent(`[bootstrap] settings after hydrate ${summarizeSettingsForDiagnostics(settings)}`);

  // Register global hotkeys immediately — user should be able to press the
  // hotkey as soon as settings are loaded, without waiting for the rest of
  // the heavy bootstrap chain (Ollama, STT, TTS, model lists, etc.).
  requestGlobalShortcutSync(true);

  void backfillHistoryRecordingIds();
  setStage("idle", "Loading assistant metadata...");

  try {
    const info = await ipcGetAssistantInfo();
    renderAssistantInfo(info);

    if (info.piperInstalled && info.voiceInstalled) {
      setNotice("Piper runtime is ready.");
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

  await refreshMicrophones(false);
  if (stage === "idle") {
    void primeCaptureReadiness(settings.microphoneDeviceId, settings.showFlowBar);
  }
  await refreshOllamaStatus({ quiet: true });
  await fetchOllamaModels({ quiet: true, autoSelect: true });
  await fetchLocalSttModels({ quiet: true, autoSelect: true });
  await refreshSelectedLocalSttModelAvailability({ quiet: true });
  await pollLocalSttDownloadStatusOnce({ quiet: true });
  try {
    await syncLocalSttRuntimeForMode(settings.sttRuntimeMode);
  } catch (error) {
    setNotice(`Unable to initialize local STT runtime: ${asErrorMessage(error)}`, true);
  }
  try {
    await pollTtsSetupStatusOnceService();
  } catch {
    // Ignore bootstrap poll failures and continue normal app startup.
  }
  syncActionAvailability();
  startAutomaticUpdateChecks();
  if (analyticsSessionDetails.length > 0 && achievementStates.length === 0) {
    const totalWords = usageStats.words + usageStats.prevWords;
    const totalSessions = usageStats.sessions + usageStats.prevSessions;
    const totalSeconds = usageStats.speakingSeconds + usageStats.prevSpeakingSeconds;
    if (totalWords > 0 || totalSessions > 0 || totalSeconds > 0) {
      checkAndUnlockAchievements({
        ...usageStats,
        words: totalWords,
        sessions: totalSessions,
        speakingSeconds: totalSeconds,
      });
      window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
    }
  }
  logClientEvent("[bootstrap] completed");
}

function asMainPage(value: string | undefined): MainPage | null {
  if (value === "home" || value === "history" || value === "dictionary" || value === "snippets" || value === "notes" || value === "analytics") {
    return value;
  }

  return null;
}

function asSettingsPane(value: string | undefined): SettingsPane | null {
  if (value === "online" || value === "offline" || value === "hybrid") {
    return "models";
  }
  if (
    value === "general" ||
    value === "models" ||
    value === "update-security" ||
    value === "pipeline"
  ) {
    return value;
  }

  return null;
}

function setActivePage(next: MainPage): void {
  activePage = next;
  localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, next);

  // Let React control nav button and panel classes via the store event below.
  // Vanilla JS only updates aria-current for accessibility.
  for (const navButton of pageNavButtons) {
    const current = navButton.dataset.pageNav === next;
    navButton.setAttribute("aria-current", current ? "page" : "false");
  }

  // Notify React to re-render with the new active page.
  // React is the single source of truth for page content (history, etc.).
  // Do NOT call renderHomeHistory()/renderFullHistory() here — that causes
  // innerHTML writes on React-controlled DOM nodes, leading to blank screens.
  window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
}

function setActiveSettingsPane(next: SettingsPane, reason = "unspecified"): void {
  logClientEvent(
    `[ui.settings.pane] next=${next} reason=${reason}`,
  );
  const previousPane = activeSettingsPane;
  activeSettingsPane = next;
  localStorage.setItem(ACTIVE_SETTINGS_PANE_STORAGE_KEY, next);

  const titleMap: Record<SettingsPane, string> = {
    general: "General",
    models: "Models",
    "update-security": "Update and Security",
    pipeline: "Pipeline",
  };

  settingsPaneTitle.textContent = titleMap[next];

  for (const navButton of settingsNavButtons) {
    const current = navButton.dataset.settingsPaneNav === next;
    navButton.classList.toggle("is-active", current);
    navButton.setAttribute("aria-current", current ? "page" : "false");
  }

  if (settingsPaneTransitionTimer !== null) {
    window.clearTimeout(settingsPaneTransitionTimer);
    settingsPaneTransitionTimer = null;
  }

  settingsMain.classList.remove("is-pane-switching", "is-switching-forward", "is-switching-backward");
  for (const panel of settingsPanels) {
    panel.classList.remove("is-transitioning-in", "is-transitioning-forward", "is-transitioning-backward");
  }

  const previousIndex = settingsPanels.findIndex((panel) => panel.dataset.settingsPane === previousPane);
  const nextIndex = settingsPanels.findIndex((panel) => panel.dataset.settingsPane === next);
  const shouldAnimate = previousPane !== next && previousIndex >= 0 && nextIndex >= 0;

  for (const panel of settingsPanels) {
    const current = panel.dataset.settingsPane === next;
    panel.classList.toggle("is-active", current);
    panel.hidden = !current;
    if (current && shouldAnimate) {
      const directionClass = nextIndex > previousIndex ? "is-transitioning-forward" : "is-transitioning-backward";
      panel.classList.add("is-transitioning-in", directionClass);
    }
  }

  if (shouldAnimate) {
    const switchDirectionClass = nextIndex > previousIndex ? "is-switching-forward" : "is-switching-backward";
    settingsMain.classList.add("is-pane-switching", switchDirectionClass);
    settingsPaneTransitionTimer = window.setTimeout(() => {
      settingsMain.classList.remove("is-pane-switching", "is-switching-forward", "is-switching-backward");
      for (const panel of settingsPanels) {
        panel.classList.remove("is-transitioning-in", "is-transitioning-forward", "is-transitioning-backward");
      }
      settingsPaneTransitionTimer = null;
    }, 180);
  }
}

function setActiveTtsProfile(_next: TtsProfilePane): void {
  ttsProfilePiperTab.classList.toggle("is-active", true);
  ttsProfilePiperTab.setAttribute("aria-selected", "true");
  ttsProfilePiperPanel.hidden = false;
}

function updateTtsSetupGate(): void {
  const piperReady = piperRuntimeReady;
  const showBootstrap = !piperReady || ttsSetupRunning;
  ttsBootstrapCard.hidden = !showBootstrap;
  ttsProfilesArea.hidden = !piperReady;

  if (piperReady && !ttsSetupRunning && !ttsSetupStatus.textContent?.trim()) {
    ttsSetupStatus.textContent = "Piper is ready.";
  }
}

function openSettings(reason = "unspecified"): void {
  logClientEvent(`[ui.settings.open] reason=${reason}`);
  if (settingsCloseTimer !== null) {
    window.clearTimeout(settingsCloseTimer);
    settingsCloseTimer = null;
  }
  settingsOverlay.hidden = false;
  settingsOverlay.classList.remove("is-closing");
  void settingsOverlay.offsetWidth;
  settingsOverlay.classList.add("is-open");
  syncLocalSttDownloadOverlayVisibility();
}

function closeSettings(): void {
  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && settingsOverlay.contains(activeElement)) {
    activeElement.blur();
  }
  settingsOverlay.classList.remove("is-open");
  settingsOverlay.classList.add("is-closing");
  if (settingsCloseTimer !== null) {
    window.clearTimeout(settingsCloseTimer);
  }
  settingsCloseTimer = window.setTimeout(() => {
    settingsOverlay.hidden = true;
    settingsOverlay.classList.remove("is-closing");
    settingsCloseTimer = null;
  }, 180);
  syncLocalSttDownloadOverlayVisibility();
}

function isSettingsOpen(): boolean {
  return !settingsOverlay.hidden && settingsOverlay.classList.contains("is-open");
}

async function hydrateSettingsFromNativeStorage(): Promise<void> {
  const hydrated = await hydrateSettingsFromNativeStorageService({
    isTauri: isTauriEnvironment,
    loadNative: () => ipcLoadPersistedLocalSettings(),
    log: (message) => logClientEvent(message),
    warn: (message) => console.warn(message),
    applyAll: (next) => {
      settings = next;
      applySettingsToForm(next);
    },
    onChanged: () => {
      void handleSettingsChange();
    },
  });
  if (hydrated) {
    settings = hydrated;
    setSettingsSnapshot(settings);
  }
}

export function getSettingsSnapshot(): PersistedSettings {
  return settings;
}

async function backfillHistoryRecordingIds(): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }
  try {
    const recordingIds = await ipcListDictationRecordingIds();
    if (!recordingIds || recordingIds.length === 0) {
      return;
    }
    const matches = matchHistoryToRecordings(homeHistoryEntries, recordingIds);
    if (matches.length === 0) {
      return;
    }
    const byTimestamp = new Map<number, string>(
      matches.map((m: { timestamp: number; recordingId: string }) => [m.timestamp, m.recordingId]),
    );
    let patched = 0;
    homeHistoryEntries = homeHistoryEntries.map((entry): HomeHistoryEntry => {
      if (entry.recordingId) {
        return entry;
      }
      const id = byTimestamp.get(entry.timestamp);
      if (id) {
        patched += 1;
        return { ...entry, recordingId: id };
      }
      return entry;
    });
    if (patched > 0) {
      persistHomeHistory();
      window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
      logClientEvent(`[recordings.backfill] attached=${patched} of ${matches.length}`);
    }
  } catch (error) {
    logClientEvent(`[recordings.backfill] failed: ${asErrorMessage(error)}`);
  }
}

async function handleSettingsChange(): Promise<void> {
  const previousSettings = { ...settings };

  settings = runSettingsHandlePipeline({
    refs: settingsFormRefs,
    coreDeps: settingsCoreDeps,
    previous: previousSettings,
    catalogs: {
      providerModels: providerModelCatalog,
      localOllamaModels: localOllamaModelCatalog,
      localSttModels: localSttModelCatalog,
    },
    assistantInfo: latestAssistantInfoDefaults,
    stage,
    effects: settingsHandleEffects,
    updateCachedHotkeyDisplay: (display) => {
      cachedHotkeyDisplay = formatHotkeyForDisplay(display);
    },
  });
  setSettingsSnapshot(settings);
}

const settingsHandleEffects: SettingsHandleEffects = {
  notifyChange: (previous, next) => {
    logClientEvent(
      `[settings.change] from="${summarizeSettingsForDiagnostics(
        previous,
      )}" to="${summarizeSettingsForDiagnostics(next)}"`,
    );
  },
  syncDerivedFormState: (_refs, next, catalogs, assistantInfo) => {
    setActiveTtsProfile("piper");
    if (catalogs.providerModels.includes(next.aiModelName)) {
      providerModelCatalogSelect.value = next.aiModelName;
    } else if (catalogs.providerModels.includes(next.sttModelName)) {
      providerModelCatalogSelect.value = next.sttModelName;
    } else if (catalogs.providerModels.length > 0) {
      providerModelCatalogSelect.value = "";
    }
    if (catalogs.localOllamaModels.includes(next.localOllamaModel)) {
      localOllamaModelCatalogSelect.value = next.localOllamaModel;
    } else if (catalogs.localOllamaModels.length > 0) {
      localOllamaModelCatalogSelect.value = "";
    }
    if (catalogs.localSttModels.includes(next.localSttModel)) {
      localSttModelCatalogSelect.value = next.localSttModel;
    } else if (catalogs.localSttModels.length > 0) {
      localSttModelCatalogSelect.value = "";
    }
    if (assistantInfo) {
      renderAssistantInfo(assistantInfo as AssistantInfoResponse);
    }
  },
  clearCaptureHolds: () => clearPushToTalkHolds(),
  notifyIncognitoChanged: () => {
    // Notify React to re-render with updated incognito state from localStorage.
    window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
  },
  syncExternalMediaMute: (muted) => {
    if (muted) {
      pauseExternalMediaForDictation();
    } else {
      resumeExternalMediaAfterDictation();
    }
  },
  persist: (next) => persistSettings(next),
  afterPersist: (previous, next, stageAtChange) => {
    const previousMicrophoneDeviceId = previous.microphoneDeviceId;
    const previousShowFlowBar = previous.showFlowBar;
    const previousLaunchAtLogin = previous.launchAtLogin;
    const previousTtsEngine = previous.ttsEngine;
    const previousSttRuntimeMode = previous.sttRuntimeMode;
    const previousAiRuntimeMode = previous.aiRuntimeMode;
    const previousShortcutSignature = buildShortcutSyncSignature(previous);
    renderSidebarLocalSttToggle();
    refreshRecordButton();
    syncActionAvailability();
    updateMicrophoneSummary();
    renderNotesList();
    const nextShortcutSignature = buildShortcutSyncSignature(next);
    if (previousShortcutSignature !== nextShortcutSignature) {
      requestGlobalShortcutSync();
    }
    if (previousLaunchAtLogin !== next.launchAtLogin) {
      requestLaunchAtLoginSync(next.launchAtLogin);
    }
    if (previousTtsEngine !== next.ttsEngine) {
      interruptTtsPlaybackForCaptureIntent();
    }
    const sttRuntimeModeChanged = previousSttRuntimeMode !== next.sttRuntimeMode;
    const aiRuntimeModeChanged = previousAiRuntimeMode !== next.aiRuntimeMode;
    if (sttRuntimeModeChanged || aiRuntimeModeChanged) {
      if (next.sttRuntimeMode === next.aiRuntimeMode) {
        setNotice(
          next.sttRuntimeMode === "local"
            ? "Offline mode enabled for both STT and AI."
            : "Online mode enabled for both STT and AI.",
        );
      } else {
        setNotice(
          `Hybrid mode enabled (STT: ${next.sttRuntimeMode}, AI: ${next.aiRuntimeMode}).`,
        );
      }
    }
    if (sttRuntimeModeChanged) {
      requestLocalSttRuntimeSyncForMode(next.sttRuntimeMode, {
        showLoadOverlay: next.sttRuntimeMode === "local",
      });
    }
    updateTtsSetupGate();
    publishDockState();
    void syncFloatingIndicatorWindow();
    if (
      stageAtChange === "idle" &&
      (previousMicrophoneDeviceId !== next.microphoneDeviceId ||
        (!previousShowFlowBar && next.showFlowBar))
    ) {
      void primeCaptureReadiness(next.microphoneDeviceId, next.showFlowBar);
    }
  },
};

function getLocalSttActionBlockReason(): string | null {
  if (pipelineRunning) {
    return "Finish the current pipeline run first.";
  }
  if (stage === "recording") {
    return "Stop recording before changing offline STT setup.";
  }
  if (localSttDownloadInFlight || localSttDownloadActive) {
    return "A local STT download is already running.";
  }
  if (localSttDeleteInFlight) {
    return "A local STT delete is already running.";
  }
  if (localSttDeactivateInFlight) {
    return "Local STT is currently unloading.";
  }
  if (localSttWarmupInFlight) {
    return "Local STT is currently loading.";
  }
  if (localSttRuntimeStateInFlight) {
    return "Local STT status is still refreshing.";
  }
  if (localSttHardwareAdvisorOpen) {
    return "Close the hardware advisor before continuing.";
  }
  return null;
}

function reportBlockedLocalSttAction(action: string): boolean {
  const reason = getLocalSttActionBlockReason();
  if (!reason) {
    return false;
  }
  setNotice(`${action} unavailable right now. ${reason}`, true);
  return true;
}

async function getLocalSttModelStatus(
  model: string,
  options: { quiet?: boolean } = {},
): Promise<LocalSttModelStatusResponse | null> {
  const normalizedModel = model.trim();
  if (!normalizedModel) {
    localSttSelectedModelDownloaded = false;
    localSttStatusChecked = true;
    renderSidebarLocalSttToggle();
    return null;
  }

  try {
    const response = await ipcGetLocalSttModelStatus(
      { model: normalizedModel },
      `Timed out while checking local STT files for \"${normalizedModel}\".`,
    );
    localSttSelectedModelDownloaded = response.exists;
    return response;
  } catch (error) {
    localSttSelectedModelDownloaded = false;
    if (!options.quiet) {
      setNotice(`Unable to inspect local STT model files: ${asErrorMessage(error)}`, true);
    }
    return null;
  } finally {
    localSttStatusChecked = true;
    renderSidebarLocalSttToggle();
  }
}

async function refreshSelectedLocalSttModelAvailability(
  options: { quiet?: boolean } = {},
): Promise<boolean> {
  const model = getSelectedLocalSttModel();
  const response = await getLocalSttModelStatus(model, options);
  localSttSelectedModelDownloaded = response?.exists === true;
  renderLocalSttSettingsStatus();
  return localSttSelectedModelDownloaded;
}

async function ensureSelectedLocalSttModel(options: { quiet?: boolean } = {}): Promise<string> {
  const quiet = options.quiet === true;
  let activeSettings = readSettingsFromForm();
  let selected = activeSettings.localSttModel.trim() || localSttModelCatalogSelect.value.trim();
  if (selected) {
    return selected;
  }

  if (localSttModelCatalog.length === 0) {
    await fetchLocalSttModels({ quiet: true, autoSelect: true });
    selected = readSettingsFromForm().localSttModel.trim() || localSttModelCatalogSelect.value.trim();
    if (selected) {
      return selected;
    }
  }

  const fallbackModel = pickDefaultLocalSttModelFromList(localSttModelCatalog);
  if (fallbackModel) {
    localSttModelInput.value = fallbackModel;
    if (localSttModelCatalog.includes(fallbackModel)) {
      localSttModelCatalogSelect.value = fallbackModel;
    }
    handleSettingsChange();
    await refreshSelectedLocalSttModelAvailability({ quiet: true });
    if (!quiet) {
      setNotice(`Selected local STT model "${localSttModelLabel(fallbackModel)}".`);
    }
    return fallbackModel;
  }

  if (!quiet) {
    setNotice("No local STT models are available yet. Open Settings > Models and refresh the catalog.", true);
    openSettings("local-stt-model-required");
    setActiveSettingsPane("models", "local-stt-model-required");
  }
  return "";
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
    try {
      while (pendingRuntimeModeSyncTarget) {
        const nextTarget = pendingRuntimeModeSyncTarget;
        const nextShowLoadOverlay =
          nextTarget === "local" && pendingRuntimeModeSyncShowLoadOverlay;
        pendingRuntimeModeSyncTarget = null;
        pendingRuntimeModeSyncShowLoadOverlay = false;
        try {
          await syncLocalSttRuntimeForMode(nextTarget, { showLoadOverlay: nextShowLoadOverlay });
        } catch (error) {
          setNotice(`Unable to switch local STT runtime: ${asErrorMessage(error)}`, true);
        }
      }
    } finally {
      runtimeModeSyncInFlight = false;
    }
  })();
}

async function syncLocalSttRuntimeForMode(
  mode: RuntimeMode,
  options: { showLoadOverlay?: boolean } = {},
): Promise<void> {
  if (mode === "local") {
    let model = readSettingsFromForm().localSttModel.trim() || localSttModelCatalogSelect.value.trim();
    if (!model) {
      const fallbackModel = pickDefaultLocalSttModelFromList(localSttModelCatalog);
      if (fallbackModel) {
        localSttModelInput.value = fallbackModel;
        if (localSttModelCatalog.includes(fallbackModel)) {
          localSttModelCatalogSelect.value = fallbackModel;
        }
        handleSettingsChange();
        await refreshSelectedLocalSttModelAvailability({ quiet: true });
        model = fallbackModel;
      }
    }

    const showLoadOverlay = options.showLoadOverlay === true && Boolean(model);
    if (showLoadOverlay) {
      showLocalSttLoadOverlay(model);
      setLocalSttNotice(`Loading local STT model "${model}"...`);
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
      } else if (!(await checkModelFileExists(selectedModel))) {
        setNotice(
          `Local STT model "${selectedModel}" is not downloaded yet. Open Settings > Models and download it first.`,
          true,
        );
      } else {
        setNotice(
          `Local STT runtime is active but local STT model "${selectedModel}" could not be loaded. Open Settings > Models and click Load STT.`,
          true,
        );
      }
      setActiveSettingsPane("models");
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

  let activeSettings = readSettingsFromForm();
  const modelToUnload =
    activeSettings.localSttModel.trim() ||
    localSttModelCatalogSelect.value.trim() ||
    lastWarmedLocalSttModel.trim();
  try {
    const response = await ipcDeactivateLocalSttModel(
      { model: modelToUnload || null },
      "Local STT unload timed out. You can keep using Online mode and retry unloading later.",
    );
    setLocalSttNotice(response.details, response.deactivated ? "normal" : "error");
    if (response.deactivated) {
      lastWarmedLocalSttModel = "";
    }
  } catch (error) {
    setNotice(`Unable to unload local STT runtime: ${asErrorMessage(error)}`, true);
  } finally {
    await refreshLocalSttRuntimeState({ quiet: true });
  }
}


function isTauriEnvironment(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

function openInSystemBrowser(url: string): void {
  void openExternalUrl(url).catch((error: unknown) => {
    setNotice(`Failed to open link: ${asErrorMessage(error)}`, true);
  });
}

function setupCustomWindowControls(): void {
  if (!isTauriEnvironment()) {
    windowMinimizeBtn.disabled = true;
    windowCloseBtn.disabled = true;
    return;
  }

  const appWindow = getCurrentWindow();

  windowMinimizeBtn.addEventListener("click", () => {
    void appWindow.minimize().catch((error) => {
      setNotice(`Minimize failed: ${asErrorMessage(error)}`, true);
    });
  });

  windowCloseBtn.addEventListener("click", () => {
    void appWindow.close().catch((error) => {
      setNotice(`Close failed: ${asErrorMessage(error)}`, true);
    });
  });
}

function requestLaunchAtLoginSync(enabled: boolean): void {
  if (!isTauriEnvironment()) {
    return;
  }

  const syncNonce = ++launchAtLoginSyncNonce;
  void ipcConfigureLaunchAtLogin(enabled).catch((error) => {
    if (syncNonce !== launchAtLoginSyncNonce) {
      return;
    }
    setNotice(`Launch-at-login update failed: ${asErrorMessage(error)}`, true);
  });
}

async function reconcileLaunchAtLoginWithOs(): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }
  try {
    const status = await ipcLaunchAtLoginStatus();
    const wanted = settings.launchAtLogin;
    if (wanted && (!status.enabled || !status.path_matches)) {
      logClientEvent(
        `[startup] launch-at-login registry stale — reapplying wanted=${wanted} stored=${
          status.stored_value ?? "<missing>"
        }`,
      );
      requestLaunchAtLoginSync(true);
    } else if (!wanted && status.enabled) {
      logClientEvent(
        `[startup] launch-at-login registry still enabled despite preference=false; cleaning up`,
      );
      requestLaunchAtLoginSync(false);
    }
  } catch (error) {
    logClientEvent(`[startup] launch-at-login reconcile skipped: ${asErrorMessage(error)}`);
  }
}

function handleGlobalShortcutEvent(event: ShortcutEvent): void {
  logClientEvent(
    `[hotkey.global.event] shortcut=${event.shortcut || "-"} state=${String(
      (event as { state?: unknown }).state ?? "",
    )}`,
  );
  if (isAnyHotkeyCaptureActive()) {
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
  const { push: pushShortcut, command: commandShortcut } = getNormalizedRegisteredShortcuts();
  logClientEvent(
    `[hotkey.global.event] normalized shortcut=${shortcut || "-"} push=${
      pushShortcut || "-"
    } command=${commandShortcut || "-"} capture=${settings.captureMode}`,
  );

  if (pushShortcut && shortcut === pushShortcut) {
    if (pressed) {
      markGlobalShortcutHandled(shortcut, "pressed");
      logClientEvent(
        `[hotkey.global.push] pressed capture=${settings.captureMode} holdCount=${getPushToTalkHoldCount()}`,
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
        if (hasPushToTalkHold("hotkey")) {
          logClientEvent("[hotkey.global.push] ignored repeated press because hold is already active");
          return;
        }
        void engagePushToTalk("hotkey");
      } else {
        void handleRecordToggle();
      }
    }
    if (released && (settings.captureMode === "push-to-talk" || hasPushToTalkHold("hotkey"))) {
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

function persistDictionaryTerms(): void {
  localStorage.setItem(DICTIONARY_STORAGE_KEY, JSON.stringify(dictionaryTerms));
}

function persistSnippets(): void {
  localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));
}

function persistQuickNotes(): void {
  localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(quickNotes));
}

function loadUsageStats(): UsageStats {
  const raw = localStorage.getItem(USAGE_STORAGE_KEY);
  if (!raw) {
    return { sessions: 0, words: 0, avgWpm: 0, speakingSeconds: 0, prevSessions: 0, prevWords: 0, prevWpm: 0, prevSpeakingSeconds: 0, lastPeriodReset: Date.now() };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<UsageStats>;
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const lastReset = parsed.lastPeriodReset || 0;
    
    if (now - lastReset > sevenDaysMs) {
      const totalPrevWords = (parsed.prevWords || 0) + (parsed.words || 0);
      const totalPrevSeconds = (parsed.prevSpeakingSeconds || 0) + (parsed.speakingSeconds || 0);
      return {
        sessions: 0,
        words: 0,
        avgWpm: 0,
        speakingSeconds: 0,
        prevSessions: coerceInteger((parsed.prevSessions || 0) + (parsed.sessions || 0), 0, 0, 999_999),
        prevWords: coerceInteger(totalPrevWords, 0, 0, 99_999_999),
        prevWpm: coerceNumber(totalPrevSeconds > 0 ? Math.round((totalPrevWords / totalPrevSeconds) * 60) : 0, 0, 0, 600),
        prevSpeakingSeconds: coerceInteger(totalPrevSeconds, 0, 0, 99_999_999),
        lastPeriodReset: now,
      };
    }
    
    return {
      sessions: coerceInteger(parsed.sessions, 0, 0, 999_999),
      words: coerceInteger(parsed.words, 0, 0, 99_999_999),
      avgWpm: coerceNumber(parsed.avgWpm, 0, 0, 600),
      speakingSeconds: coerceInteger(parsed.speakingSeconds, 0, 0, 99_999_999),
      prevSessions: coerceInteger(parsed.prevSessions, 0, 0, 999_999),
      prevWords: coerceInteger(parsed.prevWords, 0, 0, 99_999_999),
      prevWpm: coerceNumber(parsed.prevWpm, 0, 0, 600),
      prevSpeakingSeconds: coerceInteger(parsed.prevSpeakingSeconds, 0, 0, 99_999_999),
      lastPeriodReset: coerceInteger(lastReset, 0, 0, Number.MAX_SAFE_INTEGER),
    };
  } catch {
    return { sessions: 0, words: 0, avgWpm: 0, speakingSeconds: 0, prevSessions: 0, prevWords: 0, prevWpm: 0, prevSpeakingSeconds: 0, lastPeriodReset: Date.now() };
  }
}

function persistUsageStats(): void {
  localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usageStats));
}

function persistAnalyticsSessionDetails(): void {
  localStorage.setItem(ANALYTICS_SESSIONS_KEY, JSON.stringify(analyticsSessionDetails));
}

function loadAchievementStates(): AchievementState[] {
  return parseJson<AchievementState[]>(ACHIEVEMENTS_STATE_KEY, []);
}

function persistAchievementStates(): void {
  localStorage.setItem(ACHIEVEMENTS_STATE_KEY, JSON.stringify(achievementStates));
}

function checkAndUnlockAchievements(stats: UsageStats): void {
  let newUnlock = false;
  for (const def of ACHIEVEMENT_DEFS) {
    const currentVal = def.metric === 'words' ? stats.words : def.metric === 'sessions' ? stats.sessions : stats.speakingSeconds;
    if (currentVal >= def.threshold) {
      const existing = achievementStates.find(a => a.id === def.id);
      if (!existing) {
        achievementStates.push({ id: def.id, unlockedAt: Date.now() });
        newUnlock = true;
      }
    }
  }
  if (newUnlock) {
    persistAchievementStates();
  }
}

function loadPersistedMainPage(): MainPage {
  const persisted = localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY);
  return asMainPage(persisted ?? undefined) ?? "home";
}

function loadPersistedSettingsPane(): SettingsPane {
  const persisted = localStorage.getItem(ACTIVE_SETTINGS_PANE_STORAGE_KEY);
  return asSettingsPane(persisted ?? undefined) ?? "general";
}

function persistHomeHistory(): void {
  localStorage.setItem(HOME_HISTORY_STORAGE_KEY, JSON.stringify(homeHistoryEntries));
}


function renderFullHistory(filter: "all" | "day" | "week" | "month" = "all", specificDate?: string): void {
  // React owns #fullHistoryLog. Dispatch filter event for React to apply.
  window.dispatchEvent(new CustomEvent("slasshy:history-filter", { detail: { filter, specificDate } }));
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
  const filtered = dictionaryTerms;
  dictionaryCount.textContent = `${filtered.length} term${filtered.length === 1 ? "" : "s"}`;

  if (filtered.length === 0) {
    dictionaryList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>
        </div>
        <h4>No terms yet</h4>
        <p>Your dictionary is currently empty. Start by adding a term above to improve transcription accuracy.</p>
      </div>
    `;
    return;
  }

  dictionaryList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const term of filtered) {
    const card = document.createElement("div");
    card.className = "dictionary-item-card";

    card.innerHTML = `
      <div class="dict-item-content">
        <div class="dict-term spoken">
          <span class="term-label">Spoken</span>
          <span class="term-value">${escapeHtml(term.source)}</span>
        </div>
        <div class="dict-connector">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </div>
        <div class="dict-term correct">
          <span class="term-label">Correct</span>
          <span class="term-value">${escapeHtml(term.target)}</span>
        </div>
      </div>
      <div class="dict-item-actions">
        <button type="button" class="icon-delete-btn" title="Delete term" data-dictionary-delete="${term.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
        </button>
      </div>
    `;

    const deleteBtn = card.querySelector(".icon-delete-btn") as HTMLButtonElement;
    deleteBtn.addEventListener("click", async () => {
      if (!await confirmDestructiveAction(`Delete dictionary term "${term.source}"?`)) {
        return;
      }
      dictionaryTerms = dictionaryTerms.filter((entry) => entry.id !== term.id);
      persistDictionaryTerms();
      renderDictionaryList();
    });

    fragment.append(card);
  }
  dictionaryList.append(fragment);
}

function addDictionaryTerm(): void {
  const source = dictionarySourceInput.value.trim();
  const target = dictionaryTargetInput.value.trim();
  const validationError = validateDictionaryEntry(source, target);
  if (validationError) {
    setNotice(validationError, true);
    return;
  }

  dictionaryTerms = normalizeDictionaryEntries([
    {
      id: createId(),
      source,
      target,
      createdAt: Date.now(),
    },
    ...dictionaryTerms.filter(
      (entry) => entry.source.trim().toLocaleLowerCase() !== source.toLocaleLowerCase(),
    ),
  ]);
  persistDictionaryTerms();
  renderDictionaryList();

  dictionarySourceInput.value = "";
  dictionaryTargetInput.value = "";

  dictionaryFormCard.classList.add("is-collapsed");
  dictionaryAddBtnTop.classList.remove("is-active");
  setNotice(`Dictionary term added: ${source} → ${target}`);
}

function renderSnippetsList(): void {
  const filtered = snippets;

  const snippetsCountBadge = document.getElementById("snippetsCountBadge");
  if (snippetsCountBadge) {
    snippetsCountBadge.textContent = `${filtered.length} snippet${filtered.length === 1 ? "" : "s"}`;
  }

  if (filtered.length === 0) {
    snippetsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
        </div>
        <h4>No snippets yet</h4>
        <p>Save time by creating your first text expansion shortcut.</p>
      </div>
    `;
    return;
  }

  snippetsList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const snippet of filtered) {
    const row = document.createElement("div");
    row.className = "managed-row snippet-row";

    const mainEl = document.createElement("div");
    mainEl.className = "managed-row-main";
    const triggerEl = document.createElement("strong");
    triggerEl.className = "snippet-trigger";
    triggerEl.textContent = snippet.trigger;
    const expansionEl = document.createElement("span");
    expansionEl.className = "snippet-expansion";
    expansionEl.textContent = snippet.expansion;
    mainEl.append(triggerEl, expansionEl);

    const actionsEl = document.createElement("div");
    actionsEl.className = "managed-row-actions";
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "delete-btn";
    deleteBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
      <span>Delete</span>
    `;
    deleteBtn.dataset.snippetDelete = snippet.id;
    deleteBtn.addEventListener("click", async () => {
      if (!await confirmDestructiveAction(`Delete snippet "${snippet.trigger}"?`)) {
        return;
      }
      snippets = snippets.filter((entry) => entry.id !== snippet.id);
      persistSnippets();
      renderSnippetsList();
    });
    actionsEl.append(deleteBtn);

    row.append(mainEl, actionsEl);
    fragment.append(row);
  }
  snippetsList.append(fragment);
}

function addSnippetEntry(): void {
  const trigger = snippetTriggerInput.value.trim();
  const expansion = snippetExpansionInput.value.trim();
  const validationError = validateSnippetEntry(trigger, expansion);
  if (validationError) {
    setNotice(validationError, true);
    return;
  }

  snippets = normalizeSnippetEntries([
    {
      id: createId(),
      trigger,
      expansion,
      createdAt: Date.now(),
    },
    ...snippets.filter(
      (entry) => entry.trigger.trim().toLocaleLowerCase() !== trigger.toLocaleLowerCase(),
    ),
  ]);
  persistSnippets();
  renderSnippetsList();
  snippetTriggerInput.value = "";
  snippetExpansionInput.value = "";

  snippetFormContainer.classList.add("is-collapsed");
  snippetsAddBtnTop.classList.remove("is-active");
  snippetsAddBtnTop.textContent = "Add new";
  setNotice(`Snippet added: ${trigger}`);
}

function addQuickNote(text: string): void {
  const clean = text.trim();
  const validationError = validateQuickNote(clean);
  if (validationError || settings.incognitoMode) {
    if (validationError && !settings.incognitoMode) {
      setNotice(validationError, true);
    }
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
  if (quickNotes.length >= 50) {
    setNotice("Quick note saved. The list keeps the 50 most recent notes.");
  }
}

function renderNotesList(): void {
  if (quickNotes.length === 0 || settings.incognitoMode) {
    notesList.innerHTML = "";
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
    deleteBtn.addEventListener("click", async () => {
      if (!await confirmDestructiveAction("Delete this quick note?")) {
        return;
      }
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

function createId(): string {
  if ("crypto" in window && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function copyToClipboard(
  value: string,
  options: { quiet?: boolean; successMessage?: string; errorMessage?: string } = {},
): Promise<boolean> {
  try {
    if (isTauriEnvironment()) {
      await ipcSetClipboardText(value);
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
      await ipcPasteTextViaClipboard(text);
    } else {
      await ipcPasteClipboardText();
    }
    return true;
  } catch (error) {
    setNotice(`Auto paste failed: ${asErrorMessage(error)}`, true);
    return false;
  }
}

async function confirmDestructiveAction(message: string): Promise<boolean> {
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

async function captureSelectedTextForRewrite(options: { silent?: boolean } = {}): Promise<string> {
  if (!isTauriEnvironment()) {
    return "";
  }

  try {
    const selected = await ipcCaptureSelectedText();
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

async function refreshAssistantInfo(): Promise<void> {
  const info = await ipcGetAssistantInfo();
  renderAssistantInfo(info);
  renderProviderModelCatalog(providerModelCatalog, settings.aiModelName || settings.sttModelName);
  renderLocalOllamaModelCatalog(localOllamaModelCatalog, settings.localOllamaModel);
  renderLocalSttModelCatalog(localSttModelCatalog, settings.localSttModel);

  if (!settingsFormRefs.piperPathInput.value.trim() && info.piperPath) {
    settingsFormRefs.piperPathInput.value = info.piperPath;
    handleSettingsChange();
  }

}

async function fetchLocalSttModels(
  options: { quiet?: boolean; autoSelect?: boolean } = {},
): Promise<void> {
  if (pipelineRunning || stage === "recording") {
    return;
  }
  let activeSettings = readSettingsFromForm();
  const quiet = options.quiet === true;
  const autoSelect = options.autoSelect === true;

  if (!quiet) {
    setStage("processing", "Loading local STT model catalog...");
  }
  try {
    const response = await ipcFetchLocalSttModels();
    renderLocalSttModelCatalog(response.models, activeSettings.localSttModel);
    const refreshedSettings = readSettingsFromForm();
    if (autoSelect && !refreshedSettings.localSttModel.trim() && response.models.length > 0) {
      const fallback = pickDefaultLocalSttModelFromList(localSttModelCatalog);
      if (fallback) {
        localSttModelInput.value = fallback;
        if (localSttModelCatalog.includes(fallback)) {
          localSttModelCatalogSelect.value = fallback;
        }
        handleSettingsChange();
        if (!quiet) {
          setNotice(`Auto-selected local STT model "${localSttModelLabel(fallback)}".`);
        }
      }
    } else if (!quiet) {
      setNotice(`Loaded ${response.models.length} local STT models.`);
    }
    await refreshSelectedLocalSttModelAvailability({ quiet: true });
    if (!quiet) {
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

const ICON_DOWNLOAD = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const ICON_POWER = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>`;
const ICON_PLAY = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;

function renderSidebarLocalSttToggle(): void {
  const activeSettings = readSettingsFromForm();
  const isLocalMode = activeSettings.sttRuntimeMode === "local";

  // Hide the button completely when STT mode is Online or when initial status is not yet checked
  if (!isLocalMode || !localSttStatusChecked) {
    sidebarToggleLocalSttBtn.hidden = true;
    return;
  }

  // Only show button in Local mode after status check
  sidebarToggleLocalSttBtn.hidden = false;
  sidebarToggleLocalSttBtn.dataset.sttState = "ready";

  const loaded = isSelectedLocalSttModelLoaded();
  const hasModel = !!activeSettings.localSttModel.trim();

  if (!hasModel || !localSttSelectedModelDownloaded) {
    sidebarToggleLocalSttGlyph.innerHTML = ICON_DOWNLOAD;
    sidebarToggleLocalSttLabel.textContent = "Download Model";
    const actionText = "Download offline model first";
    sidebarToggleLocalSttBtn.setAttribute("data-label", actionText);
    sidebarToggleLocalSttBtn.setAttribute("aria-label", `${actionText} (Alt+D)`);
    sidebarToggleLocalSttBtn.title = hasModel
      ? `Model files missing for ${activeSettings.localSttModel}. Click to download.`
      : "No offline model selected yet. Click to choose and download one.";
    sidebarToggleLocalSttBtn.dataset.sttState = "download";
  } else if (loaded) {
    // Model is loaded
    sidebarToggleLocalSttGlyph.innerHTML = ICON_POWER;
    sidebarToggleLocalSttLabel.textContent = "Unload STT";
    const actionText = "Unload local STT model";
    sidebarToggleLocalSttBtn.setAttribute("data-label", actionText);
    sidebarToggleLocalSttBtn.setAttribute("aria-label", `${actionText} (Alt+D)`);
    sidebarToggleLocalSttBtn.title = `Local STT model loaded: ${activeSettings.localSttModel}`;
    sidebarToggleLocalSttBtn.dataset.sttState = "loaded";
  } else {
    // Model exists but not loaded yet
    sidebarToggleLocalSttGlyph.innerHTML = ICON_PLAY;
    sidebarToggleLocalSttLabel.textContent = "Load STT";
    const actionText = "Load local STT model";
    sidebarToggleLocalSttBtn.setAttribute("data-label", actionText);
    sidebarToggleLocalSttBtn.setAttribute("aria-label", `${actionText} (Alt+D)`);
    sidebarToggleLocalSttBtn.title = `Load model: ${activeSettings.localSttModel || 'Select from Settings'}`;
    sidebarToggleLocalSttBtn.dataset.sttState = "ready";
  }
}

function setLocalSttNotice(
  message: string,
  tone: "normal" | "error" | "success" = "normal",
): void {
  localSttDownloadNotice.textContent = message;
  localSttDownloadNotice.dataset.tone = tone;
}

function renderLocalSttSettingsStatus(): void {
  const activeSettings = readSettingsFromForm();
  const selectedModel = activeSettings.localSttModel.trim() || localSttModelCatalogSelect.value.trim();

  if (activeSettings.sttRuntimeMode !== "local") {
    localSttStatusBadge.dataset.state = "offline";
    localSttStatusBadge.textContent = "Online mode";
    localSttStatusDetail.textContent = "Offline STT is disabled because STT runtime mode is currently set to Online.";
    return;
  }

  if (localSttDownloadInFlight || localSttDeleteInFlight || localSttDeactivateInFlight || localSttWarmupInFlight || localSttRuntimeStateInFlight || localSttDownloadActive) {
    localSttStatusBadge.dataset.state = "busy";
    if (localSttDeleteInFlight) {
      localSttStatusBadge.textContent = "Deleting";
      localSttStatusDetail.textContent = selectedModel
        ? `Removing local files for ${localSttModelLabel(selectedModel)}.`
        : "Removing local STT model files.";
      return;
    }
    if (localSttDeactivateInFlight) {
      localSttStatusBadge.textContent = "Unloading";
      localSttStatusDetail.textContent = selectedModel
        ? `Unloading ${localSttModelLabel(selectedModel)} from memory.`
        : "Unloading offline STT runtime from memory.";
      return;
    }
    if (localSttWarmupInFlight || localSttRuntimeStateInFlight) {
      localSttStatusBadge.textContent = "Loading";
      localSttStatusDetail.textContent = selectedModel
        ? `Preparing ${localSttModelLabel(selectedModel)} for offline transcription.`
        : "Preparing offline STT runtime.";
      return;
    }
    localSttStatusBadge.textContent = "Downloading";
    localSttStatusDetail.textContent = selectedModel
      ? `Downloading ${localSttModelLabel(selectedModel)} to local storage.`
      : "Downloading offline STT model files.";
    return;
  }

  if (!selectedModel) {
    localSttStatusBadge.dataset.state = "idle";
    localSttStatusBadge.textContent = "Not selected";
    localSttStatusDetail.textContent = "Select a local STT model to download and use it offline.";
    return;
  }

  if (!localSttSelectedModelDownloaded) {
    localSttStatusBadge.dataset.state = "missing";
    localSttStatusBadge.textContent = "Not downloaded";
    localSttStatusDetail.textContent = `${localSttModelLabel(selectedModel)} is selected, but its local files are missing.`;
    return;
  }

  if (isSelectedLocalSttModelLoaded()) {
    localSttStatusBadge.dataset.state = "active";
    localSttStatusBadge.textContent = "Loaded";
    localSttStatusDetail.textContent = `${localSttModelLabel(selectedModel)} is downloaded and currently loaded in memory.`;
    return;
  }

  localSttStatusBadge.dataset.state = "ready";
  localSttStatusBadge.textContent = "Downloaded";
  localSttStatusDetail.textContent = `${localSttModelLabel(selectedModel)} is downloaded locally and ready to load.`;
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
    advice = await ipcGetLocalSttHardwareAdvice({ selectedModel });
  } catch (error) {
    markLocalSttHardwareAdvisorShown();
    setNotice(
      `Hardware recommendation check failed. Continuing with selected model: ${asErrorMessage(error)}`,
      true,
    );
    return selectedModel;
  }

  const suggestionModel = advice.slasshySuggestionModel?.trim() || selectedModel;
  markLocalSttHardwareAdvisorShown();

  if (suggestionModel && suggestionModel !== selectedModel) {
    setNotice(
      `Using recommended local STT model for your hardware: ${localSttModelLabel(suggestionModel)}.`,
    );
    return suggestionModel;
  }

  return selectedModel;
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

function ensureLocalSttDownloadOverlay(): HTMLDivElement {
  if (localSttDownloadOverlay) {
    return localSttDownloadOverlay;
  }

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:10001;width:min(360px,calc(100vw - 32px));" +
    "padding:14px 16px;border-radius:14px;background:rgba(8, 10, 15, 0.95);color:#fff;" +
    "box-shadow:0 20px 50px rgba(0, 0, 0, 0.5);border:1px solid rgba(255, 255, 255, 0.1);backdrop-filter:blur(12px);" +
    "transition: opacity 0.2s ease, transform 0.2s ease;";
  overlay.hidden = true;
  document.body.appendChild(overlay);
  localSttDownloadOverlay = overlay;
  return overlay;
}

function showLocalSttDownloadOverlay(status: LocalSttDownloadStatusResponse): void {
  const overlay = ensureLocalSttDownloadOverlay();
  const modelLabel = localSttModelLabel(status.model || getSelectedLocalSttModel());
  const boundedPercent = Math.max(0, Math.min(100, Number(status.progressPercent) || 0));
  const stage = status.stage?.trim() || "Downloading local STT model...";
  const detail = status.currentFile?.trim() || status.message?.trim() || "Preparing files...";

  overlay.style.background = "rgba(0, 0, 0, 0.95)";
  overlay.style.border = "1px solid var(--border-subtle)";
  overlay.style.boxShadow = "var(--shadow-modal)";

  overlay.innerHTML = `
    <div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px;">Offline STT Download</div>
    <div style="font-size:15px;font-weight:600;color:var(--text-primary);margin-bottom:4px;">${escapeHtml(modelLabel)}</div>
    <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;line-height:1.4;">${escapeHtml(stage)}</div>
    <div style="height:6px;border-radius:999px;background:rgba(255, 255, 255, 0.08);overflow:hidden;margin-bottom:10px;">
      <div style="position:absolute;left:0;top:0;height:100%;width:100%;background:var(--text-secondary);transform:scaleX(${boundedPercent/100});transform-origin:left center;transition:transform 0.3s ease-out;"></div>
    </div>
    <div style="font-size:12px;color:var(--text-muted);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(detail)}</div>
  `;

  syncLocalSttDownloadOverlayVisibility();
}

function hideLocalSttDownloadOverlay(): void {
  if (localSttDownloadOverlay) {
    localSttDownloadOverlay.hidden = true;
  }
}

async function refreshLocalSttRuntimeState(options: { quiet?: boolean } = {}): Promise<void> {
  if (localSttRuntimeStateInFlight) {
    return;
  }
  localSttRuntimeStateInFlight = true;
  syncActionAvailability();
  try {
    const response = await ipcGetLocalSttRuntimeState("Timed out while checking local STT status.");
    localSttRuntimeLoaded = response.loaded;
    if (!response.loaded) {
      lastWarmedLocalSttModel = "";
    }
    renderSidebarLocalSttToggle();
    renderLocalSttSettingsStatus();
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
  if (reportBlockedLocalSttAction("Load STT")) {
    return;
  }

  let activeSettings = readSettingsFromForm();

  // DIAGNOSTIC #1: Check if STT mode is set to local
  if (activeSettings.sttRuntimeMode !== "local") {
    showOfflineModeDiagnostic('wrong-stt-mode', {
      model: activeSettings.localSttModel || undefined
    });
    return;
  }

  // Get selected model
  let model = activeSettings.localSttModel.trim() || localSttModelCatalogSelect.value.trim();
  if (!model) {
    model = await ensureSelectedLocalSttModel({ quiet: true });
    activeSettings = readSettingsFromForm();
  }

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
  setLocalSttNotice("Loading model...");
  setNotice("Loading model...");
  showLocalSttLoadOverlay(model);
  syncActionAvailability();

  try {
    // DIAGNOSTIC #3: Check if model file exists before attempting to load
    const modelExists = await checkModelFileExists(model);
    if (!modelExists) {
      hideLocalSttLoadOverlay();
      setLocalSttNotice(`Model files missing for ${localSttModelLabel(model)}.`, "error");
      showOfflineModeDiagnostic('model-file-missing', { model });
      return;
    }

    // DIAGNOSTIC #4: Check Python dependencies
    const pythonReady = await checkPythonDependencies(model);
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
    const warmup = await warmupActiveLocalSttModel({ quiet: true, force: true, explicit: true });
    await refreshLocalSttRuntimeState({ quiet: true });
    const selectedModelLoaded = isSelectedLocalSttModelLoaded();
    if (selectedModelLoaded) {
      setLocalSttNotice("Model loaded.", "success");
      setNotice("Model loaded.");
    } else {
      setLocalSttNotice("Unable to load model.", "error");
      const warmupDetails = warmup?.details || "";
      const normalizedDetails = warmupDetails.toLowerCase();
      if (normalizedDetails.includes("not downloaded yet")) {
        showOfflineModeDiagnostic('model-file-missing', { model });
      } else if (
        normalizedDetails.includes("python") ||
        normalizedDetails.includes("nemo") ||
        normalizedDetails.includes("module") ||
        normalizedDetails.includes("zero-python")
      ) {
        showOfflineModeDiagnostic('python-deps-missing', { model });
      } else if (normalizedDetails.includes("timed out") || normalizedDetails.includes("timeout")) {
        showOfflineModeDiagnostic('load-timeout', { model });
      } else {
        showOfflineModeDiagnostic(warmupDetails || 'load-timeout', { model });
      }
    }
  } catch (error) {
    const message = asErrorMessage(error);
    setLocalSttNotice(`Load failed: ${message}`, "error");
    showOfflineModeDiagnostic(message, { model });
  } finally {
    hideLocalSttLoadOverlay();
    syncActionAvailability();
  }
}

async function warmupActiveLocalSttModel(
  options: { quiet?: boolean; force?: boolean; explicit?: boolean } = {},
): Promise<LocalSttWarmupResponse | null> {
  if (localSttWarmupInFlight) {
    return null;
  }

  let activeSettings = readSettingsFromForm();
  const explicit = options.explicit === true;
  if (!explicit && activeSettings.sttRuntimeMode !== "local") {
    return null;
  }

  let model = activeSettings.localSttModel.trim() || localSttModelCatalogSelect.value.trim();
  if (!model) {
    model = await ensureSelectedLocalSttModel({ quiet: true });
    activeSettings = readSettingsFromForm();
  }
  if (!model) {
    return null;
  }

  const force = options.force === true;
  if (!force && localSttRuntimeLoaded && lastWarmedLocalSttModel === model) {
    return null;
  }

  localSttWarmupInFlight = true;
  syncActionAvailability();
  const quiet = options.quiet === true;
  try {
    const response = await ipcWarmupLocalSttModel(
      { model },
      undefined,
      `Local STT model \"${model}\" took too long to load. Switch back to Online mode or retry after checking the model files.`,
    );
    if (response.warmed) {
      lastWarmedLocalSttModel = response.model;
      localSttRuntimeLoaded = true;
      localSttSelectedModelDownloaded = true;
      renderSidebarLocalSttToggle();
      if (!quiet) {
        setNotice(response.details || `Local STT model warmed: ${response.model}.`);
      }
    } else if (!quiet) {
      setNotice(response.details || `Local STT model warmup skipped: ${response.model}.`, true);
    }
    return response;
  } catch (error) {
    if (!quiet) {
      setNotice(`Local STT warmup failed: ${asErrorMessage(error)}`, true);
    }
    throw error;
  } finally {
    localSttWarmupInFlight = false;
    void refreshLocalSttRuntimeState({ quiet: true });
    void refreshSelectedLocalSttModelAvailability({ quiet: true });
    syncActionAvailability();
  }
}

async function deactivateLocalSttModel(): Promise<void> {
  if (reportBlockedLocalSttAction("Unload STT")) {
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
    const response = await ipcDeactivateLocalSttModel(
      { model: model || null },
      "Local STT unload timed out. You can keep using Online mode and retry unloading later.",
    );
    if (response.deactivated) {
      lastWarmedLocalSttModel = "";
      localSttRuntimeLoaded = false;
      renderSidebarLocalSttToggle();
      setLocalSttNotice(response.details, "success");
      setNotice(response.details);
    } else {
      setLocalSttNotice(response.details, "error");
      setNotice(response.details, true);
    }
  } catch (error) {
    const message = asErrorMessage(error);
    setNotice(`Unable to deactivate local STT model: ${message}`, true);
  } finally {
    localSttDeactivateInFlight = false;
    void refreshLocalSttRuntimeState({ quiet: true });
    void refreshSelectedLocalSttModelAvailability({ quiet: true });
    syncActionAvailability();
  }
}

function applyLocalSttDownloadStatus(status: LocalSttDownloadStatusResponse): void {
  lastLocalSttDownloadStatus = status;
  const rawPercent = Number.isFinite(status.progressPercent) ? status.progressPercent : 0;
  const boundedPercent = Math.max(
    0,
    Math.min(100, status.completed && status.success ? 100 : rawPercent),
  );
  localSttDownloadActive = status.active;
  localSttDownloadProgressBar.style.setProperty("--p", String(boundedPercent / 100));
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
    showLocalSttDownloadOverlay(status);
    renderLocalSttSettingsStatus();
    return;
  }

  if (status.completed) {
    localSttDownloadProgressText.textContent = status.success
      ? "Model loaded."
      : status.message || status.stage || "Download finished.";
    hideLocalSttDownloadOverlay();
    renderLocalSttSettingsStatus();
    return;
  }

  localSttDownloadProgressText.textContent =
    status.message || "No local STT download in progress.";
  hideLocalSttDownloadOverlay();
  renderLocalSttSettingsStatus();
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
    const status = await ipcGetLocalSttDownloadStatus();
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
      setLocalSttNotice(completionMessage, status.success ? "success" : "error");
      if (status.success) {
        if (status.model.trim()) {
          lastWarmedLocalSttModel = status.model.trim();
        }
        localSttSelectedModelDownloaded = true;
        setNotice(completionMessage);
        await fetchLocalSttModels({ quiet: true });
        await refreshSelectedLocalSttModelAvailability({ quiet: true });
      } else {
        localSttSelectedModelDownloaded = false;
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
  if (reportBlockedLocalSttAction("Download STT model")) {
    return;
  }
  let model = await ensureSelectedLocalSttModel({ quiet: true });
  if (!model) {
    showOfflineModeDiagnostic('no-model-downloaded');
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
    const response = await ipcDownloadLocalSttModel({ model });
    localSttModelInput.value = response.model;
    handleSettingsChange();
    localSttSelectedModelDownloaded = false;
    setLocalSttNotice("Downloading model...");
    if (!isSettingsOpen()) {
      setNotice("Downloading offline model...");
    }
    showLocalSttDownloadOverlay({
      active: true,
      completed: false,
      success: false,
      model: response.model,
      repoId: "",
      stage: "Starting local STT download...",
      message: response.details || "Preparing download...",
      currentFile: "",
      downloadedBytes: 0,
      totalBytes: 0,
      filesCompleted: 0,
      filesTotal: 0,
      progressPercent: 0,
      updatedAtMs: Date.now(),
    });
    startLocalSttDownloadStatusPolling();
    await pollLocalSttDownloadStatusOnce({ quiet: true });
  } catch (error) {
    const message = asErrorMessage(error);
    setNotice(`Unable to download local STT model: ${message}`, true);
    setLocalSttNotice(`Download failed: ${message}`, "error");
    hideLocalSttDownloadOverlay();
  } finally {
    localSttDownloadInFlight = false;
    syncActionAvailability();
  }
}

async function deleteLocalSttModel(): Promise<void> {
  if (reportBlockedLocalSttAction("Delete STT model")) {
    return;
  }

  const model = await ensureSelectedLocalSttModel({ quiet: true });
  if (!model) {
    showOfflineModeDiagnostic('no-model-downloaded');
    return;
  }

  localSttDeleteInFlight = true;
  syncActionAvailability();

  try {
    const response = await ipcDeleteLocalSttModel({ model });
    setLocalSttNotice(response.details, response.removed ? "success" : "error");
    if (response.removed) {
      lastWarmedLocalSttModel = "";
      localSttRuntimeLoaded = false;
      renderSidebarLocalSttToggle();
      if (localSttModelInput.value.trim() === model) {
        localSttModelInput.value = "";
        localSttModelCatalogSelect.value = "";
        handleSettingsChange();
      }
      localSttSelectedModelDownloaded = false;
      setNotice(`Deleted local STT model "${response.model}".`);
      await refreshLocalSttRuntimeState({ quiet: true });
      await fetchLocalSttModels({ quiet: true, autoSelect: true });
      await refreshSelectedLocalSttModelAvailability({ quiet: true });
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
  if (reportBlockedLocalSttAction("Open STT model folder")) {
    return;
  }

  const model = await ensureSelectedLocalSttModel({ quiet: true });

  // DIAGNOSTIC: Check if a model is selected first
  if (!model) {
    showOfflineModeDiagnostic('no-model-downloaded');
    return;
  }

  try {
    const response = await ipcOpenLocalSttModelPath({ model });

    if (response.opened) {
      setLocalSttNotice(`Opened: ${response.localPath}`, "success");
      setNotice(`✅ Opened model folder successfully!`);
    } else {
      // Model path doesn't exist - offer to download
      setLocalSttNotice(response.details || "Model not found", "error");
      showOfflineModeDiagnostic('model-file-missing', {
        model,
        expectedPath: response.localPath
      });
    }
  } catch (error) {
    const message = asErrorMessage(error);
    setLocalSttNotice(`Failed to open: ${message}`, "error");

    // Check if it's a backend command not found error
    if (message.includes("command not found") || message.includes("not implemented")) {
      setNotice("⚠️ Open folder feature not available in this version. Please use Online mode for now.", true);
    } else {
      setNotice(`Unable to open model folder: ${message}`, true);
    }
  }
}

function showMissingApiKeyNotice(source: string): void {
  const message =
    "Recording blocked: API key is missing for online mode. Add API key in Settings > Models > Online provider.";
  setNotice(message, true);
  transitionRecordingState({ type: "recording-failed", reason: "Missing API key for online runtime." });
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
  await handleRecordToggleService();
}

async function handleDockMicToggle(): Promise<void> {
  await handleDockMicToggleService();
}

function interruptTtsPlaybackForCaptureIntent(): boolean {
  return interruptTtsPlaybackService();
}

function stopRecording(options: StopRecordingOptions = {}): void {
  stopRecordingService(options);
}

async function runPipeline(audioBlob: Blob, audioMimeType: string): Promise<void> {
  const activeSettings = readSettingsFromForm();
  const pipelineInvokeStartedAt = performance.now();

  transitionRecordingState({ type: "pipeline-started" });
  syncActionAvailability();

  try {
    let pipelineAudioBlob = audioBlob;
    let pipelineAudioMimeType = audioMimeType;
    let rawPcmBase64: string | null = null;
    if (activeSettings.noiseSuppression) {
      // Fast path: decode WebM → raw f32 PCM, send directly to Rust (skip WAV roundtrip)
      try {
        const decoded = await decodeAudioSample(audioBlob);
        const channelData = decoded.getChannelData(0); // mono f32
        // Pack as: [sample_rate: u32 LE][samples: f32 LE...]
        const header = new ArrayBuffer(4);
        new DataView(header).setUint32(0, decoded.sampleRate, true);
        const pcmBytes = new Uint8Array(header.byteLength + channelData.length * 4);
        pcmBytes.set(new Uint8Array(header), 0);
        pcmBytes.set(new Uint8Array(channelData.buffer), header.byteLength);
        // Convert to base64
        let binary = "";
        for (let i = 0; i < pcmBytes.length; i++) {
          binary += String.fromCharCode(pcmBytes[i]);
        }
        rawPcmBase64 = btoa(binary);
        logClientEvent(`[pipeline.audio] raw PCM ready samples=${channelData.length} sampleRate=${decoded.sampleRate} bytes=${pcmBytes.length}`);
      } catch (error) {
        logClientEvent(`raw PCM conversion failed, falling back to WAV: ${asErrorMessage(error)}`);
        try {
          const decoded = await decodeAudioSample(audioBlob);
          pipelineAudioBlob = audioBufferToWavBlob(decoded);
          pipelineAudioMimeType = "audio/wav";
        } catch (e2) {
          logClientEvent(`wav fallback also failed: ${asErrorMessage(e2)}`);
        }
      }
    } else if (activeSettings.sttRuntimeMode === "local") {
      try {
        const decoded = await decodeAudioSample(audioBlob);
        pipelineAudioBlob = audioBufferToWavBlob(decoded);
        pipelineAudioMimeType = "audio/wav";
      } catch (error) {
        logClientEvent(`local.stt wav conversion skipped: ${asErrorMessage(error)}`);
      }
    } else if (shouldOptimizeOnlineSttUpload(activeSettings)) {
      logClientEvent(
        `online.stt optimized transport bytes=${audioBlob.size} mime=${audioMimeType || "unknown"} bitrate=${resolvePreferredOnlineSttBitrate(activeSettings) ?? "default"}`,
      );
    }

    const base64EncodeStartedAt = performance.now();
    const audioBase64 = await blobToBase64(pipelineAudioBlob);
    logClientEvent(
      `[pipeline.audio] base64Ms=${Math.round(
        performance.now() - base64EncodeStartedAt,
      )} bytes=${pipelineAudioBlob.size} mime=${pipelineAudioMimeType || "unknown"}`,
    );
    const systemPrompt = buildEffectiveSystemPrompt(activeSettings, commandModeArmed);
    const pipelineTtsEngine: TtsEngine = "piper";
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
        const fallbackLocalSttModel = pickDefaultLocalSttModelFromList(localSttModelCatalog);
        if (fallbackLocalSttModel) {
          localSttModelInput.value = fallbackLocalSttModel;
          if (localSttModelCatalog.includes(fallbackLocalSttModel)) {
            localSttModelCatalogSelect.value = fallbackLocalSttModel;
          }
          handleSettingsChange();
          selectedLocalSttModel = fallbackLocalSttModel;
        }
      }
      if (selectedLocalSttModel && !(await checkModelFileExists(selectedLocalSttModel))) {
        logClientEvent("pipeline.blocked reason=missing-local-stt-files");
        setNotice(
          `Local STT model "${localSttModelLabel(selectedLocalSttModel)}" is not downloaded yet. Click Download Model in the sidebar first.`,
          true,
        );
        openSettings("missing-local-stt-files");
        setActiveSettingsPane("models", "missing-local-stt-files");
        transitionRecordingState({ type: "pipeline-blocked", reason: "Local setup required." });
        return;
      }
      if (!selectedLocalSttModel) {
        logClientEvent("pipeline.blocked reason=missing-local-stt-model");
        setNotice(
          "Local STT mode needs a local STT model (Parakeet). Open Settings > Models and select one.",
          true,
        );
        setActiveSettingsPane("models");
        transitionRecordingState({ type: "pipeline-blocked", reason: "Local setup required." });
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
        transitionRecordingState({ type: "pipeline-blocked", reason: "Local setup required." });
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
        setActiveSettingsPane("models");
        transitionRecordingState({ type: "pipeline-blocked", reason: "Local setup required." });
        return;
      }
    }

    const sttLanguageConfig = resolveSttLanguageConfig(activeSettings);

    const response = await ipcRunAssistantPipeline({
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
        rawMode: activeSettings.rawMode,
        applyBacktrack: activeSettings.backtrackCorrection,
        removeFillers: activeSettings.removeFillers,
        autoPunctuation: activeSettings.autoPunctuation,
        autoNumberedLists: activeSettings.numberedLists,
        noiseSuppression: activeSettings.noiseSuppression,
        rawPcmBase64: rawPcmBase64,
        commandMode: commandModeArmed,
        wakeWordEnabled: activeSettings.wakeWordEnabled,
        assistantName: activeSettings.assistantName || DEFAULT_ASSISTANT_NAME,
        selectedText: selectedTextForRewrite,
        ttsEngine: pipelineTtsEngine,
        piper: {
          speed: activeSettings.piperSpeed,
          quality: activeSettings.piperQuality,
          emotion: activeSettings.piperEmotion,
        },
        coqui: null,
    } as Record<string, unknown>);
    logClientEvent(
      `[pipeline.invoke] totalMs=${Math.round(
        performance.now() - pipelineInvokeStartedAt,
      )} sttMs=${Math.round(response.sttLatencyMs)} aiMs=${Math.round(
        response.aiLatencyMs,
      )} ttsMs=${Math.round(response.ttsLatencyMs)} endToEndMs=${Math.round(response.totalLatencyMs)}`,
    );

    const resolvedResponse =
      response.mode === "dictation"
        ? {
            ...response,
            assistantResponse: expandSnippetsInText(response.assistantResponse, snippets),
          }
        : response;

    renderPipelineResponse(resolvedResponse);
    let playbackCompleted = true;
    const selectionPopupPayload = buildSelectionPopupPayload(resolvedResponse, nextSelectionPopupToken());
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

    if (
      !selectionPopupOpened &&
      resolvedResponse.mode === "assistant" &&
      resolvedResponse.audioBase64.trim()
    ) {
      playbackCompleted = await playGeneratedAudio(resolvedResponse.audioBase64, pipelineTtsEngine);
    }

    let dictationPasted = false;
    if (resolvedResponse.mode === "dictation") {
      if (activeSettings.autoPasteDictation) {
        dictationPasted = await triggerAutoPaste(resolvedResponse.assistantResponse);
        if (dictationPasted) {
          setNotice("Dictation copied and pasted.");
        }
      }
      // Bug fix: also copy dictation to clipboard when copyToClipboard is enabled
      // and autoPaste is disabled (previously transcriptions were silently lost)
      if (
        !dictationPasted &&
        activeSettings.copyToClipboard &&
        !resolvedResponse.selectionPending &&
        !selectionPopupOpened
      ) {
        await copyToClipboard(resolvedResponse.assistantResponse);
      }
    } else if (
      activeSettings.copyToClipboard &&
      !resolvedResponse.selectionPending &&
      !selectionPopupOpened
    ) {
      await copyToClipboard(resolvedResponse.assistantResponse);
    }

    commandModeArmed = false;
    commandSelectionSnapshot = null;
    publishDockState();

    if (stage !== "recording") {
      if (resolvedResponse.mode === "dictation") {
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
    transitionRecordingState({ type: "pipeline-failed", reason: `Pipeline failed: ${asErrorMessage(error)}` });
  } finally {
    pipelineRunning = false;
    await refreshAssistantInfoSafely();
    syncActionAvailability();
  }
}

function renderPipelineResponse(response: AssistantPipelineResponse): void {
  renderPipelineResponseService(response);
}

async function playGeneratedAudio(audioBase64: string, engine: TtsEngine): Promise<boolean> {
  return playGeneratedAudioService(audioBase64, engine);
}

function renderAssistantInfo(info: AssistantInfoResponse): void {
  latestAssistantInfoDefaults = info;
  const appVersion = info.appVersion?.trim();
  settingsVersionText.textContent = appVersion ? `SlasshyWispr v${appVersion}` : "SlasshyWispr";
  updateCurrentVersion.textContent = appVersion || "-";
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
  settingsFormRefs.apiBaseUrlInput.placeholder = info.baseUrl || "Enter provider URL (example: https://api.example.com/v1)";
  settingsFormRefs.sttModelInput.placeholder = info.sttModel || "Enter STT model id";
  settingsFormRefs.aiModelInput.placeholder = info.aiModel || "Enter AI model id";
  settingsFormRefs.localOllamaBaseUrlInput.placeholder = DEFAULT_LOCAL_OLLAMA_BASE_URL;
  updateRuntimeModeNoticeService(settingsFormRefs, settings.sttRuntimeMode, settings.aiRuntimeMode);
  piperStatusValue.textContent = info.piperInstalled ? "Installed" : "Missing";
  piperPathValue.textContent = info.piperPath || "-";
  voiceStatusValue.textContent = info.voiceInstalled ? "Installed" : "Missing";
  voicePathValue.textContent = info.voiceModelPath;
  piperRuntimeReady = Boolean(info.piperInstalled && info.voiceInstalled);
  updateTtsSetupGate();
}

async function fetchForegroundInputBlockStatus(force = false): Promise<ForegroundInputBlockStatus> {
  if (!ENABLE_FOREGROUND_SHORTCUT_SUPPRESSION) {
    const fallback: ForegroundInputBlockStatus = {
      blocked: false,
      processName: "",
      reason: "",
      fullscreen: false,
    };
    foregroundBlockStatusCache = fallback;
    foregroundBlockCheckedAt = Date.now();
    return fallback;
  }

  if (!isTauriEnvironment()) {
    return { blocked: false, processName: "", reason: "", fullscreen: false };
  }

  const now = Date.now();
  if (!force && now - foregroundBlockCheckedAt <= FOREGROUND_BLOCK_CHECK_CACHE_MS) {
    return foregroundBlockStatusCache;
  }

  if (
    !force &&
    foregroundBlockMonitorId !== null &&
    foregroundBlockCheckedAt > 0 &&
    now - foregroundBlockCheckedAt <= 1_500
  ) {
    void refreshBlockedAppShortcutSuppression();
    return foregroundBlockStatusCache;
  }

  if (foregroundBlockCheckInFlight) {
    return foregroundBlockCheckInFlight;
  }

  foregroundBlockCheckInFlight = (async () => {
    try {
      const status = await ipcGetForegroundInputBlockStatus();
      const next: ForegroundInputBlockStatus = {
        blocked: Boolean(status?.blocked),
        processName: String(status?.processName ?? "").trim().toLowerCase(),
        reason: String(status?.reason ?? "").trim().toLowerCase(),
        fullscreen: Boolean(status?.fullscreen),
      };
      foregroundBlockStatusCache = next;
      foregroundBlockCheckedAt = Date.now();
      return next;
    } catch {
      const fallback: ForegroundInputBlockStatus = {
        blocked: false,
        processName: "",
        reason: "",
        fullscreen: false,
      };
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
    if (shouldSuppress === isShortcutSuppressionActive()) {
      return;
    }

    setShortcutSuppressionActive(shouldSuppress);
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

async function closeSelectionAssistantWindowForTray(): Promise<void> {
  latestSelectionPopupPayload = null;
  if (!selectionAssistantWindow) {
    return;
  }

  try {
    await selectionAssistantWindow.close();
  } catch (error) {
    logClientEvent(`[tray.background] selection popup close failed: ${asErrorMessage(error)}`);
    try {
      await selectionAssistantWindow.hide();
    } catch {
      // Ignore best-effort cleanup failures while entering tray mode.
    }
  } finally {
    selectionAssistantWindow = null;
  }
}

function stopNonEssentialUiPollingForTray(): void {
  stopTtsSetupPollingService();
  stopLocalSttDownloadStatusPolling();
  hideLocalSttLoadOverlay();
}

function resumeNonEssentialUiPollingAfterTray(): void {
  if (ttsSetupRunning) {
    startTtsSetupPollingService();
    void pollTtsSetupStatusOnceService();
  }
  if (localSttDownloadActive) {
    startLocalSttDownloadStatusPolling();
    void pollLocalSttDownloadStatusOnce({ quiet: true });
  }
}

async function applyMainWindowTrayVisibility(hidden: boolean): Promise<void> {
  mainWindowHiddenToTray = hidden;
  if (!hidden) {
    resumeNonEssentialUiPollingAfterTray();
    // Re-sync the dock so it reappears if showDockAlways is on or a session is active
    void syncFloatingIndicatorWindow();
    return;
  }

  stopNonEssentialUiPollingForTray();
  await closeSelectionAssistantWindowForTray();
  // Keep the floating dock alive when minimizing to tray — only close it
  // if the user explicitly disabled the dock via showFlowBar setting.
  // Previously this destroyed the dock window which made it disappear
  // and it was never re-created until the next recording session.
}

async function initializeTrayBackgroundLifecycle(): Promise<void> {
  if (!isTauriEnvironment()) {
    return;
  }

  await listen<{ hidden?: boolean }>(MAIN_WINDOW_VISIBILITY_EVENT, (event) => {
    void applyMainWindowTrayVisibility(Boolean(event.payload?.hidden));
  });

  try {
    const visible = await getCurrentWindow().isVisible();
    await applyMainWindowTrayVisibility(!visible);
  } catch {
    mainWindowHiddenToTray = false;
  }
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

  if (previousStage !== "idle" && next === "idle") {
    void preWarmMicrophoneStream(settings.microphoneDeviceId);
  }

  if (previousStage !== "recording" && next === "recording") {
    playDictationSoundEffect("start");
    if (settings.muteMusicWhileDictating) {
      pauseExternalMediaForDictation();
    }
    return;
  }

  if (previousStage === "recording" && next !== "recording") {
    playDictationSoundEffect("stop");
    if (isExternalMediaMutedForDictation()) {
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

// ===== Recording State Machine Integration =====
// The recordingController wraps the extracted state machine
// (recording-state-machine.ts) and makes it the authoritative
// source of recording state. It delegates the actual side effects
// to the existing setStage() and other helpers in main.tsx.

const recordingMachineState: MachineState = {
  stage: "idle",
  pipelineRunning: false,
  isRecording: false,
  pttHoldCount: 0,
  commandModeArmed: false,
};

function getRecordingMachineConfig(): MachineConfig {
  return {
    captureMode: settings.captureMode,
    muteMusicWhileDictating: settings.muteMusicWhileDictating,
  };
}

function transitionRecordingState(event: MachineEvent): TransitionResult {
  const previousStage = recordingMachineState.stage;
  const result = processEvent(recordingMachineState, event, getRecordingMachineConfig());

  // Sync the state machine's state with the result
  recordingMachineState.stage = result.stage;

  // Execute the primary side effect: update stage via the existing setStage()
  // which handles DOM updates, sound effects, media control, and mic pre-warming.
  if (result.stage !== previousStage) {
    setStage(result.stage, result.detail);
  }

  // Execute additional actions that setStage() does not handle
  for (const action of result.actions) {
    switch (action.type) {
      case "set-pipeline-running":
        pipelineRunning = action.running;
        break;
      case "clear-ptt-holds":
        clearPushToTalkHolds();
        break;
      case "reset-command-mode":
        commandModeArmed = false;
        commandSelectionSnapshot = null;
        publishDockState();
        break;
      case "set-notice":
        setNotice(action.message, action.isError);
        break;
      case "release-recorder":
        releaseMicrophone();
        break;
      case "clear-chunks":
        recordedChunks = [];
        break;
      case "stop-recording-ticker":
        stopRecordingTicker();
        break;
      case "begin-recording-ticker":
        beginRecordingTicker();
        break;
      case "set-recording-started-at":
        recordingStartedAt = action.timestamp;
        break;
      case "stop-amplitude-monitoring":
        stopAmplitudeMonitoring();
        break;
      case "start-amplitude-monitoring":
        // amplitude monitoring is started with the stream, not via action
        break;
      case "pre-warm-microphone":
        void preWarmMicrophoneStream(settings.microphoneDeviceId);
        break;
      case "resume-external-media":
        if (isExternalMediaMutedForDictation()) {
          resumeExternalMediaAfterDictation();
        }
        break;
      case "publish-dock-state":
        publishDockState();
        break;
      // set-stage, play-sound, and run-pipeline are handled by setStage()
      // or by the calling function respectively
    }
  }

  return result;
}

function stageLabel(next: Stage): string {
  if (next === "recording") return "Recording";
  if (next === "processing") return "Processing";
  if (next === "speaking") return "Speaking";
  if (next === "error") return "Error";
  return "Idle";
}

function setNotice(message: string, isError = false): void {
  setNoticeService(message, isError);
}

function logClientEvent(message: string): void {
  logClientEventService(message);
}

function shouldDisplayDock(): boolean {
  if (!settings.showFlowBar) {
    return false;
  }
  if (settings.showDockAlways) {
    return true;
  }
  return (
    stage === "recording" ||
    stage === "processing" ||
    stage === "speaking"
  );
}

function resolvedDockTheme(): "light" | "dark" {
  if (settings.themeMode === "light") {
    return "light";
  }
  if (settings.themeMode === "dark" || settings.themeMode === "mono") {
    return "dark";
  }

  return systemThemeMediaQuery?.matches ? "light" : "dark";
}

function publishDockState(): void {
  try {
    dockChannel.postMessage({
      kind: "state",
      stage,
      visible: shouldDisplayDock(),
      mainWindowHiddenToTray,
      theme: resolvedDockTheme(),
      amplitude: dockAmplitude,
      captureMode: settings.captureMode,
      hotkey: cachedHotkeyDisplay,
      showFlowBar: settings.showFlowBar,
      commandModeArmed,
      globalShortcutsActive: isGlobalShortcutsActive(),
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
    document.querySelector(".app-frame")?.classList.add("is-recording");
    return;
  }

  if (pipelineRunning) {
    recordBtn.textContent = "Processing...";
    recordBtn.classList.remove("is-recording");
    recordBtn.disabled = true;
    notesQuickMicBtn.dataset.stage = "processing";
    notesQuickMicBtn.disabled = true;
    document.querySelector(".app-frame")?.classList.remove("is-recording");
    return;
  }

  recordBtn.textContent = settings.captureMode === "push-to-talk" ? "Hold to Talk" : "Start Recording";
  recordBtn.classList.remove("is-recording");
  recordBtn.disabled = false;
  document.querySelector(".app-frame")?.classList.remove("is-recording");
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
    voiceIndicatorWindow = existing;
    return existing;
  }

  const dockWidth = 160;
  const dockHeight = 140;
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

async function showVoiceIndicatorWindow(): Promise<boolean> {
  if (dockHideTimerId !== null) {
    window.clearTimeout(dockHideTimerId);
    dockHideTimerId = null;
  }

  try {
    const wasMissing = !voiceIndicatorWindow;
    const win = await ensureVoiceIndicatorWindow();
    await win.show();
    dockRuntimeErrorShown = false;
    publishDockState();
    // ponytail: re-publish after 300ms in case the dock's onmessage listener
    // wasn't attached yet when the first message fired. Covers the race where
    // the dock window is shown but the BroadcastChannel subscriber in
    // voice-indicator.html hasn't been set up yet.
    setTimeout(() => publishDockState(), 300);
    return wasMissing;
  } catch (error) {
    reportDockRuntimeError(`Unable to show floating dock: ${asErrorMessage(error)}`);
    return false;
  }
}

async function canPreWarmMicrophone(): Promise<boolean> {
  return canPreWarmMicrophoneService();
}

async function primeCaptureReadiness(deviceId: string, shouldPrimeDock: boolean): Promise<void> {
  if (await canPreWarmMicrophone()) {
    void preWarmMicrophoneStream(deviceId);
  }

  if (shouldPrimeDock && isTauriEnvironment() && !voiceIndicatorWindow) {
    void ensureVoiceIndicatorWindow().catch((error) => {
      logClientEvent(`[dock.prime] failed: ${asErrorMessage(error)}`);
    });
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
    // Cancel any pending hide timer before showing — prevents the race where a
    // hide timer is already ticking and this show path is followed by a quick
    // re-entry that hits the early return below and lets the stale hide fire.
    if (dockHideTimerId !== null) {
      window.clearTimeout(dockHideTimerId);
      dockHideTimerId = null;
    }
    const wasMissing = await showVoiceIndicatorWindow();
    // If the dock window was just (re)created, the BroadcastChannel subscriber
    // in voice-indicator.html may not have been wired yet when the pre-show
    // publishDockState() above fired. Re-publish to guarantee it lands on a
    // live listener; the listener can still drop messages it hasn't bound yet
    // (e.g. destroyed-and-reborn dock), so publish again shortly after to
    // cover that race.
    if (wasMissing) {
      publishDockState();
      window.setTimeout(() => publishDockState(), 60);
    }
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
    ollamaStatusBusy ||
    ollamaInstallBusy ||
    ollamaPullBusy ||
    localSttHardwareAdvisorOpen;
  const localSttBusy =
    busy ||
    localSttDownloadInFlight ||
    localSttDeleteInFlight ||
    localSttDeactivateInFlight ||
    localSttWarmupInFlight ||
    localSttRuntimeStateInFlight ||
    localSttDownloadActive;
  const sttRuntimeIsLocal = settings.sttRuntimeMode === "local";
  refreshMicsBtn.disabled = busy;
  setupRuntimeBtn.disabled = busy;
  validatePiperBtn.disabled = busy;
  downloadVoiceBtn.disabled = busy;
  setupAllTtsBtn.disabled = busy;
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
  settingsFormRefs.sttRuntimeModeOnlineInput.disabled = pipelineRunning || stage === "recording" || ttsSetupRunning;
  settingsFormRefs.sttRuntimeModeOfflineInput.disabled = pipelineRunning || stage === "recording" || ttsSetupRunning;
  settingsFormRefs.aiRuntimeModeOnlineInput.disabled = busy;
  settingsFormRefs.aiRuntimeModeOfflineInput.disabled = busy;
  settingsFormRefs.microphoneSelect.disabled = busy;
  settingsFormRefs.dictationLanguageSelect.disabled = busy;
  settingsFormRefs.dictationLanguageModeSingleInput.disabled = busy;
  settingsFormRefs.dictationLanguageModeMultipleInput.disabled = busy;
  for (const option of settingsFormRefs.dictationLanguageOptionInputs) {
    option.disabled = busy;
  }
  settingsFormRefs.styleProfileSelect.disabled = busy;
  settingsFormRefs.apiKeyInput.disabled = busy;
  settingsFormRefs.rememberApiKeyInput.disabled = busy;
  settingsFormRefs.apiBaseUrlInput.disabled = busy;
  settingsFormRefs.sttModelInput.disabled =busy;
  settingsFormRefs.aiModelInput.disabled =busy;
  providerModelCatalogSelect.disabled = busy;
  settingsFormRefs.localOllamaBaseUrlInput.disabled = busy;
  settingsFormRefs.localOllamaModelInput.disabled = busy;
  localOllamaModelCatalogSelect.disabled = busy;
  localSttModelInput.disabled = localSttBusy;
  localSttModelCatalogSelect.disabled = localSttBusy;
  ttsEngineSelect.disabled = busy;
  settingsFormRefs.piperPathInput.disabled = busy;
  settingsFormRefs.piperQualitySelect.disabled = busy;
  settingsFormRefs.piperEmotionSelect.disabled = busy;
  settingsFormRefs.piperSpeedInput.disabled = busy;
  hotkeyInput.disabled = busy;
  commandHotkeyInput.disabled = busy;
  settingsFormRefs.captureModeSingleInput.disabled = busy;
  settingsFormRefs.captureModePushToTalkInput.disabled = busy;
  settingsFormRefs.commandModeToggle.disabled = busy;
  settingsFormRefs.wakeWordEnabledToggle.disabled = busy;
  settingsFormRefs.assistantNameInput.disabled = busy;
  settingsFormRefs.autoPasteDictationToggle.disabled = busy;
  settingsFormRefs.contextAwarenessToggle.disabled = busy;
  settingsFormRefs.copyToClipboardToggle.disabled = busy;
  settingsFormRefs.incognitoModeToggle.disabled = busy;
  settingsFormRefs.themeModeSelect.disabled = busy;
  for (const cardInput of settingsFormRefs.themeCardInputs) {
    cardInput.disabled = busy;
  }
  settingsFormRefs.backtrackToggle.disabled = busy;
  settingsFormRefs.removeFillersToggle.disabled = busy;
  settingsFormRefs.autoPunctuationToggle.disabled = busy;
  settingsFormRefs.numberedListsToggle.disabled = busy;
  toggleMicEditorBtn.disabled = busy;
  toggleHotkeyEditorBtn.disabled = busy;
  dictionaryAddBtn.disabled = busy;
  dictionaryAddBtnTop.disabled = busy;
  snippetAddBtn.disabled = busy;
  renderLocalSttSettingsStatus();
  snippetsAddBtnTop.disabled = busy;

  const allRuntimeLocal = settings.sttRuntimeMode === "local" && settings.aiRuntimeMode === "local";
  fetchProviderModelsBtn.disabled = fetchProviderModelsBtn.disabled || allRuntimeLocal;
  applyModelToAiBtn.disabled = applyModelToAiBtn.disabled || allRuntimeLocal;
  applyModelToSttBtn.disabled = applyModelToSttBtn.disabled || allRuntimeLocal;
  settingsFormRefs.apiKeyInput.disabled = settingsFormRefs.apiKeyInput.disabled || allRuntimeLocal;
  settingsFormRefs.rememberApiKeyInput.disabled = settingsFormRefs.rememberApiKeyInput.disabled || allRuntimeLocal;
  settingsFormRefs.apiBaseUrlInput.disabled = settingsFormRefs.apiBaseUrlInput.disabled || allRuntimeLocal;
  settingsFormRefs.sttModelInput.disabled = settingsFormRefs.sttModelInput.disabled || allRuntimeLocal;
  settingsFormRefs.aiModelInput.disabled = settingsFormRefs.aiModelInput.disabled || allRuntimeLocal;
  providerModelCatalogSelect.disabled = providerModelCatalogSelect.disabled || allRuntimeLocal;
}

async function engagePushToTalk(source: HoldSource): Promise<void> {
  await engagePushToTalkService(source);
}

function releasePushToTalk(source: HoldSource): void {
  releasePushToTalkService(source);
}

function clearPushToTalkHolds(): void {
  clearPushToTalkHoldsService();
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

function bindPushToTalkKeyboardHold(button: HTMLButtonElement, source: HoldSource): void {
  let keyboardHoldActive = false;

  button.addEventListener("keydown", (event) => {
    if (settings.captureMode !== "push-to-talk") {
      return;
    }
    if (event.repeat || (event.key !== " " && event.key !== "Enter")) {
      return;
    }

    event.preventDefault();
    if (keyboardHoldActive) {
      return;
    }
    keyboardHoldActive = true;
    void engagePushToTalk(source);
  });

  button.addEventListener("keyup", (event) => {
    if (!keyboardHoldActive || (event.key !== " " && event.key !== "Enter")) {
      return;
    }
    event.preventDefault();
    keyboardHoldActive = false;
    releasePushToTalk(source);
  });

  button.addEventListener("blur", () => {
    if (!keyboardHoldActive) {
      return;
    }
    keyboardHoldActive = false;
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

function stopAmplitudeMonitoring(resetLevel = true): void {
  stopAmplitudeMonitoringService(resetLevel);
}

function beginRecordingTicker(): void {
  beginRecordingTickerService();
}

function stopRecordingTicker(): void {
  stopRecordingTickerService();
}

function releaseMicrophone(): void {
  releaseMicrophoneService();
}

async function releasePreWarmedStream(): Promise<void> {
  await releasePreWarmedStreamService();
}

async function preWarmMicrophoneStream(deviceId: string): Promise<void> {
  await preWarmMicrophoneStreamService(deviceId);
}

// ============================================================================
// OFFLINE MODE DIAGNOSTICS - User-Friendly Error Handling
// ============================================================================

/**
 * Checks if a model file exists on disk
 */
async function checkModelFileExists(_model: string): Promise<boolean> {
  const response = await getLocalSttModelStatus(_model, { quiet: true });
  return response?.exists === true;
}

/**
 * Checks if Python dependencies are installed
 */
async function checkPythonDependencies(model: string): Promise<boolean> {
  const provider = inferLocalSttProviderFromModel(model);
  if (!provider || provider === "parakeet") {
    return true;
  }
  try {
    const response = await ipcWarmupLocalSttModel(
      { model },
      12000,
      `Timed out while checking local STT runtime dependencies for \"${model}\".`,
    );
    if (response.warmed) {
      return true;
    }
    const message = response.details.toLowerCase();
    return !(
      message.includes("python") ||
      message.includes("module") ||
      message.includes("nemo") ||
      message.includes("zero-python")
    );
  } catch (error) {
    const msg = asErrorMessage(error).toLowerCase();
    if (msg.includes("python") || msg.includes("module") || msg.includes("nemo")) {
      return false;
    }
    return true;
  }
}

/**
 * Checks available system memory
 */
async function checkAvailableMemory(model: string): Promise<{ sufficient: boolean; availableMB?: number }> {
  try {
    // Get hardware advice which includes memory info
    const advice = await ipcGetLocalSttHardwareAdvice({ selectedModel: model });

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
      <h3 style="margin: 0 0 8px 0; font-size: 18px; color: var(--text-primary, #fff);">${escapeHtml(diagnostics.title)}</h3>
      <p style="margin: 0; color: var(--text-secondary, #aaa); font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(diagnostics.description)}</p>
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
        ${diagnostics.steps.map(step => `<li style="margin-bottom: 6px;">${escapeHtml(step)}</li>`).join('')}
      </ol>
    </div>

    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      ${diagnostics.actions.map(action => `
        <button
          data-action="${escapeHtml(action.id)}"
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
          ${escapeHtml(action.label)}
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
                await ipcSetupCoquiRuntime({ pythonPath: null, useGpu: false });
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
              openInSystemBrowser('https://github.com/SlasshyOverhere/SlasshyWispr#quick-setup');
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

void bootstrap();
