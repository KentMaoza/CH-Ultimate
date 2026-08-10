import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';

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

async function pdfStreams(blob: Blob): Promise<string> {
  const bytes = Buffer.from(await blob.arrayBuffer());
  const raw = bytes.toString('latin1');
  const content = [raw];
  let cursor = 0;
  while (true) {
    const marker = raw.indexOf('stream\n', cursor);
    if (marker < 0) break;
    const start = marker + 'stream\n'.length;
    const end = raw.indexOf('\nendstream', start);
    if (end < 0) break;
    const dictionaryStart = raw.lastIndexOf('<<', marker);
    const dictionary = raw.slice(dictionaryStart, marker);
    if (dictionary.includes('/FlateDecode')) {
      try {
        content.push(inflateSync(bytes.subarray(start, end)).toString('latin1'));
      } catch {
        // Ignore image streams or unsupported filters; text streams remain readable.
      }
    }
    cursor = end + '\nendstream'.length;
  }
  return content.join('\n');
}

async function pdfPageCount(blob: Blob): Promise<number> {
  const raw = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  return raw.match(/\/Type \/Page\b/g)?.length ?? 0;
}

function pdfTextBaseline(content: string, token: string): number {
  const tokenIndex = content.indexOf(token);
  const before = content.slice(Math.max(0, tokenIndex - 240), tokenIndex);
  const positions = [...before.matchAll(/[-\d.]+\s+(-?[\d.]+)\s+Td/g)];
  return Number(positions.at(-1)?.[1]);
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

it('formats every XLSX sheet for readable warehouse use', async () => {
  const bytes = await createOperationalWorkbookBuffer(largeState(), {
    query: '', from: '', to: '', status: 'active',
  }, '2026-08-04');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);

  const summary = workbook.getWorksheet('Ringkasan')!;
  expect(summary.getColumn('A').width).toBeGreaterThanOrEqual(30);
  expect(summary.getColumn('B').width).toBeGreaterThanOrEqual(22);
  expect(summary.getCell('A1').font.bold).toBe(true);
  expect(summary.getCell('A7').font.bold).toBe(true);

  const expectedWidths: Record<string, number[]> = {
    SKU_Stok: [28, 42, 14, 18, 12, 15, 48, 34, 18, 24],
    Riwayat_Stok: [24, 28, 42, 18, 14, 16, 14],
    Riwayat_Harga: [24, 28, 42, 18, 18, 18],
    Cek_Stok: [24, 24, 28, 42, 14, 14, 16, 14, 16, 24, 48],
  };

  for (const [sheetName, widths] of Object.entries(expectedWidths)) {
    const sheet = workbook.getWorksheet(sheetName)!;
    expect(sheet.columns.map((column) => column.width)).toEqual(widths);
    expect(sheet.getRow(1).font.bold).toBe(true);
    expect(sheet.getRow(1).height).toBeGreaterThanOrEqual(24);
    if (sheet.rowCount > 1) {
      expect(sheet.getRow(2).getCell(1).alignment).toMatchObject({ vertical: 'top', wrapText: true });
    }
  }
  expect(workbook.getWorksheet('SKU_Stok')!.getColumn('D').numFmt).toBe('#,##0');
  expect(workbook.getWorksheet('SKU_Stok')!.getColumn('E').numFmt).toBe('#,##0');
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

it('preserves long image references, hashes, and stock-check notes in PDF continuation lines', async () => {
  const state = createInitialState();
  state.skus[0] = {
    ...state.skus[0]!,
    sourceImageUrl:
      `https://example.test/${'reference-segment-'.repeat(110)}REFERENCE-END`,
    imageHash: `${'a'.repeat(56)}deadbeef`,
  };
  state.stockChecks = [{
    id: 'check-long',
    skuId: state.skus[0]!.id,
    observedQuantityPcs: 12,
    countedQuantityPcs: 12,
    serverQuantityBeforePcs: 12,
    appliedDeltaPcs: 0,
    forcedOffline: false,
    countedAt: '2026-08-04T01:00:00.000Z',
    appliedAt: '2026-08-04T01:00:01.000Z',
    deviceId: 'device-1',
    deviceDisplayName: 'Perangkat Gudang',
    note: `${'catatan-panjang '.repeat(24)}NOTE-END`,
  }];
  const filters = { query: '', from: '', to: '', status: 'active' as const };

  const skuBlob = await createOperationalPdfBlob(
    buildOperationalPdfPlan(state, 'sku-stock', filters, '2026-08-04'),
  );
  const skuText = await pdfStreams(skuBlob);
  const checkText = await pdfStreams(await createOperationalPdfBlob(
    buildOperationalPdfPlan(state, 'stock-checks', filters, '2026-08-04'),
  ));

  expect(skuText).toContain('CHU');
  expect(skuText).toContain('REFERENCE-END');
  expect(skuText).toContain('deadbeef');
  expect(checkText).toContain('NOTE-END');
  expect(await pdfPageCount(skuBlob)).toBeGreaterThan(1);
  expect(pdfTextBaseline(skuText, 'REFERENCE-END')).toBeGreaterThan(
    8 * 72 / 25.4,
  );
});

it('uses deterministic wrapped row heights to paginate long operational values', async () => {
  const base = createInitialState();
  const checks = Array.from({ length: 24 }, (_, index) => ({
    id: `check-${String(index).padStart(2, '0')}`,
    skuId: base.skus[0]!.id,
    observedQuantityPcs: 12,
    countedQuantityPcs: 12,
    serverQuantityBeforePcs: 12,
    appliedDeltaPcs: 0,
    forcedOffline: false,
    countedAt: `2026-08-04T01:${String(index).padStart(2, '0')}:00.000Z`,
    appliedAt: `2026-08-04T01:${String(index).padStart(2, '0')}:01.000Z`,
    deviceId: `device-${index}`,
    deviceDisplayName: 'Perangkat Gudang',
    note: '',
  }));
  const filters = { query: '', from: '', to: '', status: 'active' as const };
  const shortPlan = buildOperationalPdfPlan(
    { ...base, stockChecks: checks },
    'stock-checks',
    filters,
    '2026-08-04',
  );
  const longPlan = buildOperationalPdfPlan(
    {
      ...base,
      stockChecks: checks.map((check) => ({
        ...check,
        note: `${'detail hitung stok '.repeat(28)}ROW-END-${check.id}`,
      })),
    },
    'stock-checks',
    filters,
    '2026-08-04',
  );

  const shortPages = await pdfPageCount(await createOperationalPdfBlob(shortPlan));
  const longBlob = await createOperationalPdfBlob(longPlan);
  const longPages = await pdfPageCount(longBlob);

  expect(shortPages).toBe(1);
  expect(longPages).toBeGreaterThan(shortPages);
  expect(await pdfStreams(longBlob)).toContain('ROW-END-check-00');
});
