export function PipelineSettingsPane() {
  return (
    <section id="settingsPanePipeline" className="settings-pane" data-settings-pane="pipeline" hidden>

      <h3 className="settings-section-title">Prompting</h3>

      <label className="field" htmlFor="systemPromptInput">
        <span className="field-label">System Prompt</span>
        <textarea id="systemPromptInput" rows={4} spellCheck="false"></textarea>
      </label>

      <label className="field" htmlFor="temperatureInput">
        <span className="field-label">Temperature <strong id="temperatureValue">0.35</strong></span>
        <input id="temperatureInput" type="range" min="0" max="1.2" step="0.05" />
      </label>

      <label className="field" htmlFor="maxTokensInput">
        <span className="field-label">Max Tokens</span>
        <input id="maxTokensInput" type="number" min="64" max="1024" step="16" />
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

      <p id="noticeText" className="field-hint">Ready.</p>

      <label className="field" htmlFor="assistantAudio">
        <span className="field-label">Voice Preview</span>
        <audio id="assistantAudio" controls preload="none"></audio>
      </label>

    </section>
  );
}
