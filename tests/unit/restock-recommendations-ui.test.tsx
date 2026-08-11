import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { createInitialState } from '../../src/domain/operations';
import type { DemoState, NotaLine, NotaPosting, RevenuePosting, Sku } from '../../src/domain/types';
import type { ChOutputBridge } from '../../src/electron/output-contract';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { App } from '../../src/renderer/App';

function sku(id: string, name: string, stock: number): Sku {
  return {
    id,
    skuNumber: `SKU-${id.toUpperCase()}`,
    aliases: [],
    identifiers: [],
    name,
    referencePrice: 10_000,
    stock,
    tracked: true,
    note: '',
    imageUrl: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    archived: false,
  };
}

function sale(id: string, skuId: string, quantity: number, postedAt: string): {
  nota: NotaPosting;
  revenue: RevenuePosting;
} {
  const item: NotaLine = {
    id: `line-${id}`,
    skuId,
    description: `Barang ${skuId}`,
    kind: 'Uji',
    quantity,
    unit: 'pcs',
    pcsPrice: 10_000,
    lsnPrice: 120_000,
  };
  return {
    nota: {
      id: `posting-${id}`,
      notaId: `nota-${id}`,
      postingKind: 'complete',
      amountRupiah: quantity * 10_000,
      lines: [item],
      stockEffects: { [skuId]: -quantity },
      trackedLineIds: { [item.id]: skuId },
      lifecycleVersion: '2',
      postedAt,
    },
    revenue: {
      id: `revenue-${id}`,
      notaId: `nota-${id}`,
      notaPostingId: `posting-${id}`,
      amountRupiah: quantity * 10_000,
      postingKind: 'complete',
      postedAt,
    },
  };
}

function seed(): DemoState {
  const skus = [
    sku('a', 'Barang Alpha CH01', 0),
    sku('b', 'Barang Beta CH01', 50),
    sku('c', 'Barang Ceri CH02', 0),
    sku('d', 'Barang Durian CH02', 0),
    sku('e', 'Barang Ekstra CH03', 5),
  ];
  const sales = [
    sale('a', 'a', 20, '2026-08-10T00:00:00.000Z'),
    sale('b', 'b', 15, '2026-08-09T00:00:00.000Z'),
    sale('c', 'c', 5, '2026-08-07T00:00:00.000Z'),
    sale('d', 'd', 9, '2026-06-30T00:00:00.000Z'),
    sale('e', 'e', 1, '2026-08-06T00:00:00.000Z'),
  ];
  return {
    ...createInitialState(),
    skus,
    adjustments: skus.map((item) => ({
      id: `adjustment-${item.id}`,
      skuId: item.id,
      quantity: -10,
      before: 10,
      after: 0,
      createdAt: '2026-07-01T00:00:00.000Z',
      source: 'manual' as const,
    })),
    stockChecks: [],
    notaTransactions: [],
    notaPostings: sales.map((row) => row.nota),
    revenuePostings: sales.map((row) => row.revenue),
  };
}

function renderRestock(output?: ChOutputBridge) {
  const gateway = new MockOperationsGateway(seed);
  render(<App gateway={gateway} outputBridge={output} />);
  fireEvent.click(screen.getByRole('button', { name: 'Barang Kosong' }));
  return gateway;
}

test('shows explainable ranked recommendations including a top seller above low-stock range', () => {
  renderRestock();

  const recommendations = screen.getByTestId('restock-recommendations');
  expect(within(recommendations).getByRole('heading', { name: 'Rekomendasi Restock' })).toBeInTheDocument();
  expect(within(recommendations).getByText('Supplier CH01')).toBeInTheDocument();
  expect(within(recommendations).getByText('Supplier CH02')).toBeInTheDocument();
  expect(within(recommendations).getByText('Barang Beta CH01')).toBeInTheDocument();
  expect(within(recommendations).getByText('Stok saat ini mencukupi')).toBeInTheDocument();
  expect(within(recommendations).getAllByText('Laris dan cepat terjual').length).toBeGreaterThan(0);
  expect(within(recommendations).getAllByText('Lambat terjual').length).toBeGreaterThan(0);
  expect(within(recommendations).getByText('Terjual 20 pcs · 30 hari')).toBeInTheDocument();
  expect(within(recommendations).getByText('Terjual 9 pcs · 60 hari')).toBeInTheDocument();
  expect(within(recommendations).getByRole('button', { name: 'Masukkan SKU-B ke laporan' })).toBeEnabled();
});

test('adds, edits, filters, and removes recommendations without mutating warehouse stock', () => {
  const gateway = renderRestock();
  const stockBefore = gateway.getSnapshot().skus.map(({ id, stock }) => ({ id, stock }));

  fireEvent.click(screen.getByRole('button', { name: 'Masukkan SKU-A ke laporan' }));
  expect(screen.getByLabelText('Jumlah restock SKU-A')).toHaveValue('20');
  fireEvent.change(screen.getByLabelText('Jumlah restock SKU-A'), { target: { value: '12abc' } });
  expect(screen.getByLabelText('Jumlah restock SKU-A')).toHaveValue('12');

  fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'CH02' } });
  expect(screen.getByTestId('empty-report-preview')).not.toHaveTextContent('Barang Alpha CH01');
  expect(screen.getByText('1 dipilih di luar filter')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Masukkan semua rekomendasi hasil filter' }));
  expect(screen.getByTestId('empty-report-preview')).toHaveTextContent('Barang Ceri CH02');
  expect(screen.getByTestId('empty-report-preview')).toHaveTextContent('Barang Durian CH02');
  expect(screen.getByTestId('empty-report-preview')).not.toHaveTextContent('Barang Alpha CH01');

  fireEvent.click(screen.getByRole('button', { name: 'Keluarkan SKU-C dari laporan' }));
  expect(screen.getByTestId('empty-report-preview')).not.toHaveTextContent('Barang Ceri CH02');
  expect(gateway.getSnapshot().skus.map(({ id, stock }) => ({ id, stock }))).toEqual(stockBefore);

  fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'CH01' } });
  expect(screen.getByLabelText('Jumlah restock SKU-A')).toHaveValue('12');
});

test('saves the restricted recommendation PDF through the trusted desktop host', async () => {
  const hostText: string[] = [];
  const savePdf = vi.fn(async () => {
    hostText.push(screen.getByTestId('print-document-host').textContent ?? '');
    return { status: 'saved' as const };
  });
  const output: ChOutputBridge = {
    printDocument: vi.fn(async () => ({ status: 'printed' as const })),
    savePdf,
    saveSpreadsheet: vi.fn(async () => ({ status: 'saved' as const })),
  };
  renderRestock(output);
  fireEvent.click(screen.getByRole('button', { name: 'Masukkan SKU-A ke laporan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Simpan PDF rekomendasi restock' }));

  await waitFor(() => expect(savePdf).toHaveBeenCalledWith({
    kind: 'restock-recommendation',
    widthMm: 210,
    heightMm: 297,
    fileName: expect.stringMatching(/^CHU-Rekomendasi-Restock-.*\.pdf$/),
  }));
  expect(hostText[0]).toContain('Barang Alpha CH01');
  expect(hostText[0]).toContain('20 pcs');
  expect(hostText[0]).not.toContain('SKU-A');
  expect(hostText[0]).not.toContain('Stok saat ini');
  expect(await screen.findByRole('status')).toHaveTextContent(
    'PDF rekomendasi restock berhasil disimpan.',
  );
});
