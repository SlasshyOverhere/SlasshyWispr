import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { removeHistoryEntry } from '../../store';
import type { HomeHistoryEntry } from '../../types';

/* Compute the popover anchor coordinates from the more button's rect
   so the menu opens to the bottom-right of the trigger. Pure function
   — returns a style object safe to spread inline. */
export function menuAnchorStyle(anchor: HTMLElement | null): React.CSSProperties {
  if (!anchor) return { visibility: "hidden" };
  const r = anchor.getBoundingClientRect();
  return {
    position: "fixed",
    top: r.bottom + 6,
    right: window.innerWidth - r.right,
    zIndex: 1000,
  };
}

/* Rich list row: time + body + metadata line + hover-revealed copy /
   more actions. Word count derived from content; recording play lives
   on the History page (HistoryRow). The more (···) popover confirms
   then removes via removeHistoryEntry(timestamp). */
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
  const wordCount = entry.content.trim() ? entry.content.trim().split(/\s+/).length : 0;
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const icon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );

  /* Close the popover on outside click / Esc. Anchor math mirrors the
     HistoryRow pattern but portals into document.body so the stack
     context doesn't clip the menu. */
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const tgt = e.target as Node | null;
      if (
        tgt &&
        !menuRef.current?.contains(tgt) &&
        !moreBtnRef.current?.contains(tgt)
      ) {
        setMenuOpen(false);
        setConfirmingDelete(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setConfirmingDelete(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [menuOpen]);

  const handleDelete = () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      window.setTimeout(() => setConfirmingDelete(false), 3000);
      return;
    }
    removeHistoryEntry(entry.timestamp);
    setMenuOpen(false);
    setConfirmingDelete(false);
  };

  return (
    <article
      className={`home-entry ${isFresh ? "is-fresh" : ""}`}
      tabIndex={0}
    >
      <span className="home-entry-time">{time}</span>
      <span className="home-entry-main">
        <span className="home-entry-body" title={entry.content}>{entry.content}</span>
        <span className="home-entry-meta">{wordCount} {wordCount === 1 ? "word" : "words"}</span>
      </span>
      <span className="home-entry-actions">
        {copied ? (
          <span className={`home-entry-action is-copied`} title="Copied" aria-label="Copied">
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
            {icon}
          </button>
        )}
        <button
          ref={moreBtnRef}
          type="button"
          className={`home-entry-action ${menuOpen ? "is-open" : ""}`}
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More"
          onClick={() => {
            setMenuOpen((v) => !v);
            setConfirmingDelete(false);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
        {menuOpen
          ? createPortal(
              <div
                ref={menuRef}
                className="home-entry-menu"
                role="menu"
                aria-label="Entry actions"
                style={menuAnchorStyle(moreBtnRef.current)}
              >
                <button
                  type="button"
                  className={`home-entry-menu-item home-entry-menu-item-danger ${
                    confirmingDelete ? "is-confirming" : ""
                  }`}
                  role="menuitem"
                  onClick={handleDelete}
                >
                  <span className="home-entry-menu-item-main">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                    </svg>
                    {confirmingDelete ? "Click again to confirm" : "Delete entry"}
                  </span>
                </button>
              </div>,
              document.body
            )
          : null}
      </span>
    </article>
  );
}

/* Build the date-grouped list of card entries for Home. Splits by
   calendar day and emits a date band per group; entries are inline
   single-line cards with copy + more-row actions. */
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
