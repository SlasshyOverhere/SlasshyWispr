import {
  useMaxTokensBounds,
  useSettingsSnapshot,
  useSttTimeoutBounds,
  useTemperatureBounds,
  dispatchSettingsPatch,
} from '../../settings/settings-react-shim';

export function PipelineSettingsPane() {
  const settings = useSettingsSnapshot();
  const sttTimeoutBounds = useSttTimeoutBounds();
  const maxTokensBounds = useMaxTokensBounds();
  const temperatureBounds = useTemperatureBounds();

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
          placeholder="Leave empty to use the built-in cleanup prompt."
          value={settings.systemPrompt}
          onChange={(event) => dispatchSettingsPatch({ systemPrompt: event.target.value })}
        ></textarea>
        <span className="field-hint">
          Empty means the app uses its built-in prompt, which is kept up to date with each
          release. Anything you type here replaces it until you clear the field.
        </span>
      </label>

      <label className="field" htmlFor="temperatureInput">
        <span className="field-label">Temperature <strong id="temperatureValue">{settings.temperature.toFixed(2)}</strong></span>
        <input
          id="temperatureInput"
          type="range"
          min={temperatureBounds.minTemperature}
          max={temperatureBounds.maxTemperature}
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
          min={maxTokensBounds.minTokens}
          max={maxTokensBounds.maxTokens}
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

      {/* Filled imperatively: the rows are created and dismissed by the shell. */}
      <div id="noticeStack" className="notice-stack" aria-live="polite" />

      <label className="field" htmlFor="assistantAudio">
        <span className="field-label">Voice Preview</span>
        <audio id="assistantAudio" controls preload="none"></audio>
      </label>

    </section>
  );
}
