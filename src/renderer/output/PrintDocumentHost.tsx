import { QRCodeSVG } from 'qrcode.react';

import { buildNotaDocumentLayout } from '../../domain/output-documents';
import type {
  BarcodeDocumentPlan,
  LabelDocumentPlan,
  NotaDocumentLayout,
  NotaDocumentPlan,
  OutputDocumentPlan,
  ProductLabelItem,
} from '../../domain/output-documents';
import type { OperationalPdfPlan } from '../../domain/operational-exports';
import type { RestockRecommendationDocumentPlan } from '../../domain/restock-recommendation-document';
import { formatRupiah } from '../format';

function StoreIdentity({ identity }: { identity: NotaDocumentLayout['identity'] }) {
  return <header className="output-document__identity">{identity.map((element) => <div key={element.id}>
    {element.id === 'logo'
      ? <div className="output-document__logo">{element.imageUrl ? <img src={element.imageUrl} alt="Logo CH" /> : null}<b>{element.text}</b></div>
      : <p>{element.text}</p>}
  </div>)}</header>;
}

function NotaHost({ plan }: { plan: NotaDocumentPlan }) {
  const layout = buildNotaDocumentLayout(plan);
  const moneyColumns = new Set(['pcsPrice', 'lsnPrice', 'total']);
  return <>{layout.pages.map((page) => <article
    className="output-document__page output-document__nota"
    key={page.id}
    style={{
      width: `${plan.widthMm}mm`,
      minHeight: `${plan.heightMm}mm`,
      fontSize: `${plan.fontSize}px`,
    }}
  >
    {plan.marker ? <strong className="output-document__draft">{plan.marker}</strong> : null}
    <StoreIdentity identity={layout.identity} />
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
      <thead><tr>{layout.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
      <tbody>{page.rows.map((row) => <tr key={row.id}>
        {layout.columns.map((column) => <td key={column.key}>
          {moneyColumns.has(column.key)
            ? formatRupiah(row.cells[column.key] as number)
            : row.cells[column.key]}
        </td>)}
      </tr>)}</tbody>
    </table>
    <footer className="output-document__totals">
      {page.totals.map((total) => <span key={total.label}>{total.label} <b>{formatRupiah(total.value)}</b></span>)}
    </footer>
  </article>)}</>;
}

function ProductLabel({ item, plan }: { item: ProductLabelItem; plan: LabelDocumentPlan }) {
  const hasQr = plan.fields.includes('qr');
  const qrSizeMm = Math.max(8, Math.min(18, plan.cardHeightMm * 0.5, plan.cardWidthMm * 0.33));
  const copyFieldCount = plan.fields.filter((field) => field !== 'qr').length;
  const fittedFontSize = Math.min(
    plan.fontSize,
    Math.max(6, Math.floor((((plan.cardHeightMm - 4) * 96) / 25.4) / Math.max(1, copyFieldCount) / 1.1)),
  );
  return <article className={`output-document__product-card${hasQr ? ' output-document__product-card--with-qr' : ''}`} style={{
    width: `${plan.cardWidthMm}mm`,
    height: `${plan.cardHeightMm}mm`,
    fontSize: `${fittedFontSize}px`,
    textAlign: plan.alignment,
  }} data-testid="output-product-card">
    {hasQr ? <QRCodeSVG
      data-testid="output-product-qr"
      value={item.qrValue}
      size={Math.round(qrSizeMm * 96 / 25.4)}
      marginSize={0}
      style={{ width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm`, flexShrink: 0 }}
    /> : null}
    <div className="output-document__product-copy" data-testid="output-product-copy">
      {plan.fields.includes('chu') ? <b>CHU</b> : null}
      {plan.fields.includes('name') ? <strong>{item.name}</strong> : null}
      {plan.fields.includes('sku') ? <span>Kode Produk: {item.productCode}</span> : null}
      {plan.fields.includes('price') ? <span>{formatRupiah(item.referencePrice)}</span> : null}
    </div>
  </article>;
}

function LabelHost({ plan }: { plan: LabelDocumentPlan }) {
  const pages = Array.from(
    { length: plan.pageCount },
    (_, pageIndex) => plan.items.slice(
      pageIndex * plan.cardsPerPage,
      (pageIndex + 1) * plan.cardsPerPage,
    ),
  );
  return <>{pages.map((items, pageIndex) => <section
    className={`output-document__labels output-document__labels--${plan.widthMm === 210 ? 'a4' : 'thermal'}`}
    data-testid="output-label-page"
    key={pageIndex}
    style={{
      width: `${plan.widthMm}mm`,
      height: `${plan.heightMm}mm`,
      minHeight: `${plan.heightMm}mm`,
      padding: `${plan.marginMm}mm`,
      gap: `${plan.gapMm}mm`,
      gridTemplateColumns: `repeat(${plan.columns}, ${plan.cardWidthMm}mm)`,
    }}
  >{items.map((item, itemIndex) => <ProductLabel
    item={item}
    plan={plan}
    key={(pageIndex * plan.cardsPerPage) + itemIndex}
  />)}</section>)}</>;
}

function BarcodeHost({ plan }: { plan: BarcodeDocumentPlan }) {
  const qrSizeMm = Math.max(8, Math.min(18, plan.cardHeightMm - 8, plan.cardWidthMm - 8));
  const compactCopy = plan.cardWidthMm <= 20 && plan.cardHeightMm <= 15;
  const pages = Array.from(
    { length: plan.pageCount },
    (_, pageIndex) => plan.items.slice(
      pageIndex * plan.cardsPerPage,
      (pageIndex + 1) * plan.cardsPerPage,
    ),
  );
  return <>{pages.map((items, pageIndex) => <section
    className={`output-document__labels output-document__labels--${plan.widthMm === 210 ? 'a4' : 'thermal'}`}
    data-testid="output-label-page"
    key={pageIndex}
    style={{
      width: `${plan.widthMm}mm`,
      height: `${plan.heightMm}mm`,
      minHeight: `${plan.heightMm}mm`,
      padding: `${plan.marginMm}mm`,
      gap: `${plan.gapMm}mm`,
      gridTemplateColumns: `repeat(${plan.columns}, ${plan.cardWidthMm}mm)`,
    }}
  >{items.map((item, itemIndex) => <article className="output-document__product-card output-document__product-card--with-qr" style={{
    width: `${plan.cardWidthMm}mm`,
    height: `${plan.cardHeightMm}mm`,
    fontSize: `${plan.fontSize}px`,
  }} data-testid="output-product-card" key={(pageIndex * plan.cardsPerPage) + itemIndex}>
    <QRCodeSVG
      data-testid="output-product-qr"
      value={item.qrValue}
      size={Math.round(qrSizeMm * 96 / 25.4)}
      marginSize={0}
      style={{ width: `${qrSizeMm}mm`, height: `${qrSizeMm}mm`, flexShrink: 0 }}
    />
    <strong
      className="output-document__product-copy"
      data-testid="output-product-copy"
      style={compactCopy ? {
        fontSize: '4px',
        lineHeight: 1,
        overflowWrap: 'anywhere',
        whiteSpace: 'normal',
      } : undefined}
    >{compactCopy ? item.productCode : `Kode Produk: ${item.productCode}`}</strong>
  </article>)}</section>)}</>;
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

function RestockRecommendationHost({
  plan,
}: {
  plan: RestockRecommendationDocumentPlan;
}) {
  return <>{plan.pages.map((page, pageIndex) => <article
    className="output-document__page output-document__restock"
    style={{ width: `${plan.widthMm}mm`, height: `${plan.heightMm}mm` }}
    data-testid="output-restock-page"
    key={`${page.supplierCode ?? 'none'}-${pageIndex}`}
  >
    <header className="output-document__restock-header">
      <div><b>CHU · REKOMENDASI RESTOCK</b><span>{plan.generatedDate}</span></div>
      <span>Halaman {pageIndex + 1}/{plan.pages.length}</span>
    </header>
    <h1 className="output-document__restock-supplier">
      {page.supplierCode ? `Supplier ${page.supplierCode}` : 'Tanpa kode supplier'}
    </h1>
    <section className="output-document__restock-grid">
      {page.items.map((item) => <article
        className="output-document__restock-card"
        data-rank={item.rank}
        data-testid="output-restock-card"
        style={{ width: '93mm', height: '56mm' }}
        key={item.id}
      >
        <div className="output-document__restock-image">
          {item.thumbnailDataUrl
            ? <img src={item.thumbnailDataUrl} alt="" />
            : <b>CHU</b>}
        </div>
        <div className="output-document__restock-copy">
          <strong>{item.name}</strong>
          <b>{item.quantity} pcs</b>
        </div>
      </article>)}
    </section>
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
  } else if (plan.kind === 'restock-recommendation') {
    content = <RestockRecommendationHost plan={plan} />;
  } else {
    content = <NotaHost plan={plan} />;
  }
  return <div
    className="print-document-host"
    data-testid="print-document-host"
    data-document-kind={plan.kind}
    aria-hidden="true"
  >
    <style data-testid="output-page-style">{
      `@page { size: ${plan.widthMm}mm ${plan.heightMm}mm; margin: 0; }`
    }</style>
    {content}
  </div>;
}
