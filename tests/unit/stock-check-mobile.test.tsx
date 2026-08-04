import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { MobileApp } from '../../mobile/MobileApp';
import type { BarcodeScannerPort } from '../../mobile/ports';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

const notifications = {
  ensurePermission: async () => 'denied' as const,
  notifyPriceChange: async () => undefined,
  listenForPriceChangeActions: async () => async () => undefined,
};
const share = { sharePdf: async () => undefined };

function stateWithPackageBarcode() {
  const state = createMobileDemoState();
  return {
    ...state,
    skus: state.skus.map((sku) => sku.id === 'sku-2' ? {
      ...sku,
      identifiers: [{
        id: 'package-mobile', skuId: sku.id, value: '899000020', kind: 'package_barcode' as const, createdAt: '',
      }],
    } : sku),
  };
}

test('mobile has exactly six nav items with visual Stok and accessible Cek Stok', () => {
  const gateway = new MockOperationsGateway(stateWithPackageBarcode);
  render(<MobileApp gateway={gateway} scanner={{ scan: async () => null }} notifications={notifications} share={share} />);

  const navigation = screen.getByRole('navigation', { name: 'Navigasi utama' });
  expect(within(navigation).getAllByRole('button')).toHaveLength(6);
  const stock = within(navigation).getByRole('button', { name: 'Cek Stok' });
  expect(stock).toHaveTextContent('Stok');
  expect(stock).toHaveAttribute('title', 'Cek Stok');

  fireEvent.click(stock);
  expect(screen.getByRole('heading', { name: 'Cek Stok', level: 1 })).toHaveFocus();
  expect(screen.getByRole('region', { name: 'Cek Stok' })).toHaveClass('stock-check--mobile');
});

test('mobile Cek Stok reuses the camera scanner and resolves a registered package barcode', async () => {
  const scanner: BarcodeScannerPort = {
    scan: vi.fn(async () => ({ rawValue: '899000020', format: 'EAN_13' })),
  };
  const gateway = new MockOperationsGateway(stateWithPackageBarcode);
  render(<MobileApp gateway={gateway} scanner={scanner} notifications={notifications} share={share} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cek Stok' }));
  fireEvent.click(screen.getByRole('button', { name: 'Scan dengan kamera' }));

  expect(await screen.findByRole('heading', { name: 'Kemeja Linen Putih' })).toBeInTheDocument();
  expect(scanner.scan).toHaveBeenCalledOnce();
});

test('mobile camera failure keeps the manual stock-code fallback available', async () => {
  const scanner: BarcodeScannerPort = { scan: vi.fn(async () => { throw new Error('camera unavailable'); }) };
  const gateway = new MockOperationsGateway(stateWithPackageBarcode);
  render(<MobileApp gateway={gateway} scanner={scanner} notifications={notifications} share={share} />);
  fireEvent.click(screen.getByRole('button', { name: 'Cek Stok' }));
  fireEvent.click(screen.getByRole('button', { name: 'Scan dengan kamera' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('Kamera tidak tersedia');
  const manual = screen.getByRole('textbox', { name: 'Kode SKU atau barcode' });
  fireEvent.change(manual, { target: { value: 'BRS-108' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cari kode' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Beras Hitam Premium 1 kg' })).toBeInTheDocument());
});
