import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { MobileApp } from '../../mobile/MobileApp';
import type { ChOutputBridge } from '../../src/electron/output-contract';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { App } from '../../src/renderer/App';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';

function mobilePorts(sharePdf = vi.fn(async () => undefined)) {
  return {
    scanner: { scan: async () => null },
    notifications: {
      ensurePermission: async () => 'denied' as const,
      notifyPriceChange: async () => undefined,
      listenForPriceChangeActions: async () => async () => undefined,
    },
    share: { sharePdf },
  };
}

test('desktop Ekspor Data applies filters, downloads five-sheet XLSX, and saves selected PDF', async () => {
  const printDocument = vi.fn(async () => ({ status: 'printed' as const }));
  const savePdf = vi.fn(async () => ({ status: 'saved' as const }));
  const saveGeneratedPdf = vi.fn(async (_input: { fileName: string; bytes: Uint8Array }) => (
    { status: 'saved' as const }
  ));
  const saveSpreadsheet = vi.fn(async () => ({ status: 'saved' as const }));
  const output: ChOutputBridge = {
    printDocument, savePdf, saveGeneratedPdf, saveSpreadsheet,
  };
  render(<App gateway={new MockOperationsGateway()} outputBridge={output} />);

  fireEvent.click(screen.getByRole('button', { name: 'Ekspor Data' }));
  expect(screen.getByRole('heading', { name: 'Ekspor Data', level: 1 })).toBeInTheDocument();
  expect(screen.getByLabelText('Dataset PDF')).toHaveValue('sku-stock');
  expect(screen.getByText('6 cocok · 6 masuk PDF')).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Cari data operasional'), { target: { value: 'BRS-108' } });
  expect(screen.getByText('1 cocok · 1 masuk PDF')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ekspor XLSX data operasional' }));
  await waitFor(() => expect(saveSpreadsheet).toHaveBeenCalledWith({
    fileName: expect.stringMatching(/^CHU-Ekspor-Data-\d{4}-\d{2}-\d{2}\.xlsx$/),
    bytes: expect.any(Uint8Array),
  }));
  expect(screen.getByRole('status')).toHaveTextContent('XLSX seluruh data cocok berhasil disimpan.');

  fireEvent.click(screen.getByRole('button', { name: 'Simpan PDF data operasional' }));
  await waitFor(() => expect(saveGeneratedPdf).toHaveBeenCalledWith({
    fileName: expect.stringMatching(/^CHU-Ekspor-SKU-Stok-\d{4}-\d{2}-\d{2}\.pdf$/),
    bytes: expect.any(Uint8Array),
  }));
  const bytes = saveGeneratedPdf.mock.calls[0]![0].bytes;
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  expect(savePdf).not.toHaveBeenCalled();
});

test('desktop keeps operational PDF failures generic while recording diagnostics', async () => {
  const failure = new Error('internal PDF detail');
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const output: ChOutputBridge = {
    printDocument: vi.fn(async () => ({ status: 'printed' as const })),
    savePdf: vi.fn(async () => ({ status: 'saved' as const })),
    saveGeneratedPdf: vi.fn(async () => { throw failure; }),
    saveSpreadsheet: vi.fn(async () => ({ status: 'saved' as const })),
  };
  render(<App gateway={new MockOperationsGateway()} outputBridge={output} />);

  fireEvent.click(screen.getByRole('button', { name: 'Ekspor Data' }));
  fireEvent.change(screen.getByLabelText('Cari data operasional'), { target: { value: 'BRS-108' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan PDF data operasional' }));

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
    'PDF data operasional belum dapat disimpan.',
  ));
  expect(screen.getByRole('status')).not.toHaveTextContent('internal PDF detail');
  expect(consoleError).toHaveBeenCalledWith(
    '[CH Ultimate] Ekspor PDF data operasional gagal.',
    failure,
  );
  consoleError.mockRestore();
});

test('mobile exposes operational PDF only from Lainnya and shares one selected dataset', async () => {
  const sharePdf = vi.fn(async () => undefined);
  const ports = mobilePorts(sharePdf);
  render(<MobileApp
    gateway={new MockOperationsGateway(createMobileDemoState)}
    scanner={ports.scanner}
    notifications={ports.notifications}
    share={ports.share}
  />);

  expect(screen.queryByRole('button', { name: 'Ekspor Data PDF' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Lainnya' }));
  fireEvent.click(screen.getByRole('button', { name: 'Ekspor Data PDF' }));
  expect(screen.getByRole('heading', { name: 'Ekspor Data', level: 1 })).toBeInTheDocument();
  expect(screen.getByLabelText('Dataset PDF mobile')).toHaveValue('sku-stock');

  fireEvent.change(screen.getByLabelText('Dataset PDF mobile'), { target: { value: 'price-history' } });
  fireEvent.click(screen.getByRole('button', { name: 'Bagikan PDF data operasional' }));
  await waitFor(() => expect(sharePdf).toHaveBeenCalledWith(expect.objectContaining({
    blob: expect.any(Blob),
    fileName: expect.stringMatching(/^CHU-Ekspor-Riwayat-Harga-.*\.pdf$/),
    title: 'Ekspor Data CHU',
  })));
});
