import { DEFAULT_LOCAL_OLLAMA_BASE_URL } from '../../constants';

export function ModelsSettingsPane() {
  return (
    <section id="settingsPaneModels" className="settings-pane" data-settings-pane="models" hidden>

      <h3 className="settings-section-title">Runtime</h3>

      <div className="runtime-card">
        <div className="runtime-card-header">
          <span className="runtime-card-title">Speech-to-Text</span>
          <div className="pills">
            <label className="pill"><input id="sttRuntimeModeOnline" name="sttRuntimeModeProfile" type="radio" value="online" />Online</label>
            <label className="pill"><input id="sttRuntimeModeOffline" name="sttRuntimeModeProfile" type="radio" value="offline" />Offline</label>
          </div>
        </div>
      </div>

      <div className="runtime-card">
        <div className="runtime-card-header">
          <span className="runtime-card-title">AI Model</span>
          <div className="pills">
            <label className="pill"><input id="aiRuntimeModeOnline" name="aiRuntimeModeProfile" type="radio" value="online" />Online</label>
            <label className="pill"><input id="aiRuntimeModeOffline" name="aiRuntimeModeProfile" type="radio" value="offline" />Offline</label>
          </div>
        </div>
      </div>

      <p id="runtimeModeNotice" className="field-hint"></p>

      <h3 className="settings-section-title">Online Provider</h3>

      <div id="onlineProviderSection">
        <div className="compact-grid">
          <label className="field" data-online-field="base-url">
            <span className="field-label">API Base URL</span>
            <input id="apiBaseUrlInput" type="text" placeholder="Use default provider URL" autoComplete="off" />
          </label>
          <label className="field" data-online-field="stt-model">
            <span className="field-label">STT Model</span>
            <input id="sttModelInput" type="text" placeholder="Use default STT model" autoComplete="off" />
          </label>
        </div>

        <label className="field">
          <span className="field-label">API Key</span>
          <input id="apiKeyInput" type="password" placeholder="Paste your API key" autoComplete="off" />
        </label>
        <label className="checkbox-field">
          <input id="rememberApiKeyInput" type="checkbox" />
          <span>Remember API key locally on this machine</span>
        </label>

        <label className="field" data-online-field="ai-model">
          <span className="field-label">AI Model</span>
          <input id="aiModelInput" type="text" placeholder="Use default AI model" autoComplete="off" />
        </label>

        <label className="field">
          <span className="field-label">Model Catalog</span>
          <select id="providerModelCatalogSelect">
            <option value="">Fetch models to load catalog...</option>
          </select>
        </label>
        <div className="btn-row">
          <button id="fetchProviderModelsBtn" className="btn" type="button">Fetch models</button>
          <button id="applyModelToAiBtn" className="btn" type="button">Use for AI</button>
          <button id="applyModelToSttBtn" className="btn" type="button">Use for STT</button>
        </div>
        <p id="onlineProviderModeNotice" className="field-hint"></p>

        <div className="status-detail-grid">
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
      </div>

      <h3 className="settings-section-title">Local AI (Ollama)</h3>

      <div id="offlineOllamaSection">
        <div className="compact-grid">
          <label className="field">
            <span className="field-label">Base URL</span>
            <input id="localOllamaBaseUrlInput" type="text" placeholder={DEFAULT_LOCAL_OLLAMA_BASE_URL} autoComplete="off" />
          </label>
          <label className="field">
            <span className="field-label">Model</span>
            <input id="localOllamaModelInput" type="text" placeholder="llama3.1:8b, qwen2.5:7b, etc." autoComplete="off" />
          </label>
        </div>
        <label className="field">
          <span className="field-label">Model Catalog</span>
          <select id="localOllamaModelCatalogSelect">
            <option value="">Fetch models to load catalog...</option>
          </select>
        </label>
        <p id="ollamaStatusNotice" className="field-hint"></p>
        <div className="btn-row">
          <button id="checkOllamaStatusBtn" className="btn" type="button">Check status</button>
          <button id="installOllamaBtn" className="btn" type="button">Install Ollama</button>
          <button id="fetchOllamaModelsBtn" className="btn" type="button">Fetch models</button>
          <button id="useOllamaModelBtn" className="btn" type="button">Use selected</button>
          <button id="pullOllamaModelBtn" className="btn" type="button">Pull model</button>
        </div>
      </div>

      <h3 className="settings-section-title">Local STT (Parakeet)</h3>

      <div id="offlineSttSection">
        <label className="field">
          <span className="field-label">Selected Model</span>
          <input id="localSttModelInput" type="text" placeholder="Select a model from catalog below" autoComplete="off" readOnly />
        </label>
        <label className="field">
          <span className="field-label">Model Catalog</span>
          <select id="localSttModelCatalogSelect">
            <option value="">Loading built-in model catalog...</option>
          </select>
        </label>

        <div className="s-row">
          <span className="s-row-label">
            Status
            <span id="localSttStatusDetail" className="s-row-hint">Select a local STT model to download and use it offline.</span>
          </span>
          <span id="localSttStatusBadge" className="status-pill" data-state="idle" aria-live="polite">Not selected</span>
        </div>

        <div className="btn-row">
          <button id="downloadLocalSttModelBtn" className="btn btn-primary" type="button">Download &amp; install</button>
          <button id="deleteLocalSttModelBtn" className="btn" type="button">Delete</button>
          <button id="openLocalSttModelPathBtn" className="btn" type="button">Open folder</button>
        </div>

        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100}>
          <span id="localSttDownloadProgressBar" className="progress-fill"></span>
        </div>
        <p id="localSttDownloadProgressText" className="field-hint">No download in progress.</p>
        <p id="localSttDownloadNotice" className="field-hint"></p>
      </div>

      <p id="offlineRuntimeModeNotice" className="field-hint">In local mode, pipeline uses Ollama for AI and your selected local STT model for transcription.</p>

      <h3 className="settings-section-title">TTS Setup</h3>

      <div id="ttsBootstrapCard">
        <div className="s-row">
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
        <h3 className="settings-section-title">TTS Profiles</h3>

        <label className="field">
          <span className="field-label">Active Engine</span>
          <select id="ttsEngineSelect">
            <option value="piper">Piper (Main)</option>
            <option value="coqui">Coqui (Disabled)</option>
          </select>
        </label>

        <div className="compact-grid">
          <label className="field">
            <span className="field-label">Quality</span>
            <select id="coquiQualitySelect">
              <option value="fast">Fast</option>
              <option value="balanced">Balanced</option>
              <option value="high">High quality</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">Emotion Style</span>
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
          <span className="field-label">Speed <strong id="coquiSpeedValue">1.00x</strong></span>
          <input id="coquiSpeedInput" type="range" min="0.5" max="2" step="0.05" />
        </label>
        <label className="checkbox-field">
          <input id="coquiSplitSentencesToggle" type="checkbox" />
          <span>Split long replies into shorter sentence chunks (Coqui)</span>
        </label>

        <div className="profile-tabs" role="tablist" aria-label="TTS profiles">
          <button id="ttsProfilePiperTab" className="profile-tab is-active" type="button">Piper</button>
          <button id="ttsProfileCoquiTab" className="profile-tab" type="button">Coqui (Beta)</button>
        </div>

        <div id="ttsProfilePiperPanel">
          <label className="field">
            <span className="field-label">Executable Path <span className="switch-desc">(optional override)</span></span>
            <input id="piperPathInput" type="text" placeholder="Auto-filled after runtime setup" autoComplete="off" />
          </label>
          <div className="compact-grid">
            <label className="field">
              <span className="field-label">Voice Quality</span>
              <select id="piperQualitySelect">
                <option value="fast">Fast</option>
                <option value="balanced">Balanced</option>
                <option value="high">High quality</option>
              </select>
            </label>
            <label className="field">
              <span className="field-label">Emotion Style</span>
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
            <span className="field-label">Speed <strong id="piperSpeedValue">1.00x</strong></span>
            <input id="piperSpeedInput" type="range" min="0.5" max="2" step="0.05" />
          </label>
          <p className="field-hint">Emotion/quality for Piper are expressive presets, not true voice cloning.</p>
          <div className="btn-row">
            <button id="setupRuntimeBtn" className="btn" type="button">Re-setup Piper</button>
            <button id="validatePiperBtn" className="btn" type="button">Validate Piper</button>
            <button id="downloadVoiceBtn" className="btn" type="button">Download voice only</button>
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

        <div id="ttsProfileCoquiPanel" hidden>
          <p className="field-hint">Coqui is beta and loads only when you select it.</p>
          <label className="field">
            <span className="field-label">Python Path <span className="switch-desc">(optional override)</span></span>
            <input id="coquiPythonPathInput" type="text" placeholder="Leave blank to use bundled/runtime python" autoComplete="off" />
          </label>
          <label className="field">
            <span className="field-label">Coqui Model</span>
            <input id="coquiModelInput" type="text" placeholder="tts_models/multilingual/multi-dataset/xtts_v2" autoComplete="off" />
          </label>
          <label className="field">
            <span className="field-label">Language Code</span>
            <input id="coquiLanguageInput" type="text" placeholder="en" autoComplete="off" />
          </label>
          <label className="checkbox-field">
            <input id="coquiUseGpuToggle" type="checkbox" />
            <span>Use CUDA/GPU if available</span>
          </label>
          <div className="btn-row">
            <button id="setupCoquiBtn" className="btn" type="button">Re-setup Coqui</button>
            <button id="validateCoquiBtn" className="btn" type="button">Validate Coqui</button>
            <button id="refreshCoquiModelsBtn" className="btn" type="button">Refresh models</button>
          </div>
          <label className="field">
            <span className="field-label">Model Catalog</span>
            <select id="coquiModelCatalogSelect">
              <option value="">Load models list...</option>
            </select>
          </label>
          <div className="status-detail-grid">
            <div className="status-detail-row">
              <span className="status-detail-label">Status</span>
              <code id="coquiStatusValue" className="status-detail-value">checking...</code>
            </div>
            <div className="status-detail-row">
              <span className="status-detail-label">Python</span>
              <code id="coquiPythonValue" className="status-detail-value">-</code>
            </div>
            <div className="status-detail-row">
              <span className="status-detail-label">TTS Version</span>
              <code id="coquiVersionValue" className="status-detail-value">-</code>
            </div>
            <div className="status-detail-row">
              <span className="status-detail-label">CUDA</span>
              <code id="coquiCudaValue" className="status-detail-value">-</code>
            </div>
            <div className="status-detail-row">
              <span className="status-detail-label">Voice Dir</span>
              <code id="coquiVoiceDirValue" className="status-detail-value">-</code>
            </div>
          </div>
          <label className="field">
            <span className="field-label">Voice Profile ID</span>
            <input id="coquiVoiceIdInput" type="text" placeholder="my_voice_profile" autoComplete="off" />
          </label>
          <label className="field">
            <span className="field-label">Reference Sample <span className="switch-desc">(WAV/MP3/WEBM, max 30s)</span></span>
            <input id="coquiVoiceFileInput" type="file" accept="audio/*" />
          </label>
          <p id="coquiCloneStatus" className="field-hint">Ready to clone a voice sample.</p>
          <div className="btn-row">
            <button id="cloneCoquiVoiceBtn" className="btn btn-primary" type="button">Clone voice</button>
            <button id="testCoquiVoiceBtn" className="btn" type="button">Test voice</button>
            <button id="refreshCoquiVoicesBtn" className="btn" type="button">Refresh voices</button>
          </div>
          <label className="field">
            <span className="field-label">Saved Cloned Voices</span>
            <select id="coquiVoiceSelect">
              <option value="">No voices found</option>
            </select>
          </label>
          <audio id="coquiVoicePreview" controls preload="none"></audio>
          <p className="field-hint">Upload a clean sample between 3 and 30 seconds for best cloning quality.</p>
        </div>
      </div>
    </section>
  );
}
