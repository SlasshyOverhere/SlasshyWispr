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
  getAssistantInfo as ipcGetAssistantInfo,
  launchAtLoginStatus as ipcLaunchAtLoginStatus,
  loadPersistedLocalSettings as ipcLoadPersistedLocalSettings,
  listDictationRecordingIds as ipcListDictationRecordingIds,
  saveDictationRecording as ipcSaveDictationRecording,
} from "./ipc/client";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  LogicalSize,
  PhysicalPosition,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import {
  unregisterAll as unregisterAllGlobalShortcuts,
  type ShortcutEvent,
} from "@tauri-apps/plugin-global-shortcut";
import { open as openExternalUrl } from "@tauri-apps/plugin-shell";
import {
  asErrorMessage,
  boolFlag,
  confirmDestructiveAction,
  createId,
} from "./utils";
import { matchHistoryToRecordings } from "./store";
import { newlyUnlockedAchievements } from "./analytics/analytics-service";
import { loadHistory } from "./state/history";
import {
  initShellPersist,
  loadAchievementStates as loadAchievementStatesService,
  loadDockLayout as loadDockLayoutService,
  loadPersistedMainPage as loadPersistedMainPageService,
  loadPersistedSettingsPane as loadPersistedSettingsPaneService,
  loadUsageStats as loadUsageStatsService,
  persistAnalyticsSessionDetails as persistAnalyticsSessionDetailsService,
  persistAchievementStates as persistAchievementStatesService,
  persistHomeHistory as persistHomeHistoryService,
  persistUsageStats as persistUsageStatsService,
  updateAndPersistDockLayout as updateAndPersistDockLayoutService,
  persistDockPositionFromWindow as persistDockPositionFromWindowService,
} from "./state/persist";
import { loadAnalyticsSessions as loadCanonicalAnalyticsSessions } from "./state/usage";
import {
  loadSettings,
  asThemeMode,
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
  initPipelinePrompt,
} from "./pipeline/pipeline-prompt";
import {
  initPipelineRender,
} from "./pipeline/pipeline-render";
import {
  initPipelineClient,
  runPipeline as runPipelineService,
} from "./pipeline/pipeline-client";
import {
  initPlayback,
  interruptTtsPlaybackForCaptureIntent as interruptTtsPlaybackService,
} from "./recording/playback";
import {
  canPreWarmMicrophone as canPreWarmMicrophoneService,
  initMicStream,
  preWarmMicrophoneStream as preWarmMicrophoneStreamService,
  releasePreWarmedStream as releasePreWarmedStreamService,
} from "./recording/mic-stream";
import {
  clearPushToTalkHolds as clearPushToTalkHoldsService,
  bindPushToTalkKeyboardHold as bindPushToTalkKeyboardHoldService,
  bindPushToTalkPointerHold as bindPushToTalkPointerHoldService,
  engagePushToTalk as engagePushToTalkService,
  getPushToTalkHoldCount,
  handleDockMicToggle as handleDockMicToggleService,
  handleRecordToggle as handleRecordToggleService,
  hasPushToTalkHold,
  initCaptureTriggers,
  initPushToTalkBindings,
  releasePushToTalk as releasePushToTalkService,
} from "./recording/capture-triggers";
import {
  initCommandMode,
  isCommandModeArmed,
  primeSelectionSnapshotForCommandMode,
  resetCommandMode,
  toggleCommandModeArmed,
} from "./recording/command-mode";
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
import {
  addDictionaryTerm as addDictionaryTermService,
  addQuickNote as addQuickNoteService,
  addSnippetEntry as addSnippetEntryService,
  getDictionaryTerms as getDictionaryTermsService,
  getSnippets as getSnippetsService,
  initCollectionsView,
  persistDictionaryTerms as persistDictionaryTermsService,
  persistQuickNotes as persistQuickNotesService,
  persistSnippets as persistSnippetsService,
  renderDictionaryList as renderDictionaryListService,
  renderNotesList as renderNotesListService,
  renderSnippetsList as renderSnippetsListService,
} from "./collections/collections-view";
import {
  initAssistantInfo,
  renderAssistantInfo as renderAssistantInfoService,
} from "./shell/assistant-info";
import {
  initHistoryView,
} from "./history/history-view";
import {
  copyToClipboard as copyToClipboardService,
  initClipboard,
  triggerAutoPaste as triggerAutoPasteService,
} from "./shell/clipboard";
import {
  MISSING_API_KEY_MESSAGE,
  initDesktopNotice,
  isNotificationPermissionRequested,
  setNotificationPermissionRequested,
  showDesktopNotice,
} from "./shell/notify";
import {
  initAnalyticsRender,
  updateUsageMetrics as updateUsageMetricsService,
} from "./analytics/analytics-render";
import {
  initUsageTracker,
  trackUsage as trackUsageService,
} from "./analytics/usage-tracker";
import {
} from "./stt/provider-inference";
import {
  initLocalSttState,
  isSelectedLocalSttModelLoaded as isSelectedLocalSttModelLoadedService,
  localSttDownloadActive,
  localSttModelLabel as localSttModelLabelService,
} from "./stt/local-stt-state";
import {
  activateSelectedLocalSttModel as activateSelectedLocalSttModelService,
  ensureSelectedLocalSttModel as ensureSelectedLocalSttModelService,
  fetchLocalSttModels as fetchLocalSttModelsService,
  handleLocalSttAdvisorEscape,
  hideLocalSttLoadOverlay as hideLocalSttLoadOverlayService,
  initLocalSttClient,
  markCatalogSelectionChanged,
  markCatalogSelectionCleared,
  isLocalSttBusy as isLocalSttBusyService,
  isLocalSttHardwareAdvisorOpen,
  notifySettingsOverlayVisibilityChanged,
  pollLocalSttDownloadStatusOnce as pollLocalSttDownloadStatusOnceService,
  refreshLocalSttRuntimeState as refreshLocalSttRuntimeStateService,
  refreshSelectedLocalSttModelAvailability as refreshSelectedLocalSttModelAvailabilityService,
  renderLocalSttSettingsStatus as renderLocalSttSettingsStatusService,
  renderSidebarLocalSttToggle as renderSidebarLocalSttToggleService,
  requestLocalSttRuntimeSyncForMode as requestLocalSttRuntimeSyncForModeService,
  startLocalSttDownloadStatusPolling as startLocalSttDownloadStatusPollingService,
  stopLocalSttDownloadStatusPolling as stopLocalSttDownloadStatusPollingService,
  syncLocalSttRuntimeForMode as syncLocalSttRuntimeForModeService,
  warmupActiveLocalSttModel as warmupActiveLocalSttModelService,
} from "./stt/local-stt-client";
import {
  closeSelectionAssistantWindowForTray as closeSelectionAssistantWindowForTrayService,
  dismissSelectionPopup as dismissSelectionPopupService,
  initSelectionPopup,
  nextSelectionPopupToken as nextSelectionPopupTokenService,
  showSelectionAssistantPopup as showSelectionAssistantPopupService,
} from "./windows/selection-popup";
import {
  initDock,
  primeCaptureReadiness as primeCaptureReadinessService,
  publishDockState as publishDockStateService,
  syncFloatingIndicatorWindow as syncFloatingIndicatorWindowService,
} from "./windows/dock";
import {
  initializeTrayBackgroundLifecycle as initializeTrayBackgroundLifecycleService,
  initTrayLifecycle,
} from "./windows/tray-lifecycle";
import {
  initForegroundPolicy,
  shouldBlockAssistantInputFromForegroundApp as shouldBlockAssistantInputFromForegroundAppService,
  startBlockedAppShortcutSuppressionMonitor as startBlockedAppShortcutSuppressionMonitorService,
  stopForegroundMonitorForShutdown,
} from "./windows/foreground-policy";
import {
  initDockGeometry,
  resolveDockStartPosition as resolveDockStartPositionService,
} from "./windows/dock-geometry";
import {
  checkAvailableMemory as checkAvailableMemoryService,
  checkModelFileExists as checkModelFileExistsService,
  checkPythonDependencies as checkPythonDependenciesService,
  initLocalSttDiagnostics,
  showOfflineModeDiagnostic as showOfflineModeDiagnosticService,
} from "./stt/local-stt-diagnostics";
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
  isHotkeyReleaseEvent as isHotkeyReleaseEventService,
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
  ACTIVE_PAGE_STORAGE_KEY,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY,
  APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY,
  DEFAULT_HOTKEY,
  DEFAULT_COMMAND_HOTKEY,
} from "./constants";

import type {
  Stage,
  MainPage,
  SettingsPane,
  TtsProfilePane,

  AssistantInfoResponse,
  PersistedSettings,
  UsageStats,
  AnalyticsSessionDetail,
  AchievementState,
  HomeHistoryEntry,
  ActiveTtsPlayback,
  SelectionPopupPayload,
} from "./types";

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
let dockLayout = loadDockLayoutService();

let usageStats = loadUsageStatsService();
let analyticsSessionDetails: AnalyticsSessionDetail[] = loadCanonicalAnalyticsSessions();
let achievementStates: AchievementState[] = loadAchievementStatesService();
let homeHistoryEntries = loadHistory();
const recentTurns: Array<{ speaker: string; content: string }> = [];
let activePage: MainPage = loadPersistedMainPageService();
let activeSettingsPane: SettingsPane = loadPersistedSettingsPaneService();
let settingsCloseTimer: number | null = null;
let settingsPaneTransitionTimer: number | null = null;
let dockRuntimeErrorShown = false;
let providerModelCatalog: string[] = [];
let localOllamaModelCatalog: string[] = [];
let localSttModelCatalog: string[] = [];
let latestAssistantInfoDefaults: AssistantInfoResponse | null = null;
let piperRuntimeReady = false;
let lastWarmedLocalSttModel = "";
let localSttRuntimeLoaded = false;

let ttsSetupRunning = false;
let launchAtLoginSyncNonce = 0;
let lastCaptureIntentStartedAt = 0;
let lastCaptureIntentLabel = "";
let mainWindowHiddenToTray = false;
const dockChannel = new BroadcastChannel("slasshywispr-dock");
const selectionPopupChannel = new BroadcastChannel("slasshywispr-selection-popup");
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
initShellPersist({
  getUsageStats: () => usageStats,
  getSessions: () => analyticsSessionDetails,
  getAchievements: () => achievementStates,
  getHomeHistory: () => homeHistoryEntries,
  getDockLayout: () => dockLayout,
  setDockLayout: (layout) => {
    dockLayout = layout;
  },
  parseMainPage: (value) => asMainPage(value),
  parseSettingsPane: (value) => asSettingsPane(value),
});

setPersistErrorReporter((message) => setNoticeService(message, true));
initPipelinePrompt({ getRecentTurns: () => recentTurns });
initPipelineRender(
  { sttLatency, aiLatency, ttsLatency, totalLatency },
  {
    isIncognito: () => settings.incognitoMode,
    now: () => Date.now(),
    getRecordingStartedAt: () => recordingStartedAt,
    getLastSavedRecordingId: () => lastSavedRecordingId,
    getLastCaptureIntentLabel: () => lastCaptureIntentLabel,
    trackUsage: (transcript) => trackUsageService(transcript),
    addQuickNote: (text) => addQuickNoteService(text),
    getHomeHistory: () => homeHistoryEntries,
    setHomeHistory: (entries) => {
      homeHistoryEntries = entries;
    },
    persistHomeHistory: () => persistHomeHistoryService(),
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
  notify: (message, isError) => setNoticeService(message, isError),
  log: (message) => logClientEventService(message),
});
initCaptureMonitors(
  { recordTimer },
  {
    getAmplitude: () => dockAmplitude,
    setAmplitude: (level) => {
      dockAmplitude = level;
    },
    publishDockState: () => publishDockStateService(),
    now: () => Date.now(),
    getRecordingStartedAt: () => recordingStartedAt,
    getMediaStream: () => mediaStream,
    setMediaStream: (stream) => {
      mediaStream = stream;
    },
  },
);
initCommandMode({
  isTauri: isTauriEnvironment,
  captureSelectedText: () => ipcCaptureSelectedText(),
  setNotice: (message, isError) => setNoticeService(message, isError),
  log: (message) => logClientEventService(message),
  publishDockState: () => publishDockStateService(),
});
initCaptureTriggers({
  getStage: () => stage,
  isPipelineRunning: () => pipelineRunning,
  getCaptureMode: () => settings.captureMode,
  setNotice: (message, isError) => setNoticeService(message, isError),
  log: (message) => logClientEventService(message),
  shouldBlockFromForegroundApp: () => shouldBlockAssistantInputFromForegroundAppService(),
  interruptPlayback: () => interruptTtsPlaybackService(),
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
initPushToTalkBindings({
  isPushToTalkMode: () => settings.captureMode === "push-to-talk",
});
initRecordingController(
  {
    getStage: () => stage,
    isPipelineRunning: () => pipelineRunning,
    getHoldCount: () => getPushToTalkHoldCount(),
    getCommandModeArmed: () => isCommandModeArmed(),
    getCaptureMode: () => settings.captureMode,
    readSettings: () => readSettingsFromFormService(settingsFormRefs, settingsCoreDeps),
    readLiveSettings: () => settings,
    summarizeSettings: (next) => summarizeSettingsForDiagnostics(next),
    shouldBlockFromForegroundApp: () => shouldBlockAssistantInputFromForegroundAppService(),
    primeSelectionSnapshot: () => {
      void primeSelectionSnapshotForCommandMode();
    },
    clearPushToTalkHolds: () => clearPushToTalkHoldsService(),
    showMissingApiKeyNotice: (source) => showMissingApiKeyNotice(source),
    setNotice: (message, isError) => setNoticeService(message, isError),
    log: (message) => logClientEventService(message),
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
    runPipeline: (blob, mimeType) => runPipelineService(blob, mimeType),
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
initPipelineClient(
  { localSttModelInput, localSttModelCatalogSelect },
  {
    readSettings: () => readSettingsFromFormService(settingsFormRefs, settingsCoreDeps),
    getStage: () => stage,
    markIdle: (detail) => setStage("idle", detail),
    transition: (event) => {
      transitionRecordingState(event);
    },
    syncAvailability: () => syncActionAvailability(),
    setPipelineRunning: (running) => {
      pipelineRunning = running;
    },
    notify: (message, isError) => setNoticeService(message, isError),
    log: (message) => logClientEventService(message),
    getLocalSttCatalog: () => localSttModelCatalog,
    commitFormSettings: () => {
      void handleSettingsChange();
    },
    checkModelFileExists: (model) => checkModelFileExistsService(model),
    localSttModelLabel: (model) => localSttModelLabelService(model),
    refreshLocalSttRuntimeState: (options) => refreshLocalSttRuntimeStateService(options),
    warmupActiveLocalSttModel: (options) => warmupActiveLocalSttModelService(options),
    isSelectedLocalSttModelLoaded: () => isSelectedLocalSttModelLoadedService(),
    getLocalSttRuntimeLoaded: () => localSttRuntimeLoaded,
    getLastWarmedLocalSttModel: () => lastWarmedLocalSttModel,
    setLastWarmedLocalSttModel: (model) => {
      lastWarmedLocalSttModel = model;
    },
    ensureLocalOllamaModelSelected: (options) => ensureLocalOllamaModelSelectedService(options),
    getDictionaryTerms: () => getDictionaryTermsService(),
    getSnippets: () => getSnippetsService(),
    nextSelectionPopupToken: () => nextSelectionPopupTokenService(),
    dismissSelectionPopup: () => dismissSelectionPopupService(),
    showSelectionAssistantPopup: (payload) => showSelectionAssistantPopupService(payload),
    triggerAutoPaste: (text) => triggerAutoPasteService(text),
    copyToClipboard: (text) => copyToClipboardService(text),
    openSettings: (reason) => openSettings(reason),
    setActiveSettingsPane: (pane, reason) => setActiveSettingsPane(pane, reason),
    refreshAssistantInfo: () => refreshAssistantInfoSafely(),
  },
);
initLocalSttState({
  readSettings: () => readSettingsFromFormService(settingsFormRefs, settingsCoreDeps),
  getCatalogSelection: () => localSttModelCatalogSelect.value,
  isPipelineRunning: () => pipelineRunning,
  getStage: () => stage,
  renderSidebarToggle: () => renderSidebarLocalSttToggleService(),
  renderSettingsStatus: () => renderLocalSttSettingsStatusService(),
});
initLocalSttDiagnostics({
  readSettings: () => readSettingsFromFormService(settingsFormRefs, settingsCoreDeps),
  commitSettings: (next) => {
    applySettingsToFormService(settingsFormRefs, settingsCoreDeps, next);
    persistSettings(next);
  },
  notify: (message, isError) => setNoticeService(message, isError),
  openSettings: (reason) => openSettings(reason),
  setActiveSettingsPane: (pane, reason) => setActiveSettingsPane(pane, reason),
  openInSystemBrowser: (url) => openInSystemBrowser(url),
  activateSelectedLocalSttModel: () => {
    void activateSelectedLocalSttModelService();
  },
});
initForegroundPolicy({
  isTauri: isTauriEnvironment,
  notify: (message, isError) => setNoticeService(message, isError),
  clearPushToTalkHolds: () => clearPushToTalkHoldsService(),
  syncGlobalShortcuts: (force) => syncGlobalShortcutsService(force),
  requestGlobalShortcutSync: (force) => requestGlobalShortcutSyncService(force),
  isShortcutSuppressionActive: () => isShortcutSuppressionActive(),
  setShortcutSuppressionActive: (active) => setShortcutSuppressionActive(active),
  now: () => Date.now(),
});
initTrayLifecycle({
  isTauri: isTauriEnvironment,
  isTtsSetupRunning: () => ttsSetupRunning,
  isLocalSttDownloadActive: () => localSttDownloadActive,
  stopTtsSetupPolling: () => stopTtsSetupPollingService(),
  startTtsSetupPolling: () => startTtsSetupPollingService(),
  pollTtsSetupStatusOnce: () => pollTtsSetupStatusOnceService(),
  stopLocalSttDownloadStatusPolling: () => stopLocalSttDownloadStatusPollingService(),
  startLocalSttDownloadStatusPolling: () => startLocalSttDownloadStatusPollingService(),
  pollLocalSttDownloadStatusOnce: (options) => pollLocalSttDownloadStatusOnceService(options),
  hideLocalSttLoadOverlay: () => hideLocalSttLoadOverlayService(),
  closeSelectionAssistantWindow: () => closeSelectionAssistantWindowForTrayService(),
  syncFloatingIndicatorWindow: () => syncFloatingIndicatorWindowService(),
  setMainWindowHiddenToTray: (hidden) => {
    mainWindowHiddenToTray = hidden;
  },
  visibilityEvent: MAIN_WINDOW_VISIBILITY_EVENT,
});
initDock(
  {
    getStage: () => stage,
    getShowFlowBar: () => settings.showFlowBar,
    getShowDockAlways: () => settings.showDockAlways,
    getThemeMode: () => settings.themeMode,
    getCaptureMode: () => settings.captureMode,
    getHotkeyDisplay: () => cachedHotkeyDisplay,
    isCommandModeArmed: () => isCommandModeArmed(),
    isGlobalShortcutsActive: () => isGlobalShortcutsActive(),
    isMainWindowHiddenToTray: () => mainWindowHiddenToTray,
    getAmplitude: () => dockAmplitude,
    isTauri: isTauriEnvironment,
    notify: (message, isError) => setNoticeService(message, isError),
    log: (message) => logClientEventService(message),
    getWindow: () => voiceIndicatorWindow,
    setWindow: (win) => {
      voiceIndicatorWindow = win;
    },
    getHideTimerId: () => dockHideTimerId,
    setHideTimerId: (id) => {
      dockHideTimerId = id;
    },
    getRuntimeErrorShown: () => dockRuntimeErrorShown,
    setRuntimeErrorShown: (shown) => {
      dockRuntimeErrorShown = shown;
    },
    persistDockPosition: (win) => persistDockPositionFromWindowService(win),
    persistLayout: (x, y) => updateAndPersistDockLayoutService(x, y),
    resolveStartPosition: (w, h) => resolveDockStartPositionService(w, h),
    canPreWarmMicrophone: () => canPreWarmMicrophoneService(),
    preWarmMicrophoneStream: (deviceId) => {
      void preWarmMicrophoneStreamService(deviceId);
    },
    getMicrophoneDeviceId: () => settings.microphoneDeviceId,
    handleDockMicToggle: () => {
      void handleDockMicToggleService();
    },
    systemThemeMatchesLight: () => systemThemeMediaQuery?.matches ?? false,
  },
  dockChannel,
);
initDockGeometry({
  getPersistedLayout: () => dockLayout,
});

initSelectionPopup(
  {
    isTauri: isTauriEnvironment,
    notify: (message, isError) => setNoticeService(message, isError),
    log: (message) => logClientEventService(message),
    copyResult: (text) => {
      void copyToClipboardService(text, {
        successMessage: "Selection result copied to clipboard.",
        errorMessage: "Unable to copy selection result.",
      });
    },
    replaceSelection: (text) => triggerAutoPasteService(text),
    getWindow: () => selectionAssistantWindow,
    setWindow: (win) => {
      selectionAssistantWindow = win;
    },
    getLatestPayload: () => latestSelectionPopupPayload,
    setLatestPayload: (payload) => {
      latestSelectionPopupPayload = payload;
    },
    nextToken: () => {
      selectionPopupTokenCounter += 1;
      return selectionPopupTokenCounter;
    },
  },
  selectionPopupChannel,
);
initLocalSttClient(
  {
    sidebarToggleBtn: sidebarToggleLocalSttBtn,
    sidebarToggleGlyph: sidebarToggleLocalSttGlyph,
    sidebarToggleLabel: sidebarToggleLocalSttLabel,
    loadOverlay: sttLoadOverlay,
    loadModel: sttLoadModel,
    loadDetail: sttLoadDetail,
    modelInput: localSttModelInput,
    modelCatalogSelect: localSttModelCatalogSelect,
    statusBadge: localSttStatusBadge,
    statusDetail: localSttStatusDetail,
    downloadNotice: localSttDownloadNotice,
    downloadProgressBar: localSttDownloadProgressBar,
    downloadProgressText: localSttDownloadProgressText,
    downloadBtn: downloadLocalSttModelBtn,
    deleteBtn: deleteLocalSttModelBtn,
    openPathBtn: openLocalSttModelPathBtn,
    hardwareAdvisorOverlay: sttHardwareAdvisorOverlay,
    hardwareAdvisorUseSuggestionBtn: sttHardwareAdvisorUseSuggestionBtn,
    hardwareAdvisorContinueBtn: sttHardwareAdvisorContinueBtn,
    hardwareAdvisorCancelBtn: sttHardwareAdvisorCancelBtn,
  },
  {
    readSettings: () => readSettingsFromFormService(settingsFormRefs, settingsCoreDeps),
    commitFormSettings: () => {
      void handleSettingsChange();
    },
    getCatalog: () => localSttModelCatalog,
    isPipelineRunning: () => pipelineRunning,
    getStage: () => stage,
    setStage: (next, detail) => setStage(next, detail),
    notify: (message, isError) => setNoticeService(message, isError),
    log: (message) => logClientEventService(message),
    syncAvailability: () => syncActionAvailability(),
    openSettings: (reason) => openSettings(reason),
    setActiveSettingsPane: (pane, reason) => setActiveSettingsPane(pane, reason),
    refreshAssistantInfo: () => refreshAssistantInfoSafely(),
    renderFetchedCatalog: (models, selected) => renderLocalSttModelCatalogService(models, selected),
    checkModelFileExists: (model) => checkModelFileExistsService(model),
    checkPythonDependencies: (model) => checkPythonDependenciesService(model),
    checkAvailableMemory: (model) => checkAvailableMemoryService(model),
    showOfflineModeDiagnostic: (issue, details) => showOfflineModeDiagnosticService(issue, details),
    ensureSelectedLocalSttModelForWarmup: () => ensureSelectedLocalSttModelService({ quiet: true }),
    isSettingsOpen: () => isSettingsOpen(),
  },
);
initDiagnostics(noticeText, { isTauri: isTauriEnvironment });
initAssistantInfo(
  {
    settingsVersionText,
    updateCurrentVersion,
    baseUrlValue,
    sttModelValue,
    aiModelValue,
    piperStatusValue,
    piperPathValue,
    voiceStatusValue,
    voicePathValue,
  },
  {
    getSttRuntimeMode: () => settings.sttRuntimeMode,
    getAiRuntimeMode: () => settings.aiRuntimeMode,
    getLocalOllamaBaseUrl: () => settings.localOllamaBaseUrl,
    getApiBaseUrl: () => settings.apiBaseUrl,
    getLocalSttModel: () => settings.localSttModel,
    getSttModelName: () => settings.sttModelName,
    getLocalOllamaModel: () => settings.localOllamaModel,
    getAiModelName: () => settings.aiModelName,
    getFormRefs: () => settingsFormRefs,
    setLatestDefaults: (info) => {
      latestAssistantInfoDefaults = info;
    },
    setPiperRuntimeReady: (ready) => {
      piperRuntimeReady = ready;
    },
    updateTtsSetupGate: () => updateTtsSetupGate(),
  },
);
initClipboard({
  isTauri: isTauriEnvironment,
  notify: (message, isError) => setNoticeService(message, isError),
});

initCollectionsView(
  {
    dictionaryList,
    dictionaryFormCard,
    dictionaryCount,
    dictionarySourceInput,
    dictionaryTargetInput,
    dictionaryAddBtnTop,
    snippetsList,
    snippetFormContainer,
    snippetTriggerInput,
    snippetExpansionInput,
    snippetsAddBtnTop,
    notesList,
  },
  {
    isIncognito: () => settings.incognitoMode,
    notify: (message, isError) => setNoticeService(message, isError),
    formatNoteTime: (createdAt) => NOTE_TIME_FORMATTER.format(createdAt),
  },
);

initDesktopNotice({
  setNotice: (message, isError) => setNoticeService(message, isError),
  log: (message) => logClientEventService(message),
  transition: (event) => {
    transitionRecordingState(event);
  },
});
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
      void primeCaptureReadinessService(deviceId, showFlowBar);
    },
    notify: (message, isError) => setNoticeService(message, isError),
  },
);
const soundDeps = {
  currentSettings: getSettingsSnapshot,
  previewVolume: () => Number(settingsFormRefs.pushToTalkSoundVolumeRange.value),
};
const mediaControlDeps = {
  isMutingEnabled: () => settings.muteMusicWhileDictating,
  isTauri: isTauriEnvironment,
  notify: (message: string, isError?: boolean) => setNoticeService(message, isError),
};
initRecordings(
  {
    clearButton: settingsFormRefs.clearRecordingsBtn,
    storageHint: settingsFormRefs.recordingsStorageHint,
    storageHintWeb: settingsFormRefs.recordingsStorageHintWeb,
  },
  {
    isTauri: isTauriEnvironment,
    notify: (message, isError) => setNoticeService(message, isError),
    log: (message) => logClientEventService(message),
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
initUpdaterFlow(
  {
    checkUpdatesBtn,
    installUpdateBtn,
    skipUpdateVersionBtn,
    snoozeUpdateBtn,
  },
  {
    isTauri: isTauriEnvironment,
    notify: (message, isError) => setNoticeService(message, isError),
    log: (message) => logClientEventService(message),
    openUpdateSettings: (reason) => {
      openSettings(reason);
      setActiveSettingsPane("update-security", reason);
    },
    confirmInstall: (version) =>
      confirmDestructiveAction(
        `Install ${version} now? The installer will download, this app will close, and any unsaved work in the current session may be lost.`,
      ),
    getNotificationPermissionRequested: () => isNotificationPermissionRequested(),
    setNotificationPermissionRequested: (requested) => {
      setNotificationPermissionRequested(requested);
    },
  },
);
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
    readSettings: () => readSettingsFromFormService(settingsFormRefs, settingsCoreDeps),
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
    renderProviderCatalog: (models, selected) => renderProviderModelCatalogService(models, selected),
    renderOllamaCatalog: (models, selected) => renderLocalOllamaModelCatalogService(models, selected),
    renderStatus: (status) => renderOllamaStatusService(status),
    setNotice: (message, isError) => setNoticeService(message, isError),
    setStage: (next, detail) => setStage(next, detail),
    syncAvailability: () => syncActionAvailability(),
    openModelsPane: () => setActiveSettingsPane("models"),
  },
);
let ollamaStatusBusy = false;
let ollamaInstallBusy = false;
let ollamaPullBusy = false;
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
    readSettings: () => readSettingsFromFormService(settingsFormRefs, settingsCoreDeps),
    getPiperPathInput: () => settingsFormRefs.piperPathInput.value,
    setPiperPathInput: (value) => {
      settingsFormRefs.piperPathInput.value = value;
    },
    commitSettings: () => {
      void handleSettingsChange();
    },
    setNotice: (message, isError) => setNoticeService(message, isError),
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
let cachedHotkeyDisplay = formatHotkeyForDisplay(settings.pushToTalkHotkey);
applySettingsToFormService(settingsFormRefs, settingsCoreDeps, settings);
renderSidebarLocalSttToggleService();
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
renderProviderModelCatalogService([], settings.aiModelName || settings.sttModelName);
renderLocalOllamaModelCatalogService([], settings.localOllamaModel);
renderLocalSttModelCatalogService([], settings.localSttModel);
setActiveTtsProfile("piper");
updateTtsSetupGate();
persistDictionaryTermsService();
persistSnippetsService();
persistQuickNotesService();
persistUsageStatsService();

if (systemThemeMediaQuery) {
  const handleSystemThemeChange = (): void => {
    if (settings.themeMode === "system") {
      publishDockStateService();
    }
  };

  systemThemeMediaQuery.addEventListener("change", handleSystemThemeChange);
}

setActivePage(activePage);
setActiveSettingsPane(activeSettingsPane);
renderDictionaryListService();
renderSnippetsListService();
renderNotesListService();
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
updateUsageMetricsService();
refreshRecordButton();
syncActionAvailability();
initializeUpdaterPanelService();
void registerUpdateInstallProgressListenerService();
setupCustomWindowControls();
void initializeTrayBackgroundLifecycleService();
hotkeyInput.readOnly = true;
commandHotkeyInput.readOnly = true;
requestLaunchAtLoginSync(settings.launchAtLogin);
void reconcileLaunchAtLoginWithOs();
startBlockedAppShortcutSuppressionMonitorService();
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

checkUpdatesBtn.addEventListener("click", () => {
  void handleCheckForUpdatesService();
});

markPaneConverted("update-security");
window.addEventListener(APP_UPDATE_AUTO_CHECK_CHANGED_EVENT, (event) => {
  const enabled = (event as CustomEvent<boolean>).detail;
  autoCheckUpdatesToggle.checked = enabled;
  localStorage.setItem(
    APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY,
    enabled ? "1" : "0",
  );
  startAutomaticUpdateChecksService();
  setNoticeService(
    enabled
      ? "Automatic update checks enabled."
      : "Automatic update checks disabled.",
  );
});

installUpdateBtn.addEventListener("click", () => {
  void handleInstallUpdateService();
});

skipUpdateVersionBtn.addEventListener("click", () => {
  const latestVersion = getCachedUpdateResult()?.latestVersion;
  if (latestVersion) {
    localStorage.setItem(APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY, latestVersion);
    setNoticeService(`Version ${latestVersion} will be skipped. You won't be notified about this version again.`);
    syncUpdaterButtonsService();
  }
});

snoozeUpdateBtn.addEventListener("click", () => {
  snoozeUpdateFor24Hours();
  setNoticeService("Update notifications snoozed for 24 hours.");
  syncUpdaterButtonsService();
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





document.addEventListener("keydown", (event) => {
  if (isHotkeyCaptureActive()) {
    handleHotkeyCaptureKeydown(event);
    return;
  }
  if (isCommandHotkeyCaptureActive()) {
    handleCommandHotkeyCaptureKeydown(event);
    return;
  }

  if (event.key === "Escape" && handleLocalSttAdvisorEscape()) {
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
    logClientEventService(
      `[hotkey.local.command] keydown shortcut=${commandShortcutToken} repeat=${boolFlag(
        event.repeat,
      )}`,
    );
    if (shouldBypassLocalShortcutHandlingService(commandShortcutToken)) {
      return;
    }
    if (shouldIgnoreLocalShortcutFromRecentGlobalService(commandShortcutToken, "pressed")) {
      return;
    }
    if (event.repeat) {
      logClientEventService("[hotkey.local.command] ignored repeated keydown");
      return;
    }
    event.preventDefault();
    void (async () => {
      if (await shouldBlockAssistantInputFromForegroundAppService()) {
        logClientEventService("[hotkey.local.command] blocked by foreground app policy");
        return;
      }
      toggleCommandModeArmed();
      logClientEventService(`[hotkey.local.command] toggled commandModeArmed=${boolFlag(isCommandModeArmed())}`);
    })();
    return;
  }

  const parsed = parseHotkey(settings.pushToTalkHotkey);
  if (!parsed || !matchesHotkey(event, parsed)) {
    return;
  }
  const pushShortcutToken = normalizeShortcutToken(toGlobalShortcutString(parsed));
  logClientEventService(
    `[hotkey.local.push] keydown shortcut=${pushShortcutToken} capture=${settings.captureMode} repeat=${boolFlag(
      event.repeat,
    )}`,
  );
  if (shouldBypassLocalShortcutHandlingService(pushShortcutToken)) {
    return;
  }
  if (shouldIgnoreLocalShortcutFromRecentGlobalService(pushShortcutToken, "pressed")) {
    return;
  }

  if (settings.captureMode === "push-to-talk") {
    if (event.repeat) {
      logClientEventService("[hotkey.local.push] ignored repeated keydown in push-to-talk mode");
      return;
    }

    event.preventDefault();
    void engagePushToTalkService("hotkey");
    return;
  }

  if (event.repeat) {
    logClientEventService("[hotkey.local.push] ignored repeated keydown in single-tap mode");
    return;
  }

  event.preventDefault();
  void handleRecordToggleService();
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
  if (!parsed || !isHotkeyReleaseEventService(event, parsed)) {
    return;
  }
  const pushShortcutToken = normalizeShortcutToken(toGlobalShortcutString(parsed));
  logClientEventService(
    `[hotkey.local.push] keyup shortcut=${pushShortcutToken} capture=${settings.captureMode}`,
  );
  if (shouldBypassLocalShortcutHandlingService(pushShortcutToken)) {
    return;
  }
  if (shouldIgnoreLocalShortcutFromRecentGlobalService(pushShortcutToken, "released")) {
    return;
  }

  event.preventDefault();
  releasePushToTalkService("hotkey");
});

window.addEventListener("blur", () => {
  if (settings.captureMode !== "push-to-talk") {
    return;
  }

  if (getPushToTalkHoldCount() === 0) {
    return;
  }

  logClientEventService(
    `[record.ptt.blur] clearing holds=${getPushToTalkHoldCount()} stage=${stage}`,
  );
  clearPushToTalkHoldsService();
  if (stage === "recording") {
    logClientEventService("[record.ptt.blur] window blurred during recording -> stopRecording()");
    stopRecordingService();
  }
});

window.addEventListener("focus", () => {
  if (!isGlobalShortcutsActive() && !isAnyHotkeyCaptureActive()) {
    requestGlobalShortcutSyncService();
  }
});

window.addEventListener("beforeunload", () => {
  stopTtsSetupPollingService();
  stopLocalSttDownloadStatusPollingService();
  if (dockHideTimerId !== null) {
    window.clearTimeout(dockHideTimerId);
    dockHideTimerId = null;
  }
  flushPendingSettings();
  stopForegroundMonitorForShutdown();
  if (isExternalMediaMutedForDictation()) {
    resumeExternalMediaAfterDictationService({
      ...mediaControlDeps,
      notify: () => {},
    });
    setExternalMediaMutedForDictation(false);
  }
  void persistDockPositionFromWindowService(voiceIndicatorWindow);
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
    notify: (message, isError) => setNoticeService(message, isError),
    onCommitted: () => {
      void handleSettingsChange();
    },
  },
);

initHotkeySync({
  isTauri: isTauriEnvironment,
  getSettings: getSettingsSnapshot,
  notify: (message, isError) => setNoticeService(message, isError),
  log: (message) => logClientEventService(message),
  publishDockState: () => publishDockStateService(),
  onShortcutEvent: (event) => handleGlobalShortcutEvent(event),
});
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
  playDictationSoundEffectService(soundDeps, "start", pushToTalkSoundSelect.value);
});
previewPttEndSoundBtn.addEventListener("click", () => {
  playDictationSoundEffectService(soundDeps, "stop", pushToTalkEndSoundSelect.value);
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
    markCatalogSelectionCleared();
    return;
  }
  localSttModelInput.value = selected;
  markCatalogSelectionChanged();
  handleSettingsChange();
  void refreshSelectedLocalSttModelAvailabilityService({ quiet: true });
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
  addDictionaryTermService();
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
  addSnippetEntryService();
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
    setNoticeService("Hold the note button while speaking in push-to-talk mode.");
    return;
  }

  void handleRecordToggleService();
});

bindPushToTalkPointerHoldService(notesQuickMicBtn, "notes-button");
bindPushToTalkKeyboardHoldService(notesQuickMicBtn, "notes-button");

refreshMicsBtn.addEventListener("click", () => {
  void refreshMicrophonesService(true);
});








applyModelToAiBtn.addEventListener("click", () => {
  const selected = providerModelCatalogSelect.value.trim();
  if (!selected) {
    setNoticeService("Select a model from catalog first.", true);
    return;
  }
  settingsFormRefs.aiModelInput.value = selected;
  handleSettingsChange();
  setNoticeService(`AI model set to "${selected}".`);
});

applyModelToSttBtn.addEventListener("click", () => {
  const selected = providerModelCatalogSelect.value.trim();
  if (!selected) {
    setNoticeService("Select a model from catalog first.", true);
    return;
  }
  settingsFormRefs.sttModelInput.value = selected;
  handleSettingsChange();
  setNoticeService(`STT model set to "${selected}".`);
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


const datePickerBtn = requiredElement<HTMLElement>("#datePickerBtn");
const customDatePicker = requiredElement<HTMLDivElement>("#customDatePicker");
const datePickerDays = requiredElement<HTMLDivElement>("#datePickerDays");
const currentMonthYear = requiredElement<HTMLElement>("#currentMonthYear");
const prevMonthBtn = requiredElement<HTMLElement>("#prevMonthBtn");
const nextMonthBtn = requiredElement<HTMLElement>("#nextMonthBtn");
initHistoryView(
  {
    datePickerBtn,
    customDatePicker,
    datePickerDays,
    currentMonthYear,
    prevMonthBtn,
    nextMonthBtn,
    clearHistoryBtn,
    clearHistoryBtnFull,
    viewFullHistoryBtn,
    clearStatsBtn,
  },
  {
    notify: (message, isError) => setNoticeService(message, isError),
    getHomeHistory: () => homeHistoryEntries,
    setHomeHistory: (entries) => {
      homeHistoryEntries = entries;
    },
    persistHomeHistory: () => persistHomeHistoryService(),
    notifyStoreUpdated: () => {
      window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
    },
    clearRecentTurns: () => {
      recentTurns.length = 0;
    },
    resetUsageStats: () => {
      usageStats = { sessions: 0, words: 0, avgWpm: 0, speakingSeconds: 0, prevSessions: 0, prevWords: 0, prevWpm: 0, prevSpeakingSeconds: 0, lastPeriodReset: Date.now() };
      persistUsageStatsService();
      analyticsSessionDetails = [];
      persistAnalyticsSessionDetailsService();
      achievementStates = [];
      persistAchievementStatesService();
    },
    renderMetrics: () => updateUsageMetricsService(),
    setActivePage: (page) => setActivePage(page),
  },
);







navigator.mediaDevices?.addEventListener?.("devicechange", () => {
  void refreshMicrophonesService(false);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    void releasePreWarmedStreamService();
  } else if (stage === "idle") {
    void preWarmMicrophoneStreamService(settings.microphoneDeviceId);
  }
});

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
  persistStats: () => persistUsageStatsService(),
  persistSessions: () => persistAnalyticsSessionDetailsService(),
  persistAchievements: () => persistAchievementStatesService(),
  renderMetrics: () => updateUsageMetricsService(),
  notifyStoreUpdated: () => {
    window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
  },
});
async function bootstrap(): Promise<void> {
  logClientEventService("[bootstrap] start");
  await hydrateSettingsFromNativeStorage();
  logClientEventService(`[bootstrap] settings after hydrate ${summarizeSettingsForDiagnostics(settings)}`);

  // Register global hotkeys immediately — user should be able to press the
  // hotkey as soon as settings are loaded, without waiting for the rest of
  // the heavy bootstrap chain (Ollama, STT, TTS, model lists, etc.).
  requestGlobalShortcutSyncService(true);

  void backfillHistoryRecordingIds();
  setStage("idle", "Loading assistant metadata...");

  try {
    const info = await ipcGetAssistantInfo();
    renderAssistantInfoService(info);

    if (info.piperInstalled && info.voiceInstalled) {
      setNoticeService("Piper runtime is ready.");
      setStage("idle", "Ready for voice input.");
    } else {
      setNoticeService("Piper runtime incomplete. Open Settings > Models and complete runtime setup.");
      setStage("idle", "Setup required.");
    }
  } catch (error) {
    const message = asErrorMessage(error);
    setNoticeService(`Failed to load assistant metadata: ${message}`, true);
    setStage("error", "Metadata load failed.");
  }

  await refreshMicrophonesService(false);
  if (stage === "idle") {
    void primeCaptureReadinessService(settings.microphoneDeviceId, settings.showFlowBar);
  }
  await refreshOllamaStatusService({ quiet: true });
  await fetchOllamaModelsService({ quiet: true, autoSelect: true });
  await fetchLocalSttModelsService({ quiet: true, autoSelect: true });
  await refreshSelectedLocalSttModelAvailabilityService({ quiet: true });
  await pollLocalSttDownloadStatusOnceService({ quiet: true });
  try {
    await syncLocalSttRuntimeForModeService(settings.sttRuntimeMode);
  } catch (error) {
    setNoticeService(`Unable to initialize local STT runtime: ${asErrorMessage(error)}`, true);
  }
  try {
    await pollTtsSetupStatusOnceService();
  } catch {
    // Ignore bootstrap poll failures and continue normal app startup.
  }
  syncActionAvailability();
  startAutomaticUpdateChecksService();
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
  logClientEventService("[bootstrap] completed");
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
  logClientEventService(
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
  logClientEventService(`[ui.settings.open] reason=${reason}`);
  if (settingsCloseTimer !== null) {
    window.clearTimeout(settingsCloseTimer);
    settingsCloseTimer = null;
  }
  settingsOverlay.hidden = false;
  settingsOverlay.classList.remove("is-closing");
  void settingsOverlay.offsetWidth;
  settingsOverlay.classList.add("is-open");
  notifySettingsOverlayVisibilityChanged();
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
  notifySettingsOverlayVisibilityChanged();
}

function isSettingsOpen(): boolean {
  return !settingsOverlay.hidden && settingsOverlay.classList.contains("is-open");
}

async function hydrateSettingsFromNativeStorage(): Promise<void> {
  const hydrated = await hydrateSettingsFromNativeStorageService({
    isTauri: isTauriEnvironment,
    loadNative: () => ipcLoadPersistedLocalSettings(),
    log: (message) => logClientEventService(message),
    warn: (message) => console.warn(message),
    applyAll: (next) => {
      settings = next;
      applySettingsToFormService(settingsFormRefs, settingsCoreDeps, next);
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
      persistHomeHistoryService();
      window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
      logClientEventService(`[recordings.backfill] attached=${patched} of ${matches.length}`);
    }
  } catch (error) {
    logClientEventService(`[recordings.backfill] failed: ${asErrorMessage(error)}`);
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
    logClientEventService(
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
      renderAssistantInfoService(assistantInfo as AssistantInfoResponse);
    }
  },
  clearCaptureHolds: () => clearPushToTalkHoldsService(),
  notifyIncognitoChanged: () => {
    // Notify React to re-render with updated incognito state from localStorage.
    window.dispatchEvent(new CustomEvent("slasshy:store-updated"));
  },
  syncExternalMediaMute: (muted) => {
    if (muted) {
      pauseExternalMediaForDictationService(mediaControlDeps);
    } else {
      resumeExternalMediaAfterDictationService(mediaControlDeps);
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
    renderSidebarLocalSttToggleService();
    refreshRecordButton();
    syncActionAvailability();
    updateMicrophoneSummaryService();
    renderNotesListService();
    const nextShortcutSignature = buildShortcutSyncSignature(next);
    if (previousShortcutSignature !== nextShortcutSignature) {
      requestGlobalShortcutSyncService();
    }
    if (previousLaunchAtLogin !== next.launchAtLogin) {
      requestLaunchAtLoginSync(next.launchAtLogin);
    }
    if (previousTtsEngine !== next.ttsEngine) {
      interruptTtsPlaybackService();
    }
    const sttRuntimeModeChanged = previousSttRuntimeMode !== next.sttRuntimeMode;
    const aiRuntimeModeChanged = previousAiRuntimeMode !== next.aiRuntimeMode;
    if (sttRuntimeModeChanged || aiRuntimeModeChanged) {
      if (next.sttRuntimeMode === next.aiRuntimeMode) {
        setNoticeService(
          next.sttRuntimeMode === "local"
            ? "Offline mode enabled for both STT and AI."
            : "Online mode enabled for both STT and AI.",
        );
      } else {
        setNoticeService(
          `Hybrid mode enabled (STT: ${next.sttRuntimeMode}, AI: ${next.aiRuntimeMode}).`,
        );
      }
    }
    if (sttRuntimeModeChanged) {
      requestLocalSttRuntimeSyncForModeService(next.sttRuntimeMode, {
        showLoadOverlay: next.sttRuntimeMode === "local",
      });
    }
    updateTtsSetupGate();
    publishDockStateService();
    void syncFloatingIndicatorWindowService();
    if (
      stageAtChange === "idle" &&
      (previousMicrophoneDeviceId !== next.microphoneDeviceId ||
        (!previousShowFlowBar && next.showFlowBar))
    ) {
      void primeCaptureReadinessService(next.microphoneDeviceId, next.showFlowBar);
    }
  },
};


function isTauriEnvironment(): boolean {
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

function openInSystemBrowser(url: string): void {
  void openExternalUrl(url).catch((error: unknown) => {
    setNoticeService(`Failed to open link: ${asErrorMessage(error)}`, true);
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
      setNoticeService(`Minimize failed: ${asErrorMessage(error)}`, true);
    });
  });

  windowCloseBtn.addEventListener("click", () => {
    void appWindow.close().catch((error) => {
      setNoticeService(`Close failed: ${asErrorMessage(error)}`, true);
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
    setNoticeService(`Launch-at-login update failed: ${asErrorMessage(error)}`, true);
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
      logClientEventService(
        `[startup] launch-at-login registry stale — reapplying wanted=${wanted} stored=${
          status.stored_value ?? "<missing>"
        }`,
      );
      requestLaunchAtLoginSync(true);
    } else if (!wanted && status.enabled) {
      logClientEventService(
        `[startup] launch-at-login registry still enabled despite preference=false; cleaning up`,
      );
      requestLaunchAtLoginSync(false);
    }
  } catch (error) {
    logClientEventService(`[startup] launch-at-login reconcile skipped: ${asErrorMessage(error)}`);
  }
}

function handleGlobalShortcutEvent(event: ShortcutEvent): void {
  logClientEventService(
    `[hotkey.global.event] shortcut=${event.shortcut || "-"} state=${String(
      (event as { state?: unknown }).state ?? "",
    )}`,
  );
  if (isAnyHotkeyCaptureActive()) {
    logClientEventService("[hotkey.global.event] ignored because hotkey capture UI is active");
    return;
  }

  const rawState = String((event as { state?: unknown }).state ?? "")
    .trim()
    .toLowerCase();
  const pressed = rawState === "pressed";
  const released = rawState === "released";
  if (!pressed && !released) {
    logClientEventService(`[hotkey.global.event] ignored because state="${rawState}" is unsupported`);
    return;
  }

  const shortcut = normalizeShortcutToken(event.shortcut);
  const { push: pushShortcut, command: commandShortcut } = getNormalizedRegisteredShortcuts();
  logClientEventService(
    `[hotkey.global.event] normalized shortcut=${shortcut || "-"} push=${
      pushShortcut || "-"
    } command=${commandShortcut || "-"} capture=${settings.captureMode}`,
  );

  if (pushShortcut && shortcut === pushShortcut) {
    if (pressed) {
      markGlobalShortcutHandledService(shortcut, "pressed");
      logClientEventService(
        `[hotkey.global.push] pressed capture=${settings.captureMode} holdCount=${getPushToTalkHoldCount()}`,
      );
      const activeSettings = readSettingsFromFormService(settingsFormRefs, settingsCoreDeps);
      if (missingApiKeyForOnlineRuntime(activeSettings)) {
        logClientEventService(
          "[hotkey.global.push] blocked before reveal because API key is missing for online runtime",
        );
        showMissingApiKeyNotice("global-hotkey");
        return;
      }
      if (settings.captureMode === "push-to-talk") {
        if (hasPushToTalkHold("hotkey")) {
          logClientEventService("[hotkey.global.push] ignored repeated press because hold is already active");
          return;
        }
        void engagePushToTalkService("hotkey");
      } else {
        void handleRecordToggleService();
      }
    }
    if (released && (settings.captureMode === "push-to-talk" || hasPushToTalkHold("hotkey"))) {
      markGlobalShortcutHandledService(shortcut, "released");
      logClientEventService("[hotkey.global.push] released -> release push-to-talk hold");
      releasePushToTalkService("hotkey");
    }
    return;
  }

  if (
    commandShortcut &&
    shortcut === commandShortcut &&
    pressed
  ) {
    markGlobalShortcutHandledService(shortcut, "pressed");
    logClientEventService("[hotkey.global.command] pressed -> toggling command mode");
    void (async () => {
      if (await shouldBlockAssistantInputFromForegroundAppService()) {
        logClientEventService("[hotkey.global.command] blocked by foreground app policy");
        return;
      }
      toggleCommandModeArmed();
      logClientEventService(`[hotkey.global.command] toggled commandModeArmed=${boolFlag(isCommandModeArmed())}`);
    })();
    return;
  }

  logClientEventService("[hotkey.global.event] no handler matched the incoming shortcut");
}

function checkAndUnlockAchievements(stats: UsageStats): void {
  const unlocked = newlyUnlockedAchievements(stats, achievementStates, Date.now());
  if (unlocked.length > 0) {
    achievementStates.push(...unlocked);
    persistAchievementStatesService();
  }
}


async function refreshAssistantInfo(): Promise<void> {
  const info = await ipcGetAssistantInfo();
  renderAssistantInfoService(info);
  renderProviderModelCatalogService(providerModelCatalog, settings.aiModelName || settings.sttModelName);
  renderLocalOllamaModelCatalogService(localOllamaModelCatalog, settings.localOllamaModel);
  renderLocalSttModelCatalogService(localSttModelCatalog, settings.localSttModel);

  if (!settingsFormRefs.piperPathInput.value.trim() && info.piperPath) {
    settingsFormRefs.piperPathInput.value = info.piperPath;
    handleSettingsChange();
  }

}


function showMissingApiKeyNotice(source: string): void {
  showDesktopNotice(MISSING_API_KEY_MESSAGE, {
    failureReason: "Missing API key for online runtime.",
    logSource: source,
  });
}

function setStage(next: Stage, detail: string): void {
  const previousStage = stage;
  stage = next;
  statusPill.dataset.stage = next;
  statusPill.textContent = stageLabel(next);
  statusDetail.textContent = detail;
  refreshRecordButton();
  publishDockStateService();
  void syncFloatingIndicatorWindowService();

  if (previousStage !== "idle" && next === "idle") {
    void preWarmMicrophoneStreamService(settings.microphoneDeviceId);
  }

  if (previousStage !== "recording" && next === "recording") {
    playDictationSoundEffectService(soundDeps, "start");
    if (settings.muteMusicWhileDictating) {
      pauseExternalMediaForDictationService(mediaControlDeps);
    }
    return;
  }

  if (previousStage === "recording" && next !== "recording") {
    playDictationSoundEffectService(soundDeps, "stop");
    if (isExternalMediaMutedForDictation()) {
      resumeExternalMediaAfterDictationService(mediaControlDeps);
    }
    return;
  }

  if (
    previousStage !== "error" &&
    next === "error" &&
    (pipelineRunning || previousStage === "recording" || previousStage === "speaking")
  ) {
    playDictationSoundEffectService(soundDeps, "error");
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
        clearPushToTalkHoldsService();
        break;
      case "reset-command-mode":
        resetCommandMode();
        break;
      case "set-notice":
        setNoticeService(action.message, action.isError);
        break;
      case "release-recorder":
        releaseMicrophoneService();
        break;
      case "clear-chunks":
        recordedChunks = [];
        break;
      case "stop-recording-ticker":
        stopRecordingTickerService();
        break;
      case "begin-recording-ticker":
        beginRecordingTickerService();
        break;
      case "set-recording-started-at":
        recordingStartedAt = action.timestamp;
        break;
      case "stop-amplitude-monitoring":
        stopAmplitudeMonitoringService();
        break;
      case "start-amplitude-monitoring":
        // amplitude monitoring is started with the stream, not via action
        break;
      case "pre-warm-microphone":
        void preWarmMicrophoneStreamService(settings.microphoneDeviceId);
        break;
      case "resume-external-media":
        if (isExternalMediaMutedForDictation()) {
          resumeExternalMediaAfterDictationService(mediaControlDeps);
        }
        break;
      case "publish-dock-state":
        publishDockStateService();
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

function syncActionAvailability(): void {
  const busy =
    pipelineRunning ||
    stage === "recording" ||
    ttsSetupRunning ||
    ollamaStatusBusy ||
    ollamaInstallBusy ||
    ollamaPullBusy ||
    isLocalSttHardwareAdvisorOpen();
  const localSttBusy = busy || isLocalSttBusyService();
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
  renderLocalSttSettingsStatusService();
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

// ============================================================================
// OFFLINE MODE DIAGNOSTICS - User-Friendly Error Handling
// ============================================================================

/**
 * Checks if a model file exists on disk
 */
/**
 * Checks if Python dependencies are installed
 */
/**
 * Checks available system memory
 */
/**
 * Shows a detailed diagnostic dialog when offline mode setup fails
 */
/**
 * Returns diagnostic data for specific offline mode issues
 */
async function refreshAssistantInfoSafely(): Promise<void> {
  try {
    await refreshAssistantInfo();
  } catch (error) {
    setNoticeService(`Unable to refresh runtime status: ${asErrorMessage(error)}`, true);
  }
}

void bootstrap();
