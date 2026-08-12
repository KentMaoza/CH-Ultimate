import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import type { ChOutputBridge } from '../../src/electron/output-contract';
import { createInitialState } from '../../src/domain/operations';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { App } from '../../src/renderer/App';

function outputBridge() {
  const rendered: string[] = [];
  const printDocument = vi.fn(async () => {
    rendered.push(screen.getByTestId('print-document-host').textContent ?? '');
    return { status: 'printed' as const };
  });
  const savePdf = vi.fn(async () => {
    rendered.push(screen.getByTestId('print-document-host').textContent ?? '');
    return { status: 'saved' as const };
  });
  const saveSpreadsheet = vi.fn(async () => ({ status: 'saved' as const }));
  return {
    bridge: { printDocument, savePdf, saveSpreadsheet } satisfies ChOutputBridge,
    printDocument,
    rendered,
    savePdf,
  };
}

test('Nota defaults to current page, can select all active pages, and has print/PDF parity', async () => {
  const output = outputBridge();
  render(<App gateway={new MockOperationsGateway()} outputBridge={output.bridge} />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));

  expect(screen.getByLabelText('Ruang cetak Nota')).toHaveValue('current');
  fireEvent.click(screen.getByRole('button', { name: 'Print Nota' }));
  await waitFor(() => expect(output.printDocument).toHaveBeenCalledWith({
    kind: 'nota', widthMm: 210, heightMm: 148,
  }));
  expect(output.rendered[0]).toContain('DRAF');
  expect(output.rendered[0]).toContain('Nota A');
  expect(output.rendered[0]).not.toContain('Nota B');

  fireEvent.change(screen.getByLabelText('Ruang cetak Nota'), { target: { value: 'all' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan PDF Nota' }));
  await waitFor(() => expect(output.savePdf).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'nota', widthMm: 210, heightMm: 148,
  })));
  expect(output.rendered[1]).toContain('Nota A');
  expect(output.rendered[1]).toContain('Nota B');
});

test('invoice uses the selected transaction page and supports matching print and PDF', async () => {
  const output = outputBridge();
  render(<App gateway={new MockOperationsGateway()} outputBridge={output.bridge} />);
  fireEvent.click(screen.getByRole('button', { name: 'Template Label & Invoice' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Invoice' }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview Nota B' }));

  fireEvent.click(screen.getByRole('button', { name: 'Print invoice' }));
  await waitFor(() => expect(output.printDocument).toHaveBeenCalledWith({
    kind: 'invoice', widthMm: 210, heightMm: 148,
  }));
  expect(output.rendered[0]).toContain('Nota B');

  fireEvent.click(screen.getByRole('button', { name: 'Simpan PDF invoice' }));
  await waitFor(() => expect(output.savePdf).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'invoice', widthMm: 210, heightMm: 148,
  })));
  expect(output.rendered[1]).toBe(output.rendered[0]);
});

test('label output uses chosen template, SKU, and exact quantity', async () => {
  const output = outputBridge();
  render(<App gateway={new MockOperationsGateway()} outputBridge={output.bridge} />);
  fireEvent.click(screen.getByRole('button', { name: 'Template Label & Invoice' }));
  fireEvent.change(screen.getByLabelText('Jumlah print'), { target: { value: '3' } });

  fireEvent.click(screen.getByRole('button', { name: 'Print label' }));
  await waitFor(() => expect(output.printDocument).toHaveBeenCalledWith({
    kind: 'label', widthMm: 54, heightMm: 34,
  }));
  expect((output.rendered[0]!.match(/BRS-108-BLK/g) ?? [])).toHaveLength(3);

  fireEvent.click(screen.getByRole('button', { name: 'Simpan PDF label' }));
  await waitFor(() => expect(output.savePdf).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'label', widthMm: 54, heightMm: 34,
  })));
});

test('warehouse barcode uses the trusted bridge for print and PDF with visible product code', async () => {
  const output = outputBridge();
  const longSkuNumber = `SKU-${'PANJANG-'.repeat(20)}CH049`;
  const gateway = new MockOperationsGateway(() => {
    const state = createInitialState();
    state.skus[0] = {
      ...state.skus[0]!,
      skuNumber: longSkuNumber,
      identifiers: [{
        id: 'product-code-identifier',
        skuId: state.skus[0]!.id,
        value: '87002109',
        kind: 'product_code',
        createdAt: '2026-08-12T00:00:00.000Z',
      }],
    };
    return state;
  });
  render(<App gateway={gateway} outputBridge={output.bridge} />);
  const row = screen.getByRole('row', { name: new RegExp(longSkuNumber) });
  fireEvent.click(within(row).getByRole('button', { name: `Print barcode ${longSkuNumber}` }));
  const dialog = screen.getByRole('dialog', { name: 'Print barcode produk' });
  expect(within(dialog).getByTestId('barcode-product-qr')).toHaveAttribute('data-value', '87002109');
  expect(within(dialog).getByText('Kode Produk: 87002109')).toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText('Jumlah barcode'), { target: { value: '2' } });

  fireEvent.click(within(dialog).getByRole('button', { name: 'Print barcode sekarang' }));
  await waitFor(() => expect(output.printDocument).toHaveBeenCalledWith({
    kind: 'barcode', widthMm: 54, heightMm: 34,
  }));
  expect((output.rendered[0]!.match(/Kode Produk: 87002109/g) ?? [])).toHaveLength(2);

  fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan PDF barcode' }));
  await waitFor(() => expect(output.savePdf).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'barcode', widthMm: 54, heightMm: 34,
  })));
});

test('completed archive Nota prints current or all active pages without a DRAF marker', async () => {
  const output = outputBridge();
  const gateway = new MockOperationsGateway();
  await gateway.completeNotaTransaction(gateway.getSnapshot().notaTransactions[0]!.id);
  render(<App gateway={gateway} outputBridge={output.bridge} />);
  fireEvent.click(screen.getByRole('button', { name: 'Arsip Nota' }));

  expect(screen.getByLabelText('Ruang cetak arsip Nota')).toHaveValue('current');
  fireEvent.click(screen.getByRole('button', { name: 'Print arsip Nota' }));
  await waitFor(() => expect(output.printDocument).toHaveBeenCalledWith({
    kind: 'nota', widthMm: 210, heightMm: 148,
  }));
  expect(output.rendered[0]).not.toContain('DRAF');
  expect(output.rendered[0]).toContain('Nota A');
  expect(output.rendered[0]).not.toContain('Nota B');

  fireEvent.change(screen.getByLabelText('Ruang cetak arsip Nota'), { target: { value: 'all' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan PDF arsip Nota' }));
  await waitFor(() => expect(output.savePdf).toHaveBeenCalledWith(expect.objectContaining({ kind: 'nota' })));
  expect(output.rendered[1]).toContain('Nota A');
  expect(output.rendered[1]).toContain('Nota B');
});
