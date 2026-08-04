import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { createInitialState } from '../../src/domain/operations';
import {
  buildOperationalDatasetPlan,
  buildOperationalPdfPlan,
  createOperationalPdfBlob,
} from '../../src/domain/operational-exports';
import { createOperationalWorkbookBuffer } from '../../src/domain/operational-workbook';
import type { DemoState, Sku } from '../../src/domain/types';

function largeState(): DemoState {
  const state = createInitialState();
  const skus: Sku[] = Array.from({ length: 325 }, (_, index) => ({
    ...structuredClone(state.skus[0]!),
    id: `sku-${String(index).padStart(3, '0')}`,
    skuNumber: `SKU-${String(324 - index).padStart(3, '0')}`,
    name: `Barang ${String(index).padStart(3, '0')}`,
    stock: index,
    referencePrice: 10_000 + index,
    imageUrl: index === 0 ? 'data:image/png;base64,BINARY-MUST-NOT-EXPORT' : `https://img.example/${index}.jpg`,
    imageHash: `sha256-${index}`,
    createdAt: '2026-08-04T00:00:00.000Z',
  }));
  return { ...state, skus };
}

describe('operational export selectors', () => {
  it('keeps every matching row for XLSX while PDF reports and caps at 300', () => {
    const state = largeState();
    const all = buildOperationalDatasetPlan(state, 'sku-stock', {
      query: '', from: '', to: '', status: 'active',
    });
    const pdf = buildOperationalPdfPlan(state, 'sku-stock', {
      query: '', from: '', to: '', status: 'active',
    }, '2026-08-04');

    expect(all.rows).toHaveLength(325);
    expect(all.totalMatched).toBe(325);
    expect(pdf.rows).toHaveLength(300);
    expect(pdf.totalIncluded).toBe(300);
    expect(pdf.totalMatched).toBe(325);
    expect(pdf.fileName).toBe('CHU-Ekspor-SKU-Stok-2026-08-04.pdf');
    expect(pdf.rows[0]!.cells[0]).toBe('SKU-000');
    expect(pdf.rows.at(-1)!.cells[0]).toBe('SKU-299');
  });

  it('applies inclusive WITA dates at both UTC boundaries', () => {
    const state = createInitialState();
    state.adjustments = [
      ['before', '2026-08-03T15:59:59.000Z'],
      ['start', '2026-08-03T16:00:00.000Z'],
      ['end', '2026-08-04T15:59:59.000Z'],
      ['after', '2026-08-04T16:00:00.000Z'],
    ].map(([id, createdAt], index) => ({
      id, skuId: state.skus[0]!.id, quantity: 1, before: index,
      after: index + 1, createdAt, source: 'manual' as const,
    }));

    const plan = buildOperationalDatasetPlan(state, 'stock-history', {
      query: 'BRS-108', from: '2026-08-04', to: '2026-08-04', status: 'active',
    });
    expect(plan.rows.map((row) => row.id)).toEqual(['end', 'start']);
  });
});

it('creates a five-sheet XLSX with unlimited native integers and metadata-only images', async () => {
  const bytes = await createOperationalWorkbookBuffer(largeState(), {
    query: '', from: '', to: '', status: 'active',
  }, '2026-08-04');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);

  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    'Ringkasan', 'SKU_Stok', 'Riwayat_Stok', 'Riwayat_Harga', 'Cek_Stok',
  ]);
  const skuSheet = workbook.getWorksheet('SKU_Stok')!;
  expect(skuSheet.rowCount).toBe(326);
  expect(typeof skuSheet.getRow(2).getCell('D').value).toBe('number');
  expect(typeof skuSheet.getRow(2).getCell('E').value).toBe('number');
  const workbookValues: string[] = [];
  skuSheet.eachRow((row) => row.eachCell((cell) => {
    workbookValues.push(String(cell.value ?? ''));
  }));
  const workbookText = workbookValues.join('\n');
  expect(workbookText).not.toContain('BINARY-MUST-NOT-EXPORT');
  expect(workbookText).toContain('sha256-0');
  expect(workbookText).toContain('Biner dihilangkan');
});

it('creates a readable operational PDF blob with included-versus-matched metadata', async () => {
  const blob = await createOperationalPdfBlob(buildOperationalPdfPlan(
    createInitialState(),
    'sku-stock',
    { query: '', from: '', to: '', status: 'active' },
    '2026-08-04',
  ));
  expect(blob.type).toBe('application/pdf');
  expect(await blob.slice(0, 5).text()).toBe('%PDF-');
});
