import { expect, test } from 'vitest';

import { createDraftNotaTransaction } from '../../src/domain/nota';
import {
  buildNotaDocumentLayout,
  buildNotaDocumentPlan,
} from '../../src/domain/output-documents';
import { createInitialState } from '../../src/domain/operations';
import { createNotaPdfBlob } from '../../src/domain/nota-pdf';

test('mobile Nota PDF is generated from the shared document plan', async () => {
  const state = createInitialState();
  const transaction = createDraftNotaTransaction(1);
  transaction.pages[0]!.lines[0] = {
    id: 'line-1', description: 'Beras Hitam', kind: 'Pangan', quantity: 2,
    unit: 'pcs', pcsPrice: 42_000, lsnPrice: 504_000,
  };
  const plan = buildNotaDocumentPlan(transaction, state.invoiceTemplate, {
    kind: 'nota', scope: 'current', currentPageId: transaction.pages[0]!.id,
  });

  const blob = await createNotaPdfBlob(plan);
  const pdfText = await blob.text();
  expect(blob.type).toBe('application/pdf');
  expect(await blob.slice(0, 5).text()).toBe('%PDF-');
  expect(pdfText).toContain('HARGA PCS');
  expect(pdfText).toContain('HARGA LSN');
  expect(pdfText).toContain('Total Nota');
  expect(pdfText).toContain('PPN 12%');
  expect(pdfText).toContain('Total Transaksi');
});

test('mobile Nota PDF preserves configured identity order and desktop table semantics', async () => {
  const state = createInitialState();
  const transaction = createDraftNotaTransaction(1);
  transaction.pages[0]!.lines[0] = {
    id: 'line-1', description: 'Beras Hitam', kind: 'Pangan', quantity: 2,
    unit: 'pcs', pcsPrice: 42_000, lsnPrice: 504_000,
  };
  const plan = buildNotaDocumentPlan(transaction, {
    ...state.invoiceTemplate,
    logoUrl: 'data:image/png;base64,configured-logo',
    address: 'Jl. Toko CH 1',
    phone: '0812-0000',
    bankAccount: 'BCA 123',
    elements: [
      { id: 'bank', visible: true },
      { id: 'phone', visible: false },
      { id: 'logo', visible: true },
      { id: 'address', visible: true },
    ],
  }, { kind: 'nota', scope: 'current' });

  const layout = buildNotaDocumentLayout(plan);

  expect(layout.identity).toEqual([
    { id: 'bank', text: 'BCA 123' },
    { id: 'logo', text: 'CHU', imageUrl: 'data:image/png;base64,configured-logo' },
    { id: 'address', text: 'Jl. Toko CH 1' },
  ]);
  expect(layout.columns.map((column) => column.label)).toEqual([
    'NO', 'NAMA BARANG', 'JENIS', 'JUMLAH', 'PCS/LSN',
    'HARGA PCS', 'HARGA LSN', 'TOTAL',
  ]);
  expect(layout.pages[0]!.rows[0]!.cells).toEqual({
    code: '1A', description: 'Beras Hitam', kind: 'Pangan', quantity: 2,
    unit: 'PCS', pcsPrice: 42_000, lsnPrice: 504_000, total: 84_000,
  });
  expect(layout.pages[0]!.totals).toEqual([
    { label: 'Total Nota', value: 75_000 },
    { label: 'PPN 12%', value: 9_000 },
    { label: 'Total Transaksi', value: 84_000 },
  ]);

  const pdfText = await (await createNotaPdfBlob(plan)).text();
  expect(pdfText).toContain('BCA 123');
  expect(pdfText).toContain('Jl. Toko CH 1');
  expect(pdfText).not.toContain('0812-0000');
  expect(pdfText.indexOf('BCA 123')).toBeLessThan(pdfText.indexOf('Jl. Toko CH 1'));
});
