import type { jsPDF } from 'jspdf';

import type { NotaDocumentPlan } from './output-documents';

function rupiah(value: number): string {
  return `Rp${Math.round(value).toLocaleString('id-ID')}`;
}

function drawPage(doc: jsPDF, plan: NotaDocumentPlan, pageIndex: number) {
  const page = plan.pages[pageIndex]!;
  const margin = 8;
  const width = plan.widthMm;
  doc.setTextColor(17, 17, 17);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(10, plan.fontSize + 2));
  doc.text('CHU', margin, 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(Math.max(7, plan.fontSize - 3));
  const identity = [plan.identity.address, plan.identity.phone, plan.identity.bankAccount]
    .filter(Boolean).join(' · ');
  doc.text(identity, margin, 18, { maxWidth: width - (margin * 2) });
  doc.setLineWidth(0.4);
  doc.line(margin, 22, width - margin, 22);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(plan.fontSize);
  doc.text(plan.kind === 'invoice' ? 'INVOICE NOTA' : 'NOTA BARANG', margin, 30);
  doc.text(page.documentNumber, width - margin, 30, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(Math.max(7, plan.fontSize - 3));
  doc.text(`Pelanggan: ${plan.customerName || '—'}`, margin, 36);
  doc.text(`Tempat: ${plan.customerPlace || '—'}`, margin, 41);
  doc.text(`Tanggal: ${plan.transactionDate}`, width - margin, 36, { align: 'right' });

  if (plan.marker) {
    doc.setTextColor(180, 180, 180);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(34);
    doc.text(plan.marker, width / 2, plan.heightMm / 2, { align: 'center', angle: 18 });
    doc.setTextColor(17, 17, 17);
  }

  let y = 49;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(Math.max(7, plan.fontSize - 4));
  doc.text('NO', margin, y);
  doc.text('NAMA BARANG', margin + 12, y);
  doc.text('JML', width - 54, y, { align: 'right' });
  doc.text('UNIT', width - 39, y, { align: 'right' });
  doc.text('TOTAL', width - margin, y, { align: 'right' });
  y += 3;
  doc.line(margin, y, width - margin, y);
  doc.setFont('helvetica', 'normal');
  for (const row of page.rows) {
    y += 6;
    if (y > plan.heightMm - 26) break;
    doc.text(row.code, margin, y);
    doc.text(row.line.description.slice(0, 45), margin + 12, y);
    doc.text(String(row.line.quantity), width - 54, y, { align: 'right' });
    doc.text(row.line.unit.toUpperCase(), width - 39, y, { align: 'right' });
    doc.text(rupiah(row.total), width - margin, y, { align: 'right' });
  }
  const footerY = plan.heightMm - 18;
  doc.line(margin, footerY - 5, width - margin, footerY - 5);
  doc.setFont('helvetica', 'bold');
  doc.text(`Total Nota ${page.suffix}`, margin, footerY);
  doc.text(rupiah(page.total), width - margin, footerY, { align: 'right' });
}

export async function createNotaPdfBlob(plan: NotaDocumentPlan): Promise<Blob> {
  const { jsPDF: JsPdf } = await import('jspdf');
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
    drawPage(doc, plan, index);
  }
  return doc.output('blob');
}
