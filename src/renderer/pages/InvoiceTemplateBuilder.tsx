import { useEffect, useState } from 'react';
import { lineTotal } from '../../domain/nota';
import type { InvoiceElementId, InvoiceTemplate } from '../../domain/types';
import { formatRupiah } from '../format';
import { useOperations } from '../operations-context';

const integerFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const elementLabels: Record<InvoiceElementId, string> = {
  logo: 'Logo', address: 'Alamat', phone: 'No. Telp', bank: 'No. rekening',
};

function invoicePrice(value: number) { return value > 0 ? integerFormat.format(value) : '—'; }

export function InvoiceTemplateBuilder() {
  const { state, gateway } = useOperations();
  const template = state.invoiceTemplate;
  const transaction = state.notaTransactions[0];
  const pages = transaction?.pages
    .filter((page) => page.status === 'active')
    .map((page) => ({
      ...page,
      rows: page.lines
        .map((line, rowIndex) => ({ line, rowIndex }))
        .filter(({ line }) => line.description.trim()),
    })) ?? [];
  const [selectedPageId, setSelectedPageId] = useState<string>();
  useEffect(() => {
    if (!pages.some((page) => page.id === selectedPageId)) setSelectedPageId(pages[0]?.id);
  }, [pages, selectedPageId]);
  const selectedPage = pages.find((page) => page.id === selectedPageId) ?? pages[0];
  const transactionTotal = selectedPage?.rows.reduce((sum, { line }) => sum + lineTotal(line), 0) ?? 0;
  const ppn = Math.round(transactionTotal * 12 / 112);
  const noteTotal = transactionTotal - ppn;
  const update = (patch: Partial<InvoiceTemplate>) => void gateway.setInvoiceTemplate({ ...template, ...patch });
  const updateElement = (id: InvoiceElementId, visible: boolean) => update({ elements: template.elements.map((element) => element.id === id ? { ...element, visible } : element) });
  const moveElement = (id: InvoiceElementId, direction: -1 | 1) => {
    const index = template.elements.findIndex((element) => element.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= template.elements.length) return;
    const elements = [...template.elements];
    [elements[index], elements[target]] = [elements[target]!, elements[index]!];
    update({ elements });
  };
  const renderElement = (id: InvoiceElementId) => {
    if (id === 'logo') return <div className="invoice-logo">{template.logoUrl && <img key={template.logoUrl} src={template.logoUrl} alt="Logo invoice" onError={(event) => { event.currentTarget.style.display = 'none'; }} />}<strong>CHU</strong></div>;
    if (id === 'address') return <p>{template.address}</p>;
    if (id === 'phone') return <p>{template.phone}</p>;
    return <p>{template.bankAccount}</p>;
  };

  return <div className="label-layout">
    <section className="builder-panel">
      <div className="section-heading"><span>INVOICE BUILDER</span><h2>Template invoice</h2><p>Atur ukuran serta identitas toko. Gunakan tombol naik/turun untuk memindahkan elemen.</p></div>
      <div className="form-grid compact">
        <label><span>Lebar invoice (mm)</span><input type="number" min="80" max="297" value={template.widthMm} onChange={(event) => update({ widthMm: Number(event.target.value) })} /></label>
        <label><span>Tinggi invoice (mm)</span><input type="number" min="80" max="420" value={template.heightMm} onChange={(event) => update({ heightMm: Number(event.target.value) })} /></label>
        <label><span>Ukuran font invoice</span><input type="number" min="8" max="24" value={template.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label>
        <label className="full"><span>URL logo</span><input type="url" value={template.logoUrl} onChange={(event) => update({ logoUrl: event.target.value })} placeholder="Kosongkan untuk CHU" /></label>
        <label className="full"><span>No. rekening</span><input value={template.bankAccount} onChange={(event) => update({ bankAccount: event.target.value })} /></label>
        <label className="full"><span>Alamat</span><textarea rows={2} value={template.address} onChange={(event) => update({ address: event.target.value })} /></label>
        <label className="full"><span>No. Telp</span><input value={template.phone} onChange={(event) => update({ phone: event.target.value })} /></label>
      </div>
      <fieldset className="invoice-elements"><legend>Urutan elemen invoice</legend>{template.elements.map((element, index) => <div key={element.id}><label className="check-field"><input type="checkbox" checked={element.visible} onChange={(event) => updateElement(element.id, event.target.checked)} /><span>{elementLabels[element.id]}</span></label><button type="button" aria-label={`Naikkan ${elementLabels[element.id]}`} disabled={index === 0} onClick={() => moveElement(element.id, -1)}>↑</button><button type="button" aria-label={`Turunkan ${elementLabels[element.id]}`} disabled={index === template.elements.length - 1} onClick={() => moveElement(element.id, 1)}>↓</button></div>)}</fieldset>
      <div className="form-actions"><button className="button secondary" disabled aria-label="Export PDF invoice">Export PDF</button><button className="button primary" disabled aria-label="Print invoice">Print</button></div>
    </section>
    <section className="preview-panel invoice-preview-wrap">
      <div className="preview-title"><strong>Preview invoice</strong><span>Session-only · output produksi belum aktif</span></div>
      <div className="invoice-page-selector" aria-label="Pilih Nota untuk preview">{pages.map((page) => <button type="button" key={page.id} aria-label={`Preview Nota ${page.suffix}`} aria-pressed={page.id === selectedPage?.id} onClick={() => setSelectedPageId(page.id)}>Nota {page.suffix}</button>)}</div>
      <article className="invoice-paper" data-testid="invoice-preview" style={{ width: `${template.widthMm}mm`, minHeight: `${template.heightMm}mm`, fontSize: `${template.fontSize}px` }}>
        <header>{template.elements.filter((element) => element.visible).map((element) => <div key={element.id} data-testid={`invoice-element-${element.id}`}>{renderElement(element.id)}</div>)}</header>
        <div className="invoice-heading">
          <div className="invoice-heading__number"><b>INVOICE NOTA</b><span>{transaction?.baseNumber ?? 'CHU-DEMO-0001'}</span></div>
          <div className="invoice-customer-grid">
            <div><span>Pelanggan</span><strong data-testid="invoice-customer-name">{transaction?.customerName || 'Pelanggan Demo'}</strong></div>
            <div><span>Tempat</span><strong data-testid="invoice-customer-place">{transaction?.customerPlace || 'Tempat belum diisi'}</strong></div>
            <div><span>Tanggal</span><strong data-testid="invoice-customer-date">{transaction?.transactionDate || 'Tanggal belum diisi'}</strong></div>
          </div>
        </div>
        {selectedPage ? <section className="invoice-nota-section">
            <div className="invoice-nota-heading"><strong>Nota {selectedPage.suffix}</strong><span>{transaction?.baseNumber ?? 'CHU-DEMO-0001'}{selectedPage.suffix}</span></div>
            {selectedPage.rows.length ? <table className="invoice-items-grid" data-testid="invoice-items-grid">
              <colgroup><col className="invoice-col-no" /><col className="invoice-col-name" /><col className="invoice-col-kind" /><col className="invoice-col-quantity" /><col className="invoice-col-unit" /><col className="invoice-col-price" /><col className="invoice-col-price" /><col className="invoice-col-total" /></colgroup>
              <thead><tr><th>NO</th><th>NAMA BARANG</th><th>JENIS</th><th>JUMLAH</th><th>PCS/LSN</th><th>HARGA PCS</th><th>HARGA LSN</th><th>TOTAL</th></tr></thead>
              <tbody>{selectedPage.rows.map(({ line, rowIndex }) => {
                const code = `${rowIndex + 1}${selectedPage.suffix}`;
                return <tr key={line.id}>
                  <td className="invoice-item-code">{code}</td>
                  <td className="invoice-item-name">{line.description}</td>
                  <td data-testid={`invoice-kind-${code}`}>{line.kind || '—'}</td>
                  <td data-testid={`invoice-quantity-${code}`}>{line.quantity}</td>
                  <td className="invoice-unit-cell" data-testid={`invoice-unit-${code}`}>{line.unit.toUpperCase()}</td>
                  <td className="invoice-item-price" data-testid={`invoice-price-pcs-${code}`}>{invoicePrice(line.pcsPrice)}</td>
                  <td className="invoice-item-price" data-testid={`invoice-price-lsn-${code}`}>{invoicePrice(line.lsnPrice)}</td>
                  <td data-testid={`invoice-line-total-${code}`}>{formatRupiah(lineTotal(line))}</td>
                </tr>;
              })}</tbody>
            </table> : <p className="invoice-empty">Belum ada barang pada Nota {selectedPage.suffix}.</p>}
          </section> : <p className="invoice-empty">Belum ada Nota aktif pada transaksi ini.</p>}
        <footer className="invoice-summary">
          <div data-testid="invoice-note-total"><span>Total Nota</span><strong>{formatRupiah(noteTotal)}</strong></div>
          <div data-testid="invoice-ppn"><span>PPN 12%</span><strong>{formatRupiah(ppn)}</strong></div>
          <div data-testid="invoice-transaction-total"><span>Total Transaksi</span><strong>{formatRupiah(transactionTotal)}</strong></div>
        </footer>
      </article>
    </section>
  </div>;
}
