import {
  DEFAULT_ASSISTANT_NAME,
  DICTATION_LANGUAGE_OPTIONS,
  PUSH_TO_TALK_SOUND_OPTIONS,
} from "../../constants";
import {
  asDictationLanguageMode,
  formatDictationLanguageLabel,
  normalizeDictationLanguageAllowList,
  normalizeDictationLanguageCode,
} from "../../state/settings-store";
import { dispatchSettingsPatch, useSettingsSnapshot } from "../../settings/settings-react-shim";
import { formatHotkeyForDisplay } from "../../hotkeys/hotkey-service";
import { captureModeLabel } from "../../utils";
import { AdvancedSettings, SettingsGroup } from "./SettingsPrimitives";

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
      <div
        id="settingsSection-general-audio"
        className="settings-category"
        data-settings-section-owner="general"
        data-settings-section="audio"
      >
        <SettingsGroup title="Recording input">
          <div className="settings-choice-row">
            <div className="settings-row-copy">
              <span className="settings-row-title">Capture mode</span>
              <span className="settings-row-hint" id="captureModeHint">{captureModeLabel(settings.captureMode)}</span>
            </div>
            <div className="settings-segmented" role="radiogroup" aria-label="Capture mode">
              <label className="settings-segment">
                <input id="captureModeSingle" name="captureMode" type="radio" value="single-tap" checked={settings.captureMode === "single-tap"} onChange={() => dispatchSettingsPatch({ captureMode: "single-tap" })} />
                Single tap
              </label>
              <label className="settings-segment">
                <input id="captureModePushToTalk" name="captureMode" type="radio" value="push-to-talk" checked={settings.captureMode === "push-to-talk"} onChange={() => dispatchSettingsPatch({ captureMode: "push-to-talk" })} />
                Push-to-talk
              </label>
            </div>
          </div>

          <div className="s-row" title="Hold or tap it to dictate. Change rebinds the keys.">
            <span className="s-row-label">Dictation hotkey <span className="s-row-hint" id="hotkeyHint">{formatHotkeyForDisplay(settings.pushToTalkHotkey)}</span></span>
            <button id="toggleHotkeyEditorBtn" className="btn" type="button">Change</button>
          </div>
          <div id="hotkeyEditor" className="s-row-block" hidden>
            <label className="field" htmlFor="hotkeyInput" title="Click the box, then press the keys you hold down to dictate.">
              <span className="field-label">Push-To-Talk Hotkey</span>
              <input id="hotkeyInput" type="text" placeholder="Click and press keys" autoComplete="off" />
            </label>
            <label className="field" htmlFor="commandHotkeyInput" title="Keys that rewrite the text you have selected instead of dictating.">
              <span className="field-label">Command Mode Hotkey</span>
              <input id="commandHotkeyInput" type="text" placeholder="Ctrl+Shift+Space" autoComplete="off" />
            </label>
          </div>

          <div className="s-row" title="Choose a microphone and lock it. Choose Auto-detect to follow the system default.">
            <span className="s-row-label">Microphone <span className="s-row-hint" id="microphoneSummary">Auto-detect</span></span>
            <button id="toggleMicEditorBtn" className="btn" type="button">Change</button>
          </div>
          <div id="microphoneEditor" className="s-row-block" hidden>
            <label className="field" htmlFor="microphoneSelect" title="Pick the microphone to record from.">
              <span className="field-label">Microphone Device</span>
              <select id="microphoneSelect"></select>
            </label>
            <button id="refreshMicsBtn" className="btn" type="button" title="Rescan after plugging a microphone in.">Refresh</button>
          </div>
        </SettingsGroup>

        <AdvancedSettings title="Advanced audio">
          <div className="s-row" title="Where the microphone is recorded. Native runs in Rust with lower latency; WebView is the compatible fallback.">
            <span className="s-row-label" id="captureBackendLabel">Audio backend</span>
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
        </AdvancedSettings>
      </div>

      <div
        id="settingsSection-general-dictation"
        className="settings-category"
        data-settings-section-owner="general"
        data-settings-section="dictation"
      >
        <SettingsGroup title="Language">
          <div className="settings-choice-row">
            <div className="settings-row-copy">
              <span className="settings-row-title">Dictation language</span>
              <span className="settings-row-hint">Let Whisper detect one language or choose from an allowlist.</span>
            </div>
            <div className="settings-segmented" role="radiogroup" aria-label="Dictation language mode">
              <label className="settings-segment">
                <input id="dictationLanguageModeSingle" name="dictationLanguageMode" type="radio" value="single" checked={languageMode === "single"} onChange={() => dispatchSettingsPatch({ dictationLanguageMode: "single" })} />
                Single
              </label>
              <label className="settings-segment">
                <input id="dictationLanguageModeMultiple" name="dictationLanguageMode" type="radio" value="multiple" checked={languageMode === "multiple"} onChange={() => dispatchSettingsPatch({ dictationLanguageMode: "multiple" })} />
                Multiple
              </label>
            </div>
          </div>
          <p id="dictationLanguageSummary" className="field-hint">{languageSummary}</p>
          <label className="field" htmlFor="dictationLanguageSelect" title="The language you dictate in. Auto-detect guesses it from the audio.">
            <span className="field-label">Primary language</span>
            <select id="dictationLanguageSelect" value={primaryLanguage} onChange={(event) => dispatchSettingsPatch({ dictationLanguage: event.target.value })}>
              <option value="">Auto-detect</option>
              {DICTATION_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
          </label>
          <div id="dictationLanguageMultiWrap" className="s-row-block" hidden={languageMode !== "multiple"} title="Languages the model may pick from when one dictation switches language.">
            <p className="settings-group-title">Allowed languages</p>
            <div className="language-grid">
              {DICTATION_LANGUAGE_OPTIONS.map((option) => (
                <label className="language-option" key={option.code}>
                  <input type="checkbox" value={option.code} data-dictation-lang-option checked={languageAllowList.includes(option.code)} onChange={() => toggleLanguageOption(option.code)} />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="field" htmlFor="styleProfileSelect" title="How the AI rewrites your transcript: tone and brevity.">
            <span className="field-label">Writing style</span>
            <select id="styleProfileSelect" value={settings.styleProfile} onChange={(event) => dispatchSettingsPatch({ styleProfile: event.target.value as typeof settings.styleProfile })}>
              <option value="adaptive">Adaptive</option>
              <option value="professional">Professional</option>
              <option value="casual">Casual</option>
              <option value="concise">Concise</option>
              <option value="developer">Developer</option>
            </select>
          </label>
        </SettingsGroup>

        <SettingsGroup title="Transcript cleanup">
          <label className="s-row" htmlFor="removeFillersToggle" title="Drops um, uh and similar filler sounds.">
            <span className="s-row-label">Remove filler words</span>
            <input id="removeFillersToggle" className="switch-input" type="checkbox" checked={settings.removeFillers} onChange={(event) => dispatchSettingsPatch({ removeFillers: event.target.checked })} />
          </label>
          <label className="s-row" htmlFor="autoPunctuationToggle" title="Adds punctuation and capitalisation.">
            <span className="s-row-label">Auto punctuation</span>
            <input id="autoPunctuationToggle" className="switch-input" type="checkbox" checked={settings.autoPunctuation} onChange={(event) => dispatchSettingsPatch({ autoPunctuation: event.target.checked })} />
          </label>
          <label className="s-row" htmlFor="numberedListsToggle" title="Turns a spoken list into numbered lines.">
            <span className="s-row-label">Auto numbered lists</span>
            <input id="numberedListsToggle" className="switch-input" type="checkbox" checked={settings.numberedLists} onChange={(event) => dispatchSettingsPatch({ numberedLists: event.target.checked })} />
          </label>
        </SettingsGroup>

        <AdvancedSettings title="Advanced cleanup">
          <label className="s-row" htmlFor="rawModeToggle" title="Send the transcript through untouched, with no AI cleanup.">
            <span className="s-row-label">Raw mode <span className="switch-desc">No AI cleanup</span></span>
            <input id="rawModeToggle" className="switch-input" type="checkbox" checked={settings.rawMode} onChange={(event) => dispatchSettingsPatch({ rawMode: event.target.checked })} />
          </label>
          <label className="s-row" htmlFor="backtrackToggle" title='Say "scratch that" to drop the last phrase you said.'>
            <span className="s-row-label">Backtrack corrections <span className="switch-desc">Scratch that</span></span>
            <input id="backtrackToggle" className="switch-input" type="checkbox" checked={settings.backtrackCorrection} onChange={(event) => dispatchSettingsPatch({ backtrackCorrection: event.target.checked })} />
          </label>
          <label className="s-row" htmlFor="noiseSuppressionToggle" title="Filters steady background noise before transcription.">
            <span className="s-row-label">Noise suppression <span className="switch-desc">Reduces steady fan and AC noise</span></span>
            <input id="noiseSuppressionToggle" className="switch-input" type="checkbox" checked={settings.noiseSuppression} onChange={(event) => dispatchSettingsPatch({ noiseSuppression: event.target.checked })} />
          </label>
        </AdvancedSettings>
      </div>

      <div
        id="settingsSection-general-assistant"
        className="settings-category"
        data-settings-section-owner="general"
        data-settings-section="assistant"
      >
        <SettingsGroup title="Wake and context">
          <label className="s-row" htmlFor="commandModeToggle" title="Speak edits for the text you have selected instead of dictating.">
            <span className="s-row-label">Command mode</span>
            <input id="commandModeToggle" className="switch-input" type="checkbox" checked={settings.commandMode} onChange={(event) => dispatchSettingsPatch({ commandMode: event.target.checked })} />
          </label>
          <label className="s-row" htmlFor="wakeWordEnabledToggle" title="Only act when the phrase starts with your assistant's name.">
            <span className="s-row-label">Require wake phrase</span>
            <input id="wakeWordEnabledToggle" className="switch-input" type="checkbox" checked={settings.wakeWordEnabled} onChange={(event) => dispatchSettingsPatch({ wakeWordEnabled: event.target.checked })} />
          </label>
          <label className="field" htmlFor="assistantNameInput" title="The name the wake phrase uses.">
            <span className="field-label">Assistant wake name</span>
            <input id="assistantNameInput" type="text" placeholder={DEFAULT_ASSISTANT_NAME} autoComplete="off" value={settings.assistantName} onChange={(event) => dispatchSettingsPatch({ assistantName: event.target.value })} />
          </label>
          <p id="wakePhrasePreview" className="field-hint">{`Say "Hey ${settings.assistantName.trim() || DEFAULT_ASSISTANT_NAME}", "Hi ${settings.assistantName.trim() || DEFAULT_ASSISTANT_NAME}", or "Okay ${settings.assistantName.trim() || DEFAULT_ASSISTANT_NAME}"`}</p>
        </SettingsGroup>

        <SettingsGroup title="Output">
          <label className="s-row" htmlFor="copyToClipboardToggle" title="Put the result on the clipboard after each run.">
            <span className="s-row-label">Copy response to clipboard</span>
            <input id="copyToClipboardToggle" className="switch-input" type="checkbox" checked={settings.copyToClipboard} onChange={(event) => dispatchSettingsPatch({ copyToClipboard: event.target.checked })} />
          </label>
          <label className="s-row" htmlFor="autoPasteDictationToggle" title="Paste the result into the app you were typing in.">
            <span className="s-row-label">Auto paste after copy</span>
            <input id="autoPasteDictationToggle" className="switch-input" type="checkbox" checked={settings.autoPasteDictation} onChange={(event) => dispatchSettingsPatch({ autoPasteDictation: event.target.checked })} />
          </label>
        </SettingsGroup>

        <AdvancedSettings title="Advanced context">
          <label className="s-row" htmlFor="contextAwarenessToggle" title="Include recent turns so replies stay on topic.">
            <span className="s-row-label">Context awareness <span className="switch-desc">Include recent turns</span></span>
            <input id="contextAwarenessToggle" className="switch-input" type="checkbox" checked={settings.contextAwareness} onChange={(event) => dispatchSettingsPatch({ contextAwareness: event.target.checked })} />
          </label>
        </AdvancedSettings>
      </div>

      <div
        id="settingsSection-general-appearance"
        className="settings-category"
        data-settings-section-owner="general"
        data-settings-section="appearance"
      >
        <SettingsGroup title="Theme">
          <select
            id="themeModeSelect"
            aria-label="Theme"
            value={settings.themeMode}
            onChange={(event) => dispatchSettingsPatch({ themeMode: event.target.value as typeof settings.themeMode })}
            hidden
          >
            <option value="system">Follow system</option>
            <option value="dark">Studio</option>
            <option value="light">Daylight</option>
            <option value="mono">Index</option>
          </select>
          <div className="theme-choice-grid" role="radiogroup" aria-label="Theme">
            <label className="theme-choice" data-theme="system">
              <input type="radio" name="themeCard" value="system" data-theme-card checked={settings.themeMode === "system"} onChange={() => dispatchSettingsPatch({ themeMode: "system" })} />
              <span className="theme-choice-swatch theme-choice-swatch--system" aria-hidden="true"><span /></span>
              <span className="theme-choice-copy"><strong>System</strong><small>Follow Windows</small></span>
            </label>
            <label className="theme-choice" data-theme="dark">
              <input type="radio" name="themeCard" value="dark" data-theme-card checked={settings.themeMode === "dark"} onChange={() => dispatchSettingsPatch({ themeMode: "dark" })} />
              <span className="theme-choice-swatch theme-choice-swatch--dark" aria-hidden="true"><span /></span>
              <span className="theme-choice-copy"><strong>Studio</strong><small>Near-black</small></span>
            </label>
            <label className="theme-choice" data-theme="light">
              <input type="radio" name="themeCard" value="light" data-theme-card checked={settings.themeMode === "light"} onChange={() => dispatchSettingsPatch({ themeMode: "light" })} />
              <span className="theme-choice-swatch theme-choice-swatch--light" aria-hidden="true"><span /></span>
              <span className="theme-choice-copy"><strong>Daylight</strong><small>Paper white</small></span>
            </label>
            <label className="theme-choice" data-theme="mono">
              <input type="radio" name="themeCard" value="mono" data-theme-card checked={settings.themeMode === "mono"} onChange={() => dispatchSettingsPatch({ themeMode: "mono" })} />
              <span className="theme-choice-swatch theme-choice-swatch--mono" aria-hidden="true"><span /></span>
              <span className="theme-choice-copy"><strong>Index</strong><small>Graphite</small></span>
            </label>
          </div>
        </SettingsGroup>
      </div>

      <div
        id="settingsSection-general-app-privacy"
        className="settings-category"
        data-settings-section-owner="general"
        data-settings-section="app-privacy"
      >
        <SettingsGroup title="App behavior">
          <label className="s-row" htmlFor="launchAtLoginToggle" title="Start SlasshyWispr when Windows signs in.">
            <span className="s-row-label">Launch at login</span>
            <input id="launchAtLoginToggle" className="switch-input" type="checkbox" checked={settings.launchAtLogin} onChange={(event) => dispatchSettingsPatch({ launchAtLogin: event.target.checked })} />
          </label>
          <label className="s-row" htmlFor="showFlowBarToggle" title="Show the small floating level dock while recording.">
            <span className="s-row-label">Show floating dock</span>
            <input id="showFlowBarToggle" className="switch-input" type="checkbox" checked={settings.showFlowBar} onChange={(event) => dispatchSettingsPatch({ showFlowBar: event.target.checked })} />
          </label>
          <label className="s-row" htmlFor="shellIntegrationToggle" title="Adds Transcribe with SlasshyWispr to the right-click menu for audio files.">
            <span className="s-row-label">Transcribe from Explorer</span>
            <input id="shellIntegrationToggle" className="switch-input" type="checkbox" checked={settings.shellIntegration} onChange={(event) => dispatchSettingsPatch({ shellIntegration: event.target.checked })} />
          </label>
        </SettingsGroup>

        <SettingsGroup title="Privacy">
          <label className="s-row" htmlFor="incognitoModeToggle" title="Dictate without writing history, stats, or achievements.">
            <span className="s-row-label">Incognito mode <span className="switch-desc">No history or stats</span></span>
            <input id="incognitoModeToggle" className="switch-input" type="checkbox" checked={settings.incognitoMode} onChange={(event) => dispatchSettingsPatch({ incognitoMode: event.target.checked })} />
          </label>
          {settings.incognitoMode && (
            <div className="privacy-suppressed" role="note" aria-label="What incognito suppresses">
              <p className="settings-group-title">While incognito is on</p>
              <ul className="privacy-suppressed-list">
                <li>Transcript turns are not written to History</li>
                <li>Usage stats and analytics sessions are not updated</li>
                <li>Quick notes are not created</li>
                <li>Achievements do not unlock from this session</li>
              </ul>
            </div>
          )}
        </SettingsGroup>

        <AdvancedSettings title="Advanced dock behavior">
          <label className="s-row" htmlFor="showDockAlwaysToggle" title="Keep the dock on screen even when idle.">
            <span className="s-row-label">Show dock always</span>
            <input id="showDockAlwaysToggle" className="switch-input" type="checkbox" checked={settings.showDockAlways} onChange={(event) => dispatchSettingsPatch({ showDockAlways: event.target.checked })} />
          </label>
        </AdvancedSettings>
      </div>

      <div
        id="settingsSection-general-recordings"
        className="settings-category"
        data-settings-section-owner="general"
        data-settings-section="recordings"
      >
        <SettingsGroup title="Saved audio">
          <label className="s-row" htmlFor="saveRecordingsToggle" title="Keep the audio of each dictation on this machine.">
            <span className="s-row-label">Save recordings <span className="switch-desc">Audio of what you said</span></span>
            <input id="saveRecordingsToggle" className="switch-input" type="checkbox" checked={settings.saveRecordings} onChange={(event) => dispatchSettingsPatch({ saveRecordings: event.target.checked })} />
          </label>
          <div className="s-row" title="Space used by saved recordings.">
            <span className="s-row-label">Storage used <span className="s-row-hint" id="recordingsStorageHint">0 files · 0 B</span></span>
            <button id="clearRecordingsBtn" className="btn-ghost" type="button" title="Delete every saved recording.">Clear all</button>
          </div>
          <p id="recordingsStorageHintWeb" className="field-hint" hidden>Recordings are saved only in the desktop app.</p>
        </SettingsGroup>
      </div>

      <div
        id="settingsSection-general-sound"
        className="settings-category"
        data-settings-section-owner="general"
        data-settings-section="sound"
      >
        <SettingsGroup title="Dictation cues">
          <label className="s-row" htmlFor="dictationSoundEffectsToggle" title="Play a short cue when recording starts and stops.">
            <span className="s-row-label">Sound effects</span>
            <input id="dictationSoundEffectsToggle" className="switch-input" type="checkbox" checked={settings.dictationSoundEffects} onChange={(event) => dispatchSettingsPatch({ dictationSoundEffects: event.target.checked })} />
          </label>
          <div className="s-row" title="Cue played when the hold begins.">
            <span className="s-row-label">Start sound</span>
            <div className="settings-inline-control">
              <select id="pushToTalkSoundSelect" className="mini-select" value={settings.pushToTalkSound} onChange={(event) => dispatchSettingsPatch({ pushToTalkSound: event.target.value })}>
                {PUSH_TO_TALK_SOUND_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <button id="previewPttSoundBtn" className="btn" type="button" title="Hear it before you pick it.">Preview</button>
            </div>
          </div>
          <div className="s-row" title="Cue played when the hold ends.">
            <span className="s-row-label">End sound</span>
            <div className="settings-inline-control">
              <select id="pushToTalkEndSoundSelect" className="mini-select" value={settings.pushToTalkEndSound} onChange={(event) => dispatchSettingsPatch({ pushToTalkEndSound: event.target.value })}>
                {PUSH_TO_TALK_SOUND_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
              <button id="previewPttEndSoundBtn" className="btn" type="button" title="Hear it before you pick it.">Preview</button>
            </div>
          </div>
          <div className="s-row" title="Loudness of those cues.">
            <span className="s-row-label">Volume <span className="s-row-hint" id="pttVolumeHint">{Math.round(settings.pushToTalkSoundVolume * 100)}%</span></span>
            <input id="pushToTalkSoundVolumeRange" className="settings-range" type="range" min="0" max="100" step="1" value={Math.round(settings.pushToTalkSoundVolume * 100)} onChange={(event) => dispatchSettingsPatch({ pushToTalkSoundVolume: Number(event.target.value) / 100 })} />
          </div>
          <label className="s-row" htmlFor="muteMusicWhileDictatingToggle" title="Pause other audio so it cannot bleed into the transcript.">
            <span className="s-row-label">Mute music while dictating</span>
            <input id="muteMusicWhileDictatingToggle" className="switch-input" type="checkbox" checked={settings.muteMusicWhileDictating} onChange={(event) => dispatchSettingsPatch({ muteMusicWhileDictating: event.target.checked })} />
          </label>
        </SettingsGroup>
      </div>
    </section>
  );
}
