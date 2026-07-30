import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import type {
  CatalogueValidationResult,
  OperationsGateway,
} from '../../src/gateway/operations-gateway-contract';

test('adjusts a tracked SKU into a negative balance in the current session', async () => {
  render(<App gateway={new MockOperationsGateway()} />);
  expect(screen.getByTestId('sku-stock-sku-1')).toHaveTextContent('24');
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Kurangi stok BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Jumlah stok dikurangi'), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kurangi stok' }));
  expect(await screen.findByTestId('sku-stock-sku-1')).toHaveTextContent('-6');
});

test('uses explicit add and subtract stock actions without requiring signed input', async () => {
  render(<App gateway={new MockOperationsGateway()} />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Tambah stok BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Jumlah stok ditambah'), { target: { value: '5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah stok' }));
  expect(await screen.findByTestId('sku-stock-sku-1')).toHaveTextContent('29');

  fireEvent.click(within(row).getByRole('button', { name: 'Kurangi stok BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Jumlah stok dikurangi'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Kurangi stok' }));
  expect(await screen.findByTestId('sku-stock-sku-1')).toHaveTextContent('22');
});

test('keeps the stock dialog open and shows an actionable server error', async () => {
  const gateway = new MockOperationsGateway();
  vi.spyOn(gateway, 'adjustStock').mockRejectedValue(
    new Error('SKU sudah diarsipkan. Sinkronkan ulang lalu coba lagi.'),
  );
  render(<App gateway={gateway} />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(
    within(row).getByRole('button', { name: 'Tambah stok BRS-108-BLK' }),
  );
  fireEvent.change(screen.getByLabelText('Jumlah stok ditambah'), {
    target: { value: '2' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah stok' }));

  expect(
    await screen.findByText(
      'SKU sudah diarsipkan. Sinkronkan ulang lalu coba lagi.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Tambah stok' })).toBeInTheDocument();
});

test('keeps an SKU visible and surfaces an archive rejection', async () => {
  const gateway = new MockOperationsGateway();
  vi.spyOn(gateway, 'setArchived').mockRejectedValue(
    new Error('Versi SKU berubah. Sinkronkan ulang lalu coba lagi.'),
  );
  render(<App gateway={gateway} />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });

  fireEvent.click(within(row).getByRole('button', { name: 'Arsip' }));

  expect(
    await screen.findByText(
      'Versi SKU berubah. Sinkronkan ulang lalu coba lagi.',
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole('row', { name: /BRS-108-BLK/ })).toBeInTheDocument();
});

test('confirms successful archive and restore mutations', async () => {
  const gateway = new MockOperationsGateway();
  render(<App gateway={gateway} />);
  const activeRow = screen.getByRole('row', { name: /BRS-108-BLK/ });

  fireEvent.click(within(activeRow).getByRole('button', { name: 'Arsip' }));

  expect(
    await screen.findByText('SKU BRS-108-BLK diarsipkan.'),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Status'), {
    target: { value: 'archived' },
  });
  const archivedRow = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(
    within(archivedRow).getByRole('button', { name: 'Pulihkan' }),
  );
  expect(
    await screen.findByText('SKU BRS-108-BLK dipulihkan.'),
  ).toBeInTheDocument();
});

test('lists filtered price and quantity changes and exposes price export', async () => {
  const gateway = new MockOperationsGateway();
  await gateway.updateSku('sku-1', { imageUrl: 'https://example.test/beras.jpg' });
  render(<App gateway={gateway} />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Edit BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Edit harga referensi'), { target: { value: '52000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan SKU' }));

  fireEvent.click(within(row).getByRole('button', { name: 'Tambah stok BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Jumlah stok ditambah'), { target: { value: '3' } });
  fireEvent.click(screen.getByRole('button', { name: 'Tambah stok' }));
  fireEvent.click(screen.getByRole('button', { name: 'Perubahan SKU' }));

  expect(screen.getByRole('heading', { name: 'Perubahan SKU', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Perubahan harga' })).toHaveAttribute('aria-selected', 'true');
  const priceRow = screen.getByRole('row', { name: /BRS-108-BLK.*Rp\s*42\.000.*Rp\s*52\.000/i });
  expect(priceRow).toBeInTheDocument();
  expect(within(priceRow).getByRole('img', { name: 'Gambar BRS-108-BLK' })).toHaveAttribute('src', 'https://example.test/beras.jpg');
  const createObjectURL = vi.fn(() => 'blob:price-history');
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Ekspor perubahan harga CSV' }));
  expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledOnce();
  await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:price-history'));
  click.mockRestore();

  fireEvent.click(screen.getByRole('tab', { name: 'Perubahan jumlah' }));
  const quantityRow = screen.getByRole('row', { name: /BRS-108-BLK.*24.*\+3.*27/ });
  expect(within(quantityRow).getByRole('img', { name: 'Gambar BRS-108-BLK' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Sampai tanggal perubahan'), { target: { value: '2000-01-01' } });
  expect(screen.getByText('Belum ada perubahan jumlah pada rentang tanggal ini.')).toBeInTheDocument();
});

test('prints a chosen quantity of warehouse SKU barcodes', () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  render(<App gateway={new MockOperationsGateway()} />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Print barcode BRS-108-BLK' }));
  const dialog = screen.getByRole('dialog', { name: 'Print barcode produk' });
  const quantity = within(dialog).getByLabelText('Jumlah barcode');
  const printNow = within(dialog).getByRole('button', { name: 'Print barcode sekarang' });
  expect(quantity).toHaveValue(1);
  fireEvent.change(quantity, { target: { value: '' } });
  expect(quantity).toHaveValue(null);
  expect(screen.queryAllByTestId('barcode-print-item')).toHaveLength(0);
  expect(printNow).toBeDisabled();
  fireEvent.change(quantity, { target: { value: '3' } });
  expect(quantity).toHaveValue(3);
  expect(screen.getAllByTestId('barcode-print-item')).toHaveLength(3);
  expect(screen.getAllByTestId('barcode-product-qr')[0]).toHaveAttribute('data-value', 'BRS-108-BLK');
  fireEvent.click(printNow);
  expect(print).toHaveBeenCalledOnce();
  print.mockRestore();
});

test('creates a SKU and shows it in the warehouse list', async () => {
  render(<App gateway={new MockOperationsGateway()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Buat SKU' }));
  fireEvent.change(screen.getByLabelText('Nomor SKU'), { target: { value: 'NEW-001' } });
  fireEvent.change(screen.getByLabelText('Nama SKU'), { target: { value: 'Produk Baru' } });
  fireEvent.change(screen.getByLabelText('Harga Referensi'), { target: { value: '35000' } });
  fireEvent.change(screen.getByLabelText('Stok Awal'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan SKU' }));
  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));
  expect(await screen.findByText('NEW-001')).toBeInTheDocument();
  expect(screen.getByText('Produk Baru')).toBeInTheDocument();
});

test('title-cases SKU names during create and edit without changing codes or notes', async () => {
  render(<App gateway={new MockOperationsGateway()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Buat SKU' }));
  fireEvent.change(screen.getByLabelText('Nomor SKU'), { target: { value: 'ch001' } });
  fireEvent.change(screen.getByLabelText('Nama SKU'), { target: { value: 'produk hITAM ch001 XL' } });
  fireEvent.change(screen.getByLabelText('Harga Referensi'), { target: { value: '35000' } });
  fireEvent.change(screen.getByLabelText('Stok Awal'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Tautan gambar (opsional)'), { target: { value: 'https://example.test/gambar.jpg' } });
  fireEvent.change(screen.getByLabelText('Catatan SKU Gudang'), { target: { value: 'stok depan. rak kedua' } });
  expect(screen.getByLabelText('Nomor SKU')).toHaveValue('ch001');
  expect(screen.getByLabelText('Tautan gambar (opsional)')).toHaveValue('https://example.test/gambar.jpg');
  expect(screen.getByLabelText('Nama SKU')).toHaveValue('Produk Hitam CH001 XL');
  expect(screen.getByLabelText('Catatan SKU Gudang')).toHaveValue('stok depan. rak kedua');
  fireEvent.click(screen.getByRole('button', { name: 'Simpan SKU' }));
  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));

  const row = screen.getByRole('row', { name: /ch001/ });
  expect(row).toHaveTextContent('Produk Hitam CH001 XL');
  expect(row).toHaveTextContent('stok depan. rak kedua');
  fireEvent.click(within(row).getByRole('button', { name: 'Edit ch001' }));
  fireEvent.change(screen.getByLabelText('Edit nama SKU'), { target: { value: 'produk revisi ch002' } });
  fireEvent.change(screen.getByLabelText('Edit catatan SKU'), { target: { value: 'pindah rak. cek ulang' } });
  expect(screen.getByLabelText('Edit nama SKU')).toHaveValue('Produk Revisi CH002');
  expect(screen.getByLabelText('Edit catatan SKU')).toHaveValue('pindah rak. cek ulang');
});

test('edits a SKU number while keeping the old value searchable', async () => {
  render(<App gateway={new MockOperationsGateway()} />);
  const row = screen.getByRole('row', { name: /BRS-108-BLK/ });
  fireEvent.click(within(row).getByRole('button', { name: 'Edit BRS-108-BLK' }));
  fireEvent.change(screen.getByLabelText('Edit nomor SKU'), { target: { value: 'BRS-NEW' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan SKU' }));
  fireEvent.change(screen.getByPlaceholderText('Nama / nomor SKU / scan QR'), { target: { value: 'BRS-108-BLK' } });
  expect(await screen.findByText('BRS-NEW')).toBeInTheDocument();
});

test('replaces a warehouse image from a clickable thumbnail and exposes an enlarged preview', async () => {
  const gateway = new MockOperationsGateway();
  const untouchedImage = gateway.getSnapshot().skus.find((sku) => sku.id === 'sku-2')!.imageUrl;
  const inputClick = vi.spyOn(HTMLInputElement.prototype, 'click');
  render(<App gateway={gateway} />);

  const button = screen.getByRole('button', { name: 'Ubah gambar BRS-108-BLK' });
  expect(within(button).getByTestId('sku-image-hover-preview')).toBeInTheDocument();
  fireEvent.click(button);
  expect(inputClick).toHaveBeenCalledOnce();

  const fileInput = screen.getByLabelText('Pilih file gambar SKU');
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'beras.png', { type: 'image/png' });
  fireEvent.change(fileInput, { target: { files: [file] } });

  await waitFor(() => expect(gateway.getSnapshot().skus.find((sku) => sku.id === 'sku-1')!.imageUrl).toMatch(/^data:image\/png;base64,/));
  expect(gateway.getSnapshot().skus.find((sku) => sku.id === 'sku-2')!.imageUrl).toBe(untouchedImage);
  expect(fileInput).toHaveValue('');
  await waitFor(() =>
    expect(
      within(
        screen.getByRole('button', { name: 'Ubah gambar BRS-108-BLK' }),
      ).getByRole('img', { name: 'Gambar BRS-108-BLK' }),
    ).toHaveAttribute('src', expect.stringMatching(/^data:image\/png;base64,/)),
  );
  inputClick.mockRestore();
});

test('previews exact CH Core catalogue totals before an explicit commit', async () => {
  const gateway = new MockOperationsGateway();
  Object.assign(gateway.capabilities, {
    canImportInitialCatalogue: false,
    canStageInitialCatalogue: true,
  });
  const stagedGateway: OperationsGateway = gateway;
  const validation: CatalogueValidationResult = {
    importId: '88888888-8888-4888-8888-888888888888',
    workbookSha256: 'a'.repeat(64),
    sourceFileName: 'catalogue.xlsx',
    status: 'staged',
    preview: {
      rowCount: 3_144,
      imageJobCount: 2_786,
      missingImageCount: 358,
      priceMismatchCount: 3,
      selectedPriceTotal: 276_267_011,
      stockTotal: 4_115,
      maximumCellTextLength: 168,
      warnings: ['3 baris memakai harga terpilih yang berbeda.'],
      priceMismatches: [
        {
          rowNumber: 17,
          primarySku: 'SKU-017',
          modalPrice: 80_000,
          salePrice: 90_000,
          selectedPrice: 90_000,
        },
      ],
    },
    expiresAt: '2026-07-31T00:00:00.000Z',
    committedAt: null,
  };
  const validate = vi
    .spyOn(stagedGateway, 'validateInitialCatalogue')
    .mockResolvedValue(validation);
  const commit = vi
    .spyOn(stagedGateway, 'commitInitialCatalogue')
    .mockResolvedValue({
      importId: validation.importId,
      workbookSha256: validation.workbookSha256,
      rowCount: 3_144,
      imageJobCount: 2_786,
      committedAt: '2026-07-30T02:00:00.000Z',
      replayed: false,
    });
  const confirm = vi.spyOn(window, 'confirm');
  render(<App gateway={gateway} />);

  const file = new File([new Uint8Array([80, 75, 3, 4])], 'catalogue.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  fireEvent.change(screen.getByLabelText('Import XLSX'), {
    target: { files: [file] },
  });

  const dialog = await screen.findByRole('dialog', {
    name: 'Tinjau import katalog',
  });
  expect(validate).toHaveBeenCalledWith({
    fileName: 'catalogue.xlsx',
    workbookBase64: 'UEsDBA==',
  });
  expect(confirm).not.toHaveBeenCalled();
  expect(within(dialog).getByText('3.144')).toBeInTheDocument();
  expect(within(dialog).getByText('2.786')).toBeInTheDocument();
  expect(within(dialog).getByText('358')).toBeInTheDocument();
  expect(within(dialog).getByText('Rp 276.267.011')).toBeInTheDocument();
  expect(within(dialog).getByText('4.115')).toBeInTheDocument();
  expect(within(dialog).getByText('SKU-017')).toBeInTheDocument();

  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Komit katalog' }),
  );
  await waitFor(() =>
    expect(commit).toHaveBeenCalledWith(validation.importId),
  );
  expect(
    await screen.findByText('3.144 SKU dikomit ke CH Core.'),
  ).toBeInTheDocument();
  confirm.mockRestore();
});

test('loads an imported SKU image through the gateway cache boundary', async () => {
  const gateway = new MockOperationsGateway();
  await gateway.updateSku('sku-1', {
    imageHash: 'a'.repeat(64),
    imageUrl: '',
  });
  const stagedGateway: OperationsGateway = gateway;
  const load = vi
    .spyOn(stagedGateway, 'loadSkuImage')
    .mockResolvedValue('data:image/png;base64,iVBORw==');

  render(<App gateway={gateway} />);

  const image = await within(
    screen.getByRole('button', { name: 'Ubah gambar BRS-108-BLK' }),
  ).findByRole('img', { name: 'Gambar BRS-108-BLK' });
  expect(image).toHaveAttribute('src', 'data:image/png;base64,iVBORw==');
  expect(load).toHaveBeenCalledWith(
    expect.objectContaining({ imageHash: 'a'.repeat(64) }),
  );
});

test('hides the entire import flow when the authenticated device is not an owner', () => {
  const gateway = new MockOperationsGateway();
  Object.assign(gateway.capabilities, {
    canImportInitialCatalogue: false,
    canStageInitialCatalogue: false,
  });

  render(<App gateway={gateway} />);

  expect(screen.queryByLabelText('Import XLSX')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Import XLSX' }),
  ).not.toBeInTheDocument();
});
