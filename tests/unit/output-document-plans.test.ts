import { describe, expect, it } from 'vitest';

import { createDraftNotaTransaction } from '../../src/domain/nota';
import {
  buildBarcodeDocumentPlan,
  buildLabelDocumentPlan,
  buildNotaDocumentPlan,
} from '../../src/domain/output-documents';
import { createInitialState } from '../../src/domain/operations';

function transactionFixture() {
  const transaction = createDraftNotaTransaction(7);
  transaction.baseNumber = 'CHU-20260804-0007';
  transaction.customerName = 'Amelia';
  transaction.customerPlace = 'Saibah';
  transaction.transactionDate = '2026-08-04';
  transaction.pages[0]!.id = 'page-a';
  transaction.pages[0]!.lines[0] = {
    id: 'line-a', description: 'Beras Hitam', kind: 'Pangan', quantity: 2,
    unit: 'pcs', pcsPrice: 42_000, lsnPrice: 504_000,
  };
  const pageB = structuredClone(transaction.pages[0]!);
  pageB.id = 'page-b';
  pageB.suffix = 'B';
  pageB.lines[0] = {
    id: 'line-b', description: 'Kemeja', kind: 'Fashion', quantity: 1,
    unit: 'pcs', pcsPrice: 185_000, lsnPrice: 2_220_000,
  };
  const pageC = structuredClone(pageB);
  pageC.id = 'page-c';
  pageC.suffix = 'C';
  pageC.status = 'cancelled';
  transaction.pages = [transaction.pages[0]!, pageB, pageC];
  transaction.nextNoteIndex = 3;
  return transaction;
}

describe('Nota and invoice document plans', () => {
  it('defaults to the current active page and shares invoice size, identity, and font', () => {
    const state = createInitialState();
    const plan = buildNotaDocumentPlan(
      transactionFixture(),
      { ...state.invoiceTemplate, widthMm: 190, heightMm: 120, fontSize: 16 },
      { kind: 'nota', scope: 'current', currentPageId: 'page-b' },
    );

    expect(plan).toMatchObject({
      kind: 'nota',
      widthMm: 190,
      heightMm: 120,
      fontSize: 16,
      marker: 'DRAF',
      fileName: 'CHU-Nota-CHU-20260804-0007-B.pdf',
      identity: {
        bankAccount: state.invoiceTemplate.bankAccount,
        address: state.invoiceTemplate.address,
        phone: state.invoiceTemplate.phone,
      },
    });
    expect(plan.pages.map((page) => page.suffix)).toEqual(['B']);
    expect(plan.pages[0]).toMatchObject({
      documentNumber: 'CHU-20260804-0007B',
      total: 185_000,
    });
  });

  it('selects all active pages deterministically and excludes cancelled pages', () => {
    const transaction = transactionFixture();
    transaction.status = 'reopened';
    const plan = buildNotaDocumentPlan(
      transaction,
      createInitialState().invoiceTemplate,
      { kind: 'invoice', scope: 'all', currentPageId: 'page-c' },
    );

    expect(plan.kind).toBe('invoice');
    expect(plan.marker).toBe('DRAF');
    expect(plan.pages.map((page) => page.suffix)).toEqual(['A', 'B']);
    expect(plan.fileName).toBe('CHU-Invoice-CHU-20260804-0007-Semua.pdf');
  });

  it('removes the draft marker from completed documents and refuses cancelled transactions', () => {
    const completed = transactionFixture();
    completed.status = 'completed';
    expect(buildNotaDocumentPlan(
      completed,
      createInitialState().invoiceTemplate,
      { kind: 'nota', scope: 'current', currentPageId: 'page-a' },
    ).marker).toBeNull();

    completed.status = 'cancelled';
    expect(() => buildNotaDocumentPlan(
      completed,
      createInitialState().invoiceTemplate,
      { kind: 'nota', scope: 'all' },
    )).toThrow('Transaksi yang dibatalkan tidak dapat dicetak.');
  });
});

describe('label and product-barcode plans', () => {
  it('honours thermal versus A4 layout and exact requested quantity', () => {
    const state = createInitialState();
    const sku = state.skus[0]!;
    const thermal = buildLabelDocumentPlan(sku, {
      ...state.labelTemplate,
      medium: 'thermal', widthMm: 50, heightMm: 30, columns: 1,
    }, 4);
    const a4 = buildLabelDocumentPlan(sku, {
      ...state.labelTemplate,
      medium: 'a4', widthMm: 60, heightMm: 35, columns: 3,
    }, 7);

    expect(thermal).toMatchObject({
      widthMm: 54,
      heightMm: 34,
      contentWidthMm: 50,
      contentHeightMm: 30,
      cardWidthMm: 50,
      cardHeightMm: 30,
      columns: 1,
      cardsPerPage: 1,
      pageCount: 4,
    });
    expect(thermal.cardWidthMm + (thermal.marginMm * 2)).toBeLessThanOrEqual(thermal.widthMm);
    expect(thermal.cardHeightMm + (thermal.marginMm * 2)).toBeLessThanOrEqual(thermal.heightMm);
    expect(thermal.items).toHaveLength(4);
    expect(a4).toMatchObject({
      widthMm: 210,
      heightMm: 297,
      contentWidthMm: 206,
      contentHeightMm: 293,
      columns: 3,
      cardsPerPage: 21,
      pageCount: 1,
    });
    expect(a4.items).toHaveLength(7);
  });

  it('always puts QR payload and human-readable Kode Produk on every barcode', () => {
    const state = createInitialState();
    const sku = state.skus[0]!;
    const plan = buildBarcodeDocumentPlan(sku, state.labelTemplate, 3);

    expect(plan.kind).toBe('barcode');
    expect(plan.items).toHaveLength(3);
    expect(plan.items).toEqual([
      { qrValue: 'BRS-108-BLK', productCode: 'BRS-108-BLK' },
      { qrValue: 'BRS-108-BLK', productCode: 'BRS-108-BLK' },
      { qrValue: 'BRS-108-BLK', productCode: 'BRS-108-BLK' },
    ]);
    expect(plan.fileName).toBe('CHU-Barcode-BRS-108-BLK-x3.pdf');
  });

  it('keeps barcode and label PDF file names valid for a maximum-length warehouse SKU', () => {
    const state = createInitialState();
    const sku = {
      ...state.skus[0]!,
      skuNumber: `SKU-${'PANJANG-'.repeat(24)}CH049`,
    };

    const barcode = buildBarcodeDocumentPlan(sku, state.labelTemplate, 1);
    const label = buildLabelDocumentPlan(sku, state.labelTemplate, 1);

    expect(barcode.fileName.length).toBeLessThanOrEqual(120);
    expect(barcode.fileName).toMatch(/^CHU-Barcode-.+-x1\.pdf$/);
    expect(label.fileName.length).toBeLessThanOrEqual(120);
    expect(label.fileName).toMatch(/^CHU-Label-.+-x1\.pdf$/);
  });

  it('rejects zero, fractional, and over-limit quantities', () => {
    const state = createInitialState();
    for (const quantity of [0, 1.5, 10_001]) {
      expect(() => buildLabelDocumentPlan(
        state.skus[0]!, state.labelTemplate, quantity,
      )).toThrow('Jumlah output tidak valid.');
    }
  });
});
