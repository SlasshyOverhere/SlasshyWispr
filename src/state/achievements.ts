import type { AchievementDef } from "../types";

/**
 * Canonical achievement definitions.
 *
 * Single owner — both the unlock logic (main.tsx) and the display grid
 * (AnalyticsPage.tsx) must import from here, never redefine.
 *
 * NOTE: unlock evaluation historically uses current-period totals while the
 * display grid uses current + prev totals. That divergence is preserved here
 * (behavior-preserving move); fixing it is a separate, flagged follow-up.
 */
export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { id: 'words-1k', label: 'First Milestone', description: '1,000 total words dictated', threshold: 1000, metric: 'words' },
  { id: 'words-10k', label: 'Word Explorer', description: '10,000 total words dictated', threshold: 10000, metric: 'words' },
  { id: 'words-50k', label: 'Wordsmith', description: '50,000 total words dictated', threshold: 50000, metric: 'words' },
  { id: 'words-100k', label: 'Lexicon Master', description: '100,000 total words dictated', threshold: 100000, metric: 'words' },
  { id: 'sessions-100', label: 'Century Mark', description: '100 dictation sessions', threshold: 100, metric: 'sessions' },
  { id: 'sessions-1k', label: 'Dedicated Dictator', description: '1,000 dictation sessions', threshold: 1000, metric: 'sessions' },
  { id: 'time-1h', label: 'First Hour', description: '1 hour of speaking time', threshold: 3600, metric: 'speakingSeconds' },
  { id: 'time-10h', label: 'Vocal Veteran', description: '10 hours of speaking time', threshold: 36000, metric: 'speakingSeconds' },
  { id: 'time-50h', label: 'Orator', description: '50 hours of speaking time', threshold: 180000, metric: 'speakingSeconds' },
];
