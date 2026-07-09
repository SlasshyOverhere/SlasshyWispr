import {
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_HOTKEY,
  DICTATION_LANGUAGE_OPTIONS,
  PUSH_TO_TALK_SOUND_OPTIONS,
} from '../../constants';

export function GeneralSettingsPane() {
  return (
    <section id="settingsPaneGeneral" className="settings-pane is-active" data-settings-pane="general">

      {/* ── Shortcuts & Mic ── */}
      <h3 className="settings-section-title">Shortcuts &amp; input</h3>

      <div className="s-row">
        <span className="s-row-label">Dictation hotkey <span className="s-row-hint" id="hotkeyHint">{DEFAULT_HOTKEY}</span></span>
        <button id="toggleHotkeyEditorBtn" className="btn" type="button">Change</button>
      </div>
      <div id="hotkeyEditor" className="s-row-block" hidden>
        <label className="field" htmlFor="hotkeyInput">
          <span className="field-label">Push-To-Talk Hotkey</span>
          <input id="hotkeyInput" type="text" placeholder="Click and press keys" autoComplete="off" />
        </label>
        <label className="field" htmlFor="commandHotkeyInput">
          <span className="field-label">Command Mode Hotkey</span>
          <input id="commandHotkeyInput" type="text" placeholder="Ctrl+Shift+Space" autoComplete="off" />
        </label>
      </div>

      <div className="s-row">
        <span className="s-row-label">Microphone <span className="s-row-hint" id="microphoneSummary">Auto-detect</span></span>
        <button id="toggleMicEditorBtn" className="btn" type="button">Change</button>
      </div>
      <div id="microphoneEditor" className="s-row-block" hidden>
        <label className="field" htmlFor="microphoneSelect">
          <span className="field-label">Microphone Device</span>
          <select id="microphoneSelect"></select>
        </label>
        <button id="refreshMicsBtn" className="btn" type="button">Refresh</button>
      </div>

      <div className="s-row">
        <span className="s-row-label">Capture mode <span className="s-row-hint" id="captureModeHint">Push-To-Talk</span></span>
      </div>
      <div className="pills">
        <label className="pill" htmlFor="captureModeSingle"><input id="captureModeSingle" name="captureMode" type="radio" value="single-tap" />Single tap</label>
        <label className="pill" htmlFor="captureModePushToTalk"><input id="captureModePushToTalk" name="captureMode" type="radio" value="push-to-talk" />Push-to-talk</label>
      </div>

      {/* ── Appearance ── */}
      <h3 className="settings-section-title">Appearance</h3>

      <div className="s-row">
        <span className="s-row-label" id="themeLabel">Theme</span>
        <select
          id="themeModeSelect"
          aria-labelledby="themeLabel"
          className="mini-select"
          defaultValue="system"
        >
          <option value="system">Follow system</option>
          <option value="dark">Studio</option>
          <option value="light">Daylight</option>
          <option value="mono">Index</option>
        </select>
      </div>

      <div className="theme-picker" role="radiogroup" aria-labelledby="themeLabel">
        <label className="theme-card" data-theme-target="dark">
          <input
            type="radio"
            name="themeCard"
            value="dark"
            className="theme-card-input"
            data-theme-card
          />
          <span className="theme-card-preview" aria-hidden="true">
            <span className="preview-titlebar">
              <span className="preview-dot" />
              <span className="preview-dot" />
              <span className="preview-dot" />
            </span>
            <span className="preview-body">
              <span className="preview-sidebar">
                <span className="preview-row is-active" />
                <span className="preview-row" />
                <span className="preview-row" />
                <span className="preview-row" />
              </span>
              <span className="preview-main">
                <span className="preview-h" />
                <span className="preview-line" />
                <span className="preview-line is-short" />
                <span className="preview-line" />
                <span className="preview-record" />
              </span>
            </span>
          </span>
          <span className="theme-card-meta">
            <span className="theme-card-name">Studio</span>
            <span className="theme-card-tagline">Warm amber dark, evening work</span>
          </span>
        </label>

        <label className="theme-card" data-theme-target="light">
          <input
            type="radio"
            name="themeCard"
            value="light"
            className="theme-card-input"
            data-theme-card
          />
          <span className="theme-card-preview" aria-hidden="true">
            <span className="preview-titlebar">
              <span className="preview-dot" />
              <span className="preview-dot" />
              <span className="preview-dot" />
            </span>
            <span className="preview-body">
              <span className="preview-sidebar">
                <span className="preview-row is-active" />
                <span className="preview-row" />
                <span className="preview-row" />
                <span className="preview-row" />
              </span>
              <span className="preview-main">
                <span className="preview-h" />
                <span className="preview-line" />
                <span className="preview-line is-short" />
                <span className="preview-line" />
                <span className="preview-record" />
              </span>
            </span>
          </span>
          <span className="theme-card-meta">
            <span className="theme-card-name">Daylight</span>
            <span className="theme-card-tagline">Editorial paper, daytime reading</span>
          </span>
        </label>

        <label className="theme-card" data-theme-target="mono">
          <input
            type="radio"
            name="themeCard"
            value="mono"
            className="theme-card-input"
            data-theme-card
          />
          <span className="theme-card-preview" aria-hidden="true">
            <span className="preview-titlebar">
              <span className="preview-dot" />
              <span className="preview-dot" />
              <span className="preview-dot" />
            </span>
            <span className="preview-body">
              <span className="preview-sidebar">
                <span className="preview-row is-active" />
                <span className="preview-row" />
                <span className="preview-row" />
                <span className="preview-row" />
              </span>
              <span className="preview-main">
                <span className="preview-h" />
                <span className="preview-line" />
                <span className="preview-line is-short" />
                <span className="preview-line" />
                <span className="preview-record" />
              </span>
            </span>
          </span>
          <span className="theme-card-meta">
            <span className="theme-card-name">Index</span>
            <span className="theme-card-tagline">Pure grayscale, deep focus</span>
          </span>
        </label>
      </div>

      {/* ── Language ── */}
      <h3 className="settings-section-title">Language &amp; dictation</h3>

      <div className="pills">
        <label className="pill" htmlFor="dictationLanguageModeSingle"><input id="dictationLanguageModeSingle" name="dictationLanguageMode" type="radio" value="single" />Single language</label>
        <label className="pill" htmlFor="dictationLanguageModeMultiple"><input id="dictationLanguageModeMultiple" name="dictationLanguageMode" type="radio" value="multiple" />Multiple languages</label>
      </div>
      <p id="dictationLanguageSummary" className="field-hint">Auto-detect</p>
      <label className="field" htmlFor="dictationLanguageSelect">
        <span className="field-label">Primary language</span>
        <select id="dictationLanguageSelect">
          <option value="">Auto-detect</option>
          {DICTATION_LANGUAGE_OPTIONS.map(opt => (
            <option key={opt.code} value={opt.code}>{opt.label}</option>
          ))}
        </select>
      </label>
      <div id="dictationLanguageMultiWrap" className="s-row-block" hidden>
        <p className="s-group-label">Allowed languages</p>
        <div className="pills">
          {DICTATION_LANGUAGE_OPTIONS.map(opt => (
            <label key={opt.code} className="pill"><input type="checkbox" value={opt.code} data-dictation-lang-option />{opt.label}</label>
          ))}
        </div>
        <p className="field-hint">Selected languages will be used for decoding.</p>
      </div>

      <div className="s-divider" />

      <label className="field" htmlFor="styleProfileSelect">
        <span className="field-label">Style profile</span>
        <select id="styleProfileSelect">
          <option value="adaptive">Adaptive</option>
          <option value="professional">Professional</option>
          <option value="casual">Casual</option>
          <option value="concise">Concise</option>
          <option value="developer">Developer</option>
        </select>
      </label>

      {/* ── Transcript cleanup ── */}
      <h3 className="settings-section-title">Transcript cleanup</h3>

      <label className="s-row" htmlFor="rawModeToggle">
        <span className="s-row-label">Raw mode <span className="switch-desc">(no cleanup at all)</span></span>
        <input id="rawModeToggle" className="switch-input" type="checkbox" />
      </label>
      <label className="s-row" htmlFor="backtrackToggle">
        <span className="s-row-label">Backtrack corrections <span className="switch-desc">("scratch that")</span></span>
        <input id="backtrackToggle" className="switch-input" type="checkbox" />
      </label>
      <label className="s-row" htmlFor="removeFillersToggle">
        <span className="s-row-label">Remove filler words</span>
        <input id="removeFillersToggle" className="switch-input" type="checkbox" />
      </label>
      <label className="s-row" htmlFor="autoPunctuationToggle">
        <span className="s-row-label">Auto punctuation</span>
        <input id="autoPunctuationToggle" className="switch-input" type="checkbox" />
      </label>
      <label className="s-row" htmlFor="numberedListsToggle">
        <span className="s-row-label">Auto numbered lists</span>
        <input id="numberedListsToggle" className="switch-input" type="checkbox" />
      </label>
      <label className="s-row" htmlFor="noiseSuppressionToggle">
        <span className="s-row-label">
          Noise Suppression
          <span className="switch-desc">(reduces fan/AC noise)</span>
        </span>
        <input id="noiseSuppressionToggle" className="switch-input" type="checkbox" />
      </label>

      {/* ── Assistant ── */}
      <h3 className="settings-section-title">Assistant &amp; AI</h3>

      <label className="s-row" htmlFor="commandModeToggle">
        <span className="s-row-label">Command mode</span>
        <input id="commandModeToggle" className="switch-input" type="checkbox" />
      </label>
      <label className="s-row" htmlFor="wakeWordEnabledToggle">
        <span className="s-row-label">Require wake phrase</span>
        <input id="wakeWordEnabledToggle" className="switch-input" type="checkbox" />
      </label>
      <label className="field" htmlFor="assistantNameInput">
        <span className="field-label">Assistant wake name</span>
        <input id="assistantNameInput" type="text" placeholder={DEFAULT_ASSISTANT_NAME} autoComplete="off" />
      </label>
      <p id="wakePhrasePreview" className="field-hint">{`Say "Hey ${DEFAULT_ASSISTANT_NAME}", "Hi ${DEFAULT_ASSISTANT_NAME}", or "Okay ${DEFAULT_ASSISTANT_NAME}"`}</p>
      <label className="s-row" htmlFor="contextAwarenessToggle">
        <span className="s-row-label">Context awareness <span className="switch-desc">(recent turns)</span></span>
        <input id="contextAwarenessToggle" className="switch-input" type="checkbox" />
      </label>

      <div className="s-divider" />
      <p className="s-group-label">Output</p>
      <label className="s-row" htmlFor="copyToClipboardToggle">
        <span className="s-row-label">Copy response to clipboard</span>
        <input id="copyToClipboardToggle" className="switch-input" type="checkbox" />
      </label>
      <label className="s-row" htmlFor="autoPasteDictationToggle">
        <span className="s-row-label">Auto paste after copy</span>
        <input id="autoPasteDictationToggle" className="switch-input" type="checkbox" />
      </label>

      {/* ── App behavior ── */}
      <h3 className="settings-section-title">App &amp; sound</h3>

      <label className="s-row" htmlFor="launchAtLoginToggle">
        <span className="s-row-label">Launch at login</span>
        <input id="launchAtLoginToggle" className="switch-input" type="checkbox" />
      </label>
      <label className="s-row" htmlFor="showFlowBarToggle">
        <span className="s-row-label">Show floating dock</span>
        <input id="showFlowBarToggle" className="switch-input" type="checkbox" />
      </label>
      <label className="s-row" htmlFor="showDockAlwaysToggle">
        <span className="s-row-label">Show dock always</span>
        <input id="showDockAlwaysToggle" className="switch-input" type="checkbox" />
      </label>
      <label className="s-row" htmlFor="incognitoModeToggle">
        <span className="s-row-label">Incognito mode <span className="switch-desc">(no history)</span></span>
        <input id="incognitoModeToggle" className="switch-input" type="checkbox" />
      </label>

      <div className="s-divider" />
      <p className="s-group-label">Recordings</p>
      <label className="s-row" htmlFor="saveRecordingsToggle">
        <span className="s-row-label">Save recordings <span className="switch-desc">(audio of what you said)</span></span>
        <input id="saveRecordingsToggle" className="switch-input" type="checkbox" />
      </label>
      <div className="s-row">
        <span className="s-row-label">Storage used <span className="s-row-hint" id="recordingsStorageHint">0 files · 0 B</span></span>
        <button id="clearRecordingsBtn" className="btn-ghost" type="button">Clear all</button>
      </div>
      <p id="recordingsStorageHintWeb" className="field-hint" hidden>Recordings are saved only in the desktop app.</p>

      <div className="s-divider" />
      <p className="s-group-label">Sound</p>
      <label className="s-row" htmlFor="dictationSoundEffectsToggle">
        <span className="s-row-label">Dictation sound effects</span>
        <input id="dictationSoundEffectsToggle" className="switch-input" type="checkbox" />
      </label>
      <div className="s-row">
        <span className="s-row-label">Push-to-talk start sound</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select id="pushToTalkSoundSelect" className="mini-select">
            {PUSH_TO_TALK_SOUND_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <button id="previewPttSoundBtn" className="btn" type="button">Preview</button>
        </div>
      </div>
      <div className="s-row">
        <span className="s-row-label">Push-to-talk end sound</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select id="pushToTalkEndSoundSelect" className="mini-select">
            {PUSH_TO_TALK_SOUND_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <button id="previewPttEndSoundBtn" className="btn" type="button">Preview</button>
        </div>
      </div>
      <div className="s-row">
        <span className="s-row-label">Sound volume <span className="s-row-hint" id="pttVolumeHint">50%</span></span>
        <input id="pushToTalkSoundVolumeRange" type="range" min="0" max="100" step="1" style={{ maxWidth: 140 }} />
      </div>
      <label className="s-row" htmlFor="muteMusicWhileDictatingToggle">
        <span className="s-row-label">Mute music while dictating</span>
        <input id="muteMusicWhileDictatingToggle" className="switch-input" type="checkbox" />
      </label>

    </section>
  );
}
