import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createDraftNotaTransaction } from '../../src/domain/nota';
import {
  buildBarcodeDocumentPlan,
  buildLabelDocumentPlan,
  buildNotaDocumentPlan,
} from '../../src/domain/output-documents';
import { createInitialState } from '../../src/domain/operations';
import type { ChOutputBridge } from '../../src/electron/output-contract';
import {
  OutputProvider,
  useOutput,
  waitForHostReady,
} from '../../src/renderer/output-context';
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

test('trusted host defines the exact logical page size for the native print pipeline', () => {
  const plan = notaPlan();
  const { rerender } = render(<PrintDocumentHost plan={plan} />);

  expect(screen.getByTestId('output-page-style')).toHaveTextContent(
    `@page { size: ${plan.widthMm}mm ${plan.heightMm}mm; margin: 0; }`,
  );

  const state = createInitialState();
  const a4Plan = buildLabelDocumentPlan(state.skus[0]!, {
    ...state.labelTemplate,
    medium: 'a4',
  }, 1);
  rerender(<PrintDocumentHost plan={a4Plan} />);
  expect(screen.getByTestId('output-page-style')).toHaveTextContent(
    '@page { size: 210mm 297mm; margin: 0; }',
  );
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
  const qrCodes = screen.getAllByTestId('output-product-qr');
  expect(qrCodes).toHaveLength(2);
  expect(qrCodes[0]).toHaveStyle({
    width: '18mm',
    height: '18mm',
    flexShrink: '0',
  });
  const pages = screen.getAllByTestId('output-label-page');
  expect(pages).toHaveLength(2);
  for (const page of pages) {
    expect(page).toHaveStyle({ width: '54mm', minHeight: '34mm', padding: '2mm' });
    const card = page.querySelector('.output-document__product-card');
    expect(card).toHaveClass('output-document__product-card--with-qr');
    expect(card).toHaveStyle({
      width: '50mm',
      height: '30mm',
    });
  }
});

test('printed product label keeps its QR at a scannable physical size', () => {
  const state = createInitialState();
  const plan = buildLabelDocumentPlan(state.skus[0]!, state.labelTemplate, 1);
  render(<PrintDocumentHost plan={plan} />);

  expect(screen.getByTestId('output-product-qr')).toHaveStyle({
    width: '15mm',
    height: '15mm',
    flexShrink: '0',
  });
});

test('minimum product label uses a fixed card and fitted copy without shrinking its QR', () => {
  const state = createInitialState();
  const plan = buildLabelDocumentPlan(state.skus[0]!, {
    ...state.labelTemplate,
    widthMm: 20,
    heightMm: 15,
    fontSize: 24,
    fields: ['qr', 'chu', 'name', 'sku', 'price'],
  }, 1);
  render(<PrintDocumentHost plan={plan} />);

  expect(screen.getByTestId('output-product-card')).toHaveStyle({
    width: '20mm',
    height: '15mm',
    fontSize: '9px',
  });
  expect(screen.getByTestId('output-product-qr')).toHaveStyle({
    width: '8mm',
    height: '8mm',
    flexShrink: '0',
  });
  expect(screen.getByTestId('output-product-copy')).toHaveClass('output-document__product-copy');
});

test('minimum barcode uses a fixed card without shrinking its QR', () => {
  const state = createInitialState();
  const plan = buildBarcodeDocumentPlan(state.skus[0]!, {
    ...state.labelTemplate,
    widthMm: 20,
    heightMm: 15,
    fontSize: 24,
  }, 1);
  render(<PrintDocumentHost plan={plan} />);

  expect(screen.getByTestId('output-product-card')).toHaveStyle({
    width: '20mm',
    height: '15mm',
  });
  expect(screen.getByTestId('output-product-qr')).toHaveStyle({
    width: '8mm',
    height: '8mm',
    flexShrink: '0',
  });
});

function OutputHarness({ plan }: { plan: ReturnType<typeof notaPlan> }) {
  const output = useOutput();
  return <>
    <button onClick={() => void output.print(plan)}>Print</button>
    <button onClick={() => void output.savePdf(plan)}>PDF</button>
  </>;
}

function OutputLifecycleHarness({
  first,
  second,
}: {
  first: ReturnType<typeof notaPlan>;
  second: ReturnType<typeof notaPlan>;
}) {
  const output = useOutput();
  return <>
    <button disabled={output.busy} onClick={() => void output.print(first)}>Print A</button>
    <button disabled={output.busy} onClick={() => void output.print(second)}>Print B</button>
    <button disabled={output.busy} onClick={() => void output.savePdf(first)}>PDF A</button>
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
  const bridge: ChOutputBridge = {
    printDocument,
    savePdf,
    saveSpreadsheet: vi.fn(async () => ({ status: 'saved' as const })),
  };
  render(<OutputProvider bridge={bridge}>
    <OutputHarness plan={plan} />
  </OutputProvider>);

  fireEvent.click(screen.getByRole('button', { name: 'Print' }));
  await waitFor(() => expect(printDocument).toHaveBeenCalledWith({
    kind: 'nota', widthMm: plan.widthMm, heightMm: plan.heightMm,
  }));
  await waitFor(() => expect(screen.queryByTestId('print-document-host')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
  await waitFor(() => expect(savePdf).toHaveBeenCalledWith({
    kind: 'nota', widthMm: plan.widthMm, heightMm: plan.heightMm,
    fileName: plan.fileName,
  }));
});

test('native print keeps its host and output lock until the Electron bridge resolves', async () => {
  const first = notaPlan();
  const second = {
    ...notaPlan(),
    customerName: 'Budi',
    pages: notaPlan().pages.map((page) => ({
      ...page,
      rows: page.rows.map((row) => ({
        ...row,
        line: { ...row.line, description: 'Kopi Arabika' },
      })),
    })),
  };
  let releasePrint!: () => void;
  const printDocument = vi.fn()
    .mockImplementationOnce(() => new Promise<{ status: 'printed' }>((resolve) => {
      releasePrint = () => resolve({ status: 'printed' });
    }))
    .mockResolvedValue({ status: 'printed' as const });
  const bridge: ChOutputBridge = {
    printDocument,
    savePdf: vi.fn().mockResolvedValue({ status: 'saved' as const }),
    saveSpreadsheet: vi.fn().mockResolvedValue({ status: 'saved' as const }),
  };
  render(<OutputProvider bridge={bridge}>
    <OutputLifecycleHarness first={first} second={second} />
  </OutputProvider>);

  fireEvent.click(screen.getByRole('button', { name: 'Print A' }));
  await waitFor(() => expect(printDocument).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('print-document-host')).toHaveTextContent('Beras Hitam');
  expect(screen.getByRole('button', { name: 'Print B' })).toBeDisabled();

  releasePrint();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Print B' })).toBeEnabled());
  expect(screen.queryByTestId('print-document-host')).not.toBeInTheDocument();
});

test('save PDF removes its trusted host immediately instead of retaining a large document tree', async () => {
  const plan = notaPlan();
  const savePdf = vi.fn().mockResolvedValue({ status: 'saved' as const });
  const bridge: ChOutputBridge = {
    printDocument: vi.fn().mockResolvedValue({ status: 'printed' as const }),
    savePdf,
    saveSpreadsheet: vi.fn().mockResolvedValue({ status: 'saved' as const }),
  };
  render(<OutputProvider bridge={bridge}>
    <OutputLifecycleHarness first={plan} second={plan} />
  </OutputProvider>);

  fireEvent.click(screen.getByRole('button', { name: 'PDF A' }));

  await waitFor(() => expect(savePdf).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.queryByTestId('print-document-host')).not.toBeInTheDocument());
});

test('output readiness waits for a concurrently rendered trusted host', async () => {
  const waiting = waitForHostReady();
  const host = document.createElement('div');
  host.dataset.testid = 'print-document-host';
  window.setTimeout(() => document.body.append(host), 25);

  await expect(waiting).resolves.toBeUndefined();
  host.remove();
});

test('print CSS exposes only the trusted output host, not the interactive barcode preview', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8');
  expect(css).not.toContain('.barcode-print-sheet, .barcode-print-sheet * { visibility: visible !important; }');
  expect(css).toContain('.print-document-host, .print-document-host * { visibility: visible !important; }');
  expect(css).toContain('.output-document__page:last-child { break-after: auto; }');
  expect(css).toContain('#root > :not(.print-document-host) { display: none !important; }');
  expect(css).toContain('body { min-width: 0; min-height: 0; }');
  expect(css).toContain('white-space: nowrap;');
});
