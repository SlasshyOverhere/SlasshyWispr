import {
  useMaxTokensBounds,
  useSettingsSnapshot,
  useSttTimeoutBounds,
  useTemperatureBounds,
  dispatchSettingsPatch,
} from '../../settings/settings-react-shim';
import { AdvancedSettings, SettingsGroup } from './SettingsPrimitives';

export function PipelineSettingsPane() {
  const settings = useSettingsSnapshot();
  const sttTimeoutBounds = useSttTimeoutBounds();
  const maxTokensBounds = useMaxTokensBounds();
  const temperatureBounds = useTemperatureBounds();

  return (
    <section id="settingsPanePipeline" className="settings-pane" data-settings-pane="pipeline" hidden>
      <div
        id="settingsSection-pipeline-controls"
        className="settings-category"
        data-settings-section-owner="pipeline"
        data-settings-section="controls"
      >
        <SettingsGroup title="Request limit">
          <label className="field" htmlFor="sttTimeoutSecondsInput" title="How long one online transcription may run before it is abandoned.">
            <span className="field-label">Request timeout</span>
            <input
              id="sttTimeoutSecondsInput"
              type="number"
              min={sttTimeoutBounds.minSeconds}
              max={sttTimeoutBounds.maxSeconds}
              step="5"
              value={settings.sttTimeoutSeconds}
              onChange={(event) => dispatchSettingsPatch({ sttTimeoutSeconds: Number(event.target.value) })}
            />
            <span className="field-hint">Longer recordings need a higher ceiling. Allowed range: {sttTimeoutBounds.minSeconds} to {sttTimeoutBounds.maxSeconds} seconds.</span>
          </label>
        </SettingsGroup>

        <SettingsGroup title="Prompting">
          <label className="field" htmlFor="systemPromptInput" title="Replaces the built-in cleanup prompt while filled in.">
            <span className="field-label">Custom system prompt</span>
            <textarea
              id="systemPromptInput"
              rows={5}
              spellCheck="false"
              placeholder="Leave empty to use the built-in cleanup prompt."
              value={settings.systemPrompt}
              onChange={(event) => dispatchSettingsPatch({ systemPrompt: event.target.value })}
            ></textarea>
            <span className="field-hint">Leave empty to follow the built-in prompt, which stays current with each release.</span>
          </label>
        </SettingsGroup>

        <AdvancedSettings title="Advanced generation">
          <label className="field" htmlFor="temperatureInput" title="How much the wording may vary. Low is more predictable.">
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

          <label className="field" htmlFor="maxTokensInput" title="Ceiling on the reply length.">
            <span className="field-label">Maximum response tokens</span>
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
        </AdvancedSettings>
      </div>

      <div
        id="settingsSection-pipeline-status"
        className="settings-category"
        data-settings-section-owner="pipeline"
        data-settings-section="status"
      >
        <SettingsGroup title="Current run">
          <div className="s-row" title="What the pipeline is doing right now.">
            <span className="s-row-label">
              Status
              <span id="statusDetail" className="s-row-hint">Ready.</span>
            </span>
            <div id="statusPill" className="status-pill" data-stage="idle">Idle</div>
          </div>

          <dl className="latency-inline" aria-live="polite" title="Where the time went on the last run.">
            <dt>STT</dt><dd id="sttLatency">-</dd>
            <dt>AI</dt><dd id="aiLatency">-</dd>
            <dt>TTS</dt><dd id="ttsLatency">-</dd>
            <dt>Total</dt><dd id="totalLatency">-</dd>
          </dl>
        </SettingsGroup>

        <SettingsGroup title="Voice preview">
          <label className="field" htmlFor="assistantAudio" title="Play the last generated reply.">
            <span className="field-label">Last assistant response</span>
            <audio id="assistantAudio" className="settings-audio" controls preload="none"></audio>
          </label>
        </SettingsGroup>
      </div>
    </section>
  );
}
