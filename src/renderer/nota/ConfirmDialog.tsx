import type { ReactNode } from 'react';
import { useAccessibleModal } from './useAccessibleModal';

export function ConfirmDialog({ open, title, children, onCancel, onConfirm, restoreFocusTo, confirmLabel = 'Selesaikan', busy = false }: {
  open: boolean;
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  restoreFocusTo: HTMLElement | null;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const modal = useAccessibleModal<HTMLDivElement>(open, onCancel, restoreFocusTo, !busy);
  if (!open) return null;
  return <div className="chu-nota-workspace__dialog-backdrop" onMouseDown={modal.onBackdropMouseDown}>
    <div ref={modal.dialogRef} role="dialog" aria-modal="true" aria-labelledby="chu-nota-confirm-title" className="chu-nota-workspace__dialog" onKeyDown={modal.onKeyDown}>
      <h2 id="chu-nota-confirm-title">{title}</h2>
      <p>{children}</p>
      <div><button data-modal-initial-focus disabled={busy} onClick={modal.close}>Batal</button><button disabled={busy} className="chu-nota-workspace__complete" onClick={onConfirm}>{confirmLabel}</button></div>
    </div>
  </div>;
}
