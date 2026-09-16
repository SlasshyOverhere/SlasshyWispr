import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDictationRecording } from '../../ipc/client';
import { removeHistoryEntry } from '../../store';
import type { HomeHistoryEntry } from '../../types';

/* Moved verbatim from App.tsx (Phase 3). Owns its own copy/play/delete
   menu plus recording playback via typed IPC. */

export function HistoryRow({ entry, rowIndex = 0 }: { entry: HomeHistoryEntry; rowIndex?: number }) {
  const [copied, setCopied] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contentRef = useRef<HTMLParagraphElement | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [needsClamp, setNeedsClamp] = useState(false);
  const d = new Date(entry.timestamp);
  const hh = d.getHours();
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = ((hh + 11) % 12) + 1;
  const isFresh = Date.now() - entry.timestamp < 30_000;
  const time = isFresh ? "just now" : `${h12}:${mm} ${ampm}`;
  const isHero = rowIndex === 0;
  const isAssistant = entry.tone === "assistant";
  const hasMetrics = Boolean(entry.wpm || entry.pipelineMs || entry.spokenSeconds);
  const hasRecording = Boolean(entry.recordingId);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) {
      return;
    }
    const onEnded = () => setPlaying(false);
    const onError = () => {
      setPlaying(false);
      setPlayError("Unable to play this recording.");
    };
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    return () => {
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
    };
  }, [audioSrc]);

  useEffect(() => {
    if (!menuOpen) return;
    const computePos = () => {
      const btn = moreBtnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setMenuPos({
        top: r.bottom + 6,
        right: window.innerWidth - r.right,
      });
    };
    computePos();
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      const btn = moreBtnRef.current;
      const inMenu = menuRef.current && target && menuRef.current.contains(target);
      const inBtn = btn && target && btn.contains(target);
      if (!inMenu && !inBtn) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    const onScroll = () => {
      // Reposition (or close) the menu as the page scrolls so it stays anchored.
      const btn = moreBtnRef.current;
      if (!btn) {
        setMenuOpen(false);
        return;
      }
      const r = btn.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) {
        setMenuOpen(false);
      } else {
        computePos();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menuOpen]);

  // Measure whether the transcription text overflows 3 lines.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 21;
    setNeedsClamp(el.scrollHeight > lineHeight * 3.5);
  }, [entry.content]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(entry.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleCopyWithTime = async () => {
    const stamp = new Date(entry.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    await navigator.clipboard.writeText(`[${stamp}] ${entry.content}`);
    setCopied(true);
    setMenuOpen(false);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDelete = () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      // Auto-dismiss the confirm state if the user walks away.
      window.setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    removeHistoryEntry(entry.timestamp);
    setMenuOpen(false);
    setConfirmDelete(false);
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
      let dataUrl: string;
      if (audioSrc) {
        dataUrl = audioSrc;
      } else {
        dataUrl = await getDictationRecording(entry.recordingId);
        setAudioSrc(dataUrl);
      }
      const el = audioRef.current;
      if (!el) {
        return;
      }
      if (playing) {
        el.pause();
        el.currentTime = 0;
        setPlaying(false);
        return;
      }
      // If audio needs to load, wait for it
      if (!el.src || el.src !== dataUrl || el.readyState < 2) {
        setAudioSrc(dataUrl);
        await new Promise<void>((resolve, reject) => {
          el.oncanplay = () => resolve();
          el.onerror = () => reject(new Error("Failed to load audio"));
        });
      }
      try {
        await el.play();
        setPlaying(true);
      } catch (playErr) {
        setPlaying(false);
        setPlayError(`Playback failed: ${(playErr as Error).message}`);
      }
    } catch (err) {
      setPlaying(false);
      setPlayError(`Unable to load recording: ${(err as Error).message}`);
    }
  };

  return (
    <div
      className={`conversation-entry ${isAssistant ? 'is-assistant' : 'is-user'} ${isHero ? 'is-hero' : 'is-archive'} ${isFresh ? 'is-fresh' : ''}`}
      data-recording-id={entry.recordingId ?? ""}
      style={{ "--row-index": rowIndex } as React.CSSProperties}
    >
      <span className="entry-time">
        {isFresh ? <span className="entry-fresh-dot" aria-hidden="true" /> : null}
        {time}
      </span>
      <div className="entry-content-wrap">
        <p
          ref={contentRef}
          className={`entry-content${needsClamp && !expanded ? ' is-clamped' : ''}`}
        >{entry.content}</p>
        {needsClamp ? (
          <button
            type="button"
            className="entry-expand-btn"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : null}
        {playError ? (
          <p className="entry-play-error">{playError}</p>
        ) : null}
      </div>
      {hasMetrics ? (
        !isHero ? (
          // Archive rows: collapsed ledger token. Numbers only,
          // separated by a thin middle dot. Meaning is obvious from
          // the hero row above; this is a glanceable summary.
          <div className="entry-metrics entry-metrics-archive" aria-label="dictation metrics">
            {entry.wpm ? <span className="metric" title="Words per minute">{entry.wpm}</span> : null}
            {entry.spokenSeconds ? <span className="metric" title="Time spoken">{entry.spokenSeconds.toFixed(0)}s</span> : null}
            {entry.pipelineMs ? <span className="metric" title="Time to process the transcription">{(entry.pipelineMs / 1000).toFixed(1)}s</span> : null}
          </div>
        ) : (
          <div className="entry-metrics entry-metrics-hero" aria-label="dictation metrics">
            {entry.wpm ? (
              <span className="metric" title="Words per minute">
                <span className="metric-num">{entry.wpm}</span>
                <span className="metric-unit">wpm</span>
              </span>
            ) : null}
            {entry.spokenSeconds ? (
              <span className="metric" title="Time spoken">
                <span className="metric-num">{entry.spokenSeconds.toFixed(1)}</span>
                <span className="metric-unit">s spoken</span>
              </span>
            ) : null}
            {entry.pipelineMs ? (
              <span className="metric" title="Time to process the transcription">
                <span className="metric-icon" aria-hidden="true">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
                  </svg>
                </span>
                <span className="metric-num">{(entry.pipelineMs / 1000).toFixed(1)}</span>
                <span className="metric-unit">s</span>
              </span>
            ) : null}
          </div>
        )
      ) : <span className="entry-metrics-spacer" aria-hidden="true" />}
      <div className="entry-actions">
        {hasRecording ? (
          <button
            type="button"
            className={`entry-icon-btn entry-icon-play ${playing ? 'is-playing' : ''}`}
            onClick={handlePlay}
            aria-label={playing ? "Stop recording" : "Play recording"}
            title={playing ? "Stop" : "Play recording"}
            data-recording-id={entry.recordingId}
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
        {copied ? (
          <span className="entry-icon-btn entry-icon-copied" title="Copied">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </span>
        ) : (
          <button
            type="button"
            className="entry-icon-btn"
            onClick={handleCopy}
            aria-label="Copy transcription"
            title="Copy"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        )}
        <button
          ref={moreBtnRef}
          type="button"
          className={`entry-icon-btn entry-icon-more ${menuOpen ? 'is-open' : ''}`}
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More"
          onClick={() => {
            setMenuOpen((v) => !v);
            setConfirmDelete(false);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6"></circle>
            <circle cx="12" cy="12" r="1.6"></circle>
            <circle cx="19" cy="12" r="1.6"></circle>
          </svg>
        </button>
        {menuOpen && menuPos
          ? createPortal(
              <div
                ref={menuRef}
                className="entry-menu entry-menu-portal"
                role="menu"
                aria-label="Entry actions"
                style={{ top: `${menuPos.top}px`, right: `${menuPos.right}px` }}
              >
                <button
                  type="button"
                  className="entry-menu-item"
                  role="menuitem"
                  onClick={handleCopyWithTime}
                >
                  <span className="entry-menu-item-main">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    Copy with timestamp
                  </span>
                  <span className="entry-menu-item-hint">[{time}]</span>
                </button>
                <div className="entry-menu-sep" role="separator" />
                <button
                  type="button"
                  className={`entry-menu-item entry-menu-item-danger ${confirmDelete ? 'is-confirming' : ''}`}
                  role="menuitem"
                  onClick={handleDelete}
                >
                  <span className="entry-menu-item-main">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"></path>
                      <path d="M10 11v6"></path>
                      <path d="M14 11v6"></path>
                      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path>
                    </svg>
                    {confirmDelete ? "Click again to confirm" : "Delete entry"}
                  </span>
                </button>
              </div>,
              document.body
            )
          : null}
        {hasRecording ? (
          <audio
            ref={audioRef}
            src={audioSrc ?? undefined}
            preload="auto"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setPlaying(false);
              setPlayError("Unable to play this recording.");
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
