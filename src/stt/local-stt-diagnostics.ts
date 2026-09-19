/**
 * Local-STT offline diagnostics — Phase 5 shell decomposition.
 *
 * Owns checkModelFileExists + checkPythonDependencies +
 * checkAvailableMemory + showOfflineModeDiagnostic +
 * getOfflineDiagnosticData. Moved verbatim from main.tsx; shell seams
 * (settings commit, notices, panes, browser, STT actions, IPC) arrive
 * via initLocalSttDiagnostics so this module never touches main.tsx
 * module globals.
 */
import type { PersistedSettings, SettingsPane } from "../types";
import { asErrorMessage, escapeHtml } from "../utils";
import {
  getLocalSttHardwareAdvice as ipcGetLocalSttHardwareAdvice,
  getLocalSttModelStatus as ipcGetLocalSttModelStatus,
  setupCoquiRuntime as ipcSetupCoquiRuntime,
  warmupLocalSttModel as ipcWarmupLocalSttModel,
} from "../ipc/client";
import { inferLocalSttProviderFromModel } from "./provider-inference";

export interface StageTimings {
  sttMs?: number;
  aiMs?: number;
  ttsMs?: number;
  totalMs?: number;
}

function formatStageMs(value: number | undefined): string {
  return Number.isFinite(value) ? `${Math.max(0, Math.round(value as number))}ms` : "n/a";
}

/** One-line latency budget: `STT 412ms / AI 1830ms / TTS 305ms (total 2547ms)`. */
export function formatStageTimings(timings: StageTimings): string {
  const stages = `STT ${formatStageMs(timings.sttMs)} / AI ${formatStageMs(timings.aiMs)} / TTS ${formatStageMs(timings.ttsMs)}`;
  return Number.isFinite(timings.totalMs) ? `${stages} (total ${Math.round(timings.totalMs as number)}ms)` : stages;
}

/** Explain-Why-Slow thin slice: names the slowest stage plus one fix hint. */
// ponytail: ceiling is slowest-stage heuristic; add per-model thresholds when Agent 2 ships tts_status semantics.
export function explainWhySlow(timings: StageTimings): string {
  const entries: Array<[string, number | undefined]> = [
    ["STT", timings.sttMs],
    ["AI", timings.aiMs],
    ["TTS", timings.ttsMs],
  ];
  const known = entries.filter((entry): entry is [string, number] => Number.isFinite(entry[1]));
  if (known.length === 0) return "No timing data yet — run one dictation turn first.";
  known.sort((a, b) => b[1] - a[1]);
  const [slowest, ms] = known[0];
  if (ms < 2000) return `All stages fast (slowest: ${slowest} ${Math.round(ms)}ms).`;
  const hint =
    slowest === "STT"
      ? "Try a smaller offline model or check microphone audio."
      : slowest === "AI"
        ? "Try a smaller/faster model or switch to online mode."
        : "Piper TTS runs locally; long replies take longer — shorten replies.";
  return `Slowest stage: ${slowest} (${Math.round(ms)}ms). ${hint}`;
}

export interface OfflineDiagnosticDetails {
  model?: string;
  expectedPath?: string;
  availableMemory?: number;
  pythonInstalled?: boolean;
  waitTime?: string;
}

export interface LocalSttDiagnosticsDeps {
  readSettings: () => PersistedSettings;
  commitSettings: (next: PersistedSettings) => void;
  notify: (message: string, isError?: boolean) => void;
  openSettings: (reason: string) => void;
  setActiveSettingsPane: (pane: SettingsPane, reason?: string) => void;
  openInSystemBrowser: (url: string) => void;
  activateSelectedLocalSttModel: () => void;
}

let diagnosticsDeps!: LocalSttDiagnosticsDeps;

export function initLocalSttDiagnostics(deps: LocalSttDiagnosticsDeps): void {
  diagnosticsDeps = deps;
}

/**
 * Checks if a model file exists on disk
 */
export async function checkModelFileExists(_model: string): Promise<boolean> {
  const response = await ipcGetLocalSttModelStatus(
    { model: _model },
    `Timed out while checking local STT files for "${_model}".`,
  );
  return response?.exists === true;
}

/**
 * Checks if Python dependencies are installed
 */
export async function checkPythonDependencies(model: string): Promise<boolean> {
  const provider = inferLocalSttProviderFromModel(model);
  if (!provider || provider === "parakeet") {
    return true;
  }
  try {
    const response = await ipcWarmupLocalSttModel(
      { model },
      12000,
      `Timed out while checking local STT runtime dependencies for "${model}".`,
    );
    if (response.warmed) {
      return true;
    }
    const message = response.details.toLowerCase();
    return !(
      message.includes("python") ||
      message.includes("module") ||
      message.includes("nemo") ||
      message.includes("zero-python")
    );
  } catch (error) {
    const msg = asErrorMessage(error).toLowerCase();
    if (msg.includes("python") || msg.includes("module") || msg.includes("nemo")) {
      return false;
    }
    return true;
  }
}

/**
 * Checks available system memory
 */
export async function checkAvailableMemory(model: string): Promise<{ sufficient: boolean; availableMB?: number }> {
  try {
    // Get hardware advice which includes memory info
    const advice = await ipcGetLocalSttHardwareAdvice({ selectedModel: model });

    // Parakeet v3 needs ~600MB, v2 needs ~500MB
    // const requiredMB = model.includes("parakeet-tdt-0.6b") ? 600 : 500;
    // const availableMB = advice.totalRamGb * 1024; // Convert GB to MB

    // Consider sufficient if at least 1GB free (conservative)
    return {
      sufficient: advice.totalRamGb >= 2,
      availableMB: Math.round(advice.totalRamGb * 1024)
    };
  } catch (error) {
    console.warn("Memory check failed:", error);
    return { sufficient: true }; // Assume OK if we can't check
  }
}

/**
 * Shows a detailed diagnostic dialog when offline mode setup fails
 */
export function showOfflineModeDiagnostic(issue: string, details?: {
  model?: string;
  expectedPath?: string;
  availableMemory?: number;
  pythonInstalled?: boolean;
}): void {
  const diagnostics = getOfflineDiagnosticData(issue, details);

  const overlay = document.createElement("div");
  overlay.className = "offline-diagnostic-overlay";
  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.2s ease-out;
  `;

  const dialog = document.createElement("div");
  dialog.className = "offline-diagnostic-dialog";
  dialog.style.cssText = `
    background: var(--surface-elevated, #1e1e1e);
    border: 1px solid var(--border-subtle, #333);
    border-radius: 12px;
    padding: 24px;
    max-width: 560px;
    width: 90%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    animation: slideUp 0.3s ease-out;
  `;

  dialog.innerHTML = `
    <div style="margin-bottom: 20px;">
      <div style="font-size: 32px; margin-bottom: 12px;">${diagnostics.icon}</div>
      <h3 style="margin: 0 0 8px 0; font-size: 18px; color: var(--text-primary, #fff);">${escapeHtml(diagnostics.title)}</h3>
      <p style="margin: 0; color: var(--text-secondary, #aaa); font-size: 14px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(diagnostics.description)}</p>
    </div>

    ${details?.model ? `
    <div style="background: var(--surface-raised, #2a2a2a); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
      <div style="font-size: 12px; color: var(--text-muted, #888); margin-bottom: 4px;">Model</div>
      <div style="font-family: monospace; font-size: 13px; color: var(--text-primary, #fff); word-break: break-all;">${escapeHtml(details?.model)}</div>
    </div>
    ` : ''}

    <div style="margin-bottom: 20px;">
      <div style="font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary, #fff);">How to fix:</div>
      <ol style="margin: 0; padding-left: 20px; color: var(--text-secondary, #aaa); font-size: 13px; line-height: 1.6;">
        ${diagnostics.steps.map(step => `<li style="margin-bottom: 6px;">${escapeHtml(step)}</li>`).join('')}
      </ol>
    </div>

    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      ${diagnostics.actions.map(action => `
        <button
          data-action="${escapeHtml(action.id)}"
          class="diagnostic-action-btn"
          style="
            padding: 8px 16px;
            border: 1px solid ${action.primary ? '#3b82f6' : 'var(--border-subtle, #444)'};
            background: ${action.primary ? '#3b82f6' : 'transparent'};
            color: #ffffff;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.15s ease;
          "
        >
          ${escapeHtml(action.label)}
        </button>
      `).join('')}
    </div>
  `;

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Add hover effects
  const buttons = dialog.querySelectorAll('.diagnostic-action-btn');
  buttons.forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      if (!btn.textContent?.includes('Cancel')) {
        (btn as HTMLElement).style.transform = 'translateY(-1px)';
        (btn as HTMLElement).style.boxShadow = '0 2px 8px rgba(59, 130, 246, 0.3)';
      }
    });
    btn.addEventListener('mouseleave', () => {
      (btn as HTMLElement).style.transform = 'translateY(0)';
      (btn as HTMLElement).style.boxShadow = 'none';
    });
  });

  // Handle actions
  buttons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const actionId = btn.getAttribute('data-action');
      const action = diagnostics.actions.find(a => a.id === actionId);

      overlay.style.animation = 'fadeOut 0.2s ease-in';
      setTimeout(() => overlay.remove(), 200);

      if (action?.handler) {
        await action.handler();
      }
    });
  });

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.style.animation = 'fadeOut 0.2s ease-in';
      setTimeout(() => overlay.remove(), 200);
    }
  });
}

/**
 * Returns diagnostic data for specific offline mode issues
 */
export function getOfflineDiagnosticData(issue: string, details?: OfflineDiagnosticDetails): {
  icon: string;
  title: string;
  description: string;
  steps: string[];
  actions: Array<{ id: string; label: string; primary?: boolean; handler?: () => Promise<void> | void }>;
} {
  switch (issue) {
    case 'no-model-downloaded':
      return {
        icon: '⬇️',
        title: 'No Offline Model Downloaded',
        description: 'To use offline mode, you need to download a speech recognition model first.',
        steps: [
          'Open Settings → Models tab',
          'Scroll to "Offline STT Model" section',
          'Select a model (e.g., "Parakeet v3 - 478 MB")',
          'Click "Download & install selected model"',
          'Wait for download to complete (~2-5 minutes)',
          'Then click "Load STT" again'
        ],
        actions: [
          {
            id: 'open-settings',
            label: 'Open Settings',
            primary: true,
            handler: () => {
              diagnosticsDeps.openSettings('user-click');
              diagnosticsDeps.setActiveSettingsPane('models');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    case 'wrong-stt-mode':
      return {
        icon: '🔄',
        title: 'STT Mode is Currently "Online"',
        description: 'To load an offline STT model, you need to switch from Online to Local mode.',
        steps: [
          'Open Settings → Models tab',
          'Find "STT Runtime Mode" section',
          'Click the "Offline" radio button',
          'Select a model from "Local STT Model" dropdown',
          'If no models appear, download one first',
          'Click "Save Settings"',
          'Then click "Load STT" button'
        ],
        actions: [
          {
            id: 'switch-now',
            label: 'Switch to Offline Now',
            primary: true,
            handler: async () => {
              const currentSettings = diagnosticsDeps.readSettings();
              currentSettings.sttRuntimeMode = 'local';
              diagnosticsDeps.commitSettings(currentSettings);
              diagnosticsDeps.notify('Switched to Offline mode. Now select a model and click "Load STT".');
            }
          },
          {
            id: 'open-settings',
            label: 'Open Settings',
            handler: () => {
              diagnosticsDeps.openSettings('user-click');
              diagnosticsDeps.setActiveSettingsPane('models');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    case 'model-file-missing':
      return {
        icon: '❌',
        title: 'Model File Not Found',
        description: `The selected model file appears to be missing or incomplete.${details?.model ? `\n\nExpected: ${details?.model}` : ''}`,
        steps: [
          'The model may not have been downloaded yet',
          'Download was interrupted or corrupted',
          'Antivirus may have quarantined the files',
          '',
          'Solution:',
          'Delete and re-download the model from Settings → Models'
        ],
        actions: [
          {
            id: 'redownload',
            label: 'Download Model',
            primary: true,
            handler: () => {
              diagnosticsDeps.openSettings('user-click');
              diagnosticsDeps.setActiveSettingsPane('models');
              setTimeout(() => {
                const downloadBtn = document.getElementById('downloadLocalSttModelBtn');
                if (downloadBtn) {
                  (downloadBtn as HTMLButtonElement).click();
                }
              }, 100);
            }
          },
          {
            id: 'use-online',
            label: 'Use Online Mode',
            handler: () => {
              const currentSettings = diagnosticsDeps.readSettings();
              currentSettings.sttRuntimeMode = 'online';
              diagnosticsDeps.commitSettings(currentSettings);
              diagnosticsDeps.notify('Switched to Online mode.');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    case 'python-deps-missing':
      return {
        icon: '🐍',
        title: 'Python Dependencies Not Installed',
        description: 'Offline STT requires Python packages that aren\'t installed.',
        steps: [
          'Missing: nemo-toolkit (for Parakeet) OR transformers + faster-whisper',
          '',
          'Quick Fix:',
          'Click "Install Dependencies" to run the automatic setup script',
          '',
          'Manual Fix:',
          '1. Ensure Python 3.9+ is installed',
          '2. Run: pip install torch torchaudio nemo-toolkit',
          '3. Restart the app'
        ],
        actions: [
          {
            id: 'install-deps',
            label: 'Install Dependencies',
            primary: true,
            handler: async () => {
              diagnosticsDeps.notify('Running dependency installation script...');
              try {
                await ipcSetupCoquiRuntime({ pythonPath: null, useGpu: false });
                diagnosticsDeps.notify('Dependencies installed successfully! Try loading STT again.');
              } catch (error) {
                diagnosticsDeps.notify(`Installation failed: ${asErrorMessage(error)}`, true);
              }
            }
          },
          {
            id: 'guide',
            label: 'Setup Guide',
            handler: () => {
              diagnosticsDeps.openInSystemBrowser('https://github.com/SlasshyOverhere/SlasshyWispr#quick-setup');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    case 'insufficient-memory':
      return {
        icon: '💾',
        title: 'Insufficient Memory for Offline Model',
        description: `Your system doesn't have enough free memory to load this model safely.${details?.availableMemory ? `\nAvailable: ~${Math.round(details.availableMemory / 1024)}MB` : ''}`,
        steps: [
          'Required: ~600MB RAM for Parakeet v3',
          '',
          'Options:',
          '1. Use a smaller model (Parakeet v2: 473MB or Moonshine: 58MB)',
          '2. Close other applications to free memory',
          '3. Use Online mode instead (no local model needed)',
          '4. Update CUDA drivers if you have NVIDIA GPU'
        ],
        actions: [
          {
            id: 'try-smaller',
            label: 'Try Smaller Model',
            primary: true,
            handler: () => {
              const currentSettings = diagnosticsDeps.readSettings();
              currentSettings.localSttModel = 'nvidia/parakeet-tdt_ctc-110m';
              diagnosticsDeps.commitSettings(currentSettings);
              diagnosticsDeps.notify('Switched to smaller model. Click "Load STT" to try again.');
            }
          },
          {
            id: 'use-online',
            label: 'Use Online Mode',
            handler: () => {
              const currentSettings = diagnosticsDeps.readSettings();
              currentSettings.sttRuntimeMode = 'online';
              diagnosticsDeps.commitSettings(currentSettings);
              diagnosticsDeps.notify('Switched to Online mode.');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    case 'load-timeout':
      return {
        icon: '⏱️',
        title: 'Model Loading Taking Longer Than Expected',
        description: 'The model is still loading. This can happen on slower systems.',
        steps: [
          `Current wait time: ${(details as { waitTime?: string })?.waitTime || 'unknown'}`,
          'Expected: 15-30 seconds',
          '',
          'This is normal for first-time loads on HDD or low-RAM systems.',
          'The model will eventually load, but you can also:'
        ],
        actions: [
          {
            id: 'wait-longer',
            label: 'Keep Waiting',
            primary: true,
            handler: () => {
              diagnosticsDeps.notify('Continuing to load... Please wait.');
            }
          },
          {
            id: 'try-smaller',
            label: 'Try Smaller Model',
            handler: () => {
              const currentSettings = diagnosticsDeps.readSettings();
              currentSettings.localSttModel = 'nvidia/parakeet-tdt_ctc-110m';
              diagnosticsDeps.commitSettings(currentSettings);
              diagnosticsDeps.notify('Switched to smaller model. Click "Load STT" to try again.');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };

    default:
      return {
        icon: '⚠️',
        title: 'Offline Mode Setup Failed',
        description: issue || 'An unknown error occurred while setting up offline mode.',
        steps: [
          'Check that you have a stable internet connection',
          'Verify the model is properly downloaded',
          'Try restarting the application',
          'If problem persists, use Online mode'
        ],
        actions: [
          {
            id: 'retry',
            label: 'Retry',
            primary: true,
            handler: () => {
              diagnosticsDeps.activateSelectedLocalSttModel();
            }
          },
          {
            id: 'use-online',
            label: 'Use Online Mode',
            handler: () => {
              const currentSettings = diagnosticsDeps.readSettings();
              currentSettings.sttRuntimeMode = 'online';
              diagnosticsDeps.commitSettings(currentSettings);
              diagnosticsDeps.notify('Switched to Online mode.');
            }
          },
          {
            id: 'cancel',
            label: 'Cancel',
            handler: () => {}
          }
        ]
      };
  }
}
