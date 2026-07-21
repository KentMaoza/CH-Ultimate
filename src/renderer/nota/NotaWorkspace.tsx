import { useRef, useState } from 'react';
import { lineTotal } from '../../domain/nota';
import type { PaymentKind } from '../../domain/types';
import { formatRupiah } from '../format';
import { useOperations } from '../operations-context';
import { ConfirmDialog } from './ConfirmDialog';
import { NotaGrid, type NotaGridHandle } from './NotaGrid';
import './nota-workspace.css';

function paymentLabel(payment: PaymentKind) { return { unclassified: 'Belum diklasifikasi', cash: 'Kas', transfer: 'Transfer', credit: 'Piutang' }[payment]; }

export function NotaWorkspace({ onBack }: { onBack: () => void }) {
  const { state, gateway } = useOperations();
  const [selectedId] = useState(state.notaTransactions[0]?.id ?? '');
  const [zoom, setZoom] = useState(100);
  const [message, setMessage] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const completeTrigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<NotaGridHandle>(null);
  const transaction = state.notaTransactions.find((item) => item.id === selectedId) ?? state.notaTransactions[0];
  const page = transaction?.pages.find((item) => item.status === 'active');
  if (!transaction || !page) return <main className="chu-nota-workspace"><div className="chu-nota-workspace__empty"><p>Belum ada nota aktif pada sesi ini.</p><button onClick={onBack}>Kembali ke CH Ultimate</button></div></main>;
  const editable = transaction.status === 'draft' || transaction.status === 'reopened';
  const total = transaction.pages.filter((item) => item.status === 'active').flatMap((item) => item.lines).reduce((sum, line) => sum + lineTotal(line), 0);
  const requestComplete = () => {
    if (!grid.current?.validateAndFocus()) { setMessage('Perbaiki nilai angka: jumlah harus bilangan bulat positif dan harga harus bilangan bulat nol atau lebih.'); return; }
    setConfirmOpen(true);
  };
  const complete = async () => { try { await gateway.completeNotaTransaction(transaction.id); setConfirmOpen(false); setMessage('Nota selesai dan stok demo diperbarui.'); } catch (error) { setConfirmOpen(false); setMessage(error instanceof Error ? error.message : 'Nota tidak dapat diselesaikan.'); } };
  return <main className="chu-nota-workspace" data-testid="chu-nota-workspace" style={{ zoom: zoom / 100 }}>
    <header className="chu-nota-workspace__toolbar"><button className="chu-nota-workspace__back" onClick={onBack}>Kembali ke CH Ultimate</button><strong className="chu-nota-workspace__wordmark">CHU</strong><span className="chu-nota-workspace__section">Nota Dikerjakan</span><button disabled title="Daftar nota tersedia pada wave berikutnya">Daftar Nota</button><input aria-label="Cari nota" disabled placeholder="Cari nota (segera hadir)" /><div className="chu-nota-workspace__zoom" aria-label="Zoom sesi"><button aria-label="Perkecil zoom" disabled={zoom <= 90} onClick={() => setZoom((value) => value - 10)}>−</button><span>{zoom}%</span><button aria-label="Perbesar zoom" disabled={zoom >= 110} onClick={() => setZoom((value) => value + 10)}>+</button></div><span className="chu-nota-workspace__demo">DEMO DATA · SESSION ONLY</span><button className="chu-nota-workspace__new" disabled title="Pembuatan transaksi baru tersedia pada wave berikutnya">Transaksi Baru</button></header>
    <section className="chu-nota-workspace__meta" aria-label="Metadata nota"><div className="chu-nota-workspace__number"><span>NOTA DIBUAT</span><strong>{page.suffix}</strong><b>{transaction.baseNumber}{page.suffix}</b></div><label><span>Pelanggan</span><input disabled={!editable} value={transaction.customerName} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { customerName: event.target.value })} /></label><label><span>Tempat</span><input disabled={!editable} value={transaction.customerPlace} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { customerPlace: event.target.value })} /></label><label><span>Tanggal</span><input disabled={!editable} type="date" value={transaction.transactionDate} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { transactionDate: event.target.value })} /></label><label><span>Pembayaran</span><select disabled={!editable} value={transaction.payment} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { payment: event.target.value as PaymentKind })}><option value="unclassified">Belum diklasifikasi</option><option value="cash">Kas</option><option value="transfer">Transfer</option><option value="credit">Piutang</option></select></label><div className="chu-nota-workspace__meta-total"><span>TOTAL SEMUA HALAMAN AKTIF</span><strong data-testid="nota-transaction-total">{formatRupiah(total)}</strong><small>{paymentLabel(transaction.payment)}</small></div></section>
    {message && <p className="chu-nota-workspace__notice" role="status">{message}</p>}
    <NotaGrid ref={grid} lines={page.lines} suffix={page.suffix} skus={state.skus} editable={editable} onUpdate={(line, patch) => void gateway.updateNotaLine(transaction.id, page.id, line.id, patch)} onDelete={(line) => void gateway.deleteNotaLine(transaction.id, page.id, line.id)} />
    <footer className="chu-nota-workspace__footer"><div><span>TOTAL TRANSAKSI</span><strong>{formatRupiah(total)}</strong></div><label><span>Ruang cetak</span><select disabled><option>Semua halaman aktif (segera hadir)</option></select></label><p>Printing produksi belum tersedia pada demo sesi ini.</p><button disabled aria-label="Print Nota">Print Nota</button><div className="chu-nota-workspace__lifecycle">{transaction.status === 'completed' && <button onClick={() => void gateway.reopenNotaTransaction(transaction.id)}>Buka kembali</button>}{transaction.status === 'cancelled' && <button onClick={() => void gateway.restoreNotaTransaction(transaction.id)}>Pulihkan nota</button>}{editable && <button ref={completeTrigger} className="chu-nota-workspace__complete" aria-label="Selesaikan nota" onClick={requestComplete}>Selesaikan nota</button>}</div></footer>
    <ConfirmDialog open={confirmOpen} title="Selesaikan nota?" onCancel={() => setConfirmOpen(false)} onConfirm={() => void complete()} restoreFocusTo={completeTrigger.current}>Stok demo akan diperbarui berdasarkan baris SKU yang terlacak.</ConfirmDialog>
  </main>;
}
