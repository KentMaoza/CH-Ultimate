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
});

test('shows daily share recommendations grouped by supplier and a separate urgent section', () => {
  render(<App gateway={new MockOperationsGateway(createRecommendationState)} />);

  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  expect(screen.getByRole('heading', { name: 'Rekomendasi Share', level: 1 })).toBeInTheDocument();
  expect(screen.getByLabelText('Tanggal rekomendasi')).toHaveValue('2026-07-23');
  expect(screen.getByRole('button', { name: 'Download PDF Harian' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Bagikan SKU / })).not.toBeInTheDocument();
  expect(screen.getByText('3 dari 3 SKU dipilih untuk hari ini')).toBeInTheDocument();
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

test('downloads one PDF for the active recommendation tab with a stable filename', async () => {
  let downloadedName = '';
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:recommendations');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    downloadedName = this.download;
  });
  render(<App gateway={new MockOperationsGateway(createRecommendationState)} />);
  fireEvent.click(screen.getByRole('button', { name: 'Rekomendasi Share' }));
  vi.useRealTimers();

  fireEvent.click(screen.getByRole('tab', { name: 'SKU Urgent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Download PDF Urgent' }));

  await waitFor(() => expect(createObjectURL).toHaveBeenCalledOnce());
  expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  expect(downloadedName).toBe('CHU-SKU-Urgent-2026-07-23.pdf');
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:recommendations');
  expect(await screen.findByRole('status')).toHaveTextContent('PDF SKU Urgent berhasil diunduh.');
});
