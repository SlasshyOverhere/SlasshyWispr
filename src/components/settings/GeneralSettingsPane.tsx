import {
  DEFAULT_ASSISTANT_NAME,
  DICTATION_LANGUAGE_OPTIONS,
  PUSH_TO_TALK_SOUND_OPTIONS,
} from '../../constants';
import {
  asDictationLanguageMode,
  formatDictationLanguageLabel,
  normalizeDictationLanguageAllowList,
  normalizeDictationLanguageCode,
} from '../../state/settings-store';
import { dispatchSettingsPatch, useSettingsSnapshot } from '../../settings/settings-react-shim';
import { formatHotkeyForDisplay } from '../../hotkeys/hotkey-service';
import { captureModeLabel } from '../../utils';

export function GeneralSettingsPane() {
  const settings = useSettingsSnapshot();
  const primaryLanguage = normalizeDictationLanguageCode(settings.dictationLanguage);
  let languageMode = asDictationLanguageMode(settings.dictationLanguageMode);
  let languageAllowList = normalizeDictationLanguageAllowList(settings.dictationLanguageAllowList);
  if (languageMode === "multiple" && languageAllowList.length === 0 && primaryLanguage) {
    languageAllowList = [primaryLanguage];
  }
  if (languageAllowList.length > 1) {
    languageMode = "multiple";
  }
  const languageSummary = languageMode === "multiple"
    ? languageAllowList.length === 0
      ? "Whisper language mode: Multiple (choose at least one language)."
      : `Whisper language mode: Multiple (${languageAllowList.map((code) => formatDictationLanguageLabel(code)).join(", ")}).`
    : primaryLanguage
      ? `Whisper language mode: Single (${formatDictationLanguageLabel(primaryLanguage)}).`
      : "Whisper language mode: Auto-detect.";
  const toggleLanguageOption = (code: string) => {
    dispatchSettingsPatch({
      dictationLanguageAllowList: languageAllowList.includes(code)
        ? languageAllowList.filter((entry) => entry !== code)
        : [...languageAllowList, code],
    });
  };

  return (
    <section id="settingsPaneGeneral" className="settings-pane is-active" data-settings-pane="general">

      {/* ── Shortcuts & Mic ── */}
      <h3 className="settings-section-title">Shortcuts &amp; input</h3>

      <div className="s-row">
        <span className="s-row-label">Dictation hotkey <span className="s-row-hint" id="hotkeyHint">{formatHotkeyForDisplay(settings.pushToTalkHotkey)}</span></span>
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
        <span className="s-row-label">Capture mode <span className="s-row-hint" id="captureModeHint">{captureModeLabel(settings.captureMode)}</span></span>
      </div>
      <div className="pills">
        <label className="pill" htmlFor="captureModeSingle"><input id="captureModeSingle" name="captureMode" type="radio" value="single-tap" checked={settings.captureMode === "single-tap"} onChange={() => dispatchSettingsPatch({ captureMode: "single-tap" })} />Single tap</label>
        <label className="pill" htmlFor="captureModePushToTalk"><input id="captureModePushToTalk" name="captureMode" type="radio" value="push-to-talk" checked={settings.captureMode === "push-to-talk"} onChange={() => dispatchSettingsPatch({ captureMode: "push-to-talk" })} />Push-to-talk</label>
      </div>

      {/* ── Appearance ── */}
      <h3 className="settings-section-title">Appearance</h3>

      <div className="s-row">
        <span className="s-row-label" id="themeLabel">Theme</span>
        <select
          id="themeModeSelect"
          aria-labelledby="themeLabel"
          className="mini-select"
          value={settings.themeMode}
          onChange={(event) => dispatchSettingsPatch({ themeMode: event.target.value as typeof settings.themeMode })}
        >
          <option value="system">Follow system</option>
          <option value="dark">Studio</option>
          <option value="light">Daylight</option>
          <option value="mono">Index</option>
        </select>
      </div>

      <div className="s-row">
        <span className="s-row-label" id="captureBackendLabel">Audio capture</span>
        <select
          id="captureBackendSelect"
          aria-labelledby="captureBackendLabel"
          className="mini-select"
          value={settings.captureBackend}
          onChange={(event) => dispatchSettingsPatch({ captureBackend: event.target.value as typeof settings.captureBackend })}
        >
          <option value="webview">WebView (compatible)</option>
          <option value="native">Native (lower latency)</option>
        </select>
      </div>

      <label className="s-row" htmlFor="shellIntegrationToggle">
        <span className="s-row-label">Transcribe from Explorer</span>
        <input
          id="shellIntegrationToggle"
          className="switch-input"
          type="checkbox"
          checked={settings.shellIntegration}
          onChange={(event) => dispatchSettingsPatch({ shellIntegration: event.target.checked })}
        />
      </label>

      <div className="theme-picker" role="radiogroup" aria-labelledby="themeLabel">
        <label className="theme-card" data-theme-target="dark">
          <input
            type="radio"
            name="themeCard"
            value="dark"
            className="theme-card-input"
            data-theme-card
            checked={settings.themeMode === "dark"}
            onChange={() => dispatchSettingsPatch({ themeMode: "dark" })}
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
            <span className="theme-card-tagline">Near-black, quiet, long sessions</span>
          </span>
        </label>

        <label className="theme-card" data-theme-target="light">
          <input
            type="radio"
            name="themeCard"
            value="light"
            className="theme-card-input"
            data-theme-card
            checked={settings.themeMode === "light"}
            onChange={() => dispatchSettingsPatch({ themeMode: "light" })}
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
            checked={settings.themeMode === "mono"}
            onChange={() => dispatchSettingsPatch({ themeMode: "mono" })}
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
        <label className="pill" htmlFor="dictationLanguageModeSingle"><input id="dictationLanguageModeSingle" name="dictationLanguageMode" type="radio" value="single" checked={languageMode === "single"} onChange={() => dispatchSettingsPatch({ dictationLanguageMode: "single" })} />Single language</label>
        <label className="pill" htmlFor="dictationLanguageModeMultiple"><input id="dictationLanguageModeMultiple" name="dictationLanguageMode" type="radio" value="multiple" checked={languageMode === "multiple"} onChange={() => dispatchSettingsPatch({ dictationLanguageMode: "multiple" })} />Multiple languages</label>
      </div>
      <p id="dictationLanguageSummary" className="field-hint">{languageSummary}</p>
      <label className="field" htmlFor="dictationLanguageSelect">
        <span className="field-label">Primary language</span>
        <select id="dictationLanguageSelect" value={primaryLanguage} onChange={(event) => dispatchSettingsPatch({ dictationLanguage: event.target.value })}>
          <option value="">Auto-detect</option>
          {DICTATION_LANGUAGE_OPTIONS.map(opt => (
            <option key={opt.code} value={opt.code}>{opt.label}</option>
          ))}
        </select>
      </label>
      <div id="dictationLanguageMultiWrap" className="s-row-block" hidden={languageMode !== "multiple"}>
        <p className="s-group-label">Allowed languages</p>
        <div className="pills">
          {DICTATION_LANGUAGE_OPTIONS.map(opt => (
            <label key={opt.code} className="pill"><input type="checkbox" value={opt.code} data-dictation-lang-option checked={languageAllowList.includes(opt.code)} onChange={() => toggleLanguageOption(opt.code)} />{opt.label}</label>
          ))}
        </div>
        <p className="field-hint">Selected languages will be used for decoding.</p>
      </div>

      <div className="s-divider" />

      <label className="field" htmlFor="styleProfileSelect">
        <span className="field-label">Style profile</span>
        <select id="styleProfileSelect" value={settings.styleProfile} onChange={(event) => dispatchSettingsPatch({ styleProfile: event.target.value as typeof settings.styleProfile })}>
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
        <input id="rawModeToggle" className="switch-input" type="checkbox" checked={settings.rawMode} onChange={(event) => dispatchSettingsPatch({ rawMode: event.target.checked })} />
      </label>
      <label className="s-row" htmlFor="backtrackToggle">
        <span className="s-row-label">Backtrack corrections <span className="switch-desc">("scratch that")</span></span>
        <input id="backtrackToggle" className="switch-input" type="checkbox" checked={settings.backtrackCorrection} onChange={(event) => dispatchSettingsPatch({ backtrackCorrection: event.target.checked })} />
      </label>
      <label className="s-row" htmlFor="removeFillersToggle">
        <span className="s-row-label">Remove filler words</span>
        <input id="removeFillersToggle" className="switch-input" type="checkbox" checked={settings.removeFillers} onChange={(event) => dispatchSettingsPatch({ removeFillers: event.target.checked })} />
      </label>
      <label className="s-row" htmlFor="autoPunctuationToggle">
        <span className="s-row-label">Auto punctuation</span>
        <input id="autoPunctuationToggle" className="switch-input" type="checkbox" checked={settings.autoPunctuation} onChange={(event) => dispatchSettingsPatch({ autoPunctuation: event.target.checked })} />
      </label>
      <label className="s-row" htmlFor="numberedListsToggle">
        <span className="s-row-label">Auto numbered lists</span>
        <input id="numberedListsToggle" className="switch-input" type="checkbox" checked={settings.numberedLists} onChange={(event) => dispatchSettingsPatch({ numberedLists: event.target.checked })} />
      </label>
      <label className="s-row" htmlFor="noiseSuppressionToggle">
        <span className="s-row-label">
          Noise Suppression
          <span className="switch-desc">(reduces fan/AC noise)</span>
        </span>
        <input id="noiseSuppressionToggle" className="switch-input" type="checkbox" checked={settings.noiseSuppression} onChange={(event) => dispatchSettingsPatch({ noiseSuppression: event.target.checked })} />
      </label>

      {/* ── Assistant ── */}
      <h3 className="settings-section-title">Assistant &amp; AI</h3>

      <label className="s-row" htmlFor="commandModeToggle">
        <span className="s-row-label">Command mode</span>
        <input id="commandModeToggle" className="switch-input" type="checkbox" checked={settings.commandMode} onChange={(event) => dispatchSettingsPatch({ commandMode: event.target.checked })} />
      </label>
      <label className="s-row" htmlFor="wakeWordEnabledToggle">
        <span className="s-row-label">Require wake phrase</span>
        <input id="wakeWordEnabledToggle" className="switch-input" type="checkbox" checked={settings.wakeWordEnabled} onChange={(event) => dispatchSettingsPatch({ wakeWordEnabled: event.target.checked })} />
      </label>
      <label className="field" htmlFor="assistantNameInput">
        <span className="field-label">Assistant wake name</span>
        <input id="assistantNameInput" type="text" placeholder={DEFAULT_ASSISTANT_NAME} autoComplete="off" value={settings.assistantName} onChange={(event) => dispatchSettingsPatch({ assistantName: event.target.value })} />
      </label>
      <p id="wakePhrasePreview" className="field-hint">{`Say "Hey ${settings.assistantName.trim() || DEFAULT_ASSISTANT_NAME}", "Hi ${settings.assistantName.trim() || DEFAULT_ASSISTANT_NAME}", or "Okay ${settings.assistantName.trim() || DEFAULT_ASSISTANT_NAME}"`}</p>
      <label className="s-row" htmlFor="contextAwarenessToggle">
        <span className="s-row-label">Context awareness <span className="switch-desc">(recent turns)</span></span>
        <input id="contextAwarenessToggle" className="switch-input" type="checkbox" checked={settings.contextAwareness} onChange={(event) => dispatchSettingsPatch({ contextAwareness: event.target.checked })} />
      </label>

      <div className="s-divider" />
      <p className="s-group-label">Output</p>
      <label className="s-row" htmlFor="copyToClipboardToggle">
        <span className="s-row-label">Copy response to clipboard</span>
        <input id="copyToClipboardToggle" className="switch-input" type="checkbox" checked={settings.copyToClipboard} onChange={(event) => dispatchSettingsPatch({ copyToClipboard: event.target.checked })} />
      </label>
      <label className="s-row" htmlFor="autoPasteDictationToggle">
        <span className="s-row-label">Auto paste after copy</span>
        <input id="autoPasteDictationToggle" className="switch-input" type="checkbox" checked={settings.autoPasteDictation} onChange={(event) => dispatchSettingsPatch({ autoPasteDictation: event.target.checked })} />
      </label>

      {/* ── App behavior ── */}
      <h3 className="settings-section-title">App &amp; sound</h3>

      <label className="s-row" htmlFor="launchAtLoginToggle">
        <span className="s-row-label">Launch at login</span>
        <input id="launchAtLoginToggle" className="switch-input" type="checkbox" checked={settings.launchAtLogin} onChange={(event) => dispatchSettingsPatch({ launchAtLogin: event.target.checked })} />
      </label>
      <label className="s-row" htmlFor="showFlowBarToggle">
        <span className="s-row-label">Show floating dock</span>
        <input id="showFlowBarToggle" className="switch-input" type="checkbox" checked={settings.showFlowBar} onChange={(event) => dispatchSettingsPatch({ showFlowBar: event.target.checked })} />
      </label>
      <label className="s-row" htmlFor="showDockAlwaysToggle">
        <span className="s-row-label">Show dock always</span>
        <input id="showDockAlwaysToggle" className="switch-input" type="checkbox" checked={settings.showDockAlways} onChange={(event) => dispatchSettingsPatch({ showDockAlways: event.target.checked })} />
      </label>
      <label className="s-row" htmlFor="incognitoModeToggle">
        <span className="s-row-label">Incognito mode <span className="switch-desc">(no history)</span></span>
        <input id="incognitoModeToggle" className="switch-input" type="checkbox" checked={settings.incognitoMode} onChange={(event) => dispatchSettingsPatch({ incognitoMode: event.target.checked })} />
      </label>
      {/* F-003: state exactly what is suppressed, so "no history" is provable
          rather than a claim. Rendered only while incognito is on. */}
      {settings.incognitoMode && (
        <div className="privacy-suppressed" role="note" aria-label="What incognito suppresses">
          <p className="s-group-label">While incognito is on</p>
          <ul className="privacy-suppressed-list">
            <li>Transcript turns are not written to History</li>
            <li>Usage stats and analytics sessions are not updated</li>
            <li>Quick notes are not created</li>
            <li>Achievements do not unlock from this session</li>
          </ul>
        </div>
      )}

      <div className="s-divider" />
      <p className="s-group-label">Recordings</p>
      <label className="s-row" htmlFor="saveRecordingsToggle">
        <span className="s-row-label">Save recordings <span className="switch-desc">(audio of what you said)</span></span>
        <input id="saveRecordingsToggle" className="switch-input" type="checkbox" checked={settings.saveRecordings} onChange={(event) => dispatchSettingsPatch({ saveRecordings: event.target.checked })} />
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
        <input id="dictationSoundEffectsToggle" className="switch-input" type="checkbox" checked={settings.dictationSoundEffects} onChange={(event) => dispatchSettingsPatch({ dictationSoundEffects: event.target.checked })} />
      </label>
      <div className="s-row">
        <span className="s-row-label">Push-to-talk start sound</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select id="pushToTalkSoundSelect" className="mini-select" value={settings.pushToTalkSound} onChange={(event) => dispatchSettingsPatch({ pushToTalkSound: event.target.value })}>
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
          <select id="pushToTalkEndSoundSelect" className="mini-select" value={settings.pushToTalkEndSound} onChange={(event) => dispatchSettingsPatch({ pushToTalkEndSound: event.target.value })}>
            {PUSH_TO_TALK_SOUND_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
          <button id="previewPttEndSoundBtn" className="btn" type="button">Preview</button>
        </div>
      </div>
      <div className="s-row">
        <span className="s-row-label">Sound volume <span className="s-row-hint" id="pttVolumeHint">{Math.round(settings.pushToTalkSoundVolume * 100)}%</span></span>
        <input id="pushToTalkSoundVolumeRange" type="range" min="0" max="100" step="1" style={{ maxWidth: 140 }} value={Math.round(settings.pushToTalkSoundVolume * 100)} onChange={(event) => dispatchSettingsPatch({ pushToTalkSoundVolume: Number(event.target.value) / 100 })} />
      </div>
      <label className="s-row" htmlFor="muteMusicWhileDictatingToggle">
        <span className="s-row-label">Mute music while dictating</span>
        <input id="muteMusicWhileDictatingToggle" className="switch-input" type="checkbox" checked={settings.muteMusicWhileDictating} onChange={(event) => dispatchSettingsPatch({ muteMusicWhileDictating: event.target.checked })} />
      </label>

    </section>
  );
}
