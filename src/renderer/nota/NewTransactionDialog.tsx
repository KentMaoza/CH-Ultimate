import { useEffect, useState } from 'react';
import { useAccessibleModal } from './useAccessibleModal';

function todayWita() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function NewTransactionDialog({ open, onClose, onCreate, restoreFocusTo, busy = false }: { open: boolean; onClose: () => void; onCreate: (input: { customerName: string; customerPlace: string; transactionDate: string }) => void; restoreFocusTo: HTMLElement | null; busy?: boolean }) {
  const [customerName, setCustomerName] = useState('');
  const [customerPlace, setCustomerPlace] = useState('');
  const [transactionDate, setTransactionDate] = useState(todayWita);
  const modal = useAccessibleModal<HTMLFormElement>(open, onClose, restoreFocusTo);

  useEffect(() => {
    if (!open) return;
    setCustomerName('');
    setCustomerPlace('');
    setTransactionDate(todayWita());
  }, [open]);

  if (!open) return null;
  return <div className="chu-nota-workspace__dialog-backdrop" onMouseDown={modal.onBackdropMouseDown}><form ref={modal.dialogRef} className="chu-nota-workspace__dialog" role="dialog" aria-modal="true" aria-label="Transaksi Baru" onKeyDown={modal.onKeyDown} onSubmit={(event) => { event.preventDefault(); onCreate({ customerName, customerPlace, transactionDate }); }}><h2>Transaksi Baru</h2><label><span>Pelanggan</span><input data-modal-initial-focus disabled={busy} value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label><label><span>Tempat</span><input disabled={busy} value={customerPlace} onChange={(event) => setCustomerPlace(event.target.value)} /></label><label><span>Tanggal</span><input disabled={busy} type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} /></label><p>Pembayaran awal: Belum diklasifikasi.</p><div><button type="button" onClick={modal.close}>Batal</button><button disabled={busy} className="chu-nota-workspace__complete">Buat transaksi</button></div></form></div>;
}
