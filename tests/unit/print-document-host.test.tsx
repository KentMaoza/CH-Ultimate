import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createDraftNotaTransaction } from '../../src/domain/nota';
import {
  buildBarcodeDocumentPlan,
  buildNotaDocumentPlan,
} from '../../src/domain/output-documents';
import { createInitialState } from '../../src/domain/operations';
import type { ChOutputBridge } from '../../src/electron/output-contract';
import { OutputProvider, useOutput } from '../../src/renderer/output-context';
import { PrintDocumentHost } from '../../src/renderer/output/PrintDocumentHost';

function notaPlan(status: 'draft' | 'completed' = 'draft') {
  const state = createInitialState();
  const transaction = createDraftNotaTransaction(1);
  transaction.baseNumber = 'CHU-20260804-0001';
  transaction.customerName = 'Amelia';
  transaction.customerPlace = 'Saibah';
  transaction.transactionDate = '2026-08-04';
  transaction.status = status;
  transaction.pages[0]!.lines[0] = {
    id: 'line-1', description: 'Beras Hitam', kind: 'Pangan', quantity: 2,
    unit: 'pcs', pcsPrice: 42_000, lsnPrice: 504_000,
  };
  return buildNotaDocumentPlan(transaction, {
    ...state.invoiceTemplate,
    address: 'Jl. Toko CH 1',
    phone: '0812-0000',
    bankAccount: 'BCA 123',
  }, { kind: 'nota', scope: 'all' });
}

test('trusted Nota host renders invoice identity, content, and a prominent draft marker', () => {
  render(<PrintDocumentHost plan={notaPlan()} />);

  const host = screen.getByTestId('print-document-host');
  expect(host).toHaveAttribute('data-document-kind', 'nota');
  expect(host).toHaveTextContent('DRAF');
  expect(host).toHaveTextContent('Jl. Toko CH 1');
  expect(host).toHaveTextContent('0812-0000');
  expect(host).toHaveTextContent('BCA 123');
  expect(host).toHaveTextContent('Beras Hitam');
  expect(host).toHaveTextContent('CHU-20260804-0001A');
});

test('completed host has no draft marker', () => {
  render(<PrintDocumentHost plan={notaPlan('completed')} />);
  expect(screen.queryByText('DRAF')).not.toBeInTheDocument();
});

test('trusted barcode host renders every QR with a human-readable Kode Produk', () => {
  const state = createInitialState();
  const plan = buildBarcodeDocumentPlan(state.skus[0]!, state.labelTemplate, 2);
  render(<PrintDocumentHost plan={plan} />);

  expect(screen.getAllByText('Kode Produk: BRS-108-BLK')).toHaveLength(2);
  expect(screen.getAllByTestId('output-product-qr')).toHaveLength(2);
  const pages = screen.getAllByTestId('output-label-page');
  expect(pages).toHaveLength(2);
  for (const page of pages) {
    expect(page).toHaveStyle({ width: '54mm', minHeight: '34mm', padding: '2mm' });
    expect(page.querySelector('.output-document__product-card')).toHaveStyle({
      width: '50mm',
      minHeight: '30mm',
    });
  }
});

function OutputHarness({ plan }: { plan: ReturnType<typeof notaPlan> }) {
  const output = useOutput();
  return <>
    <button onClick={() => void output.print(plan)}>Print</button>
    <button onClick={() => void output.savePdf(plan)}>PDF</button>
  </>;
}

test('output provider mounts trusted content before print and reuses it for PDF parity', async () => {
  const plan = notaPlan();
  const printDocument = vi.fn(async () => {
    expect(screen.getByTestId('print-document-host')).toHaveTextContent('Beras Hitam');
    return { status: 'printed' as const };
  });
  const savePdf = vi.fn(async () => {
    expect(screen.getByTestId('print-document-host')).toHaveTextContent('Beras Hitam');
    return { status: 'saved' as const };
  });
  const bridge: ChOutputBridge = { printDocument, savePdf };
  render(<OutputProvider bridge={bridge}><OutputHarness plan={plan} /></OutputProvider>);

  fireEvent.click(screen.getByRole('button', { name: 'Print' }));
  await waitFor(() => expect(printDocument).toHaveBeenCalledWith({
    kind: 'nota', widthMm: plan.widthMm, heightMm: plan.heightMm,
  }));
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
  await waitFor(() => expect(savePdf).toHaveBeenCalledWith({
    kind: 'nota', widthMm: plan.widthMm, heightMm: plan.heightMm,
    fileName: plan.fileName,
  }));
});

test('output provider keeps the trusted host mounted after print resolves for the Windows spooler', async () => {
  const plan = notaPlan();
  const printDocument = vi.fn().mockResolvedValue({ status: 'printed' as const });
  const bridge: ChOutputBridge = {
    printDocument,
    savePdf: vi.fn().mockResolvedValue({ status: 'saved' as const }),
  };
  render(<OutputProvider bridge={bridge}><OutputHarness plan={plan} /></OutputProvider>);

  fireEvent.click(screen.getByRole('button', { name: 'Print' }));

  await waitFor(() => expect(printDocument).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByTestId('print-document-host')).toHaveTextContent('Beras Hitam'));
});

test('print CSS exposes only the trusted output host, not the interactive barcode preview', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
  expect(css).not.toContain('.barcode-print-sheet, .barcode-print-sheet * { visibility: visible !important; }');
  expect(css).toContain('.print-document-host, .print-document-host * { visibility: visible !important; }');
});
