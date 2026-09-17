/**
 * Pipeline client — Phase 5 shell decomposition.
 *
 * Owns runPipeline: audio prep (PCM fast path / WAV fallback), base64,
 * system prompt, command-mode selection, local-STT/Ollama gating, the
 * run_assistant_pipeline invoke, selection popup, playback, paste/
 * clipboard, and completion notices. Moved verbatim from main.tsx; shell
 * seams (settings, stage/machine, local-STT runtime, catalogs, popups,
 * clipboard, settings panes, assistant refresh) arrive via
 * initPipelineClient so this module never touches main.tsx globals.
 */
import { DEFAULT_ASSISTANT_NAME } from "../constants";
import { runAssistantPipeline as ipcRunAssistantPipeline } from "../ipc/client";
import { resolveSttLanguageConfig } from "../state/settings-store";
import { pickDefaultLocalSttModelFromCatalog as pickDefaultLocalSttModelFromList } from "../stt/provider-inference";
import type {
  AssistantPipelineResponse,
  DictionaryTerm,
  PersistedSettings,
  SelectionPopupPayload,
  SettingsPane,
  SnippetEntry,
  TtsEngine,
} from "../types";
import { asErrorMessage, expandSnippetsInText } from "../utils";
import { buildSelectionPopupPayload } from "../windows/selection-intent";
import {
  audioBufferToWavBlob,
  blobToBase64,
  decodeAudioSample,
  resolvePreferredOnlineSttBitrate,
  shouldOptimizeOnlineSttUpload,
} from "../recording/audio-utils";
import {
  captureSelectedTextForRewrite,
  getCommandSelectionSnapshot,
  isCommandModeArmed,
  resetCommandMode,
} from "../recording/command-mode";
import { playGeneratedAudio } from "../recording/playback";
import { renderPipelineResponse } from "./pipeline-render";
import { buildEffectiveSystemPrompt } from "./pipeline-prompt";

export type PipelineClientEvent =
  | { type: "pipeline-started" }
  | { type: "pipeline-blocked"; reason: string }
  | { type: "pipeline-failed"; reason: string };

export interface PipelineClientElements {
  localSttModelInput: HTMLInputElement;
  localSttModelCatalogSelect: HTMLSelectElement;
}

export interface PipelineClientDeps {
  readSettings: () => PersistedSettings;
  getStage: () => string;
  markIdle: (detail: string) => void;
  transition: (event: PipelineClientEvent) => void;
  syncAvailability: () => void;
  setPipelineRunning: (running: boolean) => void;
  notify: (message: string, isError?: boolean) => void;
  log: (message: string) => void;
  getLocalSttCatalog: () => string[];
  commitFormSettings: () => void;
  checkModelFileExists: (model: string) => Promise<boolean>;
  localSttModelLabel: (model: string) => string;
  refreshLocalSttRuntimeState: (options?: { quiet?: boolean }) => Promise<void>;
  warmupActiveLocalSttModel: (options: { quiet?: boolean; explicit?: boolean }) => Promise<unknown>;
  isSelectedLocalSttModelLoaded: () => boolean;
  getLocalSttRuntimeLoaded: () => boolean;
  getLastWarmedLocalSttModel: () => string;
  setLastWarmedLocalSttModel: (model: string) => void;
  ensureLocalOllamaModelSelected: (options?: { quiet?: boolean }) => Promise<string>;
  getDictionaryTerms: () => DictionaryTerm[];
  getSnippets: () => SnippetEntry[];
  nextSelectionPopupToken: () => number;
  dismissSelectionPopup: () => Promise<void>;
  showSelectionAssistantPopup: (payload: SelectionPopupPayload) => Promise<boolean>;
  triggerAutoPaste: (text: string) => Promise<boolean>;
  copyToClipboard: (text: string) => Promise<boolean>;
  openSettings: (reason: string) => void;
  setActiveSettingsPane: (pane: SettingsPane, reason?: string) => void;
  refreshAssistantInfo: () => Promise<void>;
}

let clientElements!: PipelineClientElements;
let clientDeps!: PipelineClientDeps;

export function initPipelineClient(
  elements: PipelineClientElements,
  deps: PipelineClientDeps,
): void {
  clientElements = elements;
  clientDeps = deps;
}

export async function runPipeline(audioBlob: Blob, audioMimeType: string): Promise<void> {
  const activeSettings = clientDeps.readSettings();
  const pipelineInvokeStartedAt = performance.now();

  clientDeps.transition({ type: "pipeline-started" });
  clientDeps.syncAvailability();

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
        clientDeps.log(`[pipeline.audio] raw PCM ready samples=${channelData.length} sampleRate=${decoded.sampleRate} bytes=${pcmBytes.length}`);
      } catch (error) {
        clientDeps.log(`raw PCM conversion failed, falling back to WAV: ${asErrorMessage(error)}`);
        try {
          const decoded = await decodeAudioSample(audioBlob);
          pipelineAudioBlob = audioBufferToWavBlob(decoded);
          pipelineAudioMimeType = "audio/wav";
        } catch (e2) {
          clientDeps.log(`wav fallback also failed: ${asErrorMessage(e2)}`);
        }
      }
    } else if (activeSettings.sttRuntimeMode === "local") {
      try {
        const decoded = await decodeAudioSample(audioBlob);
        pipelineAudioBlob = audioBufferToWavBlob(decoded);
        pipelineAudioMimeType = "audio/wav";
      } catch (error) {
        clientDeps.log(`local.stt wav conversion skipped: ${asErrorMessage(error)}`);
      }
    } else if (shouldOptimizeOnlineSttUpload(activeSettings)) {
      clientDeps.log(
        `online.stt optimized transport bytes=${audioBlob.size} mime=${audioMimeType || "unknown"} bitrate=${resolvePreferredOnlineSttBitrate(activeSettings) ?? "default"}`,
      );
    }

    const base64EncodeStartedAt = performance.now();
    const audioBase64 = await blobToBase64(pipelineAudioBlob);
    clientDeps.log(
      `[pipeline.audio] base64Ms=${Math.round(
        performance.now() - base64EncodeStartedAt,
      )} bytes=${pipelineAudioBlob.size} mime=${pipelineAudioMimeType || "unknown"}`,
    );
    const systemPrompt = buildEffectiveSystemPrompt(activeSettings, isCommandModeArmed());
    const pipelineTtsEngine: TtsEngine = "piper";
    let selectedTextForRewrite: string | null = null;
    if (isCommandModeArmed()) {
      const primedSelected = (getCommandSelectionSnapshot() ?? "").trim();
      const selected = primedSelected || (await captureSelectedTextForRewrite({ silent: true })).trim();
      if (selected) {
        selectedTextForRewrite = selected;
      } else {
        const explicitSelected = (await captureSelectedTextForRewrite()).trim();
        if (explicitSelected) {
          selectedTextForRewrite = explicitSelected;
        } else {
          clientDeps.notify("No selected text detected. Command mode will run without selection replace.", true);
        }
      }
    }
    clientDeps.log(
      `pipeline.selection commandMode=${isCommandModeArmed()} selectedChars=${selectedTextForRewrite ? selectedTextForRewrite.length : 0}`,
    );

    let resolvedLocalOllamaModel = activeSettings.localOllamaModel.trim();
    if (activeSettings.sttRuntimeMode === "local") {
      let selectedLocalSttModel = activeSettings.localSttModel.trim();
      if (!selectedLocalSttModel) {
        const fallbackLocalSttModel = pickDefaultLocalSttModelFromList(clientDeps.getLocalSttCatalog());
        if (fallbackLocalSttModel) {
          clientElements.localSttModelInput.value = fallbackLocalSttModel;
          if (clientDeps.getLocalSttCatalog().includes(fallbackLocalSttModel)) {
            clientElements.localSttModelCatalogSelect.value = fallbackLocalSttModel;
          }
          clientDeps.commitFormSettings();
          selectedLocalSttModel = fallbackLocalSttModel;
        }
      }
      if (selectedLocalSttModel && !(await clientDeps.checkModelFileExists(selectedLocalSttModel))) {
        clientDeps.log("pipeline.blocked reason=missing-local-stt-files");
        clientDeps.notify(
          `Local STT model "${clientDeps.localSttModelLabel(selectedLocalSttModel)}" is not downloaded yet. Click Download Model in the sidebar first.`,
          true,
        );
        clientDeps.openSettings("missing-local-stt-files");
        clientDeps.setActiveSettingsPane("models", "missing-local-stt-files");
        clientDeps.transition({ type: "pipeline-blocked", reason: "Local setup required." });
        return;
      }
      if (!selectedLocalSttModel) {
        clientDeps.log("pipeline.blocked reason=missing-local-stt-model");
        clientDeps.notify(
          "Local STT mode needs a local STT model (Parakeet). Open Settings > Models and select one.",
          true,
        );
        clientDeps.setActiveSettingsPane("models");
        clientDeps.transition({ type: "pipeline-blocked", reason: "Local setup required." });
        return;
      }

      await clientDeps.refreshLocalSttRuntimeState({ quiet: true });
      const needsWarmup =
        !clientDeps.getLocalSttRuntimeLoaded() ||
        !selectedLocalSttModel ||
        clientDeps.getLastWarmedLocalSttModel().trim() !== selectedLocalSttModel;
      if (needsWarmup) {
        await clientDeps.warmupActiveLocalSttModel({ quiet: true, explicit: true });
        await clientDeps.refreshLocalSttRuntimeState({ quiet: true });
      } else if (selectedLocalSttModel) {
        clientDeps.setLastWarmedLocalSttModel(selectedLocalSttModel);
      }
      if (!clientDeps.isSelectedLocalSttModelLoaded()) {
        clientDeps.log("pipeline.blocked reason=local-stt-not-loaded");
        clientDeps.notify("Local STT is not loaded. Click Load STT in the left sidebar.", true);
        clientDeps.transition({ type: "pipeline-blocked", reason: "Local setup required." });
        return;
      }
    }
    if (activeSettings.aiRuntimeMode === "local") {
      resolvedLocalOllamaModel = await clientDeps.ensureLocalOllamaModelSelected({ quiet: true });
      if (!resolvedLocalOllamaModel) {
        clientDeps.log("pipeline.blocked reason=missing-local-ollama-model");
        clientDeps.notify(
          "Local AI mode needs a local Ollama model. Open Settings > Models and pull/download one.",
          true,
        );
        clientDeps.setActiveSettingsPane("models");
        clientDeps.transition({ type: "pipeline-blocked", reason: "Local setup required." });
        return;
      }
    }

    const sttLanguageConfig = resolveSttLanguageConfig(activeSettings);

    const response: AssistantPipelineResponse = await ipcRunAssistantPipeline({
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
        dictionaryEntries: clientDeps.getDictionaryTerms().map((item) => ({
          source: item.source,
          target: item.target,
        })),
        snippetEntries: clientDeps.getSnippets().map((item) => ({
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
        commandMode: isCommandModeArmed(),
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
    clientDeps.log(
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
            assistantResponse: expandSnippetsInText(response.assistantResponse, clientDeps.getSnippets()),
          }
        : response;

    renderPipelineResponse(resolvedResponse);
    let playbackCompleted = true;
    const selectionPopupPayload = buildSelectionPopupPayload(resolvedResponse, clientDeps.nextSelectionPopupToken());
    if (!selectionPopupPayload) {
      await clientDeps.dismissSelectionPopup();
    }
    const selectionPopupOpened = selectionPopupPayload
      ? await clientDeps.showSelectionAssistantPopup(selectionPopupPayload)
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
        dictationPasted = await clientDeps.triggerAutoPaste(resolvedResponse.assistantResponse);
        if (dictationPasted) {
          clientDeps.notify("Dictation copied and pasted.");
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
        await clientDeps.copyToClipboard(resolvedResponse.assistantResponse);
      }
    } else if (
      activeSettings.copyToClipboard &&
      !resolvedResponse.selectionPending &&
      !selectionPopupOpened
    ) {
      await clientDeps.copyToClipboard(resolvedResponse.assistantResponse);
    }

    resetCommandMode();

    if (clientDeps.getStage() !== "recording") {
      if (resolvedResponse.mode === "dictation") {
        if (dictationPasted) {
          // Notice already set above.
        } else {
          clientDeps.notify("Dictation ready. Copy it from Home if needed.");
        }
      } else if (selectionPopupOpened || response.selectionRewrite || response.selectionPending) {
        // Notice already set above.
      } else {
        clientDeps.notify(playbackCompleted ? "Pipeline completed." : "Playback interrupted for new dictation.");
      }
      clientDeps.markIdle("Ready for next request.");
    }
  } catch (error) {
    clientDeps.notify(`Pipeline failed: ${asErrorMessage(error)}`, true);
    clientDeps.transition({ type: "pipeline-failed", reason: `Pipeline failed: ${asErrorMessage(error)}` });
  } finally {
    clientDeps.setPipelineRunning(false);
    await clientDeps.refreshAssistantInfo();
    clientDeps.syncAvailability();
  }
}
