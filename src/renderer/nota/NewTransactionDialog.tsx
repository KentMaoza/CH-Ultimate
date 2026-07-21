import { useState } from 'react';

function todayWita() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Makassar', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function NewTransactionDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (input: { customerName: string; customerPlace: string; transactionDate: string }) => void }) {
  const [customerName, setCustomerName] = useState('');
  const [customerPlace, setCustomerPlace] = useState('');
  const [transactionDate, setTransactionDate] = useState(todayWita);
  if (!open) return null;
  return <div className="chu-nota-workspace__dialog-backdrop"><form className="chu-nota-workspace__dialog" role="dialog" aria-modal="true" aria-label="Transaksi Baru" onSubmit={(event) => { event.preventDefault(); onCreate({ customerName, customerPlace, transactionDate }); }}><h2>Transaksi Baru</h2><label><span>Pelanggan</span><input autoFocus value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label><label><span>Tempat</span><input value={customerPlace} onChange={(event) => setCustomerPlace(event.target.value)} /></label><label><span>Tanggal</span><input type="date" value={transactionDate} onChange={(event) => setTransactionDate(event.target.value)} /></label><p>Pembayaran awal: Belum diklasifikasi.</p><div><button type="button" onClick={onClose}>Batal</button><button className="chu-nota-workspace__complete">Buat transaksi</button></div></form></div>;
}
