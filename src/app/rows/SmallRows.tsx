import { NOTES_STORAGE_KEY } from '../../constants';
import type { DictionaryTerm, SnippetEntry, QuickNoteEntry } from '../../types';

/* Render-only rows. Add/remove behavior is owned by main.tsx via
   element ids; NoteRow owns only its own remove + store event. */

export function DictionaryRow({ term }: { term: DictionaryTerm }) {
  return (
    <div className="dictionary-item-row" data-id={term.id}>
      <div className="dict-term spoken">
        <span className="term-label">Spoken</span>
        <code className="term-value">{term.source}</code>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dict-connector" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>
      <div className="dict-term correct">
        <span className="term-label">Correct</span>
        <span className="term-value">{term.target}</span>
      </div>
      <button className="dictionary-remove-btn" type="button" data-action="remove-term" aria-label="Remove term">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  );
}

export function SnippetRow({ snippet }: { snippet: SnippetEntry }) {
  return (
    <article className="snippet-row" data-id={snippet.id}>
      <div className="managed-row-main">
        <code className="snippet-trigger">{snippet.trigger}</code>
      </div>
      <p className="snippet-expansion">{snippet.expansion}</p>
      <button className="delete-btn" type="button" data-action="remove-snippet" aria-label="Remove snippet">
        Remove
      </button>
    </article>
  );
}

export function NoteRow({ note }: { note: QuickNoteEntry }) {
  const time = new Date(note.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const handleRemove = (): void => {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return;
    try {
      const notes = JSON.parse(raw) as QuickNoteEntry[];
      const filtered = notes.filter(n => n.id !== note.id);
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(filtered));
      window.dispatchEvent(new CustomEvent('slasshy:store-updated'));
    } catch { /* ignore */ }
  };

  return (
    <div className="conversation-entry" data-id={note.id}>
      <span className="entry-time">{time}</span>
      <p className="entry-content">{note.text}</p>
      <div className="entry-actions">
        <button type="button" className="entry-action" onClick={handleRemove}>Remove</button>
      </div>
    </div>
  );
}
