import { useEffect, useState } from 'react';

const ONBOARDING_DISMISSED_KEY = 'slasshy-wispr-onboarding-dismissed-v1';

type Step = 'welcome' | 'hotkey' | 'tts' | 'done';

export function OnboardingWizard() {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState<Step>('welcome');

  useEffect(() => {
    if (localStorage.getItem(ONBOARDING_DISMISSED_KEY)) return;
    const raw = localStorage.getItem('slasshy-desktop-assistant-settings-v4');
    if (!raw) setVisible(true);
    else {
      try {
        const s = JSON.parse(raw);
        if (!s.apiKey && !s.localSttModel) setVisible(true);
      } catch { setVisible(true); }
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, 'true');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboardingTitle">
        {step === 'welcome' && (
          <>
            <h2 id="onboardingTitle">Welcome to SlasshyWispr</h2>
            <p>Your voice dictation and AI assistant. Take 30s to set up.</p>
            <ol className="onboarding-steps">
              <li>Set your push-to-talk hotkey</li>
              <li>Configure speech output (TTS)</li>
              <li>Start dictating</li>
            </ol>
            <div className="onboarding-actions">
              <button className="dark-action" type="button" onClick={() => setStep('hotkey')}>Get started</button>
              <button className="ghost-action" type="button" onClick={dismiss}>Skip</button>
            </div>
          </>
        )}

        {step === 'hotkey' && (
          <>
            <h2 id="onboardingTitle">Push-to-Talk Hotkey</h2>
            <p>Press this key combination to start and stop recording.</p>
            <div className="onboarding-hotkey-demo">
              <kbd>Ctrl</kbd><span>+</span><kbd>Space</kbd>
            </div>
            <p className="onboarding-hint">
              You can change this later in <strong>Settings &gt; General</strong>.
            </p>
            <div className="onboarding-actions">
              <button className="dark-action" type="button" onClick={() => setStep('tts')}>Next</button>
              <button className="ghost-action" type="button" onClick={() => setStep('tts')}>Skip</button>
            </div>
          </>
        )}

        {step === 'tts' && (
          <>
            <h2 id="onboardingTitle">Voice Output</h2>
            <p>SlasshyWispr can speak responses aloud. Go to <strong>Settings &gt; Update &amp; Security</strong> to download the voice model when you're ready.</p>
            <p className="onboarding-hint">TTS works offline — no internet needed once installed.</p>
            <div className="onboarding-actions">
              <button className="dark-action" type="button" onClick={() => setStep('done')}>Next</button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <h2 id="onboardingTitle">You're all set!</h2>
            <p>Press your hotkey to start dictating, or say <strong>"Hey {localStorage.getItem('slasshy-desktop-assistant-settings-v4') ? JSON.parse(localStorage.getItem('slasshy-desktop-assistant-settings-v4') || '{}').assistantName || 'Lily' : 'Lily'}"</strong> for assistant mode.</p>
            <p className="onboarding-hint">Need help? Check Settings or hit <kbd>Alt+S</kbd>.</p>
            <div className="onboarding-actions">
              <button className="dark-action" type="button" onClick={dismiss}>Start dictating</button>
            </div>
          </>
        )}

        <div className="onboarding-dots">
          {(['welcome', 'hotkey', 'tts', 'done'] as const).map(s => (
            <span key={s} className={`onboarding-dot ${step === s ? 'active' : ''}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
