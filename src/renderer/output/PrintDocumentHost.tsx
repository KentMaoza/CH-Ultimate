import { QRCodeSVG } from 'qrcode.react';

import type {
  BarcodeDocumentPlan,
  LabelDocumentPlan,
  NotaDocumentPlan,
  OutputDocumentPlan,
  ProductLabelItem,
} from '../../domain/output-documents';
import type { OperationalPdfPlan } from '../../domain/operational-exports';
import { formatRupiah } from '../format';

function StoreIdentity({ plan }: { plan: NotaDocumentPlan }) {
  const value = {
    logo: plan.identity.logoUrl
      ? <div className="output-document__logo"><img src={plan.identity.logoUrl} alt="Logo CH" /><b>CHU</b></div>
      : <div className="output-document__logo"><b>CHU</b></div>,
    address: <p>{plan.identity.address}</p>,
    phone: <p>{plan.identity.phone}</p>,
    bank: <p>{plan.identity.bankAccount}</p>,
  };
  return <header className="output-document__identity">{plan.identity.elements
    .filter((element) => element.visible)
    .map((element) => <div key={element.id}>{value[element.id]}</div>)}</header>;
}

function NotaHost({ plan }: { plan: NotaDocumentPlan }) {
  return <>{plan.pages.map((page) => <article
    className="output-document__page output-document__nota"
    key={page.id}
    style={{
      width: `${plan.widthMm}mm`,
      minHeight: `${plan.heightMm}mm`,
      fontSize: `${plan.fontSize}px`,
    }}
  >
    {plan.marker ? <strong className="output-document__draft">{plan.marker}</strong> : null}
    <StoreIdentity plan={plan} />
    <section className="output-document__heading">
      <div><b>{plan.kind === 'invoice' ? 'INVOICE NOTA' : 'NOTA BARANG'}</b><strong>{page.documentNumber}</strong></div>
      <dl>
        <div><dt>Pelanggan</dt><dd>{plan.customerName || '—'}</dd></div>
        <div><dt>Tempat</dt><dd>{plan.customerPlace || '—'}</dd></div>
        <div><dt>Tanggal</dt><dd>{plan.transactionDate}</dd></div>
      </dl>
    </section>
    <h2>Nota {page.suffix}</h2>
    <table className="output-document__table">
      <thead><tr><th>NO</th><th>NAMA BARANG</th><th>JENIS</th><th>JUMLAH</th><th>PCS/LSN</th><th>HARGA PCS</th><th>HARGA LSN</th><th>TOTAL</th></tr></thead>
      <tbody>{page.rows.map((row) => <tr key={row.line.id}>
        <td>{row.code}</td><td>{row.line.description}</td><td>{row.line.kind || '—'}</td>
        <td>{row.line.quantity}</td><td>{row.line.unit.toUpperCase()}</td>
        <td>{formatRupiah(row.line.pcsPrice)}</td><td>{formatRupiah(row.line.lsnPrice)}</td>
        <td>{formatRupiah(row.total)}</td>
      </tr>)}</tbody>
    </table>
    <footer className="output-document__totals">
      <span>Total Nota <b>{formatRupiah(page.subtotalBeforeTax)}</b></span>
      <span>PPN 12% <b>{formatRupiah(page.tax)}</b></span>
      <span>Total Transaksi <b>{formatRupiah(page.total)}</b></span>
    </footer>
  </article>)}</>;
}

function ProductLabel({ item, plan }: { item: ProductLabelItem; plan: LabelDocumentPlan }) {
  return <article className="output-document__product-card" style={{
    width: `${plan.cardWidthMm}mm`,
    minHeight: `${plan.cardHeightMm}mm`,
    fontSize: `${plan.fontSize}px`,
    textAlign: plan.alignment,
  }}>
    {plan.fields.includes('qr') ? <QRCodeSVG data-testid="output-product-qr" value={item.qrValue} size={72} marginSize={0} /> : null}
    {plan.fields.includes('chu') ? <b>CHU</b> : null}
    {plan.fields.includes('name') ? <strong>{item.name}</strong> : null}
    {plan.fields.includes('sku') ? <span>Kode Produk: {item.productCode}</span> : null}
    {plan.fields.includes('price') ? <span>{formatRupiah(item.referencePrice)}</span> : null}
  </article>;
}

function LabelHost({ plan }: { plan: LabelDocumentPlan }) {
  return <section className={`output-document__labels output-document__labels--${plan.widthMm === 210 ? 'a4' : 'thermal'}`} style={{
    width: `${plan.widthMm}mm`,
    minHeight: `${plan.heightMm}mm`,
    padding: `${plan.marginMm}mm`,
    gap: `${plan.gapMm}mm`,
    gridTemplateColumns: `repeat(${plan.columns}, ${plan.cardWidthMm}mm)`,
  }}>{plan.items.map((item, index) => <ProductLabel item={item} plan={plan} key={index} />)}</section>;
}

function BarcodeHost({ plan }: { plan: BarcodeDocumentPlan }) {
  return <section className={`output-document__labels output-document__labels--${plan.widthMm === 210 ? 'a4' : 'thermal'}`} style={{
    width: `${plan.widthMm}mm`,
    minHeight: `${plan.heightMm}mm`,
    padding: `${plan.marginMm}mm`,
    gap: `${plan.gapMm}mm`,
    gridTemplateColumns: `repeat(${plan.columns}, ${plan.cardWidthMm}mm)`,
  }}>{plan.items.map((item, index) => <article className="output-document__product-card" style={{
    width: `${plan.cardWidthMm}mm`,
    minHeight: `${plan.cardHeightMm}mm`,
    fontSize: `${plan.fontSize}px`,
  }} key={index}>
    <QRCodeSVG data-testid="output-product-qr" value={item.qrValue} size={72} marginSize={0} />
    <strong>Kode Produk: {item.productCode}</strong>
  </article>)}</section>;
}

function OperationalHost({ plan }: { plan: OperationalPdfPlan }) {
  const pages = Array.from(
    { length: Math.max(1, Math.ceil(plan.rows.length / 20)) },
    (_, pageIndex) => plan.rows.slice(pageIndex * 20, (pageIndex + 1) * 20),
  );
  return <>{pages.map((rows, pageIndex) => <article
    className="output-document__page output-document__operational"
    style={{ width: `${plan.widthMm}mm`, minHeight: `${plan.heightMm}mm` }}
    key={pageIndex}
  >
    <header><div><b>CHU · EKSPOR DATA</b><h1>{plan.title}</h1></div><div><strong>{plan.totalIncluded} dari {plan.totalMatched} baris</strong><span>{plan.generatedDate} · Halaman {pageIndex + 1}/{pages.length}</span></div></header>
    <table className="output-document__table">
      <thead><tr>{plan.dataset === 'sku-stock' ? <th>GAMBAR</th> : null}{plan.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}>
        {plan.dataset === 'sku-stock' ? <td className="output-document__thumbnail">{row.thumbnailDataUrl ? <img src={row.thumbnailDataUrl} alt="" /> : <b>CHU</b>}</td> : null}
        {row.cells.map((cell, index) => <td key={index}>{cell}</td>)}
      </tr>)}</tbody>
    </table>
  </article>)}</>;
}

export function PrintDocumentHost({ plan }: { plan: OutputDocumentPlan }) {
  let content;
  if (plan.kind === 'label') {
    content = <LabelHost plan={plan} />;
  } else if (plan.kind === 'barcode') {
    content = <BarcodeHost plan={plan} />;
  } else if (plan.kind === 'operational-data') {
    content = <OperationalHost plan={plan} />;
  } else {
    content = <NotaHost plan={plan} />;
  }
  return <div
    className="print-document-host"
    data-testid="print-document-host"
    data-document-kind={plan.kind}
    aria-hidden="true"
  >
    {content}
  </div>;
}
