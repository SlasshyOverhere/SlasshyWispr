import { DEFAULT_LOCAL_OLLAMA_BASE_URL } from '../../constants';

export function ModelsSettingsPane() {
  return (
    <section className="settings-pane" data-settings-pane="models" hidden>
      <h3 className="settings-section-title">Models</h3>
      <div className="settings-card">
        <div className="settings-row">
          <div className="full-row">
            <h3>Runtime routing</h3>
            <p>Choose STT and AI runtime independently.</p>
            <div className="capture-mode-pills runtime-mode-pills">
              <span>STT:</span>
              <label><input id="sttRuntimeModeOnline" name="sttRuntimeModeProfile" type="radio" value="online" />Online</label>
              <label><input id="sttRuntimeModeOffline" name="sttRuntimeModeProfile" type="radio" value="offline" />Offline</label>
            </div>
            <div className="capture-mode-pills runtime-mode-pills">
              <span>AI:</span>
              <label><input id="aiRuntimeModeOnline" name="aiRuntimeModeProfile" type="radio" value="online" />Online</label>
              <label><input id="aiRuntimeModeOffline" name="aiRuntimeModeProfile" type="radio" value="offline" />Offline</label>
            </div>
            <p id="runtimeModeNotice" className="notice">
              Online mode is active. API base URL + API key will be used for STT and AI.
            </p>
          </div>
        </div>

        <div id="onlineProviderSection" className="settings-row">
          <div className="full-row">
            <h3>Online provider models</h3>
            <div className="compact-grid">
              <label className="field" data-online-field="base-url">
                <span>API Base URL</span>
                <input id="apiBaseUrlInput" type="text" placeholder="Use default provider URL" autoComplete="off" />
              </label>
              <label className="field" data-online-field="stt-model">
                <span>STT model</span>
                <input id="sttModelInput" type="text" placeholder="Use default STT model" autoComplete="off" />
              </label>
            </div>
            <label className="field">
              <span>Provider API Key</span>
              <input id="apiKeyInput" type="password" placeholder="Paste your API key" autoComplete="off" />
            </label>
            <label className="checkbox-field">
              <input id="rememberApiKeyInput" type="checkbox" />
              <span>Remember API key locally on this machine</span>
            </label>
            <label className="field" data-online-field="ai-model">
              <span>AI model</span>
              <input id="aiModelInput" type="text" placeholder="Use default AI model" autoComplete="off" />
            </label>
            <label className="field">
              <span>Model catalog</span>
              <select id="providerModelCatalogSelect">
                <option value="">Fetch models to load catalog...</option>
              </select>
            </label>
            <div className="button-row">
              <button id="fetchProviderModelsBtn" className="ghost-action" type="button">Fetch models</button>
              <button id="applyModelToAiBtn" className="ghost-action" type="button">Use for AI</button>
              <button id="applyModelToSttBtn" className="ghost-action" type="button">Use for STT</button>
            </div>
            <p id="onlineProviderModeNotice" className="notice">Used only in online mode.</p>
          </div>
        </div>

        <div id="offlineOllamaSection" className="settings-row">
          <div className="full-row">
            <h3>Ollama (local AI / offline LLM)</h3>
            <div className="compact-grid">
              <label className="field">
                <span>Ollama Base URL</span>
                <input id="localOllamaBaseUrlInput" type="text" placeholder={DEFAULT_LOCAL_OLLAMA_BASE_URL} autoComplete="off" />
              </label>
              <label className="field">
                <span>Ollama model</span>
                <input id="localOllamaModelInput" type="text" placeholder="llama3.1:8b, qwen2.5:7b, etc." autoComplete="off" />
              </label>
            </div>
            <label className="field">
              <span>Ollama model catalog</span>
              <select id="localOllamaModelCatalogSelect">
                <option value="">Fetch models to load catalog...</option>
              </select>
            </label>
            <p id="ollamaStatusNotice" className="notice">Ollama status has not been checked yet.</p>
            <div className="button-row">
              <button id="checkOllamaStatusBtn" className="ghost-action" type="button">Check Ollama status</button>
              <button id="installOllamaBtn" className="ghost-action" type="button">Install Ollama</button>
              <button id="fetchOllamaModelsBtn" className="ghost-action" type="button">Fetch Ollama models</button>
              <button id="useOllamaModelBtn" className="ghost-action" type="button">Use selected model</button>
              <button id="pullOllamaModelBtn" className="ghost-action" type="button">Pull/download model</button>
            </div>
          </div>
        </div>

        <div id="offlineSttSection" className="settings-row">
          <div className="full-row">
            <h3>Local STT (Native Parakeet)</h3>
            <label className="field">
              <span>Selected local STT model</span>
              <input id="localSttModelInput" type="text" placeholder="Select a model from catalog below" autoComplete="off" readOnly />
            </label>
            <label className="field">
              <span>Model catalog (NVIDIA Parakeet)</span>
              <select id="localSttModelCatalogSelect">
                <option value="">Loading built-in model catalog...</option>
              </select>
            </label>
            <div className="local-stt-status-card" aria-live="polite">
              <div className="local-stt-status-head">
                <span className="local-stt-status-label">Offline STT status</span>
                <span id="localSttStatusBadge" className="local-stt-status-badge" data-state="idle">Not selected</span>
              </div>
              <p id="localSttStatusDetail" className="local-stt-status-detail">
                Select a local STT model to download and use it offline.
              </p>
            </div>
            <div className="button-row">
              <button id="downloadLocalSttModelBtn" className="ghost-action" type="button">Download & install selected model</button>
              <button id="deleteLocalSttModelBtn" className="ghost-action" type="button">Delete selected model</button>
              <button id="openLocalSttModelPathBtn" className="ghost-action" type="button">Open selected model folder</button>
            </div>
            <div className="stt-download-status" aria-live="polite">
              <div className="stt-download-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
                <span id="localSttDownloadProgressBar" className="stt-download-fill"></span>
              </div>
              <p id="localSttDownloadProgressText" className="notice">No local STT download in progress.</p>
            </div>
            <p id="localSttDownloadNotice" className="notice">
              Pick a model from catalog and install it directly from inside the app.
            </p>
            <p className="notice">
              Available models: Parakeet v3 (478 MB), Parakeet v2 (473 MB).
            </p>
          </div>
        </div>
        <p id="offlineRuntimeModeNotice" className="notice">
          In local mode, pipeline uses Ollama for AI and your selected local STT model for transcription.
        </p>
      </div>

      <h3 className="settings-section-title">Setup</h3>
      <div id="ttsBootstrapCard" className="settings-card tts-bootstrap-card">
        <div className="tts-bootstrap-head">
          <div>
            <h3>TTS Runtime Bootstrap</h3>
            <p>
              Use one button to install and configure Piper runtime dependencies with live progress logs.
            </p>
          </div>
          <button id="setupAllTtsBtn" className="dark-action" type="button">Setup TTS runtime</button>
        </div>
        <p id="ttsSetupStatus" className="notice">Waiting for setup.</p>
        <div id="ttsSetupLogs" className="setup-log-list" aria-live="polite">
          <p className="setup-log-item">No setup logs yet.</p>
        </div>
      </div>

      <div id="ttsProfilesArea" hidden>
        <h3 className="settings-section-title">Profiles</h3>
        <div className="settings-card tts-engine-card">
          <label className="field inline-select">
            <span>Active engine profile</span>
            <select id="ttsEngineSelect">
              <option value="piper">Piper (Main)</option>
              <option value="coqui">Coqui (Disabled)</option>
            </select>
          </label>

          <div className="compact-grid">
            <label className="field">
              <span>Quality</span>
              <select id="coquiQualitySelect">
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="high">High quality</option>
              </select>
            </label>
            <label className="field">
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

          <label className="field">
            <span>Speed <strong id="coquiSpeedValue">1.00x</strong></span>
            <input id="coquiSpeedInput" type="range" min="0.5" max="2" step="0.05" />
          </label>
          <label className="checkbox-field">
            <input id="coquiSplitSentencesToggle" type="checkbox" />
            <span>Split long replies into shorter sentence chunks (Coqui)</span>
          </label>
        </div>

        <div className="tts-profile-tabs" role="tablist" aria-label="TTS profiles">
          <button id="ttsProfilePiperTab" className="mini-tab is-active" type="button">Piper (Main)</button>
          <button id="ttsProfileCoquiTab" className="mini-tab" type="button">Coqui (Beta)</button>
        </div>

        <div id="ttsProfilePiperPanel" className="settings-card tts-profile-panel">
          <div className="tts-profile-grid">
            <label className="field">
              <span>Piper executable path (optional override)</span>
              <input id="piperPathInput" type="text" placeholder="Auto-filled after runtime setup" autoComplete="off" />
            </label>
            <div className="compact-grid">
              <label className="field">
                <span>Voice quality</span>
                <select id="piperQualitySelect">
                  <option value="fast">Fast</option>
                  <option value="balanced">Balanced</option>
                  <option value="high">High quality</option>
                </select>
              </label>
              <label className="field">
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
            <label className="field">
              <span>Speed <strong id="piperSpeedValue">1.00x</strong></span>
              <input id="piperSpeedInput" type="range" min="0.5" max="2" step="0.05" />
            </label>
            <p className="notice">Emotion/quality for Piper are expressive presets, not true voice cloning.</p>

            <div className="button-row">
              <button id="setupRuntimeBtn" className="ghost-action" type="button">Re-setup Piper</button>
              <button id="validatePiperBtn" className="ghost-action" type="button">Validate Piper</button>
              <button id="downloadVoiceBtn" className="ghost-action" type="button">Download voice only</button>
            </div>
          </div>

          <div className="model-meta">
            <div className="model-meta-grid">
              <div className="model-meta-item">
                <span className="model-meta-key">Base URL</span>
                <code id="baseUrlValue" className="model-meta-val">loading...</code>
              </div>
              <div className="model-meta-item">
                <span className="model-meta-key">STT Model</span>
                <code id="sttModelValue" className="model-meta-val">loading...</code>
              </div>
              <div className="model-meta-item">
                <span className="model-meta-key">AI Model</span>
                <code id="aiModelValue" className="model-meta-val">loading...</code>
              </div>
              <div className="model-meta-item">
                <span className="model-meta-key">Piper</span>
                <code id="piperStatusValue" className="model-meta-val">checking...</code>
              </div>
              <div className="model-meta-item">
                <span className="model-meta-key">Piper Path</span>
                <code id="piperPathValue" className="model-meta-val">-</code>
              </div>
              <div className="model-meta-item">
                <span className="model-meta-key">Voice</span>
                <code id="voiceStatusValue" className="model-meta-val">checking...</code>
              </div>
              <div className="model-meta-item">
                <span className="model-meta-key">Voice Path</span>
                <code id="voicePathValue" className="model-meta-val">-</code>
              </div>
            </div>
          </div>
        </div>

        <div id="ttsProfileCoquiPanel" className="settings-card tts-profile-panel" hidden>
          <p className="notice">Coqui is beta and loads only when you select it.</p>
          <div className="tts-profile-grid">
            <label className="field">
              <span>Python path (optional override)</span>
              <input id="coquiPythonPathInput" type="text" placeholder="Leave blank to use bundled/runtime python" autoComplete="off" />
            </label>
            <label className="field">
              <span>Coqui model</span>
              <input id="coquiModelInput" type="text" placeholder="tts_models/multilingual/multi-dataset/xtts_v2" autoComplete="off" />
            </label>
            <label className="field">
              <span>Language code</span>
              <input id="coquiLanguageInput" type="text" placeholder="en" autoComplete="off" />
            </label>
            <label className="checkbox-field">
              <input id="coquiUseGpuToggle" type="checkbox" />
              <span>Use CUDA/GPU if available</span>
            </label>

            <div className="button-row">
              <button id="setupCoquiBtn" className="ghost-action" type="button">Re-setup Coqui</button>
              <button id="validateCoquiBtn" className="ghost-action" type="button">Validate Coqui</button>
              <button id="refreshCoquiModelsBtn" className="ghost-action" type="button">Refresh models</button>
            </div>

            <label className="field">
              <span>Model catalog</span>
              <select id="coquiModelCatalogSelect">
                <option value="">Load models list...</option>
              </select>
            </label>

            <div className="model-meta">
              <div className="model-meta-grid">
                <div className="model-meta-item">
                  <span className="model-meta-key">Status</span>
                  <code id="coquiStatusValue" className="model-meta-val">checking...</code>
                </div>
                <div className="model-meta-item">
                  <span className="model-meta-key">Python</span>
                  <code id="coquiPythonValue" className="model-meta-val">-</code>
                </div>
                <div className="model-meta-item">
                  <span className="model-meta-key">TTS Version</span>
                  <code id="coquiVersionValue" className="model-meta-val">-</code>
                </div>
                <div className="model-meta-item">
                  <span className="model-meta-key">CUDA</span>
                  <code id="coquiCudaValue" className="model-meta-val">-</code>
                </div>
                <div className="model-meta-item">
                  <span className="model-meta-key">Voice Dir</span>
                  <code id="coquiVoiceDirValue" className="model-meta-val">-</code>
                </div>
              </div>
            </div>
          </div>

          <div className="tts-clone-card">
            <label className="field">
              <span>Voice profile ID</span>
              <input id="coquiVoiceIdInput" type="text" placeholder="my_voice_profile" autoComplete="off" />
            </label>
            <label className="field">
              <span>Reference sample (WAV/MP3/WEBM, max 30 seconds)</span>
              <input id="coquiVoiceFileInput" type="file" accept="audio/*" />
            </label>
            <p id="coquiCloneStatus" className="notice">Ready to clone a voice sample.</p>
            <div className="button-row">
              <button id="cloneCoquiVoiceBtn" className="ghost-action" type="button">Clone voice</button>
              <button id="testCoquiVoiceBtn" className="ghost-action" type="button">Test selected voice</button>
              <button id="refreshCoquiVoicesBtn" className="ghost-action" type="button">Refresh voices</button>
            </div>
            <label className="field">
              <span>Saved cloned voices</span>
              <select id="coquiVoiceSelect">
                <option value="">No voices found</option>
              </select>
            </label>
            <audio id="coquiVoicePreview" controls preload="none"></audio>
            <p className="notice">Upload a clean sample between 3 and 30 seconds for best cloning quality.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
