import { useState } from 'react';
import { lineTotal, suggestedPrice } from '../../domain/nota';
import type { NotaLine, PaymentKind, Unit } from '../../domain/types';
import { formatRupiah } from '../format';
import { useOperations } from '../operations-context';

export function NotaPage() {
  const { state, gateway } = useOperations();
  const [selectedId, setSelectedId] = useState(state.notas[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const nota = state.notas.find((item) => item.id === selectedId) ?? state.notas[0];
  if (!nota) return <div className="feature-page empty-state"><p>Belum ada nota pada sesi ini.</p><button className="button primary" onClick={() => void gateway.createNota().then((created) => setSelectedId(created.id))}>Buat nota demo</button></div>;
  const editable = nota.status === 'draft' || nota.status === 'reopened';

  async function updateLine(line: NotaLine, patch: Partial<NotaLine>) { await gateway.updateNotaLine(nota.id, line.id, patch); }
  async function chooseSku(line: NotaLine, skuId: string) {
    const sku = state.skus.find((item) => item.id === skuId);
    await updateLine(line, sku ? { skuId: sku.id, description: sku.name, unitPrice: suggestedPrice(sku.referencePrice, line.unit) } : { skuId: undefined, description: '', unitPrice: 0 });
  }
  async function chooseUnit(line: NotaLine, unit: Unit) {
    const sku = state.skus.find((item) => item.id === line.skuId);
    await updateLine(line, { unit, unitPrice: sku ? suggestedPrice(sku.referencePrice, unit) : line.unitPrice });
  }
  async function complete() { try { await gateway.completeNota(nota.id); setMessage('Nota selesai dan stok demo diperbarui.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Nota gagal diselesaikan.'); } }
  const total = nota.lines.reduce((sum, line) => sum + lineTotal(line), 0);
  return (
    <div className="feature-page nota-page">
      <div className="nota-meta">
        <div><span className="eyebrow">NOMOR NOTA</span><strong>{nota.number}{nota.suffix}</strong><small>Nomor sesi demo</small></div>
        <label><span>Pelanggan</span><input disabled={!editable} value={nota.customerName} onChange={(event) => void gateway.updateNota(nota.id, { customerName: event.target.value })} placeholder="Nama pelanggan" /></label>
        <label><span>Tanggal nota</span><input disabled={!editable} type="date" value={nota.transactionDate} onChange={(event) => void gateway.updateNota(nota.id, { transactionDate: event.target.value })} /></label>
        <label><span>Pembayaran</span><select disabled={!editable} value={nota.payment} onChange={(event) => void gateway.updateNota(nota.id, { payment: event.target.value as PaymentKind })}><option value="unclassified">Belum diklasifikasi</option><option value="cash">Kas</option><option value="transfer">Transfer</option><option value="credit">Piutang</option></select></label>
        <span className={`status-stamp ${nota.status}`}>{nota.status.toUpperCase()}</span>
      </div>
      {message && <div className="notice" role="status">{message}</div>}
      <div className="table-frame nota-grid"><table><thead><tr><th>KODE</th><th>BARANG</th><th>JUMLAH</th><th>SATUAN</th><th>HARGA</th><th>TOTAL</th></tr></thead><tbody>
        {nota.lines.map((line, index) => <tr key={line.id}><td>{index + 1}{nota.suffix}</td><td><select disabled={!editable} aria-label={`Barang baris ${index + 1}`} value={line.skuId ?? ''} onChange={(event) => void chooseSku(line, event.target.value)}><option value="">Ad-hoc / kosong</option>{state.skus.filter((sku) => !sku.archived).map((sku) => <option key={sku.id} value={sku.id}>{sku.skuNumber} · {sku.name}</option>)}</select>{!line.skuId && <input disabled={!editable} aria-label={`Nama ad-hoc baris ${index + 1}`} value={line.description} onChange={(event) => void updateLine(line, { description: event.target.value })} placeholder="Nama barang bebas" />}</td><td><input disabled={!editable} aria-label={`Jumlah baris ${index + 1}`} type="number" min="0" step="1" value={line.quantity || ''} onChange={(event) => void updateLine(line, { quantity: Number(event.target.value) })} /></td><td><select disabled={!editable} aria-label={`Satuan baris ${index + 1}`} value={line.unit} onChange={(event) => void chooseUnit(line, event.target.value as Unit)}><option value="pcs">pcs</option><option value="lsn">lsn</option></select></td><td><input disabled={!editable} aria-label={`Harga baris ${index + 1}`} type="number" min="0" value={line.unitPrice || ''} onChange={(event) => void updateLine(line, { unitPrice: Number(event.target.value) })} /></td><td>{formatRupiah(lineTotal(line))}</td></tr>)}
      </tbody></table></div>
      <div className="nota-footer"><div><span>TOTAL NOTA</span><strong>{formatRupiah(total)}</strong></div><div className="toolbar-actions">{nota.status === 'completed' && <><button className="button secondary" onClick={() => void gateway.reopenNota(nota.id)}>Edit kembali</button><button className="button secondary" onClick={() => void gateway.cancelNota(nota.id)}>Batalkan nota</button></>}{nota.status === 'cancelled' && <button className="button secondary" onClick={() => void gateway.restoreNota(nota.id)}>Pulihkan nota</button>}{editable && <button className="button primary" aria-label="Selesaikan nota" onClick={() => void complete()}>Selesaikan nota</button>}</div></div>
    </div>
  );
}
