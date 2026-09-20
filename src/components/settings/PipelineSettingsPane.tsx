import {
  useSettingsSnapshot,
  useSttTimeoutBounds,
  dispatchSettingsPatch,
} from '../../settings/settings-react-shim';

export function PipelineSettingsPane() {
  const settings = useSettingsSnapshot();
  const sttTimeoutBounds = useSttTimeoutBounds();

  return (
    <section id="settingsPanePipeline" className="settings-pane" data-settings-pane="pipeline" hidden>

      <h3 className="settings-section-title">Speech-to-Text</h3>

      <label className="field" htmlFor="sttTimeoutSecondsInput">
        <span className="field-label">Request Timeout (seconds)</span>
        <input
          id="sttTimeoutSecondsInput"
          type="number"
          min={sttTimeoutBounds.minSeconds}
          max={sttTimeoutBounds.maxSeconds}
          step="5"
          value={settings.sttTimeoutSeconds}
          onChange={(event) => dispatchSettingsPatch({ sttTimeoutSeconds: Number(event.target.value) })}
        />
      </label>
      <p className="field-hint">How long one online transcription may run before it is abandoned. Longer recordings need a higher ceiling.</p>

      <h3 className="settings-section-title">Prompting</h3>

      <label className="field" htmlFor="systemPromptInput">
        <span className="field-label">System Prompt</span>
        <textarea
          id="systemPromptInput"
          rows={4}
          spellCheck="false"
          value={settings.systemPrompt}
          onChange={(event) => dispatchSettingsPatch({ systemPrompt: event.target.value })}
        ></textarea>
      </label>

      <label className="field" htmlFor="temperatureInput">
        <span className="field-label">Temperature <strong id="temperatureValue">{settings.temperature.toFixed(2)}</strong></span>
        <input
          id="temperatureInput"
          type="range"
          min="0"
          max="1.2"
          step="0.05"
          value={settings.temperature}
          onChange={(event) => dispatchSettingsPatch({ temperature: Number(event.target.value) })}
        />
      </label>

      <label className="field" htmlFor="maxTokensInput">
        <span className="field-label">Max Tokens</span>
        <input
          id="maxTokensInput"
          type="number"
          min="64"
          max="1024"
          step="16"
          value={settings.maxTokens}
          onChange={(event) => dispatchSettingsPatch({ maxTokens: Number(event.target.value) })}
        />
      </label>

      <h3 className="settings-section-title">Pipeline Status</h3>

      <div className="s-row">
        <span className="s-row-label">
          Status
          <span id="statusDetail" className="s-row-hint">Ready.</span>
        </span>
        <div id="statusPill" className="status-pill" data-stage="idle">Idle</div>
      </div>

      <dl className="latency-inline" aria-live="polite">
        <dt>STT</dt><dd id="sttLatency">-</dd>
        <dt>AI</dt><dd id="aiLatency">-</dd>
        <dt>TTS</dt><dd id="ttsLatency">-</dd>
        <dt>Total</dt><dd id="totalLatency">-</dd>
      </dl>

      <div className="notice-row">
        <p id="noticeText" className="field-hint" aria-live="polite">
          Ready.
        </p>
        <button
          id="noticeDismiss"
          className="notice-dismiss"
          type="button"
          aria-label="Dismiss notice"
          title="Dismiss notice"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <label className="field" htmlFor="assistantAudio">
        <span className="field-label">Voice Preview</span>
        <audio id="assistantAudio" controls preload="none"></audio>
      </label>

    </section>
  );
}
