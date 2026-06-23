import {
  DEFAULT_ASSISTANT_NAME,
  DEFAULT_HOTKEY,
  DICTATION_LANGUAGE_OPTIONS,
  PUSH_TO_TALK_SOUND_OPTIONS,
} from '../../constants';

export function GeneralSettingsPane() {
  return (
    <section className="settings-pane is-active" data-settings-pane="general">

      {/* ── Shortcuts & Mic ── */}
      <details className="settings-section" open>
        <summary>Shortcuts &amp; input<span className="section-hint" id="hotkeyHint">{DEFAULT_HOTKEY}</span></summary>
        <div className="section-body">
          <div className="s-row">
            <span className="s-row-label">Dictation hotkey</span>
            <button id="toggleHotkeyEditorBtn" className="ghost-action mini" type="button">Change</button>
          </div>
          <div id="hotkeyEditor" className="inline-editor" hidden>
            <label className="field" htmlFor="hotkeyInput">
              <span>Push-To-Talk Hotkey</span>
              <input id="hotkeyInput" type="text" placeholder="Click and press keys" autoComplete="off" />
            </label>
            <label className="field" htmlFor="commandHotkeyInput">
              <span>Command Mode Hotkey</span>
              <input id="commandHotkeyInput" type="text" placeholder="Ctrl+Shift+Space" autoComplete="off" />
            </label>
          </div>

          <div className="s-row">
            <span className="s-row-label">Microphone <span className="s-row-hint" id="microphoneSummary">Auto-detect</span></span>
            <button id="toggleMicEditorBtn" className="ghost-action mini" type="button">Change</button>
          </div>
          <div id="microphoneEditor" hidden>
            <label className="field" htmlFor="microphoneSelect">
              <span>Microphone Device</span>
              <select id="microphoneSelect"></select>
            </label>
            <button id="refreshMicsBtn" className="ghost-action mini" type="button" style={{ marginTop: 6 }}>Refresh</button>
          </div>

          <div className="s-row">
            <span className="s-row-label">Capture mode <span className="s-row-hint" id="captureModeHint">Push-To-Talk</span></span>
          </div>
          <div className="capture-mode-pills">
            <label htmlFor="captureModeSingle"><input id="captureModeSingle" name="captureMode" type="radio" value="single-tap" />Single tap</label>
            <label htmlFor="captureModePushToTalk"><input id="captureModePushToTalk" name="captureMode" type="radio" value="push-to-talk" />Push-to-talk</label>
          </div>
        </div>
      </details>

      {/* ── Appearance ── */}
      <details className="settings-section">
        <summary>Appearance</summary>
        <div className="section-body">
          <div className="s-row theme-row">
            <span className="s-row-label" id="themeLabel">Theme</span>
            <select id="themeModeSelect" aria-labelledby="themeLabel" className="theme-select">
              <option value="system">Match system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
        </div>
      </details>

      {/* ── Language ── */}
      <details className="settings-section">
        <summary>Language &amp; dictation<span className="section-hint" id="dictationLanguageSummary">Auto-detect</span></summary>
        <div className="section-body">
          <div className="capture-mode-pills">
            <label htmlFor="dictationLanguageModeSingle"><input id="dictationLanguageModeSingle" name="dictationLanguageMode" type="radio" value="single" />Single language</label>
            <label htmlFor="dictationLanguageModeMultiple"><input id="dictationLanguageModeMultiple" name="dictationLanguageMode" type="radio" value="multiple" />Multiple languages</label>
          </div>
          <label className="field" htmlFor="dictationLanguageSelect">
            <span>Primary language</span>
            <select id="dictationLanguageSelect">
              <option value="">Auto-detect</option>
              {DICTATION_LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.code} value={opt.code}>{opt.label}</option>
              ))}
            </select>
          </label>
          <div id="dictationLanguageMultiWrap" className="dictation-language-multi" hidden>
            <p className="dictation-language-multi-label">Allowed languages</p>
            <div className="dictation-language-grid">
              {DICTATION_LANGUAGE_OPTIONS.map(opt => (
                <label key={opt.code}><input type="checkbox" value={opt.code} data-dictation-lang-option />{opt.label}</label>
              ))}
            </div>
            <p className="notice">Whisper will decode only the selected languages.</p>
          </div>

          <div className="settings-group-divider" />

          <label className="field" htmlFor="styleProfileSelect">
            <span>Style profile</span>
            <select id="styleProfileSelect">
              <option value="adaptive">Adaptive</option>
              <option value="professional">Professional</option>
              <option value="casual">Casual</option>
              <option value="concise">Concise</option>
              <option value="developer">Developer</option>
            </select>
          </label>
        </div>
      </details>

      {/* ── Transcript cleanup ── */}
      <details className="settings-section">
        <summary>Transcript cleanup</summary>
        <div className="section-body">
          <label className="switch-row" htmlFor="rawModeToggle"><span>Raw mode <span className="switch-desc">(no cleanup at all)</span></span><input id="rawModeToggle" className="switch-input" type="checkbox" /></label>
          <label className="switch-row" htmlFor="backtrackToggle"><span>Backtrack corrections <span className="switch-desc">("scratch that")</span></span><input id="backtrackToggle" className="switch-input" type="checkbox" /></label>
          <label className="switch-row" htmlFor="removeFillersToggle"><span>Remove filler words</span><input id="removeFillersToggle" className="switch-input" type="checkbox" /></label>
          <label className="switch-row" htmlFor="autoPunctuationToggle"><span>Auto punctuation</span><input id="autoPunctuationToggle" className="switch-input" type="checkbox" /></label>
          <label className="switch-row" htmlFor="numberedListsToggle"><span>Auto numbered lists</span><input id="numberedListsToggle" className="switch-input" type="checkbox" /></label>
        </div>
      </details>

      {/* ── Assistant ── */}
      <details className="settings-section">
        <summary>Assistant &amp; AI</summary>
        <div className="section-body">
          <label className="switch-row" htmlFor="commandModeToggle"><span>Command mode</span><input id="commandModeToggle" className="switch-input" type="checkbox" /></label>
          <label className="switch-row" htmlFor="wakeWordEnabledToggle"><span>Require wake phrase</span><input id="wakeWordEnabledToggle" className="switch-input" type="checkbox" /></label>
          <label className="field" htmlFor="assistantNameInput">
            <span>Assistant wake name</span>
            <input id="assistantNameInput" type="text" placeholder={DEFAULT_ASSISTANT_NAME} autoComplete="off" />
          </label>
          <p id="wakePhrasePreview" className="notice">{`Say "Hey ${DEFAULT_ASSISTANT_NAME}", "Hi ${DEFAULT_ASSISTANT_NAME}", or "Okay ${DEFAULT_ASSISTANT_NAME}"`}</p>
          <label className="switch-row" htmlFor="contextAwarenessToggle"><span>Context awareness <span className="switch-desc">(recent turns)</span></span><input id="contextAwarenessToggle" className="switch-input" type="checkbox" /></label>

          <div className="settings-group-divider" />
          <p className="settings-group-label">Output</p>
          <label className="switch-row" htmlFor="copyToClipboardToggle"><span>Copy response to clipboard</span><input id="copyToClipboardToggle" className="switch-input" type="checkbox" /></label>
          <label className="switch-row" htmlFor="autoPasteDictationToggle"><span>Auto paste after copy</span><input id="autoPasteDictationToggle" className="switch-input" type="checkbox" /></label>
        </div>
      </details>

      {/* ── App behavior ── */}
      <details className="settings-section">
        <summary>App &amp; sound</summary>
        <div className="section-body">
          <label className="switch-row" htmlFor="launchAtLoginToggle"><span>Launch at login</span><input id="launchAtLoginToggle" className="switch-input" type="checkbox" /></label>
          <label className="switch-row" htmlFor="showFlowBarToggle"><span>Show floating dock</span><input id="showFlowBarToggle" className="switch-input" type="checkbox" /></label>
          <label className="switch-row" htmlFor="showDockAlwaysToggle"><span>Show dock always</span><input id="showDockAlwaysToggle" className="switch-input" type="checkbox" /></label>
          <label className="switch-row" htmlFor="incognitoModeToggle"><span>Incognito mode <span className="switch-desc">(no history)</span></span><input id="incognitoModeToggle" className="switch-input" type="checkbox" /></label>

          <div className="settings-group-divider" />
          <p className="settings-group-label">Sound</p>
          <label className="switch-row" htmlFor="dictationSoundEffectsToggle"><span>Dictation sound effects</span><input id="dictationSoundEffectsToggle" className="switch-input" type="checkbox" /></label>
          
          <div className="s-row ptt-sound-row">
            <span className="s-row-label">Push-to-talk start sound</span>
            <div className="ptt-sound-controls">
              <select id="pushToTalkSoundSelect" className="mini-select">
                {PUSH_TO_TALK_SOUND_OPTIONS.map(opt => (     
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              <button id="previewPttSoundBtn" className="ghost-action mini" type="button">Preview</button>
            </div>
          </div>
          <div className="s-row ptt-sound-row">
            <span className="s-row-label">Push-to-talk end sound</span>
            <div className="ptt-sound-controls">
              <select id="pushToTalkEndSoundSelect" className="mini-select">
                {PUSH_TO_TALK_SOUND_OPTIONS.map(opt => (     
                  <option key={opt.id} value={opt.id}>{opt.label}</option>
                ))}
              </select>
              <button id="previewPttEndSoundBtn" className="ghost-action mini" type="button">Preview</button>
            </div>
          </div>
          <div className="s-row ptt-volume-row">
            <span className="s-row-label">Sound volume <span className="s-row-hint" id="pttVolumeHint">50%</span></span>
            <input id="pushToTalkSoundVolumeRange" type="range" min="0" max="100" step="1" className="tts-range-input ptt-volume-slider" />
          </div>

          <label className="switch-row" htmlFor="muteMusicWhileDictatingToggle"><span>Mute music while dictating</span><input id="muteMusicWhileDictatingToggle" className="switch-input" type="checkbox" /></label>
        </div>
      </details>

    </section>
  );
}
