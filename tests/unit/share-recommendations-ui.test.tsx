import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createInitialState } from '../../src/domain/operations';
import type { Sku } from '../../src/domain/types';
import type { ChOutputBridge, SaveGeneratedPdfRequest } from '../../src/electron/output-contract';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { App } from '../../src/renderer/App';

function coreGateway() {
  const gateway = new MockOperationsGateway(createRecommendationState);
  gateway.getSyncSnapshot = () => ({
    phase: 'online',
    trustedV2Bootstrap: true,
    serverRevision: '1',
    pendingCount: 0,
    conflictCount: 0,
  });
  return gateway;
}

async function pdfSource(blob: Blob): Promise<string> {
  return Buffer.from(await blob.arrayBuffer()).toString('latin1');
}

function outputBridge(
  saveGeneratedPdf: (input: SaveGeneratedPdfRequest) => Promise<{ status: 'saved' | 'cancelled' }>,
): ChOutputBridge {
  return {
    printDocument: async () => ({ status: 'printed' }),
    savePdf: async () => ({ status: 'saved' }),
    saveGeneratedPdf,
    saveSpreadsheet: async () => ({ status: 'saved' }),
  };
}

function sku(id: string, name: string, createdAt: string, stock = 1): Sku {
  return { id, skuNumber: `SKU-${id}`, aliases: [], identifiers: [], name, referencePrice: 25_000, stock, tracked: true, note: '', imageUrl: '', createdAt, archived: false };
}

function createRecommendationState() {
  return {
    ...createInitialState(),
    skus: [
      sku('old', 'Kemeja Lama CH009', '2025-01-10T00:00:00.000Z', 4),
      sku('same', 'Rok Lama CH009', '2025-06-10T00:00:00.000Z', 2),
      sku('new', 'Baju Baru CH010', '2026-06-10T00:00:00.000Z', 8),
    ],
    priceChanges: [
      { id: 'price-new', skuId: 'new', before: 20_000, after: 25_000, createdAt: '2026-07-22T02:00:00.000Z', source: 'manual' as const },
    ],
    adjustments: [
      { id: 'stock-same', skuId: 'same', quantity: 2, before: 0, after: 2, createdAt: '2026-07-22T03:00:00.000Z', source: 'manual' as const },
    ],
    notaTransactions: [],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-23T04:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test('shows daily share recommendations grouped by supplier and a separate urgent section', () => {
  render(<App gateway={new MockOperationsGateway(createRecommendationState)} />);

  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  expect(screen.getByRole('heading', { name: 'Rekomendasi Share', level: 1 })).toBeInTheDocument();
  expect(screen.getByLabelText('Tanggal rekomendasi')).toHaveValue('2026-07-23');
  expect(screen.getByRole('button', { name: 'Download PDF Harian' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Bagikan SKU / })).not.toBeInTheDocument();
  expect(screen.getByText('3 dari 3 SKU dipilih untuk hari ini')).toBeInTheDocument();
  expect(screen.getByText('Rotasi harga baru, restock, stok lama, dan supplier.')).toBeInTheDocument();
  expect(screen.getByText('Harga diperbarui')).toBeInTheDocument();
  expect(screen.getByText('Baru Restock')).toBeInTheDocument();
  const group = screen.getByRole('region', { name: 'Grup supplier CH009' });
  expect(within(group).getByText('Kemeja Lama CH009')).toBeInTheDocument();
  expect(within(group).getByText('Rok Lama CH009')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'SKU Urgent' }));
  expect(screen.getByText('2 dari 2 SKU urgent dimasukkan ke PDF')).toBeInTheDocument();
  expect(screen.getByText('Kemeja Lama CH009')).toBeInTheDocument();
  expect(screen.getByText('Rok Lama CH009')).toBeInTheDocument();
  expect(screen.queryByText('Baju Baru CH010')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download PDF Urgent' })).toBeInTheDocument();
});

test('saves one PDF for the active recommendation tab through the native output bridge', async () => {
  const saveGeneratedPdf = vi.fn(async (_request: SaveGeneratedPdfRequest) => ({ status: 'saved' as const }));
  render(<App gateway={new MockOperationsGateway(createRecommendationState)} outputBridge={outputBridge(saveGeneratedPdf)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  vi.useRealTimers();

  fireEvent.click(screen.getByRole('tab', { name: 'SKU Urgent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF Urgent' }));

  await waitFor(() => expect(saveGeneratedPdf).toHaveBeenCalledOnce());
  const request = saveGeneratedPdf.mock.calls[0]?.[0];
  expect(request?.fileName).toBe('CHU-SKU-Urgent-2026-07-23.pdf');
  expect(String.fromCharCode(...(request?.bytes.slice(0, 4) ?? []))).toBe('%PDF');
  expect(await screen.findByRole('status')).toHaveTextContent('PDF SKU Urgent berhasil disimpan.');
});

test('does not report success when the native PDF save dialog is cancelled', async () => {
  const saveGeneratedPdf = vi.fn(async (_request: SaveGeneratedPdfRequest) => ({ status: 'cancelled' as const }));
  render(<App gateway={new MockOperationsGateway(createRecommendationState)} outputBridge={outputBridge(saveGeneratedPdf)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  vi.useRealTimers();

  fireEvent.click(screen.getByRole('button', { name: 'Download PDF Harian' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Penyimpanan PDF dibatalkan.');
  expect(screen.queryByText(/berhasil diunduh/i)).not.toBeInTheDocument();
});

test('core-backed desktop download embeds an operational source label instead of demo copy', async () => {
  let savedRequest: SaveGeneratedPdfRequest | undefined;
  const saveGeneratedPdf = vi.fn(async (request: SaveGeneratedPdfRequest) => {
    savedRequest = request;
    return { status: 'saved' as const };
  });
  render(<App gateway={coreGateway()} coreBacked outputBridge={outputBridge(saveGeneratedPdf)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  vi.useRealTimers();

  fireEvent.click(screen.getByRole('button', { name: 'Download PDF Harian' }));

  await waitFor(() => expect(savedRequest).toBeDefined());
  const source = Buffer.from(savedRequest!.bytes).toString('latin1');
  expect(source).toContain('CH CORE');
  expect(source).not.toContain('DATA DEMO');
});
