import { beforeEach, expect, test, vi } from 'vitest';
import type { ShareRecommendationReport } from '../../src/domain/share-recommendations';

const pdfCapture = vi.hoisted(() => ({
  instances: [] as Array<{
    properties: Record<string, string>;
    splitTextCalls: Array<{ text: string; width: number }>;
    texts: string[];
  }>,
}));

vi.mock('jspdf', () => ({
  jsPDF: class FakeJsPdf {
    properties: Record<string, string> = {};
    splitTextCalls: Array<{ text: string; width: number }> = [];
    texts: string[] = [];

    constructor() {
      pdfCapture.instances.push(this);
    }

    setProperties(properties: Record<string, string>) { this.properties = properties; }
    splitTextToSize(text: string, width: number) {
      this.splitTextCalls.push({ text, width });
      return [text];
    }
    text(value: string | string[]) {
      this.texts.push(...(Array.isArray(value) ? value : [value]));
    }
    setFillColor() {}
    rect() {}
    setTextColor() {}
    setFont() {}
    setFontSize() {}
    setDrawColor() {}
    setLineWidth() {}
    line() {}
    getNumberOfPages() { return 1; }
    setPage() {}
    output() { return new Blob(['%PDF-1.3']); }
  },
}));

import {
  buildRecommendationPdfPlan,
  createRecommendationPdfBlob,
} from '../../src/domain/recommendation-pdf';

const report: ShareRecommendationReport = {
  date: '2026-08-10',
  daily: [],
  urgent: [],
  groups: [],
  totalEligible: 0,
};

beforeEach(() => {
  pdfCapture.instances.length = 0;
});

test.each([
  [true, 'CH CORE · DATA OPERASIONAL'],
  [false, 'DATA DEMO · SESSION ONLY'],
] as const)('renders the %s source label in the PDF header and Subject', async (coreBacked, expectedLabel) => {
  await createRecommendationPdfBlob(
    buildRecommendationPdfPlan(report, 'daily', coreBacked),
  );

  expect(pdfCapture.instances).toHaveLength(1);
  expect(pdfCapture.instances[0]?.texts).toContain(expectedLabel);
  expect(pdfCapture.instances[0]?.properties.subject).toBe(expectedLabel);
});

test('bounds the product identity to the recommendation card width', async () => {
  await createRecommendationPdfBlob({
    date: '2026-08-11',
    fileName: 'acceptance.pdf',
    groups: [{
      supplierLabel: 'CH002',
      products: [{
        id: 'long-identity',
        imageUrl: '',
        name: 'Tas bayi dengan nama cukup panjang',
        referencePrice: 84_000,
        skuNumber: 'BJT1073 Baby Joy Tas Medium Baby Moo Series-Coklat CH002',
      }],
    }],
    sourceLabel: 'CH CORE · DATA OPERASIONAL',
    title: 'Rekomendasi Harian',
    totalAvailable: 1,
    totalIncluded: 1,
  });

  expect(pdfCapture.instances[0]?.splitTextCalls).toContainEqual({
    text: 'BJT1073 Baby Joy Tas Medium Baby Moo Series-Coklat CH002',
    width: 54,
  });
});
