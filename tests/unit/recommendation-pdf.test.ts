import { expect, test, vi } from 'vitest';
import type { ShareRecommendationItem, ShareRecommendationReport } from '../../src/domain/share-recommendations';
import type { Sku } from '../../src/domain/types';
import {
  buildRecommendationPdfPlan,
  createRecommendationPdfBlob,
} from '../../src/domain/recommendation-pdf';

function recommendation(index: number, supplierCode: string | null = 'CH009'): ShareRecommendationItem {
  const sku: Sku = {
    id: `sku-${index}`,
    skuNumber: `SKU-${String(index).padStart(3, '0')}`,
    aliases: [],
    name: `Produk ${index}`,
    referencePrice: 10_000 + index,
    stock: 50 + index,
    tracked: true,
    note: `Catatan internal ${index}`,
    imageUrl: index % 2 === 0 ? `/assets/product-${index}.png` : '',
    createdAt: '2025-01-01T00:00:00.000Z',
    archived: false,
  };
  return {
    sku,
    supplierCode,
    lastOutAt: '2025-01-01T00:00:00.000Z',
    idleDays: 568,
    urgent: true,
    reasons: ['idle'],
  };
}

function report(items: ShareRecommendationItem[]): ShareRecommendationReport {
  return {
    date: '2026-07-23',
    daily: items.slice(0, 300),
    urgent: items,
    groups: [],
    totalEligible: items.length,
  };
}

test('builds a public daily catalogue plan without warehouse fields', () => {
  const plan = buildRecommendationPdfPlan(report([
    recommendation(1, 'CH009'),
    recommendation(2, null),
  ]), 'daily');

  expect(plan).toMatchObject({
    date: '2026-07-23',
    fileName: 'CHU-Rekomendasi-Harian-2026-07-23.pdf',
    title: 'Rekomendasi Harian',
    totalAvailable: 2,
    totalIncluded: 2,
    demoLabel: 'DATA DEMO · SESSION ONLY',
  });
  expect(plan.groups.map((group) => group.supplierLabel)).toEqual(['CH009', 'Tanpa kode supplier']);
  expect(plan.groups[0]?.products[0]).toEqual({
    id: 'sku-1',
    imageUrl: '',
    name: 'Produk 1',
    referencePrice: 10_001,
    skuNumber: 'SKU-001',
  });
  expect(JSON.stringify(plan)).not.toMatch(/stock|idleDays|lastOutAt|Catatan internal/i);
});

test('caps an urgent PDF at 300 products and reports the full urgent count', () => {
  const plan = buildRecommendationPdfPlan(
    report(Array.from({ length: 305 }, (_, index) => recommendation(index + 1))),
    'urgent',
  );

  expect(plan.title).toBe('SKU Urgent');
  expect(plan.fileName).toBe('CHU-SKU-Urgent-2026-07-23.pdf');
  expect(plan.totalAvailable).toBe(305);
  expect(plan.totalIncluded).toBe(300);
  expect(plan.groups[0]?.products).toHaveLength(300);
});

test('creates a local PDF blob and tolerates products without a usable image', async () => {
  const loadImageDataUrl = vi.fn(async () => null);
  const plan = buildRecommendationPdfPlan(report([
    recommendation(1),
    recommendation(2),
  ]), 'daily');

  const pdf = await createRecommendationPdfBlob(plan, { loadImageDataUrl });

  expect(pdf.type).toBe('application/pdf');
  expect(pdf.size).toBeGreaterThan(1_000);
  expect(loadImageDataUrl).toHaveBeenCalledOnce();
  expect(loadImageDataUrl).toHaveBeenCalledWith('/assets/product-2.png');
});

test('loads distinct product images concurrently before drawing the catalogue', async () => {
  const releases: Array<() => void> = [];
  const loadImageDataUrl = vi.fn(() => new Promise<null>((resolve) => {
    releases.push(() => resolve(null));
  }));
  const plan = buildRecommendationPdfPlan(report([
    recommendation(2),
    recommendation(4),
  ]), 'daily');

  const pdfPromise = createRecommendationPdfBlob(plan, { loadImageDataUrl });
  await vi.waitFor(() => expect(loadImageDataUrl).toHaveBeenCalled());
  const startedBeforeFirstImageFinished = loadImageDataUrl.mock.calls.length;
  releases[0]?.();
  await vi.waitFor(() => expect(loadImageDataUrl).toHaveBeenCalledTimes(2));
  releases[1]?.();
  await pdfPromise;

  expect(startedBeforeFirstImageFinished).toBe(2);
});
