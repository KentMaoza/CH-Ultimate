import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createInitialState } from '../../src/domain/operations';
import type { Sku } from '../../src/domain/types';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { App } from '../../src/renderer/App';

function sku(id: string, name: string, createdAt: string, stock = 1): Sku {
  return { id, skuNumber: `SKU-${id}`, aliases: [], name, referencePrice: 25_000, stock, tracked: true, note: '', imageUrl: '', createdAt, archived: false };
}

function createRecommendationState() {
  return {
    ...createInitialState(),
    skus: [
      sku('old', 'Kemeja Lama CH009', '2025-01-10T00:00:00.000Z', 4),
      sku('same', 'Rok Lama CH009', '2025-06-10T00:00:00.000Z', 2),
      sku('new', 'Baju Baru CH010', '2026-06-10T00:00:00.000Z', 8),
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
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'clipboard');
});

test('shows daily share recommendations grouped by supplier and a separate urgent section', () => {
  render(<App gateway={new MockOperationsGateway(createRecommendationState)} />);

  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  expect(screen.getByRole('heading', { name: 'Rekomendasi Share', level: 1 })).toBeInTheDocument();
  expect(screen.getByLabelText('Tanggal rekomendasi')).toHaveValue('2026-07-23');
  expect(screen.queryByRole('button', { name: /Ekspor PDF/i })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^Bagikan SKU / })).not.toHaveLength(0);
  expect(screen.getByText('3 dari 3 SKU dipilih untuk hari ini')).toBeInTheDocument();
  const group = screen.getByRole('region', { name: 'Grup supplier CH009' });
  expect(within(group).getByText('Kemeja Lama CH009')).toBeInTheDocument();
  expect(within(group).getByText('Rok Lama CH009')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('tab', { name: 'SKU Urgent' }));
  expect(screen.getByText('2 SKU tidak keluar lebih dari 8 bulan')).toBeInTheDocument();
  expect(screen.getByText('Kemeja Lama CH009')).toBeInTheDocument();
  expect(screen.getByText('Rok Lama CH009')).toBeInTheDocument();
  expect(screen.queryByText('Baju Baru CH010')).not.toBeInTheDocument();
});

test('shares only the selected SKU without stock', async () => {
  const share = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  render(<App gateway={new MockOperationsGateway(createRecommendationState)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  vi.useRealTimers();

  fireEvent.click(screen.getByRole('button', { name: 'Bagikan SKU Kemeja Lama CH009' }));

  await waitFor(() => expect(share).toHaveBeenCalledOnce());
  expect(share).toHaveBeenCalledWith({
    title: 'Kemeja Lama CH009',
    text: 'Kemeja Lama CH009\nSKU: SKU-old\nHarga referensi: Rp25.000',
  });
  expect(JSON.stringify(share.mock.calls)).not.toContain('Stok');
});

test('opens the in-app fallback and copies public SKU information when system share is unavailable', async () => {
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  render(<App gateway={new MockOperationsGateway(createRecommendationState)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  vi.useRealTimers();

  fireEvent.click(screen.getByRole('button', { name: 'Bagikan SKU Kemeja Lama CH009' }));

  const dialog = await screen.findByRole('dialog', { name: 'Bagikan SKU' });
  expect(within(dialog).getByText('Kemeja Lama CH009')).toBeInTheDocument();
  expect(within(dialog).queryByText(/Stok/i)).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Salin informasi' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(
    'Kemeja Lama CH009\nSKU: SKU-old\nHarga referensi: Rp25.000',
  ));
});
