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
  getAssistantInfo as ipcGetAssistantInfo,
  loadPersistedLocalSettings as ipcLoadPersistedLocalSettings,
  maxTokensBounds as ipcMaxTokensBounds,
  sttTimeoutBounds as ipcSttTimeoutBounds,
  temperatureBounds as ipcTemperatureBounds,
  listDictationRecordingIds as ipcListDictationRecordingIds,
  notePasteTarget as ipcNotePasteTarget,
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
} from "@tauri-apps/plugin-global-shortcut";
import {
  asErrorMessage,
  confirmDestructiveAction,
  createId,
} from "./utils";
import { matchHistoryToRecordings } from "./store";
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
  flushPendingWrites as flushPendingWritesService,
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
  flushPendingSettings,
  persistSettings,
  readSettingsFromForm as readSettingsFromFormService,
  setPersistErrorReporter,
  summarizeSettingsForDiagnostics,
  wireSettingsFormInputs as wireSettingsFormInputsService,
} from "./settings/settings-service";
import { querySettingsFormRefs } from "./settings/settings-form-refs";
import { refreshSttTimeoutBounds } from "./settings/stt-timeout-bounds";
import {
  SETTINGS_PATCH_EVENT,
  initSettingsState,
  markPaneConverted,
  getSettingsSnapshot,
  setSettingsSnapshot,
} from "./settings/settings-state";
import {
  backfillAchievementsFromUsageStats as backfillAchievementsFromUsageStatsService,
  describeMaxTokensCorrection,
  describeSttTimeoutCorrection,
  describeTemperatureCorrection,
  getCachedHotkeyDisplay as getCachedHotkeyDisplayService,
  getSettingsCoreDeps as getSettingsCoreDepsService,
  handleSettingsChange as handleSettingsChangeService,
  hydrateSettingsFromNativeStorage as hydrateSettingsFromNativeStorageChangeService,
  initSettingsChange,
  reconcileMaxTokensWithBounds as reconcileMaxTokensWithBoundsService,
  reconcileSttTimeoutWithBounds as reconcileSttTimeoutWithBoundsService,
  reconcileTemperatureWithBounds as reconcileTemperatureWithBoundsService,
} from "./settings/settings-change";
import { refreshMaxTokensBounds as refreshMaxTokensBoundsService } from "./settings/max-tokens-bounds";
import { refreshTemperatureBounds as refreshTemperatureBoundsService } from "./settings/temperature-bounds";
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
import { initFileTranscription } from "./recording/file-transcription";
import {
  onTranscribeRequest,
  readAudioFile,
  takePendingFile,
} from "./shell/transcribe-requests";
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
  queueNotice as queueNoticeService,
  setNotice as setNoticeService,
} from "./shell/diagnostics";
import {
  initAssistantInfo,
  initAssistantStatus,
  refreshAssistantInfoSafely as refreshAssistantInfoSafelyService,
  renderAssistantInfo as renderAssistantInfoService,
} from "./shell/assistant-info";
import {
  initHistoryView,
} from "./history/history-view";
import {
  asMainPage as asMainPageService,
  asSettingsPane as asSettingsPaneService,
  closeSettings as closeSettingsService,
  getActivePage as getActivePageService,
  getActiveSettingsPane as getActiveSettingsPaneService,
  initNavigation,
  isSettingsOpen as isSettingsOpenService,
  openSettings as openSettingsService,
  setActivePage as setActivePageService,
  setActiveSettingsPane as setActiveSettingsPaneService,
  setActiveTtsProfile as setActiveTtsProfileService,
  updateTtsSetupGate as updateTtsSetupGateService,
} from "./shell/navigation";
import {
  initAvailability,
  syncActionAvailability as syncActionAvailabilityService,
} from "./shell/availability";
import {
  applyPersistedSidebarCollapsed as applyPersistedSidebarCollapsedService,
  initSidebar,
} from "./shell/sidebar";
import {
  describeLaunchAtLoginCorrection,
  describeShellIntegrationCorrection,
  isTauriEnvironment,
  openInSystemBrowser,
  setupCustomWindowControls,
  reconcileShellIntegrationWithOs,
  requestLaunchAtLoginSync,
  requestShellIntegrationSync,
  reconcileLaunchAtLoginWithOs,
  initTauriShell,
} from "./shell/tauri-shell";
import {
  initStageView,
  refreshRecordButton as refreshRecordButtonService,
  setStage as setStageService,
} from "./shell/stage-view";
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
  formatHotkeyForDisplay,
} from "./hotkeys/hotkey-service";
import {
  initHotkeyCapture,
  isAnyHotkeyCaptureActive,
  isCommandHotkeyCaptureActive,
  isHotkeyCaptureActive,
} from "./hotkeys/hotkey-capture";
import {
  drainPendingRemap as drainPendingRemapService,
  getNormalizedRegisteredShortcuts,
  initHotkeySync,
  isGlobalShortcutsActive,
  isShortcutSuppressionActive,
  markGlobalShortcutHandled as markGlobalShortcutHandledService,
  noteLocalShortcutPressed as noteLocalShortcutPressedService,
  requestGlobalShortcutSync as requestGlobalShortcutSyncService,
  setShortcutSuppressionActive,
  shouldBypassLocalShortcutHandling as shouldBypassLocalShortcutHandlingService,
  shouldIgnoreLocalShortcutFromRecentGlobal as shouldIgnoreLocalShortcutFromRecentGlobalService,
  syncGlobalShortcuts as syncGlobalShortcutsService,
} from "./hotkeys/hotkey-sync";
import {
  initLocalShortcuts,
  wireHotkeyInputButtons,
} from "./hotkeys/local-shortcuts";
import {
  handleGlobalShortcutEvent as handleGlobalShortcutEventService,
  initGlobalShortcutDispatch,
} from "./hotkeys/global-shortcut-dispatch";
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
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  APP_UPDATE_AUTO_CHECK_ENABLED_STORAGE_KEY,
  APP_UPDATE_LAST_NOTIFIED_VERSION_STORAGE_KEY,
  DEFAULT_HOTKEY,
  DEFAULT_COMMAND_HOTKEY,
} from "./constants";

import type {
  Stage,

  AssistantInfoResponse,
  PersistedSettings,
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

import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { App } from './App';

flushSync(() => {
  createRoot(appRoot).render(<App />);
});

const BASE_WINDOW_WIDTH = 780;
const BASE_WINDOW_HEIGHT = 600;
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
  document.querySelectorAll<HTMLElement>(".topbar [data-label]"),
);

const statusPill = requiredElement<HTMLDivElement>("#statusPill");
const statusDetail = requiredElement<HTMLParagraphElement>("#statusDetail");
const noticeStack = requiredElement<HTMLElement>("#noticeStack");
const metricWords = requiredElement<HTMLElement>("#metricWords");
const metricSpeakingTime = requiredElement<HTMLElement>("#metricSpeakingTime");
const metricSessions = requiredElement<HTMLElement>("#metricSessions");
const metricWpm = requiredElement<HTMLElement>("#metricWpm");
const wordsTrend = requiredElement<HTMLElement>("#wordsTrend");
const timeTrend = requiredElement<HTMLElement>("#timeTrend");
const sessionsTrend = requiredElement<HTMLElement>("#sessionsTrend");
const wpmTrend = requiredElement<HTMLElement>("#wpmTrend");

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
let dockRuntimeErrorShown = false;
let providerModelCatalog: string[] = [];
let localOllamaModelCatalog: string[] = [];
let localSttModelCatalog: string[] = [];
let latestAssistantInfoDefaults: AssistantInfoResponse | null = null;
let piperRuntimeReady = false;
let lastWarmedLocalSttModel = "";
let localSttRuntimeLoaded = false;

let ttsSetupRunning = false;
let lastCaptureIntentStartedAt = 0;
let lastCaptureIntentLabel = "";
let mainWindowHiddenToTray = false;
const dockChannel = new BroadcastChannel("slasshywispr-dock");
const selectionPopupChannel = new BroadcastChannel("slasshywispr-selection-popup");
const MAIN_WINDOW_VISIBILITY_EVENT = "slasshywispr://main-window-visibility";
import {
  snoozeUpdateFor24Hours,
} from "./updater/updater-client";

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
  parseMainPage: (value) => asMainPageService(value),
  parseSettingsPane: (value) => asSettingsPaneService(value),
});

setPersistErrorReporter((message) => setNoticeService(message, true));

/**
 * Store-update fan-out. React's uiStore re-reads every list from
 * localStorage on this event, while writers persist through a 300ms
 * debounce — so pending writes must land BEFORE the dispatch, otherwise
 * the UI re-renders the pre-write snapshot and stays one entry behind
 * until the next run notifies again.
 */
function notifyStoreUpdated(): void {
  flushPendingWritesService();
  window.dispatchEvent(new CustomEvent("slasshywispr:store-updated"));
}

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
    getHomeHistory: () => homeHistoryEntries,
    setHomeHistory: (entries) => {
      homeHistoryEntries = entries;
    },
    persistHomeHistory: () => persistHomeHistoryService(),
    notifyStoreUpdated,
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
  syncAvailability: () => syncActionAvailabilityService(),
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
  syncAvailability: () => syncActionAvailabilityService(),
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
    readSettings: () => readSettingsFromFormService(settingsFormRefs, getSettingsCoreDepsService()),
    readLiveSettings: () => settings,
    summarizeSettings: (next) => summarizeSettingsForDiagnostics(next),
    shouldBlockFromForegroundApp: () => shouldBlockAssistantInputFromForegroundAppService(),
    primeSelectionSnapshot: () => {
      void primeSelectionSnapshotForCommandMode();
    },
    clearPushToTalkHolds: () => clearPushToTalkHoldsService(),
    showMissingApiKeyNotice: (source) => showDesktopNotice(MISSING_API_KEY_MESSAGE, {
      failureReason: "Missing API key for online runtime.",
      logSource: source,
    }),
    setNotice: (message, isError) => setNoticeService(message, isError),
    log: (message) => logClientEventService(message),
    transition: (event) => {
      transitionRecordingState(event);
    },
    syncAvailability: () => syncActionAvailabilityService(),
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
    notePasteTarget: () => {
      if (!isTauriEnvironment()) {
        return;
      }
      void ipcNotePasteTarget().catch(() => {
        // Best-effort snapshot; the paste path falls back to invoke-time focus.
      });
    },
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
    readSettings: () => readSettingsFromFormService(settingsFormRefs, getSettingsCoreDepsService()),
    getStage: () => stage,
    markIdle: (detail) => setStageService("idle", detail),
    transition: (event) => {
      transitionRecordingState(event);
    },
    syncAvailability: () => syncActionAvailabilityService(),
    setPipelineRunning: (running) => {
      pipelineRunning = running;
    },
    notify: (message, isError) => setNoticeService(message, isError),
    log: (message) => logClientEventService(message),
    getLocalSttCatalog: () => localSttModelCatalog,
    commitFormSettings: () => {
      void handleSettingsChangeService();
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
    nextSelectionPopupToken: () => nextSelectionPopupTokenService(),
    dismissSelectionPopup: () => dismissSelectionPopupService(),
    showSelectionAssistantPopup: (payload) => showSelectionAssistantPopupService(payload),
    triggerAutoPaste: (text) => triggerAutoPasteService(text),
    copyToClipboard: (text) => copyToClipboardService(text),
    openSettings: (reason) => openSettingsService(reason),
    setActiveSettingsPane: (pane, reason) => setActiveSettingsPaneService(pane, reason),
    refreshAssistantInfo: () => refreshAssistantInfoSafelyService(),
  },
);
initLocalSttState({
  readSettings: () => readSettingsFromFormService(settingsFormRefs, getSettingsCoreDepsService()),
  getCatalogSelection: () => localSttModelCatalogSelect.value,
  isPipelineRunning: () => pipelineRunning,
  getStage: () => stage,
  renderSidebarToggle: () => renderSidebarLocalSttToggleService(),
  renderSettingsStatus: () => renderLocalSttSettingsStatusService(),
});
initLocalSttDiagnostics({
  readSettings: () => readSettingsFromFormService(settingsFormRefs, getSettingsCoreDepsService()),
  commitSettings: (next) => {
    applySettingsToFormService(settingsFormRefs, getSettingsCoreDepsService(), next);
    persistSettings(next);
  },
  notify: (message, isError) => setNoticeService(message, isError),
  openSettings: (reason) => openSettingsService(reason),
  setActiveSettingsPane: (pane, reason) => setActiveSettingsPaneService(pane, reason),
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
  // F-028: first close-to-tray hide explains how to get the window back.
  notify: (message, isError) => setNoticeService(message, isError),
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
    getHotkeyDisplay: () => getCachedHotkeyDisplayService(),
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
    // F-030/F-009: only the newest issued token is live; any older payload
    // (a superseded run) no-ops on show/copy/replace instead of pasting stale text.
    isTokenStale: (token) => token !== selectionPopupTokenCounter,
    focusMainWindow: async () => {
      const win = getCurrentWindow();
      await win.show();
      await win.setFocus();
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
    readSettings: () => readSettingsFromFormService(settingsFormRefs, getSettingsCoreDepsService()),
    commitFormSettings: () => {
      void handleSettingsChangeService();
    },
    getCatalog: () => localSttModelCatalog,
    isPipelineRunning: () => pipelineRunning,
    getStage: () => stage,
    setStage: (next, detail) => setStageService(next, detail),
    notify: (message, isError) => setNoticeService(message, isError),
    queueNotice: (message, isError) => queueNoticeService(message, isError),
    log: (message) => logClientEventService(message),
    syncAvailability: () => syncActionAvailabilityService(),
    openSettings: (reason) => openSettingsService(reason),
    setActiveSettingsPane: (pane, reason) => setActiveSettingsPaneService(pane, reason),
    refreshAssistantInfo: () => refreshAssistantInfoSafelyService(),
    renderFetchedCatalog: (models, selected) => renderLocalSttModelCatalogService(models, selected),
    checkModelFileExists: (model) => checkModelFileExistsService(model),
    checkAvailableMemory: (model) => checkAvailableMemoryService(model),
    showOfflineModeDiagnostic: (issue, details) => showOfflineModeDiagnosticService(issue, details),
    ensureSelectedLocalSttModelForWarmup: () => ensureSelectedLocalSttModelService({ quiet: true }),
    isSettingsOpen: () => isSettingsOpenService(),
  },
);
initDiagnostics(noticeStack, { isTauri: isTauriEnvironment });
void initFileTranscription({
  isTauri: isTauriEnvironment,
  isPipelineRunning: () => pipelineRunning,
  runPipeline: (blob, mimeType) => runPipelineService(blob, mimeType),
  log: (message) => logClientEventService(message),
  notify: (message, isError) => setNoticeService(message, isError),
  readAudioFile,
  takePendingFile,
  onRequest: onTranscribeRequest,
});
initNavigation(
  {
    pageNavButtons,
    settingsNavButtons,
    settingsPanels,
    settingsPaneTitle,
    settingsMain,
    settingsOverlay,
    openSettingsBtn,
    closeSettingsBtn,
    ttsBootstrapCard,
    ttsProfilesArea,
    ttsSetupStatus,
    ttsProfilePiperTab,
    ttsProfilePiperPanel,
  },
  {
    log: (message) => logClientEventService(message),
    isPiperRuntimeReady: () => piperRuntimeReady,
    isTtsSetupRunning: () => ttsSetupRunning,
    notifyOverlayVisibilityChanged: () => notifySettingsOverlayVisibilityChanged(),
  },
  { page: loadPersistedMainPageService(), pane: loadPersistedSettingsPaneService() },
);
initTauriShell(
  { windowMinimizeBtn, windowCloseBtn },
  {
    isTauri: isTauriEnvironment,
    getLaunchAtLogin: () => settings.launchAtLogin,
    getShellIntegration: () => settings.shellIntegration,
    notify: (message, isError) => setNoticeService(message, isError),
    log: (message) => logClientEventService(message),
  },
);

initSidebar(
  { toggleButton: toggleSidebarBtn, labeledButtons: sidebarLabeledButtons },
  {
    readCollapsed: () => localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1",
    writeCollapsed: (collapsed) => {
      localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    },
  },
);

initAvailability(
  {
    refreshMicsBtn,
    setupRuntimeBtn,
    validatePiperBtn,
    downloadVoiceBtn,
    setupAllTtsBtn,
    clearHistoryBtn,
    fetchProviderModelsBtn,
    applyModelToAiBtn,
    applyModelToSttBtn,
    checkOllamaStatusBtn,
    installOllamaBtn,
    fetchOllamaModelsBtn,
    useOllamaModelBtn,
    pullOllamaModelBtn,
    sidebarToggleLocalSttBtn,
    downloadLocalSttModelBtn,
    deleteLocalSttModelBtn,
    openLocalSttModelPathBtn,
    providerModelCatalogSelect,
    localOllamaModelCatalogSelect,
    localSttModelInput,
    localSttModelCatalogSelect,
    ttsEngineSelect,
    hotkeyInput,
    commandHotkeyInput,
    toggleMicEditorBtn,
    toggleHotkeyEditorBtn,
  },
  {
    isPipelineRunning: () => pipelineRunning,
    getStage: () => stage,
    isTtsSetupRunning: () => ttsSetupRunning,
    isOllamaStatusBusy: () => ollamaStatusBusy,
    isOllamaInstallBusy: () => ollamaInstallBusy,
    isOllamaPullBusy: () => ollamaPullBusy,
    isLocalSttHardwareAdvisorOpen: () => isLocalSttHardwareAdvisorOpen(),
    isLocalSttBusy: () => isLocalSttBusyService(),
    getSttRuntimeMode: () => settings.sttRuntimeMode,
    getAiRuntimeMode: () => settings.aiRuntimeMode,
    getFormRefs: () => settingsFormRefs,
    renderLocalSttSettingsStatus: () => renderLocalSttSettingsStatusService(),
  },
);
initStageView(
  { statusPill, statusDetail, recordBtn },
  {
    getStage: () => stage,
    setStageState: (next) => {
      stage = next;
    },
    getPipelineRunning: () => pipelineRunning,
    getCaptureMode: () => settings.captureMode,
    isMutingEnabled: () => settings.muteMusicWhileDictating,
    isExternalMediaMuted: () => isExternalMediaMutedForDictation(),
    getMicrophoneDeviceId: () => settings.microphoneDeviceId,
    publishDockState: () => publishDockStateService(),
    syncFloatingIndicatorWindow: () => syncFloatingIndicatorWindowService(),
    preWarmMicrophoneStream: (deviceId) => {
      void preWarmMicrophoneStreamService(deviceId);
    },
    playSoundEffect: (kind) => playDictationSoundEffectService(soundDeps, kind),
    pauseExternalMedia: () => pauseExternalMediaForDictationService(mediaControlDeps),
    resumeExternalMedia: () => resumeExternalMediaAfterDictationService(mediaControlDeps),
  },
);
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
    updateTtsSetupGate: () => updateTtsSetupGateService(),
  },
);
initAssistantStatus({
  fetchInfo: () => ipcGetAssistantInfo(),
  notify: (message, isError) => setNoticeService(message, isError),
  renderProviderCatalog: (models, selected) => renderProviderModelCatalogService(models, selected),
  renderLocalOllamaCatalog: (models, selected) => renderLocalOllamaModelCatalogService(models, selected),
  renderLocalSttCatalog: (models, selected) => renderLocalSttModelCatalogService(models, selected),
  getProviderCatalog: () => providerModelCatalog,
  getLocalOllamaCatalog: () => localOllamaModelCatalog,
  getLocalSttCatalog: () => localSttModelCatalog,
  getSettings: () => settings,
  getPiperPathInput: () => settingsFormRefs.piperPathInput,
  onSettingsChanged: () => {
    void handleSettingsChangeService();
  },
});

initClipboard({
  isTauri: isTauriEnvironment,
  notify: (message, isError) => setNoticeService(message, isError),
});

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
    notifyStoreUpdated,
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
    queueUpdateNotice: (message, action) => queueNoticeService(message, false, action),
    log: (message) => logClientEventService(message),
    openUpdateSettings: (reason) => {
      openSettingsService(reason);
      setActiveSettingsPaneService("update-security", reason);
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
    readSettings: () => readSettingsFromFormService(settingsFormRefs, getSettingsCoreDepsService()),
    commitSettings: () => {
      void handleSettingsChangeService();
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
    setStage: (next, detail) => setStageService(next, detail),
    syncAvailability: () => syncActionAvailabilityService(),
    openModelsPane: () => setActiveSettingsPaneService("models"),
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
    readSettings: () => readSettingsFromFormService(settingsFormRefs, getSettingsCoreDepsService()),
    getPiperPathInput: () => settingsFormRefs.piperPathInput.value,
    setPiperPathInput: (value) => {
      settingsFormRefs.piperPathInput.value = value;
    },
    commitSettings: () => {
      void handleSettingsChangeService();
    },
    setNotice: (message, isError) => setNoticeService(message, isError),
    setStage: (next, detail) => setStageService(next, detail),
    getStage: () => stage,
    refreshAssistantInfo: () => refreshAssistantInfoSafelyService(),
    syncAvailability: () => syncActionAvailabilityService(),
    updateGate: () => updateTtsSetupGateService(),
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
initSettingsChange({
  getSettings: () => settings,
  setSettings: (next) => {
    settings = next;
  },
  commitSettingsSnapshot: (next) => setSettingsSnapshot(next),
  getFormRefs: () => settingsFormRefs,
  getCatalogs: () => ({
    providerModels: providerModelCatalog,
    localOllamaModels: localOllamaModelCatalog,
    localSttModels: localSttModelCatalog,
  }),
  getAssistantInfoDefaults: () => latestAssistantInfoDefaults,
  getStage: () => stage,
  currentSettings: () => getSettingsSnapshot(),
  buildCaptureDeps: () => ({
    isCapturingHotkey: () => isHotkeyCaptureActive(),
    isCapturingCommandHotkey: () => isCommandHotkeyCaptureActive(),
    refreshRecordingsStorageHint: () => {
      void refreshRecordingsStorageHint();
    },
    isTauri: isTauriEnvironment,
    showStaleRuntimePane: () => setActiveSettingsPaneService("models"),
  }),
  formatHotkeyDisplay: (hotkey) => formatHotkeyForDisplay(hotkey),
  log: (message) => logClientEventService(message),
  warn: (message) => console.warn(message),
  renderSidebarLocalSttToggle: () => renderSidebarLocalSttToggleService(),
  refreshRecordButton: () => refreshRecordButtonService(),
  syncActionAvailability: () => syncActionAvailabilityService(),
  updateMicrophoneSummary: () => updateMicrophoneSummaryService(),
  renderAssistantInfo: (info) => renderAssistantInfoService(info),
  setActiveTtsProfile: (profile) => setActiveTtsProfileService(profile),
  setCatalogSelects: (next, catalogs) => {
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
  },
  requestGlobalShortcutSync: () => requestGlobalShortcutSyncService(),
  requestLaunchAtLoginSync: (enabled) => requestLaunchAtLoginSync(enabled),
  requestShellIntegrationSync: (enabled) => requestShellIntegrationSync(enabled),
  interruptTtsPlayback: () => interruptTtsPlaybackService(),
  notice: (message, isError) => setNoticeService(message, isError),
  requestLocalSttRuntimeSyncForMode: (mode, options) =>
    requestLocalSttRuntimeSyncForModeService(mode as "local" | "online", options),
  updateTtsSetupGate: () => updateTtsSetupGateService(),
  publishDockState: () => publishDockStateService(),
  syncFloatingIndicatorWindow: () => syncFloatingIndicatorWindowService(),
  primeCaptureReadiness: (deviceId, showFlowBar) => {
    void primeCaptureReadinessService(deviceId, showFlowBar);
  },
  clearCaptureHolds: () => clearPushToTalkHoldsService(),
  notifyIncognitoChanged: () => {},
  syncExternalMediaMute: (muted) => {
    if (muted) {
      pauseExternalMediaForDictationService(mediaControlDeps);
    } else {
      resumeExternalMediaAfterDictationService(mediaControlDeps);
    }
  },
  persist: (next) => persistSettings(next),
  notifyStoreUpdated,
  readSettingsFromForm: (refs, coreDeps) => readSettingsFromFormService(refs, coreDeps),
  applySettingsToForm: (refs, coreDeps, next) => applySettingsToFormService(refs, coreDeps, next),
  getUsageStats: () => usageStats,
  getSessionCount: () => analyticsSessionDetails.length,
  getAchievements: () => achievementStates,
  appendAchievements: (unlocked) => {
    achievementStates.push(...unlocked);
  },
  persistAchievements: () => persistAchievementStatesService(),
  isTauri: isTauriEnvironment,
  loadNativeSettings: () => ipcLoadPersistedLocalSettings(),
});
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
setActiveTtsProfileService("piper");
updateTtsSetupGateService();
persistUsageStatsService();

if (systemThemeMediaQuery) {
  const handleSystemThemeChange = (): void => {
    if (settings.themeMode === "system") {
      publishDockStateService();
    }
  };

  systemThemeMediaQuery.addEventListener("change", handleSystemThemeChange);
}

setActivePageService(getActivePageService());
setActiveSettingsPaneService(getActiveSettingsPaneService());
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
refreshRecordButtonService();
syncActionAvailabilityService();
initializeUpdaterPanelService();
void registerUpdateInstallProgressListenerService();
setupCustomWindowControls();
void initializeTrayBackgroundLifecycleService();
hotkeyInput.readOnly = true;
commandHotkeyInput.readOnly = true;
requestLaunchAtLoginSync(settings.launchAtLogin);
void reconcileLaunchAtLoginWithOs().then((correction) => {
  if (correction) {
    queueNoticeService(describeLaunchAtLoginCorrection(correction));
  }
});
requestShellIntegrationSync(settings.shellIntegration);
void reconcileShellIntegrationWithOs().then((correction) => {
  if (correction) {
    queueNoticeService(describeShellIntegrationCorrection(correction));
  }
});
startBlockedAppShortcutSuppressionMonitorService();
applyPersistedSidebarCollapsedService();


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
  void handleSettingsChangeService();
});

initHotkeyCapture(
  { hotkeyInput, commandHotkeyInput },
  {
    getPushHotkey: () => settings.pushToTalkHotkey,
    getCommandHotkey: () => settings.commandHotkey,
    notify: (message, isError) => setNoticeService(message, isError),
    onCommitted: () => {
      void handleSettingsChangeService();
    },
  },
);

initHotkeySync({
  isTauri: isTauriEnvironment,
  // F-007: remaps requested mid-hold are parked until the PTT release drains them.
  isHoldActive: () => hasPushToTalkHold("hotkey"),
  getSettings: getSettingsSnapshot,
  notify: (message, isError) => setNoticeService(message, isError),
  log: (message) => logClientEventService(message),
  publishDockState: () => publishDockStateService(),
  onShortcutEvent: (event) => handleGlobalShortcutEventService(event),
});
initGlobalShortcutDispatch({
  getSettings: () => settings,
  isCaptureActive: () => isAnyHotkeyCaptureActive(),
  getNormalizedShortcuts: () => getNormalizedRegisteredShortcuts(),
  markHandled: (shortcut, state) => markGlobalShortcutHandledService(shortcut, state),
  readActiveSettings: () => readSettingsFromFormService(settingsFormRefs, getSettingsCoreDepsService()),
  isApiKeyMissingForOnlineRuntime: (activeSettings) =>
    missingApiKeyForOnlineRuntime(activeSettings),
  showApiKeyMissingNotice: () =>
    showDesktopNotice(MISSING_API_KEY_MESSAGE, {
      failureReason: "Missing API key for online runtime.",
      logSource: "global-hotkey",
    }),
  hasPushToTalkHold: (source) => hasPushToTalkHold(source),
  getPushToTalkHoldCount: () => getPushToTalkHoldCount(),
  engagePushToTalk: (source) => {
    void engagePushToTalkService(source);
  },
  handleRecordToggle: () => {
    void handleRecordToggleService();
  },
  releasePushToTalk: (source) => releasePushToTalkService(source),
  shouldBlockAssistantInputFromForegroundApp: () =>
    shouldBlockAssistantInputFromForegroundAppService(),
  toggleCommandModeArmed: () => toggleCommandModeArmed(),
  isCommandModeArmed: () => isCommandModeArmed(),
  log: (message) => logClientEventService(message),
});

initLocalShortcuts(
  { toggleSidebarBtn, sidebarToggleLocalSttBtn, openSettingsBtn },
  {
    getSettings: () => settings,
    getStage: () => stage,
    isSettingsOverlayOpen: () => !settingsOverlay.hidden,
    closeSettings: () => closeSettingsService(),
    setActivePage: (page) => setActivePageService(page),
    handleLocalSttAdvisorEscape: () => handleLocalSttAdvisorEscape(),
    engagePushToTalk: (source) => {
      void engagePushToTalkService(source);
    },
    handleRecordToggle: () => {
      void handleRecordToggleService();
    },
    releasePushToTalk: (source) => releasePushToTalkService(source),
    hasPushToTalkHold: (source) => hasPushToTalkHold(source),
    getPushToTalkHoldCount: () => getPushToTalkHoldCount(),
    clearPushToTalkHolds: () => clearPushToTalkHoldsService(),
    stopRecording: () => stopRecordingService(),
    shouldBlockAssistantInputFromForegroundApp: () =>
      shouldBlockAssistantInputFromForegroundAppService(),
    toggleCommandModeArmed: () => toggleCommandModeArmed(),
    isCommandModeArmed: () => isCommandModeArmed(),
    notify: (message, isError) => setNoticeService(message, isError),
    log: (message) => logClientEventService(message),
    syncGuards: {
      shouldBypassLocalShortcutHandling: (token) =>
        shouldBypassLocalShortcutHandlingService(token),
      shouldIgnoreLocalShortcutFromRecentGlobal: (token, state) =>
        shouldIgnoreLocalShortcutFromRecentGlobalService(token, state),
      noteLocalPressed: (token) => noteLocalShortcutPressedService(token),
      drainPendingRemap: () => drainPendingRemapService(),
    },
  },
);
wireHotkeyInputButtons({ hotkeyInput, commandHotkeyInput });

wireSettingsFormInputsService({
  refs: settingsFormRefs,
  onFieldChange: () => {
    void handleSettingsChangeService();
  },
  onThemeCardChange: (value) => {
    const next = asThemeMode(value);
    if (settingsFormRefs.themeModeSelect.value !== next) {
      settingsFormRefs.themeModeSelect.value = next;
    }
    void handleSettingsChangeService();
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
  handleSettingsChangeService();
});

localOllamaModelCatalogSelect.addEventListener("change", () => {
  const selected = localOllamaModelCatalogSelect.value.trim();
  if (!selected) {
    return;
  }
  settingsFormRefs.localOllamaModelInput.value = selected;
  handleSettingsChangeService();
});

localSttModelCatalogSelect.addEventListener("change", () => {
  const selected = localSttModelCatalogSelect.value.trim();
  if (!selected) {
    markCatalogSelectionCleared();
    return;
  }
  localSttModelInput.value = selected;
  markCatalogSelectionChanged();
  handleSettingsChangeService();
  void refreshSelectedLocalSttModelAvailabilityService({ quiet: true });
});

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
  handleSettingsChangeService();
  setNoticeService(`AI model set to "${selected}".`);
});

applyModelToSttBtn.addEventListener("click", () => {
  const selected = providerModelCatalogSelect.value.trim();
  if (!selected) {
    setNoticeService("Select a model from catalog first.", true);
    return;
  }
  settingsFormRefs.sttModelInput.value = selected;
  handleSettingsChangeService();
  setNoticeService(`STT model set to "${selected}".`);
});


/* F-007: a global PTT release already ends the hold via the dispatch deps;
   this only drains a hotkey remap that was parked while the hold was active. */
window.addEventListener("slasshywispr:ptt-release", () => {
  drainPendingRemapService();
});

/* Home tab search-button → switch to History and focus the search
   input. rAF ensures the React tree has time to mount the History
   section before the input exists in the DOM. */
window.addEventListener("slasshywispr:focus-history-search", () => {
  setActivePageService("history");
  requestAnimationFrame(() => {
    const input = document.getElementById("historySearchInput");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  });
});

/* Home rail — Open analytics card-link. */
window.addEventListener("slasshywispr:focus-analytics", () => {
  setActivePageService("analytics");
});

/* Home rail — Edit (Settings) card-link. The settings modal is
   mounted at all times; we open it via the global openSettings
   button that already exists in the sidebar. */
window.addEventListener("slasshywispr:focus-settings", () => {
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
    notifyStoreUpdated,
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
    setActivePage: (page) => setActivePageService(page),
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
  // F-003: reads the live settings object so toggling incognito takes effect
  // on the next dictation without a reload.
  isIncognito: () => settings.incognitoMode,
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
  notifyStoreUpdated,
});
async function bootstrap(): Promise<void> {
  logClientEventService("[bootstrap] start");
  // Before the hydrate below: it clamps stored values against these bounds.
  await refreshSttTimeoutBounds(() => ipcSttTimeoutBounds());
  await refreshMaxTokensBoundsService(() => ipcMaxTokensBounds());
  await refreshTemperatureBoundsService(() => ipcTemperatureBounds());
  await hydrateSettingsFromNativeStorageChangeService();
  // The hydrate can restore a value stored under an older, wider range.
  const sttTimeoutCorrection = reconcileSttTimeoutWithBoundsService();
  if (sttTimeoutCorrection) {
    queueNoticeService(describeSttTimeoutCorrection(sttTimeoutCorrection));
  }
  const maxTokensCorrection = reconcileMaxTokensWithBoundsService();
  if (maxTokensCorrection) {
    queueNoticeService(describeMaxTokensCorrection(maxTokensCorrection));
  }
  const temperatureCorrection = reconcileTemperatureWithBoundsService();
  if (temperatureCorrection) {
    queueNoticeService(describeTemperatureCorrection(temperatureCorrection));
  }
  logClientEventService(`[bootstrap] settings after hydrate ${summarizeSettingsForDiagnostics(settings)}`);

  // Register global hotkeys immediately — user should be able to press the
  // hotkey as soon as settings are loaded, without waiting for the rest of
  // the heavy bootstrap chain (Ollama, STT, TTS, model lists, etc.).
  requestGlobalShortcutSyncService(true);

  void backfillHistoryRecordingIds();
  setStageService("idle", "Loading assistant metadata...");

  try {
    const info = await ipcGetAssistantInfo();
    renderAssistantInfoService(info);

    if (info.piperInstalled && info.voiceInstalled) {
      queueNoticeService("Piper runtime is ready.");
      setStageService("idle", "Ready for voice input.");
    } else {
      queueNoticeService("Piper runtime incomplete. Open Settings > Models and complete runtime setup.");
      setStageService("idle", "Setup required.");
    }
  } catch (error) {
    const message = asErrorMessage(error);
    queueNoticeService(`Failed to load assistant metadata: ${message}`, true);
    setStageService("error", "Metadata load failed.");
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
    queueNoticeService(`Unable to initialize local STT runtime: ${asErrorMessage(error)}`, true);
  }
  try {
    await pollTtsSetupStatusOnceService();
  } catch {
    // Ignore bootstrap poll failures and continue normal app startup.
  }
  syncActionAvailabilityService();
  startAutomaticUpdateChecksService();
  backfillAchievementsFromUsageStatsService();
  logClientEventService("[bootstrap] completed");
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
      notifyStoreUpdated();
      logClientEventService(`[recordings.backfill] attached=${patched} of ${matches.length}`);
    }
  } catch (error) {
    logClientEventService(`[recordings.backfill] failed: ${asErrorMessage(error)}`);
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
    setStageService(result.stage, result.detail);
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

void bootstrap();
