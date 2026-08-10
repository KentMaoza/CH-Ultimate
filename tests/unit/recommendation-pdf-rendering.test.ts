import { beforeEach, expect, test, vi } from 'vitest';
import type { ShareRecommendationReport } from '../../src/domain/share-recommendations';

const pdfCapture = vi.hoisted(() => ({
  instances: [] as Array<{
    properties: Record<string, string>;
    texts: string[];
  }>,
}));

vi.mock('jspdf', () => ({
  jsPDF: class FakeJsPdf {
    properties: Record<string, string> = {};
    texts: string[] = [];

    constructor() {
      pdfCapture.instances.push(this);
    }

    setProperties(properties: Record<string, string>) { this.properties = properties; }
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
