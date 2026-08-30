import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode, RefObject } from 'react';

/* Anchored popover menu shared by the Home entry card and the History
   row. Portals into document.body, positions itself below-right of the
   trigger, and closes on outside click / Escape. Repositions as the
   page scrolls; closes once the trigger scrolls out of view. The
   confirm-to-delete state lives in the caller — this component only
   renders children and wires up positioning + dismiss behaviour. */
export function AnchoredMenu<T extends HTMLElement>({
  open,
  anchorRef,
  onClose,
  label,
  className,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<T | null>;
  onClose: () => void;
  label: string;
  className: string;
  children?: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;

    const compute = () => {
      const anchor = anchorRef.current;
      if (!anchor) return false;
      const r = anchor.getBoundingClientRect();
      setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
      return true;
    };

    // Only show once we know we can anchor it.
    if (!compute()) {
      setPos(null);
      return;
    }

    const onDocClick = (e: MouseEvent) => {
      const tgt = e.target as Node | null;
      if (menuRef.current?.contains(tgt) || anchorRef.current?.contains(tgt)) {
        return;
      }
      onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPanelScroll = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) onClose();
      else compute();
    };

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    window.addEventListener('scroll', onPanelScroll, true);
    window.addEventListener('resize', onPanelScroll);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
      window.removeEventListener('scroll', onPanelScroll, true);
      window.removeEventListener('resize', onPanelScroll);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !pos) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={className}
      role="menu"
      aria-label={label}
      style={{ position: 'fixed', top: `${pos.top}px`, right: `${pos.right}px`, zIndex: 1000 }}
    >
      {children}
    </div>,
    document.body,
  );
}