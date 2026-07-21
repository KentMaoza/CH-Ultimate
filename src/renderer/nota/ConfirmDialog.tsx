import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ConfirmDialog({ open, title, children, onCancel, onConfirm, restoreFocusTo, confirmLabel = 'Selesaikan' }: {
  open: boolean;
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  restoreFocusTo: HTMLElement | null;
  confirmLabel?: string;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opened = dialogRef.current;
    const restore = restoreFocusTo;
    const initial = dialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]');
    initial?.focus();
    return () => {
      if (document.activeElement && opened?.contains(document.activeElement)) restore?.focus();
    };
  }, [open, restoreFocusTo]);

  if (!open) return null;
  const close = () => { restoreFocusTo?.focus(); onCancel(); };
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusable) ?? []);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const backdrop = (event: MouseEvent<HTMLDivElement>) => { if (event.target === event.currentTarget) close(); };

  return <div className="chu-nota-workspace__dialog-backdrop" onMouseDown={backdrop}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="chu-nota-confirm-title" className="chu-nota-workspace__dialog" onKeyDown={keyDown}>
      <h2 id="chu-nota-confirm-title">{title}</h2>
      <p>{children}</p>
      <div><button data-dialog-initial-focus onClick={close}>Batal</button><button className="chu-nota-workspace__complete" onClick={onConfirm}>{confirmLabel}</button></div>
    </div>
  </div>;
}
