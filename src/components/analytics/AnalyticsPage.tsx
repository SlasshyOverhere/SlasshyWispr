import { useEffect, useMemo, useState } from 'react';
import type { AchievementDef, AchievementState, AnalyticsSessionDetail, UsageStats } from '../../types';
import './analytics.css';

const USAGE_KEY = "slasshy-wispr-usage-v1";
const SESSIONS_KEY = "slasshy-wispr-analytics-sessions-v1";
const ACHIEVEMENTS_KEY = "slasshy-wispr-achievements-state-v1";

type AnalyticsRange = '7d' | '30d' | 'all';

interface AnalyticsPageProps {
  usage: UsageStats;
  analyticsSessions: AnalyticsSessionDetail[];
  achievementStates: AchievementState[];
}

function parseJson<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

const ACHIEVEMENT_DEFS: AchievementDef[] = [
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

function groupByDate(sessions: AnalyticsSessionDetail[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sessions) {
    const key = new Date(s.date).toISOString().slice(0, 10);
    map.set(key, (map.get(key) || 0) + s.words);
  }
  return map;
}

function getDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
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
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = getDayKey(d);
    if (activeDays.has(key)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function formatWpm(wpm: number): string {
  return `${Math.round(wpm)}`;
}

function MetricCard({ label, value, sub, icon }: { label: string; value: string; sub: string; icon: string }) {
  return (
    <article className="analytics-metric-card">
      <div className="analytics-metric-header">
        <span className="analytics-metric-label">{label}</span>
        <span className="analytics-metric-icon">{icon}</span>
      </div>
      <div className="analytics-metric-value">{value}</div>
      <div className="analytics-metric-sub">{sub}</div>
    </article>
  );
}

function DailyChart({ data, range }: { data: Map<string, number>; range: AnalyticsRange }) {
  const days = useMemo(() => {
    const maxDays = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const result: Array<{ key: string; label: string; words: number }> = [];
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    for (let i = maxDays - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = getDayKey(d);
      result.push({ key, label: d.getDate().toString(), words: data.get(key) || 0 });
    }
    return result;
  }, [data, range]);

  const maxWords = Math.max(...days.map(d => d.words), 1);
  const barWidth = Math.max(4, Math.min(24, Math.floor(360 / days.length)));

  return (
    <div className="analytics-chart-section">
      <h3 className="analytics-section-title">Daily Dictation Volume</h3>
      <div className="analytics-chart-wrap">
        <svg viewBox={`0 0 ${days.length * (barWidth + 3) + 20} 160`} className="analytics-svg-chart" preserveAspectRatio="xMidYMid meet">
          {days.map((day, i) => {
            const x = i * (barWidth + 3) + 10;
            const h = (day.words / maxWords) * 120;
            return (
              <g key={day.key}>
                <rect x={x} y={140 - h} width={barWidth} height={Math.max(h, 1)} rx="2" className="analytics-bar" />
                {i % Math.max(1, Math.floor(days.length / 6)) === 0 && (
                  <text x={x + barWidth / 2} y="154" textAnchor="middle" className="analytics-bar-label">{day.label}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function ActivityHeatmap({ sessions, range }: { sessions: AnalyticsSessionDetail[]; range: AnalyticsRange }) {
  const weeks = useMemo(() => {
    const maxDays = range === '7d' ? 7 : range === '30d' ? 30 : 84;
    const activeDays = new Map<string, number>();
    for (const s of sessions) {
      const key = getDayKey(new Date(s.date));
      activeDays.set(key, (activeDays.get(key) || 0) + s.words);
    }
    const rows: Array<Array<{ key: string; count: number; label: string }>> = [[], [], [], [], [], [], []];
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const startDay = new Date(now);
    startDay.setDate(startDay.getDate() - maxDays);
    const dayOfWeek = startDay.getDay();
    startDay.setDate(startDay.getDate() - dayOfWeek);
    const cell = new Date(startDay);
    while (rows[6].length < Math.ceil((maxDays + dayOfWeek) / 7)) {
      for (let r = 0; r < 7; r++) {
        if (!rows[r]) rows[r] = [];
        const key = getDayKey(cell);
        const count = activeDays.get(key) || 0;
        const diff = Math.floor((now.getTime() - cell.getTime()) / (1000 * 60 * 60 * 24));
        if (diff > maxDays) {
          rows[r].push({ key, count: -1, label: '' });
        } else {
          rows[r].push({ key, count, label: cell.getDate().toString() });
        }
        cell.setDate(cell.getDate() + 1);
      }
    }
    return rows;
  }, [sessions, range]);

  const maxCount = Math.max(...weeks.flat().map(c => c.count), 1);

  function intensity(count: number): string {
    if (count < 0) return 'cell-outside';
    if (count === 0) return 'cell-empty';
    const ratio = count / maxCount;
    if (ratio > 0.66) return 'cell-high';
    if (ratio > 0.33) return 'cell-mid';
    return 'cell-low';
  }

  return (
    <div className="analytics-heatmap-section">
      <h3 className="analytics-section-title">Activity</h3>
      <div className="analytics-heatmap-grid">
        {weeks.map((row, ri) => (
          <div key={ri} className="analytics-heatmap-row">
            <span className="analytics-heatmap-day-label">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][ri]}</span>
            {row.map((cell) => (
              <span key={cell.key} className={`analytics-heatmap-cell ${intensity(cell.count)}`} title={`${cell.key}: ${cell.count} words`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayOfWeekChart({ sessions }: { sessions: AnalyticsSessionDetail[] }) {
  const buckets = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const s of sessions) {
      const day = new Date(s.date).getDay();
      counts[day] += s.words;
    }
    return counts;
  }, [sessions]);

  const maxVal = Math.max(...buckets, 1);
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="analytics-chart-section">
      <h3 className="analytics-section-title">Words by Day of Week</h3>
      <div className="analytics-chart-wrap">
        <svg viewBox="0 0 280 150" className="analytics-svg-chart" preserveAspectRatio="xMidYMid meet">
          {buckets.map((val, i) => {
            const x = i * 36 + 14;
            const h = (val / maxVal) * 100;
            return (
              <g key={labels[i]}>
                <rect x={x} y={125 - h} width={24} height={Math.max(h, 1)} rx="3" className="analytics-bar" />
                <text x={x + 12} y="140" textAnchor="middle" className="analytics-bar-label">{labels[i]}</text>
                <text x={x + 12} y={125 - h - 6} textAnchor="middle" className="analytics-bar-value">{val > 0 ? val.toLocaleString() : ''}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
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
    if (m === 'words') return usage.words;
    if (m === 'sessions') return usage.sessions;
    return usage.speakingSeconds;
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
      setLocalSessions(parseJson<AnalyticsSessionDetail[]>(SESSIONS_KEY, initialSessions));
      setLocalAchievements(parseJson<AchievementState[]>(ACHIEVEMENTS_KEY, initialAchievements));
    };
    window.addEventListener('slasshy:store-updated', handler);
    return () => window.removeEventListener('slasshy:store-updated', handler);
  }, [initialUsage, initialSessions, initialAchievements]);

  const filteredSessions = useMemo(() => {
    if (range === 'all') return localSessions;
    const cutoff = Date.now() - (range === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000;
    return localSessions.filter(s => s.date >= cutoff);
  }, [localSessions, range]);

  const dailyData = useMemo(() => groupByDate(filteredSessions), [filteredSessions]);

  const periodWords = useMemo(() => filteredSessions.reduce((a, s) => a + s.words, 0), [filteredSessions]);
  const periodSeconds = useMemo(() => filteredSessions.reduce((a, s) => a + s.speakingSeconds, 0), [filteredSessions]);
  const periodSessions = filteredSessions.length;
  const periodWpm = useMemo(() => {
    const valid = filteredSessions.filter(s => s.wpm > 0);
    return valid.length > 0 ? valid.reduce((a, s) => a + s.wpm, 0) / valid.length : 0;
  }, [filteredSessions]);

  const streak = useMemo(() => getStreak(localSessions), [localSessions]);

  return (
    <div className="analytics-page">
      <header className="analytics-header">
        <div>
          <h1 className="analytics-title">Analytics</h1>
          <p className="analytics-subtitle">Your dictation metrics, achievements, and activity at a glance</p>
        </div>
        <div className="analytics-range-picker">
          <button className={`analytics-range-btn ${range === '7d' ? 'is-active' : ''}`} onClick={() => setRange('7d')} type="button">7 days</button>
          <button className={`analytics-range-btn ${range === '30d' ? 'is-active' : ''}`} onClick={() => setRange('30d')} type="button">30 days</button>
          <button className={`analytics-range-btn ${range === 'all' ? 'is-active' : ''}`} onClick={() => setRange('all')} type="button">All time</button>
        </div>
      </header>

      {streak > 0 && (
        <div className="analytics-streak-banner">
          <span className="streak-fire">🔥</span>
          <span className="streak-count">{streak}</span>
          <span className="streak-label">day streak</span>
        </div>
      )}

      <div className="analytics-metric-grid">
        <MetricCard label="WORDS" value={periodWords.toLocaleString()} sub={`${localUsage.words.toLocaleString()} all time`} icon="W" />
        <MetricCard label="SPEAKING TIME" value={formatDuration(periodSeconds)} sub={`${formatDuration(localUsage.speakingSeconds)} all time`} icon="⏱" />
        <MetricCard label="SESSIONS" value={periodSessions.toString()} sub={`${localUsage.sessions} all time`} icon="S" />
        <MetricCard label="AVG PACE" value={`${formatWpm(periodWpm)} wpm`} sub={`${formatWpm(localUsage.avgWpm)} wpm overall`} icon="⚡" />
      </div>

      <div className="analytics-grid-2col">
        <DailyChart data={dailyData} range={range} />
        <DayOfWeekChart sessions={filteredSessions} />
      </div>

      <RecentActivity sessions={filteredSessions} />

      <ActivityHeatmap sessions={localSessions} range={range} />

      <AchievementsGrid usage={localUsage} achievementStates={localAchievements} />
    </div>
  );
}
