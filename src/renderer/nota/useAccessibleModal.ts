import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useAccessibleModal<T extends HTMLElement = HTMLElement>(open: boolean, onClose: () => void, restoreFocusTo: HTMLElement | null, canClose = true) {
  const dialogRef = useRef<T | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = restoreFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialogRef.current?.querySelector<HTMLElement>('[data-modal-initial-focus]')?.focus();
  }, [open, restoreFocusTo]);

  useEffect(() => {
    const active = document.activeElement;
    if (open && !canClose && active instanceof HTMLElement && dialogRef.current?.contains(active) && active.matches(':disabled')) dialogRef.current.focus();
  }, [open, canClose]);

  const close = () => {
    if (!canClose) return;
    restoreRef.current?.focus();
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusable) ?? []);
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onBackdropMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) close();
  };

  return { dialogRef, close, onKeyDown, onBackdropMouseDown };
}
