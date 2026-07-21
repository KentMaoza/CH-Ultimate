import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';

const focusable = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useAccessibleModal<T extends HTMLElement = HTMLElement>(open: boolean, onClose: () => void, restoreFocusTo: HTMLElement | null) {
  const dialogRef = useRef<T | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = restoreFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialogRef.current?.querySelector<HTMLElement>('[data-modal-initial-focus]')?.focus();
  }, [open, restoreFocusTo]);

  const close = () => {
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
    if (!first || !last) return;
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
