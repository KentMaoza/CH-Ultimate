import { useState } from 'react';
import { lineTotal } from '../../domain/nota';
import type { NotaLine, PaymentKind, Unit } from '../../domain/types';
import { formatRupiah } from '../format';
import { useOperations } from '../operations-context';
import './nota-workspace.css';

const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

function formatGridNumber(value: number) {
  return numberFormat.format(value);
}

function paymentLabel(payment: PaymentKind) {
  return { unclassified: 'Belum diklasifikasi', cash: 'Kas', transfer: 'Transfer', credit: 'Piutang' }[payment];
}

export function NotaWorkspace({ onBack }: { onBack: () => void }) {
  const { state, gateway } = useOperations();
  const [selectedId] = useState(state.notaTransactions[0]?.id ?? '');
  const [zoom, setZoom] = useState(100);
  const [message, setMessage] = useState('');
  const transaction = state.notaTransactions.find((item) => item.id === selectedId) ?? state.notaTransactions[0];
  const page = transaction?.pages.find((item) => item.status === 'active');

  if (!transaction || !page) {
    return <main className="chu-nota-workspace"><div className="chu-nota-workspace__empty"><p>Belum ada nota aktif pada sesi ini.</p><button onClick={onBack}>Kembali ke CH Ultimate</button></div></main>;
  }

  const selectedPage = page;
  const editable = transaction.status === 'draft' || transaction.status === 'reopened';
  const activePages = transaction.pages.filter((item) => item.status === 'active');
  const total = activePages.flatMap((item) => item.lines).reduce((sum, line) => sum + lineTotal(line), 0);
  const fullNumber = `${transaction.baseNumber}${selectedPage.suffix}`;

  async function updateLine(line: NotaLine, patch: Partial<NotaLine>) {
    await gateway.updateNotaLine(transaction.id, selectedPage.id, line.id, patch);
  }

  async function complete() {
    try {
      await gateway.completeNotaTransaction(transaction.id);
      setMessage('Nota selesai dan stok demo diperbarui.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Nota tidak dapat diselesaikan.');
    }
  }

  return (
    <main className="chu-nota-workspace" data-testid="chu-nota-workspace" style={{ zoom: zoom / 100 }}>
      <header className="chu-nota-workspace__toolbar">
        <button className="chu-nota-workspace__back" onClick={onBack}>Kembali ke CH Ultimate</button>
        <strong className="chu-nota-workspace__wordmark">CHU</strong>
        <span className="chu-nota-workspace__section">Nota Dikerjakan</span>
        <button disabled title="Daftar nota tersedia pada wave berikutnya">Daftar Nota</button>
        <input aria-label="Cari nota" disabled placeholder="Cari nota (segera hadir)" />
        <div className="chu-nota-workspace__zoom" aria-label="Zoom sesi">
          <button aria-label="Perkecil zoom" disabled={zoom <= 90} onClick={() => setZoom((value) => value - 10)}>−</button>
          <span>{zoom}%</span>
          <button aria-label="Perbesar zoom" disabled={zoom >= 110} onClick={() => setZoom((value) => value + 10)}>+</button>
        </div>
        <span className="chu-nota-workspace__demo">DEMO DATA · SESSION ONLY</span>
        <button className="chu-nota-workspace__new" disabled title="Pembuatan transaksi baru tersedia pada wave berikutnya">Transaksi Baru</button>
      </header>

      <section className="chu-nota-workspace__meta" aria-label="Metadata nota">
        <div className="chu-nota-workspace__number"><span>NOTA DIBUAT</span><strong>{selectedPage.suffix}</strong><b>{fullNumber}</b></div>
        <label><span>Pelanggan</span><input disabled={!editable} value={transaction.customerName} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { customerName: event.target.value })} /></label>
        <label><span>Tempat</span><input disabled={!editable} value={transaction.customerPlace} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { customerPlace: event.target.value })} /></label>
        <label><span>Tanggal</span><input disabled={!editable} type="date" value={transaction.transactionDate} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { transactionDate: event.target.value })} /></label>
        <label><span>Pembayaran</span><select disabled={!editable} value={transaction.payment} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { payment: event.target.value as PaymentKind })}><option value="unclassified">Belum diklasifikasi</option><option value="cash">Kas</option><option value="transfer">Transfer</option><option value="credit">Piutang</option></select></label>
        <div className="chu-nota-workspace__meta-total"><span>TOTAL SEMUA HALAMAN AKTIF</span><strong data-testid="nota-transaction-total">{formatRupiah(total)}</strong><small>{paymentLabel(transaction.payment)}</small></div>
      </section>

      {message && <p className="chu-nota-workspace__notice" role="status">{message}</p>}
      <section className="chu-nota-workspace__grid-frame" aria-label="Grid nota">
        <table>
          <thead><tr><th>NO</th><th>NAMA BARANG</th><th>JENIS</th><th>JUMLAH</th><th>LSN</th><th>PCS</th><th>HARGA LSN</th><th>HARGA PCS</th><th>TOTAL</th><th>AKSI</th></tr></thead>
          <tbody data-testid="nota-grid-body">
            {selectedPage.lines.slice(0, 15).map((line, index) => <tr key={line.id}>
              <td>{index + 1}{selectedPage.suffix}</td>
              <td><input aria-label={`Nama barang baris ${index + 1}`} disabled={!editable} value={line.description} onChange={(event) => void updateLine(line, { description: event.target.value, skuId: undefined })} /></td>
              <td><input aria-label={`Jenis baris ${index + 1}`} disabled={!editable} value={line.kind} onChange={(event) => void updateLine(line, { kind: event.target.value })} /></td>
              <td><input aria-label={`Jumlah baris ${index + 1}`} disabled={!editable} type="number" min="0" step="1" value={line.quantity || ''} onChange={(event) => void updateLine(line, { quantity: Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></td>
              <td><input aria-label={`LSN baris ${index + 1}`} checked={line.unit === 'lsn'} disabled={!editable} name={`unit-${line.id}`} type="radio" onChange={() => void updateLine(line, { unit: 'lsn' as Unit })} /></td>
              <td><input aria-label={`PCS baris ${index + 1}`} checked={line.unit === 'pcs'} disabled={!editable} name={`unit-${line.id}`} type="radio" onChange={() => void updateLine(line, { unit: 'pcs' as Unit })} /></td>
              <td><input aria-label={`Harga LSN baris ${index + 1}`} disabled={!editable} type="number" min="0" step="1" value={line.lsnPrice || ''} onChange={(event) => void updateLine(line, { lsnPrice: Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></td>
              <td><input aria-label={`Harga PCS baris ${index + 1}`} disabled={!editable} type="number" min="0" step="1" value={line.pcsPrice || ''} onChange={(event) => void updateLine(line, { pcsPrice: Math.max(0, Math.round(Number(event.target.value) || 0)) })} /></td>
              <td>{formatGridNumber(lineTotal(line))}</td>
              <td><button disabled title="Penghapusan baris tersedia pada wave berikutnya">Hapus</button></td>
            </tr>)}
          </tbody>
        </table>
      </section>

      <footer className="chu-nota-workspace__footer">
        <div><span>TOTAL TRANSAKSI</span><strong>{formatRupiah(total)}</strong></div>
        <label><span>Ruang cetak</span><select disabled><option>Semua halaman aktif (segera hadir)</option></select></label>
        <p>Printing produksi belum tersedia pada demo sesi ini.</p>
        <button disabled aria-label="Print Nota">Print Nota</button>
        <div className="chu-nota-workspace__lifecycle">
          {transaction.status === 'completed' && <button onClick={() => void gateway.reopenNotaTransaction(transaction.id)}>Buka kembali</button>}
          {transaction.status === 'cancelled' && <button onClick={() => void gateway.restoreNotaTransaction(transaction.id)}>Pulihkan nota</button>}
          {editable && <button className="chu-nota-workspace__complete" aria-label="Selesaikan nota" onClick={() => void complete()}>Selesaikan nota</button>}
        </div>
      </footer>
    </main>
  );
}
