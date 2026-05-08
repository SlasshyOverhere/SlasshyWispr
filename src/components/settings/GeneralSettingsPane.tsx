import { DEFAULT_ASSISTANT_NAME } from '../../constants';

export function GeneralSettingsPane() {
  return (
    <section className="settings-pane is-active" data-settings-pane="general">
      <div className="settings-card">
        <div className="settings-row">
          <div>
            <h3>Keyboard shortcuts</h3>
            <p>Dictation shortcut is <strong id="hotkeyHint">Ctrl + Space</strong>. <span className="learn-link">Learn more →</span></p>
            <div id="hotkeyEditor" className="inline-editor" hidden>
              <label className="field">
                <span>Push-To-Talk Hotkey</span>
                <input id="hotkeyInput" type="text" placeholder="Click and press keys" autoComplete="off" />
              </label>
              <label className="field">
                <span>Command Mode Hotkey</span>
                <input id="commandHotkeyInput" type="text" placeholder="Ctrl+Shift+Space" autoComplete="off" />
              </label>
            </div>
          </div>
          <button id="toggleHotkeyEditorBtn" className="ghost-action" type="button">Change</button>
        </div>

        <div className="settings-row">
          <div>
            <h3>Microphone</h3>
            <p id="microphoneSummary">Auto-detect</p>
            <div id="microphoneEditor" className="inline-editor" hidden>
              <label className="field">
                <span>Microphone Device</span>
                <select id="microphoneSelect"></select>
              </label>
              <button id="refreshMicsBtn" className="ghost-action mini" type="button">Refresh</button>
            </div>
          </div>
          <button id="toggleMicEditorBtn" className="ghost-action" type="button">Change</button>
        </div>

        <div className="settings-row">
          <div>
            <h3>Dictation languages</h3>
            <p id="dictationLanguageSummary">Whisper language mode: Auto-detect.</p>
            <div className="inline-editor">
              <div className="capture-mode-pills">
                <label><input id="dictationLanguageModeSingle" name="dictationLanguageMode" type="radio" value="single" />Single language</label>
                <label><input id="dictationLanguageModeMultiple" name="dictationLanguageMode" type="radio" value="multiple" />Multiple languages</label>
              </div>
              <label className="field">
                <span>Primary language</span>
                <select id="dictationLanguageSelect">
                  <option value="">Auto-detect</option>
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                  <option value="it">Italian</option>
                  <option value="pt">Portuguese</option>
                  <option value="hi">Hindi</option>
                  <option value="bn">Bengali</option>
                  <option value="ja">Japanese</option>
                  <option value="ko">Korean</option>
                  <option value="zh">Chinese</option>
                  <option value="ar">Arabic</option>
                  <option value="ru">Russian</option>
                </select>
              </label>
              <div id="dictationLanguageMultiWrap" className="dictation-language-multi" hidden>
                <p className="dictation-language-multi-label">Allowed languages (Whisper will stay inside these)</p>
                <div className="dictation-language-grid">
                  <label><input type="checkbox" value="en" data-dictation-lang-option />English</label>
                  <label><input type="checkbox" value="es" data-dictation-lang-option />Spanish</label>
                  <label><input type="checkbox" value="fr" data-dictation-lang-option />French</label>
                  <label><input type="checkbox" value="de" data-dictation-lang-option />German</label>
                  <label><input type="checkbox" value="it" data-dictation-lang-option />Italian</label>
                  <label><input type="checkbox" value="pt" data-dictation-lang-option />Portuguese</label>
                  <label><input type="checkbox" value="hi" data-dictation-lang-option />Hindi</label>
                  <label><input type="checkbox" value="bn" data-dictation-lang-option />Bengali</label>
                  <label><input type="checkbox" value="ja" data-dictation-lang-option />Japanese</label>
                  <label><input type="checkbox" value="ko" data-dictation-lang-option />Korean</label>
                  <label><input type="checkbox" value="zh" data-dictation-lang-option />Chinese</label>
                  <label><input type="checkbox" value="ar" data-dictation-lang-option />Arabic</label>
                  <label><input type="checkbox" value="ru" data-dictation-lang-option />Russian</label>
                </div>
                <p className="notice">Online and Offline Whisper will decode only the selected languages.</p>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <h3>Capture mode</h3>
            <p id="captureModeHint">Push-To-Talk</p>
            <div className="capture-mode-pills">
              <label><input id="captureModeSingle" name="captureMode" type="radio" value="single-tap" />Single tap</label>
              <label><input id="captureModePushToTalk" name="captureMode" type="radio" value="push-to-talk" />Push-to-talk</label>
            </div>
          </div>
        </div>

        <div className="settings-row">
          <div>
            <h3>Style profile</h3>
            <p>Choose how SlasshyWispr rewrites and responds.</p>
            <label className="field inline-select">
              <span>Style</span>
              <select id="styleProfileSelect">
                <option value="adaptive">Adaptive</option>
                <option value="professional">Professional</option>
                <option value="casual">Casual</option>
                <option value="concise">Concise</option>
                <option value="developer">Developer</option>
              </select>
            </label>
          </div>
        </div>
      </div>

      <h3 className="settings-section-title">App settings</h3>
      <div className="settings-card">
        <label className="switch-row"><span>Launch app at login</span><input id="launchAtLoginToggle" className="switch-input" type="checkbox" /></label>
        <label className="switch-row"><span>Show floating dock at all times</span><input id="showFlowBarToggle" className="switch-input" type="checkbox" /></label>
        <label className="switch-row"><span>Show app in dock</span><input id="showAppInDockToggle" className="switch-input" type="checkbox" /></label>
        <label className="switch-row"><span>Command mode</span><input id="commandModeToggle" className="switch-input" type="checkbox" /></label>
        <label className="switch-row"><span>Require wake phrase for AI replies</span><input id="wakeWordEnabledToggle" className="switch-input" type="checkbox" /></label>
        <label className="field">
          <span>Assistant wake name (say "Hey name")</span>
          <input id="assistantNameInput" type="text" placeholder={DEFAULT_ASSISTANT_NAME} autoComplete="off" />
        </label>
        <p id="wakePhrasePreview" className="notice">Wake phrase examples: "Hey {DEFAULT_ASSISTANT_NAME}", "Hi {DEFAULT_ASSISTANT_NAME}", "Okay {DEFAULT_ASSISTANT_NAME}"</p>
        <label className="switch-row"><span>Context awareness (recent turns)</span><input id="contextAwarenessToggle" className="switch-input" type="checkbox" /></label>
        <label className="switch-row"><span>Copy assistant response to clipboard</span><input id="copyToClipboardToggle" className="switch-input" type="checkbox" /></label>
        <label className="switch-row"><span>Auto paste dictation after copy</span><input id="autoPasteDictationToggle" className="switch-input" type="checkbox" /></label>
        <label className="switch-row"><span>Incognito mode (no local history/notes)</span><input id="incognitoModeToggle" className="switch-input" type="checkbox" /></label>
        <label className="select-row">
          <span>Theme</span>
          <select id="themeModeSelect">
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
      </div>

      <h3 className="settings-section-title">Sound</h3>
      <div className="settings-card">
        <label className="switch-row"><span>Dictation sound effects</span><input id="dictationSoundEffectsToggle" className="switch-input" type="checkbox" /></label>
        <label className="switch-row"><span>Mute music while dictating</span><input id="muteMusicWhileDictatingToggle" className="switch-input" type="checkbox" /></label>
      </div>

      <h3 className="settings-section-title">Transcript refinement</h3>
      <div className="settings-card">
        <label className="switch-row"><span>Backtrack corrections (e.g. "scratch that")</span><input id="backtrackToggle" className="switch-input" type="checkbox" /></label>
        <label className="switch-row"><span>Remove filler words</span><input id="removeFillersToggle" className="switch-input" type="checkbox" /></label>
        <label className="switch-row"><span>Auto punctuation</span><input id="autoPunctuationToggle" className="switch-input" type="checkbox" /></label>
        <label className="switch-row"><span>Auto numbered lists</span><input id="numberedListsToggle" className="switch-input" type="checkbox" /></label>
      </div>
    </section>
  );
}
