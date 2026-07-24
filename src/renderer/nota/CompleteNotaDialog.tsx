import type { NotaCompletionDestination } from '../../domain/types';
import { useAccessibleModal } from './useAccessibleModal';

export type CompletionDialogPhase = 'choice' | 'saving' | 'success' | 'error';

const destinationLabel = (destination: NotaCompletionDestination) => destination === 'archive' ? 'Arsip' : 'Selesai';

export function CompleteNotaDialog({
  open,
  phase,
  destination,
  reason,
  restoreFocusTo,
  onChoose,
  onRetry,
  onClose,
  onOpenDestination,
}: {
  open: boolean;
  phase: CompletionDialogPhase;
  destination?: NotaCompletionDestination;
  reason?: string;
  restoreFocusTo: HTMLElement | null;
  onChoose: (destination: NotaCompletionDestination) => void;
  onRetry: () => void;
  onClose: () => void;
  onOpenDestination: (destination: NotaCompletionDestination) => void;
}) {
  const busy = phase === 'saving';
  const modal = useAccessibleModal<HTMLDivElement>(open, onClose, restoreFocusTo, !busy);
  if (!open) return null;
  const title = phase === 'success' ? 'Nota berhasil disimpan' : phase === 'error' ? 'Nota gagal disimpan' : 'Selesaikan nota?';
  const label = destination ? destinationLabel(destination) : '';

  return <div className="chu-nota-workspace__dialog-backdrop" onMouseDown={modal.onBackdropMouseDown}>
    <div ref={modal.dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="chu-nota-complete-title" className="chu-nota-workspace__dialog chu-nota-workspace__completion-dialog" onKeyDown={modal.onKeyDown}>
      <h2 id="chu-nota-complete-title">{title}</h2>
      {phase === 'choice' && <>
        <p>Pilih waktu pengiriman. Kedua pilihan langsung memperbarui stok dan omzet demo.</p>
        <div className="chu-nota-workspace__completion-options">
          <button data-modal-initial-focus aria-label="1. Barang dikirim sekarang" className="chu-nota-workspace__completion-option" onClick={() => onChoose('archive')}><strong>1. Barang dikirim sekarang</strong><span>Simpan ke Arsip</span></button>
          <button aria-label="2. Barang dikirim nanti" className="chu-nota-workspace__completion-option" onClick={() => onChoose('finished')}><strong>2. Barang dikirim nanti</strong><span>Simpan ke Selesai</span></button>
        </div>
      </>}
      {phase === 'saving' && <p role="status">Menyimpan nota ke {label}…</p>}
      {phase === 'success' && <p>Nota berhasil disimpan di {label}.</p>}
      {phase === 'error' && <><p>{reason || 'Nota tidak dapat disimpan.'}</p><small>Tidak ada perubahan yang disimpan. Anda dapat mencoba lagi.</small></>}
      <div className="chu-nota-workspace__completion-actions">
        <button data-modal-initial-focus={phase !== 'choice' || undefined} disabled={busy} onClick={modal.close}>{phase === 'success' ? 'Tutup' : 'Batal'}</button>
        {phase === 'error' && <button className="chu-nota-workspace__complete" onClick={onRetry}>Coba lagi</button>}
        {phase === 'success' && destination && <button className="chu-nota-workspace__complete" onClick={() => onOpenDestination(destination)}>Lihat {label}</button>}
      </div>
    </div>
  </div>;
}
