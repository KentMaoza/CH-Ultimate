import type { jsPDF } from 'jspdf';
import {
  groupShareRecommendationItems,
  type ShareRecommendationReport,
} from './share-recommendations';

export type RecommendationPdfMode = 'daily' | 'urgent';

export interface RecommendationPdfProduct {
  id: string;
  imageUrl: string;
  name: string;
  referencePrice: number;
  skuNumber: string;
}

export interface RecommendationPdfGroup {
  supplierLabel: string;
  products: RecommendationPdfProduct[];
}

export interface RecommendationPdfPlan {
  date: string;
  demoLabel: 'DATA DEMO · SESSION ONLY';
  fileName: string;
  groups: RecommendationPdfGroup[];
  title: 'Rekomendasi Harian' | 'SKU Urgent';
  totalAvailable: number;
  totalIncluded: number;
}

interface RecommendationPdfDependencies {
  loadImageDataUrl: (url: string) => Promise<string | null>;
}

const MAX_PDF_PRODUCTS = 300;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const PAGE_MARGIN = 12;
const CONTENT_BOTTOM = 280;
const CARD_GAP = 3;
const CARD_HEIGHT = 52;
const CARD_WIDTH = 60;

export function buildRecommendationPdfPlan(
  report: ShareRecommendationReport,
  mode: RecommendationPdfMode,
): RecommendationPdfPlan {
  const available = mode === 'daily' ? report.daily : report.urgent;
  const selected = available.slice(0, MAX_PDF_PRODUCTS);
  const groups = groupShareRecommendationItems(selected).map((group) => ({
    supplierLabel: group.supplierCode ?? 'Tanpa kode supplier',
    products: group.items.map(({ sku }) => ({
      id: sku.id,
      imageUrl: sku.imageUrl,
      name: sku.name,
      referencePrice: sku.referencePrice,
      skuNumber: sku.skuNumber,
    })),
  }));
  const title = mode === 'daily' ? 'Rekomendasi Harian' : 'SKU Urgent';
  const fileNameTitle = mode === 'daily' ? 'Rekomendasi-Harian' : 'SKU-Urgent';
  return {
    date: report.date,
    demoLabel: 'DATA DEMO · SESSION ONLY',
    fileName: `CHU-${fileNameTitle}-${report.date}.pdf`,
    groups,
    title,
    totalAvailable: available.length,
    totalIncluded: selected.length,
  };
}

async function loadImageDataUrl(url: string): Promise<string | null> {
  if (!url || typeof document === 'undefined') return null;
  const image = document.createElement('img');
  image.crossOrigin = 'anonymous';
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('Image load timed out')), 3_000);
      image.onload = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      image.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error('Image failed to load'));
      };
      image.src = url;
    });
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 216;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function formatRupiah(value: number): string {
  return `Rp${Math.round(value).toLocaleString('id-ID')}`;
}

function drawPageHeader(doc: jsPDF, plan: RecommendationPdfPlan): void {
  doc.setFillColor(17, 17, 17);
  doc.rect(PAGE_MARGIN, 10, 16, 16, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('CHU', PAGE_MARGIN + 8, 20.5, { align: 'center' });

  doc.setTextColor(17, 17, 17);
  doc.setFontSize(15);
  doc.text(plan.title, 33, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Tanggal ${plan.date} · ${plan.totalIncluded} dari ${plan.totalAvailable} SKU`, 33, 22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(plan.demoLabel, PAGE_WIDTH - PAGE_MARGIN, 15, { align: 'right' });
  doc.setDrawColor(17, 17, 17);
  doc.setLineWidth(0.6);
  doc.line(PAGE_MARGIN, 30, PAGE_WIDTH - PAGE_MARGIN, 30);
}

function drawSupplierHeader(doc: jsPDF, label: string, count: number, y: number, continued = false): void {
  doc.setFillColor(17, 17, 17);
  doc.rect(PAGE_MARGIN, y, PAGE_WIDTH - (PAGE_MARGIN * 2), 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`SUPPLIER · ${label}${continued ? ' · LANJUTAN' : ''}`, PAGE_MARGIN + 3, y + 5.2);
  doc.text(`${count} SKU`, PAGE_WIDTH - PAGE_MARGIN - 3, y + 5.2, { align: 'right' });
}

function drawFallbackImage(doc: jsPDF, x: number, y: number, width: number, height: number): void {
  doc.setFillColor(245, 245, 245);
  doc.rect(x, y, width, height, 'F');
  doc.setDrawColor(150, 150, 150);
  doc.rect(x, y, width, height);
  doc.setTextColor(70, 70, 70);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('CHU', x + (width / 2), y + (height / 2) + 1.5, { align: 'center' });
}

function drawProductCard(
  doc: jsPDF,
  product: RecommendationPdfProduct,
  imageDataUrl: string | null,
  x: number,
  y: number,
): void {
  doc.setDrawColor(25, 25, 25);
  doc.setLineWidth(0.35);
  doc.rect(x, y, CARD_WIDTH, CARD_HEIGHT);

  const imageX = x + 3;
  const imageY = y + 3;
  const imageWidth = CARD_WIDTH - 6;
  const imageHeight = 27;
  if (imageDataUrl) {
    try {
      doc.addImage(imageDataUrl, 'PNG', imageX, imageY, imageWidth, imageHeight, undefined, 'FAST');
    } catch {
      drawFallbackImage(doc, imageX, imageY, imageWidth, imageHeight);
    }
  } else {
    drawFallbackImage(doc, imageX, imageY, imageWidth, imageHeight);
  }

  doc.setTextColor(17, 17, 17);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  const nameLines = doc.splitTextToSize(product.name, CARD_WIDTH - 6).slice(0, 2) as string[];
  doc.text(nameLines, x + 3, y + 34);
  const identityY = y + (nameLines.length > 1 ? 43 : 40);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(90, 90, 90);
  doc.text(product.skuNumber, x + 3, identityY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(17, 17, 17);
  doc.text(formatRupiah(product.referencePrice), x + 3, y + 49);
}

function addPage(doc: jsPDF, plan: RecommendationPdfPlan): number {
  doc.addPage();
  drawPageHeader(doc, plan);
  return 36;
}

export async function createRecommendationPdfBlob(
  plan: RecommendationPdfPlan,
  dependencies: RecommendationPdfDependencies = { loadImageDataUrl },
): Promise<Blob> {
  const { jsPDF: JsPdf } = await import('jspdf');
  const doc = new JsPdf({ compress: false, format: 'a4', orientation: 'portrait', unit: 'mm' });
  doc.setProperties({
    creator: 'CH Ultimate',
    subject: plan.demoLabel,
    title: `${plan.title} · ${plan.date}`,
  });
  drawPageHeader(doc, plan);

  const imageCache = new Map<string, string | null>();
  const imageUrls = [...new Set(plan.groups.flatMap((group) => (
    group.products.flatMap((product) => product.imageUrl ? [product.imageUrl] : [])
  )))];
  await Promise.all(imageUrls.map(async (url) => {
    imageCache.set(url, await dependencies.loadImageDataUrl(url).catch(() => null));
  }));

  let y = 36;
  for (const group of plan.groups) {
    if (y + 8 + CARD_GAP + CARD_HEIGHT > CONTENT_BOTTOM) y = addPage(doc, plan);
    drawSupplierHeader(doc, group.supplierLabel, group.products.length, y);
    y += 8 + CARD_GAP;

    for (let index = 0; index < group.products.length; index += 3) {
      if (y + CARD_HEIGHT > CONTENT_BOTTOM) {
        y = addPage(doc, plan);
        drawSupplierHeader(doc, group.supplierLabel, group.products.length, y, true);
        y += 8 + CARD_GAP;
      }
      for (const [column, product] of group.products.slice(index, index + 3).entries()) {
        drawProductCard(
          doc,
          product,
          product.imageUrl ? (imageCache.get(product.imageUrl) ?? null) : null,
          PAGE_MARGIN + (column * (CARD_WIDTH + CARD_GAP)),
          y,
        );
      }
      y += CARD_HEIGHT + CARD_GAP;
    }
    y += 2;
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(170, 170, 170);
    doc.setLineWidth(0.2);
    doc.line(PAGE_MARGIN, PAGE_HEIGHT - 12, PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 12);
    doc.setTextColor(90, 90, 90);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text('CH Ultimate · Katalog rekomendasi lokal', PAGE_MARGIN, PAGE_HEIGHT - 7);
    doc.text(`Halaman ${page} / ${pages}`, PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 7, { align: 'right' });
  }

  return doc.output('blob');
}
