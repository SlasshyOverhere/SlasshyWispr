import { useRef, useState } from 'react';
import { getDictationRecording } from '../../ipc/client';
import { removeHistoryEntry } from '../../store';
import type { HomeHistoryEntry } from '../../types';

/* Dense activity row: transcription left, timestamp + hover actions
   right. Copy always available; Play only when a recordingId exists;
   Delete is two-step (first click arms, second removes via
   removeHistoryEntry(timestamp)). Playback uses a detached Audio
   object so the row stays light — no <audio> element in the DOM. */
export function HomeEntryCard({
  entry,
  time,
  isFresh,
  onCopy,
}: {
  entry: HomeHistoryEntry;
  time: string;
  isFresh: boolean;
  onCopy: (setCopied: (v: boolean) => void) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hasRecording = Boolean(entry.recordingId);

  const handleDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    removeHistoryEntry(entry.timestamp);
  };

  const handlePlay = async () => {
    if (!entry.recordingId) {
      return;
    }
    setPlayError(null);
    const isTauri =
      typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
      "undefined";
    if (!isTauri) {
      setPlayError("Playback is only available in the desktop app.");
      return;
    }
    try {
      const el = audioRef.current ?? new Audio();
      audioRef.current = el;
      if (playing) {
        el.pause();
        el.currentTime = 0;
        setPlaying(false);
        return;
      }
      const dataUrl = await getDictationRecording(entry.recordingId);
      el.src = dataUrl;
      el.onended = () => setPlaying(false);
      await el.play();
      setPlaying(true);
    } catch (err) {
      setPlaying(false);
      setPlayError(`Unable to play: ${(err as Error).message}`);
    }
  };

  return (
    <article
      className={`home-entry ${isFresh ? "is-fresh" : ""}`}
      tabIndex={0}
    >
      <p className="home-entry-body" title={entry.content}>{entry.content}</p>
      <div className="home-entry-side">
        <span className="home-entry-time">{time}</span>
        <span className="home-entry-actions">
          {copied ? (
            <span className="home-entry-action is-copied" title="Copied" aria-label="Copied">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          ) : (
            <button
              type="button"
              className="home-entry-action"
              onClick={() => onCopy(setCopied)}
              aria-label={`Copy: ${entry.content.slice(0, 48)}`}
              title="Copy"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
          )}
          {hasRecording ? (
            <button
              type="button"
              className={`home-entry-action ${playing ? "is-playing" : ""}`}
              onClick={() => void handlePlay()}
              aria-label={playing ? "Stop recording" : "Play recording"}
              title={playing ? "Stop" : "Play recording"}
            >
              {playing ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="5" width="4" height="14" rx="1"></rect>
                  <rect x="14" y="5" width="4" height="14" rx="1"></rect>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <polygon points="8 5 19 12 8 19 8 5"></polygon>
                </svg>
              )}
            </button>
          ) : null}
          <button
            type="button"
            className={`home-entry-action home-entry-delete ${confirmingDelete ? "is-confirming" : ""}`}
            aria-label={confirmingDelete ? "Click again to confirm delete" : "Delete entry"}
            title={confirmingDelete ? "Click again to confirm" : "Delete"}
            onClick={handleDelete}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </span>
      </div>
      {playError ? <p className="entry-play-error home-entry-error">{playError}</p> : null}
    </article>
  );
}

/* Build the date-grouped list of entries for Home. Splits by
   calendar day and emits a date band per group; entries are dense
   activity rows with copy + play + delete actions. */
export function buildHomeList(
  history: HomeHistoryEntry[],
  onCopy: (entry: HomeHistoryEntry, setter: (v: boolean) => void) => void
): React.ReactNode[] {
  const visible = history.slice(0, 30);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const out: React.ReactNode[] = [];
  let lastDayKey = "";
  visible.forEach((entry, i) => {
    const d = new Date(entry.timestamp);
    const isToday = entry.timestamp >= todayStart;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key !== lastDayKey) {
      lastDayKey = key;
      out.push(
        <li
          key={`date-${key}-${i}`}
          className="home-date-band"
          aria-hidden="true"
        >
          <span>
            {isToday
              ? "TODAY"
              : d
                  .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
                  .toUpperCase()}
          </span>
        </li>
      );
    }
    const hh = d.getHours();
    const mm = d.getMinutes().toString().padStart(2, "0");
    const ampm = hh >= 12 ? "PM" : "AM";
    const h12 = ((hh + 11) % 12) + 1;
    const isFresh = Date.now() - entry.timestamp < 30_000;
    out.push(
      <li key={`row-${entry.timestamp}-${i}`}>
        <HomeEntryCard
          entry={entry}
          time={`${h12}:${mm} ${ampm}`}
          isFresh={isFresh}
          onCopy={(setCopied) => onCopy(entry, setCopied)}
        />
      </li>
    );
  });
  return out;
}
