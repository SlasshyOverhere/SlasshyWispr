import { useEffect, useState } from 'react';
import { DEFAULT_LOCAL_OLLAMA_BASE_URL } from '../../constants';
import { apiBaseUrlError } from '../../state/settings-store';
import { dispatchSettingsPatch, useSettingsSnapshot } from '../../settings/settings-react-shim';
import {
  cloneVoice,
  deleteVoiceClone,
  ensureVoiceCloneModel,
  getVoiceCloneStatus,
  listVoiceClones,
  previewClonedVoice,
  unloadVoiceCloneModel,
} from '../../ipc/client';
import type { VoiceCloneStatusResponse } from '../../types';
import { AdvancedSettings, SettingsGroup } from './SettingsPrimitives';

/**
 * ZipVoice conditions on the exact words spoken in the reference clip, so enrolment reads a
 * known sentence rather than transcribing one — the transcript is right by construction, and
 * the field stays editable for users who prefer their own sample.
 */
const ENROLMENT_SENTENCE =
  'The quick brown fox jumps over the lazy dog while the river runs past the old stone bridge.';

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read the reference clip.'));
    reader.readAsDataURL(file);
  });
}

export function ModelsSettingsPane() {
  const settings = useSettingsSnapshot();
  const [cloneTab, setCloneTab] = useState<'piper' | 'clone'>('piper');
  const [voices, setVoices] = useState<string[]>([]);
  const [cloneStatus, setCloneStatus] = useState<VoiceCloneStatusResponse | null>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceText, setReferenceText] = useState(ENROLMENT_SENTENCE);
  const [newVoiceId, setNewVoiceId] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [cloneMessage, setCloneMessage] = useState('Ready to clone a voice.');
  const [cloneBusy, setCloneBusy] = useState(false);

  const refreshVoices = async () => {
    try {
      const [listing, status] = await Promise.all([listVoiceClones(), getVoiceCloneStatus()]);
      setVoices(listing.voices);
      setCloneStatus(status);
    } catch (error) {
      setCloneMessage(String(error));
    }
  };

  useEffect(() => {
    void refreshVoices();
  }, []);

  const withCloneBusy = async (action: () => Promise<string>) => {
    setCloneBusy(true);
    try {
      setCloneMessage(await action());
    } catch (error) {
      setCloneMessage(String(error));
    } finally {
      setCloneBusy(false);
    }
  };

  const playPreview = (audioBase64: string) => {
    if (audioBase64) setPreviewUrl(`data:audio/wav;base64,${audioBase64}`);
  };

  const modelReady = cloneStatus?.modelReady ?? false;

  return (
    <section id="settingsPaneModels" className="settings-pane" data-settings-pane="models" hidden>

      <div
        id="settingsSection-models-runtime"
        className="settings-category"
        data-settings-section-owner="models"
        data-settings-section="runtime"
      >
        <SettingsGroup title="Execution mode">
          <div className="settings-runtime-row">
            <div className="settings-row-copy">
              <span className="settings-row-title">Speech-to-text</span>
              <span className="settings-row-hint">Use the provider or a local model.</span>
            </div>
            <div className="settings-segmented" role="radiogroup" aria-label="Speech-to-text runtime">
              <label className="settings-segment"><input id="sttRuntimeModeOnline" name="sttRuntimeModeProfile" type="radio" value="online" checked={settings.sttRuntimeMode !== "local"} onChange={() => dispatchSettingsPatch({ sttRuntimeMode: "online" })} />Online</label>
              <label className="settings-segment"><input id="sttRuntimeModeOffline" name="sttRuntimeModeProfile" type="radio" value="offline" checked={settings.sttRuntimeMode === "local"} onChange={() => dispatchSettingsPatch({ sttRuntimeMode: "local" })} />Offline</label>
            </div>
          </div>
          <div className="settings-runtime-row">
            <div className="settings-row-copy">
              <span className="settings-row-title">AI rewriting</span>
              <span className="settings-row-hint">Use the provider or Ollama.</span>
            </div>
            <div className="settings-segmented" role="radiogroup" aria-label="AI runtime">
              <label className="settings-segment"><input id="aiRuntimeModeOnline" name="aiRuntimeModeProfile" type="radio" value="online" checked={settings.aiRuntimeMode !== "local"} onChange={() => dispatchSettingsPatch({ aiRuntimeMode: "online" })} />Online</label>
              <label className="settings-segment"><input id="aiRuntimeModeOffline" name="aiRuntimeModeProfile" type="radio" value="offline" checked={settings.aiRuntimeMode === "local"} onChange={() => dispatchSettingsPatch({ aiRuntimeMode: "local" })} />Offline</label>
            </div>
          </div>
          <p id="runtimeModeNotice" className="field-hint"></p>
        </SettingsGroup>
      </div>

      <div
        id="settingsSection-models-online-provider"
        className="settings-category"
        data-settings-section-owner="models"
        data-settings-section="online-provider"
        hidden
      >
        <SettingsGroup title="Provider connection">
          <p className="field-hint">These controls are used when speech-to-text or AI rewriting is set to Online.</p>
          <div id="onlineProviderSection">
        <div className="compact-grid">
          <label className="field" data-online-field="base-url" title="Provider endpoint. Leave empty to use the app's default.">
            <span className="field-label">API Base URL</span>
            <input
              id="apiBaseUrlInput"
              type="text"
              placeholder="Use default provider URL"
              autoComplete="off"
              value={settings.apiBaseUrl}
              aria-invalid={apiBaseUrlError(settings.apiBaseUrl) !== null}
              onChange={(event) => dispatchSettingsPatch({ apiBaseUrl: event.target.value })}
            />
            {/* F-021: inline invariant instead of a silent coerce. */}
            {apiBaseUrlError(settings.apiBaseUrl) && (
              <span className="field-error">{apiBaseUrlError(settings.apiBaseUrl)}</span>
            )}
          </label>
          <label className="field" data-online-field="stt-model" title="Model name your provider transcribes with.">
            <span className="field-label">STT Model</span>
            <input id="sttModelInput" type="text" placeholder="Use default STT model" autoComplete="off" value={settings.sttModelName} onChange={(event) => dispatchSettingsPatch({ sttModelName: event.target.value })} />
          </label>
        </div>

        <label className="field" title="Your provider key. Stored in the Windows credential store.">
          <span className="field-label">API Key</span>
          <input id="apiKeyInput" type="password" placeholder="Paste your API key" autoComplete="off" value={settings.apiKey} onChange={(event) => dispatchSettingsPatch({ apiKey: event.target.value })} />
        </label>
        <label className="checkbox-field" title="Keep the key on this machine so you are not asked again.">
          <input id="rememberApiKeyInput" type="checkbox" checked={settings.rememberApiKey} onChange={(event) => dispatchSettingsPatch({ rememberApiKey: event.target.checked })} />
          <span>Remember API key locally on this machine</span>
        </label>

        <label className="field" data-online-field="ai-model" title="Model name your provider rewrites with.">
          <span className="field-label">AI Model</span>
          <input id="aiModelInput" type="text" placeholder="Use default AI model" autoComplete="off" value={settings.aiModelName} onChange={(event) => dispatchSettingsPatch({ aiModelName: event.target.value })} />
        </label>

        <label className="field" title="Models your key can reach. Fetch to load the list.">
          <span className="field-label">Model Catalog</span>
          <select id="providerModelCatalogSelect">
            <option value="">Fetch models to load catalog...</option>
          </select>
        </label>
        <div className="btn-row" title="Load the provider's model list, then apply one to AI or STT.">
          <button id="fetchProviderModelsBtn" className="btn" type="button" title="Ask the provider which models your key can use.">Fetch models</button>
          <button id="applyModelToAiBtn" className="btn" type="button" title="Use the selected model for rewriting.">Use for AI</button>
          <button id="applyModelToSttBtn" className="btn" type="button" title="Use the selected model for transcription.">Use for STT</button>
        </div>
        <p id="onlineProviderModeNotice" className="field-hint"></p>

        <AdvancedSettings title="Active connection details">
          <div className="status-detail-grid" title="What the last run actually used.">
            <div className="status-detail-row">
              <span className="status-detail-label">Base URL</span>
              <code id="baseUrlValue" className="status-detail-value">loading...</code>
            </div>
            <div className="status-detail-row">
              <span className="status-detail-label">STT Model</span>
              <code id="sttModelValue" className="status-detail-value">loading...</code>
            </div>
            <div className="status-detail-row">
              <span className="status-detail-label">AI Model</span>
              <code id="aiModelValue" className="status-detail-value">loading...</code>
            </div>
          </div>
        </AdvancedSettings>
          </div>
        </SettingsGroup>
      </div>

      <div
        id="settingsSection-models-local-ai"
        className="settings-category"
        data-settings-section-owner="models"
        data-settings-section="local-ai"
        hidden
      >
        <SettingsGroup title="Ollama connection">
          <p className="field-hint">These controls are used when AI rewriting is set to Offline.</p>
          <div id="offlineOllamaSection">
        <div className="compact-grid">
          <label className="field" title="Address of your local Ollama server.">
            <span className="field-label">Base URL</span>
            <input id="localOllamaBaseUrlInput" type="text" placeholder={DEFAULT_LOCAL_OLLAMA_BASE_URL} autoComplete="off" value={settings.localOllamaBaseUrl} onChange={(event) => dispatchSettingsPatch({ localOllamaBaseUrl: event.target.value })} />
          </label>
          <label className="field" title="Ollama model used for rewriting.">
            <span className="field-label">Model</span>
            <input id="localOllamaModelInput" type="text" placeholder="llama3.1:8b, qwen2.5:7b, etc." autoComplete="off" value={settings.localOllamaModel} onChange={(event) => dispatchSettingsPatch({ localOllamaModel: event.target.value })} />
          </label>
        </div>
        <label className="field" title="Models Ollama already has. Fetch to load the list.">
          <span className="field-label">Model Catalog</span>
          <select id="localOllamaModelCatalogSelect">
            <option value="">Fetch models to load catalog...</option>
          </select>
        </label>
        <p id="ollamaStatusNotice" className="field-hint"></p>
        <div className="btn-row" title="Set up Ollama, list what it has, and pick a model.">
          <button id="checkOllamaStatusBtn" className="btn" type="button" title="See whether Ollama is running on this machine.">Check status</button>
          <button id="installOllamaBtn" className="btn" type="button" title="Open the Ollama download page.">Install Ollama</button>
          <button id="fetchOllamaModelsBtn" className="btn" type="button" title="List the models Ollama already has.">Fetch models</button>
          <button id="useOllamaModelBtn" className="btn" type="button" title="Make the chosen model the active one.">Use selected</button>
          <button id="pullOllamaModelBtn" className="btn" type="button" title="Download the chosen model through Ollama.">Pull model</button>
        </div>
          </div>
        </SettingsGroup>
      </div>

      <div
        id="settingsSection-models-local-stt"
        className="settings-category"
        data-settings-section-owner="models"
        data-settings-section="local-stt"
        hidden
      >
        <SettingsGroup title="Parakeet model">
          <p className="field-hint">These controls are used when speech-to-text is set to Offline.</p>
          <div id="offlineSttSection">
        <label className="field" title="The local STT model in use.">
          <span className="field-label">Selected Model</span>
          <input id="localSttModelInput" type="text" placeholder="Select a model from catalog below" autoComplete="off" readOnly />
        </label>
        <label className="field" title="Models you can run offline. Pick one to download.">
          <span className="field-label">Model Catalog</span>
          <select id="localSttModelCatalogSelect">
            <option value="">Loading built-in model catalog...</option>
          </select>
        </label>

        <div className="s-row" title="Whether the model is downloaded and loaded.">
          <span className="s-row-label">
            Status
            <span id="localSttStatusDetail" className="s-row-hint">Select a local STT model to download and use it offline.</span>
          </span>
          <span id="localSttStatusBadge" className="status-pill" data-state="idle" aria-live="polite">Not selected</span>
        </div>

        <div className="btn-row" title="Manage the files for the selected offline model.">
          <button id="downloadLocalSttModelBtn" className="btn btn-primary" type="button" title="Download the model and load it for offline use.">Download &amp; install</button>
          <button id="deleteLocalSttModelBtn" className="btn" type="button" title="Remove the downloaded model files.">Delete</button>
          <button id="openLocalSttModelPathBtn" className="btn" type="button" title="Show the model folder in Explorer.">Open folder</button>
        </div>

        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
          <span id="localSttDownloadProgressBar" className="progress-fill"></span>
        </div>
        <p id="localSttDownloadProgressText" className="field-hint">No download in progress.</p>
        <p id="localSttDownloadNotice" className="field-hint"></p>
          </div>
          <p id="offlineRuntimeModeNotice" className="field-hint">In local mode, pipeline uses Ollama for AI and your selected local STT model for transcription.</p>
        </SettingsGroup>
      </div>

      <div
        id="settingsSection-models-voice"
        className="settings-category"
        data-settings-section-owner="models"
        data-settings-section="voice"
        hidden
      >
        <SettingsGroup title="Voice engine">
          <div id="ttsBootstrapCard">
        <div className="s-row" title="One-time install of the Piper speech engine and its voice.">
          <span className="s-row-label">
            Piper Runtime
            <span className="s-row-hint">Install and configure TTS dependencies with live progress logs.</span>
          </span>
          <button id="setupAllTtsBtn" className="btn btn-primary" type="button">Setup TTS runtime</button>
        </div>
        <p id="ttsSetupStatus" className="field-hint">Waiting for setup.</p>
        <div id="ttsSetupLogs" className="log-box" aria-live="polite">
          <p>No setup logs yet.</p>
        </div>
      </div>

      <div id="ttsProfilesArea" hidden>
        <label className="field" title="Piper uses a fixed voice; cloned voice uses a recording of you.">
          <span className="field-label">Active Engine</span>
          <select id="ttsEngineSelect">
            <option value="piper">Piper (fixed voice)</option>
            <option value="zipvoice">Cloned voice (ZipVoice)</option>
          </select>
        </label>

        <div className="profile-tabs" role="tablist" aria-label="TTS profiles">
          <button id="ttsProfilePiperTab" className={cloneTab === 'piper' ? 'profile-tab is-active' : 'profile-tab'} type="button" title="Settings for the fixed Piper voice." onClick={() => setCloneTab('piper')}>Piper</button>
          <button id="ttsProfileCloneTab" className={cloneTab === 'clone' ? 'profile-tab is-active' : 'profile-tab'} type="button" title="Train and manage voices cloned from your own recording." onClick={() => setCloneTab('clone')}>Cloned voice</button>
        </div>

        <div id="ttsProfilePiperPanel" hidden={cloneTab !== 'piper'}>
          <label className="field" title="Point at your own piper.exe if you keep one elsewhere.">
            <span className="field-label">Executable Path <span className="switch-desc">(optional override)</span></span>
            <input id="piperPathInput" type="text" placeholder="Auto-filled after runtime setup" autoComplete="off" value={settings.piperPath} onChange={(event) => dispatchSettingsPatch({ piperPath: event.target.value })} />
          </label>
          <div className="compact-grid">
            <label className="field" title="Higher quality is slower to speak.">
              <span className="field-label">Voice Quality</span>
              <select id="piperQualitySelect" value={settings.piperQuality} onChange={(event) => dispatchSettingsPatch({ piperQuality: event.target.value as typeof settings.piperQuality })}>
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="high">High quality</option>
              </select>
            </label>
            <label className="field" title="Expressive preset applied to the voice.">
              <span className="field-label">Emotion Style</span>
              <select id="piperEmotionSelect" value={settings.piperEmotion} onChange={(event) => dispatchSettingsPatch({ piperEmotion: event.target.value as typeof settings.piperEmotion })}>
                <option value="neutral">Neutral</option>
                <option value="calm">Calm</option>
                <option value="happy">Happy</option>
                <option value="excited">Excited</option>
                <option value="serious">Serious</option>
                <option value="sad">Sad</option>
              </select>
            </label>
          </div>
          <label className="field" title="How fast the voice speaks.">
            <span className="field-label">Speed <strong id="piperSpeedValue">{settings.piperSpeed.toFixed(2)}x</strong></span>
            <input id="piperSpeedInput" type="range" min="0.5" max="2" step="0.05" value={settings.piperSpeed} onChange={(event) => dispatchSettingsPatch({ piperSpeed: Number(event.target.value) })} />
          </label>
          <p className="field-hint">Emotion/quality for Piper are expressive presets, not true voice cloning.</p>
          <div className="btn-row" title="Repair or check the Piper install without losing your settings.">
            <button id="setupRuntimeBtn" className="btn" type="button" title="Run the engine install again.">Re-setup Piper</button>
            <button id="validatePiperBtn" className="btn" type="button" title="Check the installed files are usable.">Validate Piper</button>
            <button id="downloadVoiceBtn" className="btn" type="button" title="Re-download just the voice file.">Download voice only</button>
          </div>
          <div className="status-detail-grid">
            <div className="status-detail-row">
              <span className="status-detail-label">Piper Status</span>
              <code id="piperStatusValue" className="status-detail-value">checking...</code>
            </div>
            <div className="status-detail-row">
              <span className="status-detail-label">Piper Path</span>
              <code id="piperPathValue" className="status-detail-value">-</code>
            </div>
            <div className="status-detail-row">
              <span className="status-detail-label">Voice Status</span>
              <code id="voiceStatusValue" className="status-detail-value">checking...</code>
            </div>
            <div className="status-detail-row">
              <span className="status-detail-label">Voice Path</span>
              <code id="voicePathValue" className="status-detail-value">-</code>
            </div>
          </div>
        </div>

        <div id="ttsProfileClonePanel" hidden={cloneTab !== 'clone'}>
          <div className="status-detail-grid">
            <div className="status-detail-row">
              <span className="status-detail-label">Clone Model</span>
              <code id="voiceCloneModelValue" className="status-detail-value">
                {cloneStatus === null ? 'checking...' : modelReady ? 'installed' : 'not downloaded'}
              </code>
            </div>
            <div className="status-detail-row">
              <span className="status-detail-label">Engine</span>
              <code id="voiceCloneEngineValue" className="status-detail-value">
                {cloneStatus?.engineLoaded ? 'loaded in memory' : 'idle'}
              </code>
            </div>
          </div>
          <div className="btn-row">
            <button
              id="ensureVoiceCloneModelBtn"
              title="Downloads the voice-cloning model once, about 156 MB."
              className="btn"
              type="button"
              disabled={cloneBusy}
              onClick={() =>
                void withCloneBusy(async () => {
                  const result = await ensureVoiceCloneModel();
                  await refreshVoices();
                  return `Clone model ready in ${result.modelDir}.`;
                })
              }
            >
              Download clone model (~156 MB)
            </button>
            <button
              id="unloadVoiceCloneModelBtn"
              title="Free the clone model from memory."
              className="btn"
              type="button"
              disabled={cloneBusy}
              onClick={() =>
                void withCloneBusy(async () => {
                  const result = await unloadVoiceCloneModel();
                  await refreshVoices();
                  return result.engineLoaded ? 'Clone engine still loaded.' : 'Clone engine unloaded.';
                })
              }
            >
              Unload model
            </button>
            <button
              id="refreshVoiceClonesBtn"
              title="Re-read the saved voice profiles."
              className="btn"
              type="button"
              disabled={cloneBusy}
              onClick={() => void withCloneBusy(async () => {
                await refreshVoices();
                return `Found ${voices.length} cloned voice profile(s).`;
              })}
            >
              Refresh voices
            </button>
          </div>

          <label className="field" title="Read this sentence exactly — the clone is built from these words, so it must match.">
            <span className="field-label">Enrolment sentence <span className="switch-desc">(read this aloud, exactly)</span></span>
            <code id="voiceCloneSentence" className="status-detail-value">{ENROLMENT_SENTENCE}</code>
          </label>
          <label className="field" title="A clean WAV of you reading the sentence, 3 to 30 seconds.">
            <span className="field-label">Reference clip <span className="switch-desc">(WAV, 3-30s)</span></span>
            <input
              id="voiceCloneFileInput"
              type="file"
              accept="audio/wav,audio/x-wav,audio/wave,.wav"
              onChange={(event) => setReferenceFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className="field" title="Type exactly what the clip says.">
            <span className="field-label">Words spoken in the clip</span>
            <input
              id="voiceCloneReferenceTextInput"
              type="text"
              autoComplete="off"
              value={referenceText}
              onChange={(event) => setReferenceText(event.target.value)}
            />
          </label>
          <label className="field" title="A short name to save this voice under.">
            <span className="field-label">Voice profile ID</span>
            <input
              id="voiceCloneIdInput"
              type="text"
              placeholder="my_voice"
              autoComplete="off"
              value={newVoiceId}
              onChange={(event) => setNewVoiceId(event.target.value)}
            />
          </label>
          <div className="btn-row">
            <button
              id="cloneVoiceBtn"
              title="Build a voice profile from the clip and its words."
              className="btn btn-primary"
              type="button"
              disabled={cloneBusy}
              onClick={() =>
                void withCloneBusy(async () => {
                  if (!referenceFile) return 'Choose a reference clip first.';
                  if (!newVoiceId.trim()) return 'Give the voice profile an ID.';
                  const audioBase64 = await readFileAsBase64(referenceFile);
                  const result = await cloneVoice({
                    speakerId: newVoiceId.trim(),
                    audioBase64,
                    fileName: referenceFile.name,
                    referenceText,
                    speed: settings.voiceCloneSpeed,
                  });
                  setVoices(result.voices);
                  dispatchSettingsPatch({ voiceCloneSpeakerId: result.speakerId });
                  playPreview(result.previewAudioBase64);
                  await refreshVoices();
                  return `Cloned '${result.speakerId}' from ${result.durationSeconds.toFixed(1)}s of audio.`;
                })
              }
            >
              Clone voice
            </button>
            <button
              id="testVoiceCloneBtn"
              title="Speak a sample line with this voice."
              className="btn"
              type="button"
              disabled={cloneBusy || !settings.voiceCloneSpeakerId}
              onClick={() =>
                void withCloneBusy(async () => {
                  const result = await previewClonedVoice({
                    speakerId: settings.voiceCloneSpeakerId,
                    speed: settings.voiceCloneSpeed,
                  });
                  playPreview(result.audioBase64);
                  return 'Preview ready.';
                })
              }
            >
              Test voice
            </button>
            <button
              id="deleteVoiceCloneBtn"
              title="Remove this voice profile."
              className="btn"
              type="button"
              disabled={cloneBusy || !settings.voiceCloneSpeakerId}
              onClick={() =>
                void withCloneBusy(async () => {
                  const removed = settings.voiceCloneSpeakerId;
                  const result = await deleteVoiceClone({ speakerId: removed });
                  setVoices(result.voices);
                  dispatchSettingsPatch({ voiceCloneSpeakerId: '' });
                  return `Deleted '${removed}'.`;
                })
              }
            >
              Delete voice
            </button>
          </div>

          <label className="field" title="Pick which cloned voice reads your replies.">
            <span className="field-label">Saved cloned voices</span>
            <select
              id="voiceCloneSelect"
              value={settings.voiceCloneSpeakerId}
              onChange={(event) => dispatchSettingsPatch({ voiceCloneSpeakerId: event.target.value })}
            >
              <option value="">{voices.length ? 'None selected' : 'No voices found'}</option>
              {voices.map((voice) => (
                <option key={voice} value={voice}>{voice}</option>
              ))}
            </select>
          </label>
          <label className="field" title="How fast the cloned voice speaks.">
            <span className="field-label">Speed <strong id="voiceCloneSpeedValue">{settings.voiceCloneSpeed.toFixed(2)}x</strong></span>
            <input
              id="voiceCloneSpeedInput"
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              value={settings.voiceCloneSpeed}
              onChange={(event) => dispatchSettingsPatch({ voiceCloneSpeed: Number(event.target.value) })}
            />
          </label>
          <p id="voiceCloneStatusText" className="field-hint">{cloneMessage}</p>
          <audio id="voiceClonePreview" controls preload="none" src={previewUrl || undefined}></audio>
          <p className="field-hint">ZipVoice clones from the clip plus its exact wording, so a clean 3-30 second WAV of the sentence above gives the best result.</p>
        </div>
      </div>
        </SettingsGroup>
      </div>
    </section>
  );
}
