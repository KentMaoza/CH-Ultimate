import type { jsPDF } from 'jspdf';

import { buildNotaDocumentLayout } from './output-documents';
import type {
  NotaDocumentColumnKey,
  NotaDocumentLayout,
  NotaDocumentPlan,
} from './output-documents';

function rupiah(value: number): string {
  return `Rp${Math.round(value).toLocaleString('id-ID')}`;
}

const moneyColumns = new Set<NotaDocumentColumnKey>(['pcsPrice', 'lsnPrice', 'total']);
const columnRatios = [0.06, 0.23, 0.12, 0.08, 0.09, 0.13, 0.13, 0.16];

function cellText(key: NotaDocumentColumnKey, value: string | number): string {
  return moneyColumns.has(key) ? rupiah(value as number) : String(value);
}

async function resolveLogoDataUrl(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  if (url.startsWith('data:image/')) return url;
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const mimeType = response.headers.get('content-type') || 'image/png';
    return `data:${mimeType};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

function drawIdentity(
  doc: jsPDF,
  identity: NotaDocumentLayout['identity'],
  logoDataUrl: string | undefined,
  width: number,
  margin: number,
) {
  const availableWidth = width - (margin * 2);
  const itemWidth = availableWidth / Math.max(1, identity.length);
  doc.setFontSize(7);
  identity.forEach((element, index) => {
    const x = margin + (itemWidth * index);
    if (element.id === 'logo') {
      if (logoDataUrl) {
        try {
          doc.addImage(logoDataUrl, x, 6, Math.min(18, itemWidth - 2), 9);
          return;
        } catch {
          // Unsupported image data falls back to the CHU wordmark.
        }
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(element.text, x, 12);
      return;
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(element.text, x, 11, { maxWidth: itemWidth - 2 });
  });
}

function drawPage(
  doc: jsPDF,
  plan: NotaDocumentPlan,
  layout: NotaDocumentLayout,
  pageIndex: number,
  logoDataUrl: string | undefined,
) {
  const page = layout.pages[pageIndex]!;
  const margin = 8;
  const width = plan.widthMm;
  doc.setTextColor(17, 17, 17);
  drawIdentity(doc, layout.identity, logoDataUrl, width, margin);
  doc.setLineWidth(0.4);
  doc.line(margin, 18, width - margin, 18);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(plan.fontSize);
  doc.text(plan.kind === 'invoice' ? 'INVOICE NOTA' : 'NOTA BARANG', margin, 26);
  doc.text(page.documentNumber, width - margin, 26, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(Math.max(7, plan.fontSize - 3));
  doc.text(`Pelanggan: ${plan.customerName || '—'}`, margin, 32);
  doc.text(`Tempat: ${plan.customerPlace || '—'}`, margin, 37);
  doc.text(`Tanggal: ${plan.transactionDate}`, width - margin, 32, { align: 'right' });

  if (plan.marker) {
    doc.setTextColor(180, 180, 180);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(34);
    doc.text(plan.marker, width / 2, plan.heightMm / 2, { align: 'center', angle: 18 });
    doc.setTextColor(17, 17, 17);
  }

  let y = 45;
  const contentWidth = width - (margin * 2);
  const columnWidths = columnRatios.map((ratio) => contentWidth * ratio);
  const columnStarts = columnWidths.map((_, index) => (
    margin + columnWidths.slice(0, index).reduce((sum, value) => sum + value, 0)
  ));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(7, plan.fontSize - 4));
  layout.columns.forEach((column, index) => {
    const rightAligned = column.numeric;
    doc.text(
      column.label,
      rightAligned ? columnStarts[index]! + columnWidths[index]! - 1 : columnStarts[index]! + 1,
      y,
      { align: rightAligned ? 'right' : 'left', maxWidth: columnWidths[index]! - 2 },
    );
  });
  y += 3;
  doc.line(margin, y, width - margin, y);
  doc.setFont('helvetica', 'normal');
  for (const row of page.rows) {
    y += 6;
    if (y > plan.heightMm - 34) break;
    layout.columns.forEach((column, index) => {
      const rightAligned = column.numeric;
      doc.text(
        cellText(column.key, row.cells[column.key]),
        rightAligned ? columnStarts[index]! + columnWidths[index]! - 1 : columnStarts[index]! + 1,
        y,
        { align: rightAligned ? 'right' : 'left', maxWidth: columnWidths[index]! - 2 },
      );
    });
  }
  const footerY = plan.heightMm - 25;
  doc.line(margin, footerY - 4, width - margin, footerY - 4);
  page.totals.forEach((total, index) => {
    const totalY = footerY + (index * 5);
    doc.setFont('helvetica', index === page.totals.length - 1 ? 'bold' : 'normal');
    doc.text(total.label, width - margin - 48, totalY);
    doc.text(rupiah(total.value), width - margin, totalY, { align: 'right' });
  });
}

export async function createNotaPdfBlob(plan: NotaDocumentPlan): Promise<Blob> {
  const { jsPDF: JsPdf } = await import('jspdf');
  const layout = buildNotaDocumentLayout(plan);
  const logoElement = layout.identity.find((element) => element.id === 'logo');
  const logoDataUrl = await resolveLogoDataUrl(logoElement?.imageUrl);
  const orientation = plan.widthMm > plan.heightMm ? 'landscape' : 'portrait';
  const doc = new JsPdf({
    compress: false,
    format: [plan.widthMm, plan.heightMm],
    orientation,
    unit: 'mm',
  });
  doc.setProperties({
    creator: 'CH Ultimate',
    title: `${plan.kind === 'invoice' ? 'Invoice' : 'Nota'} ${plan.baseNumber}`,
  });
  for (let index = 0; index < plan.pages.length; index += 1) {
    if (index > 0) doc.addPage([plan.widthMm, plan.heightMm], orientation);
    drawPage(doc, plan, layout, index, logoDataUrl);
  }
  return doc.output('blob');
}
