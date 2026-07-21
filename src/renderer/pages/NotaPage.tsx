import { useState } from 'react';
import { lineTotal, selectedPrice } from '../../domain/nota';
import type { NotaLine, PaymentKind, Unit } from '../../domain/types';
import { formatRupiah } from '../format';
import { useOperations } from '../operations-context';

export function NotaPage() {
  const { state, gateway } = useOperations();
  const [selectedId, setSelectedId] = useState(state.notaTransactions[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const transaction = state.notaTransactions.find((item) => item.id === selectedId) ?? state.notaTransactions[0];
  const page = transaction?.pages.find((item) => item.status === 'active');
  if (!transaction || !page) return <div className="feature-page empty-state"><p>Belum ada halaman nota aktif pada sesi ini.</p><button className="button primary" onClick={() => void gateway.createNotaTransaction().then((created) => setSelectedId(created.id))}>Buat transaksi demo</button></div>;
  const selectedPage = page;
  const editable = transaction.status === 'draft' || transaction.status === 'reopened';

  async function updateLine(line: NotaLine, patch: Partial<NotaLine>) { await gateway.updateNotaLine(transaction.id, selectedPage.id, line.id, patch); }
  async function chooseSku(line: NotaLine, skuId: string) {
    const sku = state.skus.find((item) => item.id === skuId);
    await updateLine(line, sku ? {
      skuId: sku.id, description: sku.name, pcsPrice: sku.referencePrice, lsnPrice: sku.referencePrice * 12,
    } : { skuId: undefined, description: '', kind: '', pcsPrice: 0, lsnPrice: 0 });
  }
  async function chooseUnit(line: NotaLine, unit: Unit) { await updateLine(line, { unit }); }
  async function complete() {
    try { await gateway.completeNotaTransaction(transaction.id); setMessage('Transaksi selesai dan stok demo diperbarui.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Transaksi gagal diselesaikan.'); }
  }
  const total = selectedPage.lines.reduce((sum, line) => sum + lineTotal(line), 0);
  return (
    <div className="feature-page nota-page">
      <div className="nota-meta">
        <div><span className="eyebrow">NOMOR NOTA</span><strong>{transaction.baseNumber}{selectedPage.suffix}</strong><small>Nomor sesi demo</small></div>
        <label><span>Pelanggan</span><input disabled={!editable} value={transaction.customerName} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { customerName: event.target.value })} placeholder="Nama pelanggan" /></label>
        <label><span>Tempat</span><input disabled={!editable} value={transaction.customerPlace} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { customerPlace: event.target.value })} placeholder="Tempat pelanggan" /></label>
        <label><span>Tanggal nota</span><input disabled={!editable} type="date" value={transaction.transactionDate} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { transactionDate: event.target.value })} /></label>
        <label><span>Pembayaran</span><select disabled={!editable} value={transaction.payment} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { payment: event.target.value as PaymentKind })}><option value="unclassified">Belum diklasifikasi</option><option value="cash">Kas</option><option value="transfer">Transfer</option><option value="credit">Piutang</option></select></label>
        <span className={`status-stamp ${transaction.status}`}>{transaction.status.toUpperCase()}</span>
      </div>
      {message && <div className="notice" role="status">{message}</div>}
      <div className="table-frame nota-grid"><table><thead><tr><th>KODE</th><th>BARANG</th><th>JUMLAH</th><th>SATUAN</th><th>HARGA</th><th>TOTAL</th></tr></thead><tbody>
        {selectedPage.lines.map((line, index) => <tr key={line.id}><td>{index + 1}{selectedPage.suffix}</td><td><select disabled={!editable} aria-label={`Barang baris ${index + 1}`} value={line.skuId ?? ''} onChange={(event) => void chooseSku(line, event.target.value)}><option value="">Ad-hoc / kosong</option>{state.skus.filter((sku) => !sku.archived).map((sku) => <option key={sku.id} value={sku.id}>{sku.skuNumber} · {sku.name}</option>)}</select>{!line.skuId && <input disabled={!editable} aria-label={`Nama ad-hoc baris ${index + 1}`} value={line.description} onChange={(event) => void updateLine(line, { description: event.target.value })} placeholder="Nama barang bebas" />}</td><td><input disabled={!editable} aria-label={`Jumlah baris ${index + 1}`} type="number" min="0" step="1" value={line.quantity || ''} onChange={(event) => void updateLine(line, { quantity: Number(event.target.value) })} /></td><td><select disabled={!editable} aria-label={`Satuan baris ${index + 1}`} value={line.unit} onChange={(event) => void chooseUnit(line, event.target.value as Unit)}><option value="pcs">pcs</option><option value="lsn">lsn</option></select></td><td><input disabled={!editable} aria-label={`Harga baris ${index + 1}`} type="number" min="0" value={selectedPrice(line) || ''} onChange={(event) => void updateLine(line, line.unit === 'pcs' ? { pcsPrice: Number(event.target.value) } : { lsnPrice: Number(event.target.value) })} /></td><td>{formatRupiah(lineTotal(line))}</td></tr>)}
      </tbody></table></div>
      <div className="nota-footer"><div><span>TOTAL NOTA</span><strong>{formatRupiah(total)}</strong></div><div className="toolbar-actions">{transaction.status === 'completed' && <><button className="button secondary" onClick={() => void gateway.reopenNotaTransaction(transaction.id)}>Edit kembali</button><button className="button secondary" onClick={() => void gateway.cancelNotaTransaction(transaction.id)}>Batalkan transaksi</button></>}{transaction.status === 'cancelled' && <button className="button secondary" onClick={() => void gateway.restoreNotaTransaction(transaction.id)}>Pulihkan transaksi</button>}{editable && <button className="button primary" aria-label="Selesaikan nota" onClick={() => void complete()}>Selesaikan nota</button>}</div></div>
    </div>
  );
}
