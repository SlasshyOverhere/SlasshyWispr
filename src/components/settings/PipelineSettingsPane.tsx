export function PipelineSettingsPane() {
  return (
    <section className="settings-pane" data-settings-pane="pipeline" hidden>
      <h3 className="settings-section-title">Prompting</h3>
      <div className="settings-card">
        <label className="field">
          <span>System Prompt</span>
          <textarea id="systemPromptInput" rows={4} spellCheck="false"></textarea>
        </label>
        <div className="compact-grid">
          <label className="field">
            <span>Temperature <strong id="temperatureValue">0.35</strong></span>
            <input id="temperatureInput" type="range" min="0" max="1.2" step="0.05" />
          </label>
          <label className="field">
            <span>Max Tokens</span>
            <input id="maxTokensInput" type="number" min="64" max="1024" step="16" />
          </label>
        </div>
      </div>

      <h3 className="settings-section-title">Pipeline status</h3>
      <div className="settings-card">
        <div className="pipeline-status-row">
          <div id="statusPill" className="status-pill" data-stage="idle">Idle</div>
          <p id="statusDetail" className="status-detail">Ready.</p>
        </div>
        <div className="latency-grid" aria-live="polite">
          <p><span>STT</span><strong id="sttLatency">-</strong></p>
          <p><span>AI</span><strong id="aiLatency">-</strong></p>
          <p><span>TTS</span><strong id="ttsLatency">-</strong></p>
          <p><span>Total</span><strong id="totalLatency">-</strong></p>
        </div>
        <p id="noticeText" className="notice">Ready.</p>
        <audio id="assistantAudio" controls preload="none"></audio>
      </div>
    </section>
  );
}
