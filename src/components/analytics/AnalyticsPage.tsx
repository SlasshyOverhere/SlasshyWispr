import { useEffect, useMemo, useState } from 'react';
import type { AchievementState, AnalyticsSessionDetail, UsageStats } from '../../types';
import {
  ACHIEVEMENTS_STATE_KEY as ACHIEVEMENTS_KEY,
  ANALYTICS_SESSIONS_KEY as SESSIONS_KEY,
  USAGE_STORAGE_KEY as USAGE_KEY,
} from '../../constants';
import { ACHIEVEMENT_DEFS } from '../../state/achievements';
import { parseJson } from '../../state/storage';
import './analytics.css';

type AnalyticsRange = '7d' | '30d' | 'all';

interface AnalyticsPageProps {
  usage: UsageStats;
  analyticsSessions: AnalyticsSessionDetail[];
  achievementStates: AchievementState[];
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getStreak(sessions: AnalyticsSessionDetail[]): number {
  if (sessions.length === 0) return 0;
  const activeDays = new Set<string>();
  for (const s of sessions) {
    activeDays.add(getDayKey(new Date(s.date)));
  }
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // Start from yesterday so the streak persists even if user hasn't dictated yet today
  for (let i = 1; i < 366; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = getDayKey(d);
    if (activeDays.has(key)) {
      streak++;
    } else {
      break;
    }
  }
  // If user dictated today, add it to the streak
  if (activeDays.has(getDayKey(today))) {
    streak++;
  }
  return streak;
}

function getStreakTier(streak: number): 1 | 2 | 3 | 4 | 5 {
  if (streak >= 100) return 5;
  if (streak >= 30) return 4;
  if (streak >= 7) return 3;
  if (streak >= 3) return 2;
  return 1;
}

function getStreakSubMessage(streak: number): string {
  if (streak >= 100) return 'Unstoppable. A hundred days of voice.';
  if (streak >= 30) return 'Discipline made visible. Keep the fire.';
  if (streak >= 7) return 'You’re on a roll — a full week of dictation.';
  if (streak >= 3) return 'Momentum is building. Don’t break the chain.';
  if (streak === 2) return 'Two days running. One more makes it a habit.';
  return 'You dictated today. Tomorrow keeps the streak alive.';
}

function getLast7DaysActivity(sessions: AnalyticsSessionDetail[]): boolean[] {
  const activeDays = new Set<string>();
  for (const s of sessions) {
    activeDays.add(getDayKey(new Date(s.date)));
  }
  const out: boolean[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    out.push(activeDays.has(getDayKey(d)));
  }
  return out;
}

function formatWpm(wpm: number): string {
  return `${Math.round(wpm)}`;
}

/* One column per day, scaled to the range's peak. The old grid grouped
   days into week-rows and stretched each cell with `flex: 1`, so any
   range under a week painted seven identical full-width bars. */
function DailyActivity({ sessions, range }: { sessions: AnalyticsSessionDetail[]; range: AnalyticsRange }) {
  const days = useMemo(() => {
    const span = range === '7d' ? 7 : 30;
    const totals = new Map<string, number>();
    for (const s of sessions) {
      const key = getDayKey(new Date(s.date));
      totals.set(key, (totals.get(key) || 0) + s.words);
    }
    const out: Array<{ key: string; words: number; label: string; dateLabel: string; isToday: boolean }> = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = getDayKey(d);
      out.push({
        key,
        words: totals.get(key) || 0,
        label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
        dateLabel: d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
        isToday: i === 0,
      });
    }
    return out;
  }, [sessions, range]);

  const peak = Math.max(...days.map(d => d.words), 1);
  const span = days.length;
  const showLabels = span <= 10;
  const empty = days.every(d => d.words === 0);

  return (
    <section className="analytics-activity">
      <div className="analytics-activity-head">
        <h3 className="analytics-section-title">Daily activity</h3>
        <span className="analytics-activity-meta">
          {empty ? 'No dictation in this range' : `Last ${span} days · peak ${peak.toLocaleString()}`}
        </span>
      </div>
      <div className="analytics-activity-bars" role="img" aria-label={`Words per day over the last ${span} days`}>
        {days.map((d, i) => (
          <div
            key={d.key}
            className={`activity-col ${d.isToday ? 'is-today' : ''}`}
            title={`${d.key}: ${d.words.toLocaleString()} words`}
          >
            <span className="activity-track">
              <span
                className="activity-bar"
                style={{ height: `${d.words === 0 ? 0 : Math.max(6, Math.round((d.words / peak) * 100))}%` }}
              />
            </span>
            {showLabels && <span className="activity-label">{d.label}</span>}
            {!showLabels && (i === 0 || i === span - 1) && <span className="activity-label">{d.dateLabel}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function RecentActivity({ sessions }: { sessions: AnalyticsSessionDetail[] }) {
  const recent = useMemo(() => {
    return [...sessions].sort((a, b) => b.date - a.date).slice(0, 12);
  }, [sessions]);

  if (recent.length === 0) return null;

  return (
    <div className="analytics-recent-section">
      <h3 className="analytics-section-title">Recent Activity</h3>
      <div className="analytics-recent-list">
        {recent.map((s, i) => {
          const d = new Date(s.date);
          const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
          const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
          return (
            <div key={s.date + '-' + i} className="analytics-recent-row">
              <span className="analytics-recent-time">{dateStr} {time}</span>
              <span className="analytics-recent-words">{s.words.toLocaleString()} words</span>
              <span className="analytics-recent-meta">{formatDuration(s.speakingSeconds)}</span>
              <span className="analytics-recent-wpm">{formatWpm(s.wpm)} wpm</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AchievementsGrid({ usage, achievementStates }: { usage: UsageStats; achievementStates: AchievementState[] }) {
  const currentMetric = (m: 'words' | 'sessions' | 'speakingSeconds'): number => {
    if (m === 'words') return usage.words + (usage.prevWords || 0);
    if (m === 'sessions') return usage.sessions + (usage.prevSessions || 0);
    return usage.speakingSeconds + (usage.prevSpeakingSeconds || 0);
  };

  const stateMap = useMemo(() => {
    const m = new Map<string, AchievementState>();
    for (const s of achievementStates) m.set(s.id, s);
    return m;
  }, [achievementStates]);

  return (
    <div className="analytics-achievements-section">
      <h3 className="analytics-section-title">Achievements</h3>
      <div className="analytics-achievements-grid">
        {ACHIEVEMENT_DEFS.map((def) => {
          const state = stateMap.get(def.id);
          const unlocked = state?.unlockedAt != null;
          const progress = Math.min(currentMetric(def.metric) / def.threshold, 1);
          return (
            <article key={def.id} className={`achievement-card ${unlocked ? 'is-unlocked' : ''}`}>
              <div className="achievement-icon-wrap">
                <span className="achievement-icon" />
                {unlocked && <span className="achievement-check">✓</span>}
              </div>
              <div className="achievement-info">
                <span className="achievement-label">{def.label}</span>
                <span className="achievement-desc">{def.description}</span>
              </div>
              {!unlocked && (
                <div className="achievement-progress-bar">
                  <div className="achievement-progress-fill" style={{ width: `${Math.min(progress * 100, 100)}%` }} />
                </div>
              )}
              {unlocked && state && (
                <span className="achievement-date">{formatDate(state.unlockedAt!)}</span>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

export function AnalyticsPage({ usage: initialUsage, analyticsSessions: initialSessions, achievementStates: initialAchievements }: AnalyticsPageProps) {
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [localUsage, setLocalUsage] = useState(initialUsage);
  const [localSessions, setLocalSessions] = useState(initialSessions);
  const [localAchievements, setLocalAchievements] = useState(initialAchievements);

  useEffect(() => {
    const handler = (): void => {
      setLocalUsage(parseJson<UsageStats>(USAGE_KEY, initialUsage));
      const parsed = parseJson<AnalyticsSessionDetail[]>(SESSIONS_KEY, []);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setLocalSessions(parsed);
      }
      setLocalAchievements(parseJson<AchievementState[]>(ACHIEVEMENTS_KEY, initialAchievements));
    };
    window.addEventListener('slasshywispr:store-updated', handler);
    return () => window.removeEventListener('slasshywispr:store-updated', handler);
  }, [initialUsage, initialSessions, initialAchievements]);

  const filteredSessions = useMemo(() => {
    if (range === 'all') return localSessions;
    const nowDate = new Date();
    const cutoffDate = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - (range === '7d' ? 7 : 30));
    const cutoff = cutoffDate.getTime();
    return localSessions.filter(s => s.date >= cutoff);
  }, [localSessions, range]);

  const periodWords = useMemo(() => filteredSessions.reduce((a, s) => a + s.words, 0), [filteredSessions]);
  const periodSeconds = useMemo(() => filteredSessions.reduce((a, s) => a + s.speakingSeconds, 0), [filteredSessions]);
  const periodSessions = filteredSessions.length;
  const periodWpm = useMemo(() => {
    return filteredSessions.length > 0 ? filteredSessions.reduce((a, s) => a + s.wpm, 0) / filteredSessions.length : 0;
  }, [filteredSessions]);

  const streak = useMemo(() => getStreak(localSessions), [localSessions]);
  const last7 = useMemo(() => getLast7DaysActivity(localSessions), [localSessions]);

  return (
    <div className="analytics-page">
      <header className="analytics-header">
        <div>
          <h1 className="analytics-title">Analytics</h1>
          <p className="analytics-subtitle">Dictation metrics, achievements and activity</p>
        </div>
        <div className="analytics-range-picker">
          <button className={`analytics-range-btn ${range === '7d' ? 'is-active' : ''}`} onClick={() => setRange('7d')} type="button">7 days</button>
          <button className={`analytics-range-btn ${range === '30d' ? 'is-active' : ''}`} onClick={() => setRange('30d')} type="button">30 days</button>
          <button className={`analytics-range-btn ${range === 'all' ? 'is-active' : ''}`} onClick={() => setRange('all')} type="button">All time</button>
        </div>
      </header>

      {streak > 0 && (
        <div
          className="analytics-streak-banner"
          data-streak-tier={getStreakTier(streak)}
          role="status"
          aria-label={`${streak} day dictation streak`}
        >
          <span className="streak-icon-wrap" aria-hidden="true">
            <svg
              className="streak-flame"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 2.5c.4 2.2-.6 3.7-1.9 5.2-1.4 1.6-3.1 3.2-3.1 5.8 0 1.1.3 2.1.9 2.9-.6-2.4.4-4 1.7-5.1.2 1.6 1.1 2.4 2.2 2.9-.4-2.1.4-3.9 1.7-5.5.3 1.5 1.3 2.4 2.4 3.2 1.2.9 2.3 1.9 2.6 3.6.4 2.3-.6 4.4-2.2 5.8-1.5 1.3-3.6 1.9-5.5 1.5-2.3-.5-4.2-2.2-4.9-4.4-.7-2.2-.1-4.6 1.4-6.3.7-.8 1.6-1.5 2.2-2.4.7-1 1.1-2.2.8-3.4 0-.2.1-.4.3-.4.2 0 .3.1.4.3.5 1.4 1.2 2.7 1 4.1-.1.6-.3 1.2-.6 1.7.6-1.4.6-3 .6-4.5z" />
            </svg>
          </span>
          <div className="streak-body">
            <div className="streak-headline">
              <span className="streak-count">{streak}</span>
              <span className="streak-label">day streak</span>
            </div>
            <span className="streak-sub">{getStreakSubMessage(streak)}</span>
          </div>
          <div className="streak-meter" aria-hidden="true">
            <span className="streak-meter-label">Last 7</span>
            <span className="streak-meter-dots">
              {last7.map((active, i) => (
                <span key={i} className={`streak-meter-dot ${active ? 'is-lit' : ''}`} />
              ))}
            </span>
          </div>
        </div>
      )}

      <div className="analytics-metrics">
        <div className="analytics-metric">
          <span className="analytics-metric-label">Words</span>
          <span className="analytics-metric-value">{periodWords.toLocaleString()}</span>
          <span className="analytics-metric-sub">{localUsage.words.toLocaleString()} all time</span>
        </div>
        <div className="analytics-metric">
          <span className="analytics-metric-label">Speaking Time</span>
          <span className="analytics-metric-value">{formatDuration(periodSeconds)}</span>
          <span className="analytics-metric-sub">{formatDuration(localUsage.speakingSeconds)} all time</span>
        </div>
        <div className="analytics-metric">
          <span className="analytics-metric-label">Sessions</span>
          <span className="analytics-metric-value">{periodSessions}</span>
          <span className="analytics-metric-sub">{localUsage.sessions} all time</span>
        </div>
        <div className="analytics-metric">
          <span className="analytics-metric-label">Avg Pace</span>
          <span className="analytics-metric-value">{formatWpm(periodWpm)} <span className="analytics-metric-unit">wpm</span></span>
          <span className="analytics-metric-sub">{formatWpm(localUsage.avgWpm)} wpm overall</span>
        </div>
      </div>

      <DailyActivity sessions={filteredSessions} range={range} />

      <RecentActivity sessions={filteredSessions} />

      <AchievementsGrid usage={localUsage} achievementStates={localAchievements} />
    </div>
  );
}
