import { writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { _electron as electron, expect, test, type Page, type TestInfo } from '@playwright/test';

async function launch() {
  const application = await electron.launch({ args: ['.vite/build/main.js'] });
  const window = await application.firstWindow();
  await expect(window).toHaveTitle('CH Ultimate');
  return { application, window };
}

async function openNota(window: Page) {
  await window.getByRole('button', { name: 'Nota', exact: true }).click();
  await expect(window.getByTestId('chu-nota-workspace')).toBeVisible();
}

async function finishNota(window: Page) {
  await window.getByRole('button', { name: 'Selesaikan nota' }).click();
  const confirmation = window.getByRole('dialog', { name: 'Selesaikan nota?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Selesaikan' }).click();
  await expect(window.getByText('Nota selesai dan stok demo diperbarui.')).toBeVisible();
}

async function expectStockAndRevenue(window: Page, stock: number, revenue: number) {
  await expect(window.getByTestId('sku-stock-sku-1')).toHaveText(String(stock));
  await window.getByRole('button', { name: 'Laporan Omzet' }).click();
  const formatted = `Rp ${revenue.toLocaleString('id-ID')}`;
  await expect(window.getByTestId('revenue-today')).toContainText(formatted);
  await expect(window.getByTestId('revenue-month')).toContainText(formatted);
  await expect(window.getByTestId('revenue-year')).toContainText(formatted);
}

async function createRuntimeWorkbook(testInfo: TestInfo) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SKU');
  sheet.addRow(['Nomor SKU', 'Judul', 'Modal Referensi', 'Semua Total Stok', 'Catatan SKU Gudang', 'Waktu Dibuat']);
  sheet.addRow(['IMP-001', 'Barang Impor Satu', 12000, 7, 'Rak impor A', '2026-07-21 10:00:00']);
  sheet.addRow(['IMP-002', 'Barang Impor Dua', 34000, 9, 'Rak impor B', '2026-07-21 10:01:00']);
  const path = testInfo.outputPath('runtime-import.xlsx');
  await writeFile(path, Buffer.from(await workbook.xlsx.writeBuffer()));
  return path;
}

test('Nota is a full-window workspace, stays horizontally contained, and returns to inventory', async ({}, testInfo) => {
  const { application, window } = await launch();
  try {
    await openNota(window);
    await expect(window.getByRole('navigation', { name: 'Modul CH Ultimate' })).toHaveCount(0);
    await expect(window.locator('.page-header')).toHaveCount(0);

    for (const [index, viewport] of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ].entries()) {
      await window.setViewportSize(viewport);
      if (index === 1) await window.getByRole('button', { name: 'Perbesar tulisan' }).click();
      await expect(window.getByRole('button', { name: `Ukuran tulisan ${index === 0 ? 150 : 175}%` })).toBeVisible();
      await expect(window.getByRole('columnheader')).toHaveCount(10);
      await expect(window.getByTestId('nota-grid-row-1')).toContainText('1A');
      await expect(window.getByTestId('nota-grid-row-15')).toContainText('15A');
      expect(await window.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const grid = window.getByRole('region', { name: 'Grid nota' });
      const overflow = await grid.evaluate((element) => element.scrollWidth > element.clientWidth);
      if (overflow) {
        await grid.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
        expect(await grid.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      }
      await expect(window.getByRole('columnheader', { name: 'AKSI' })).toBeVisible();
      await window.screenshot({ path: testInfo.outputPath(`nota-${viewport.width}x${viewport.height}.png`) });
    }

    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await expect(window.getByRole('heading', { name: 'SKU Gudang', level: 1 })).toBeVisible();
    await expect(window.getByRole('navigation', { name: 'Modul CH Ultimate' })).toBeVisible();
    await expect(window.locator('.nav-glyph svg')).toHaveCount(9);
  } finally {
    await application.close();
  }
});

test('SKU changes record price and quantity history and export filtered prices', async () => {
  const { application, window } = await launch();
  try {
    const skuRow = window.getByRole('row', { name: /BRS-108-BLK/ });
    await skuRow.getByRole('button', { name: 'Edit BRS-108-BLK' }).click();
    await window.getByLabel('Edit harga referensi').fill('52000');
    await window.getByRole('button', { name: 'Simpan perubahan SKU' }).click();
    await skuRow.getByRole('button', { name: 'Tambah stok BRS-108-BLK' }).click();
    await window.getByLabel('Jumlah stok ditambah').fill('4');
    await window.getByRole('button', { name: 'Tambah stok', exact: true }).click();

    await window.getByRole('button', { name: 'Perubahan SKU' }).click();
    await expect(window.getByRole('row', { name: /BRS-108-BLK.*42\.000.*52\.000/ })).toBeVisible();
    await window.evaluate(() => {
      HTMLAnchorElement.prototype.click = function captureSkuExport() {
        const anchor = this;
        (window as typeof window & { skuExportCapture?: Promise<{ filename: string; content: string }> }).skuExportCapture = fetch(anchor.href)
          .then((response) => response.text())
          .then((content) => ({ filename: anchor.download, content }));
      };
    });
    await window.getByRole('button', { name: 'Ekspor perubahan harga CSV' }).click();
    const exported = await window.evaluate(() => (window as typeof window & { skuExportCapture: Promise<{ filename: string; content: string }> }).skuExportCapture);
    expect(exported.filename).toMatch(/^perubahan-harga-sku-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(exported.content).toContain('BRS-108-BLK;Beras Hitam Premium 1 kg;42000;52000');

    await window.getByRole('tab', { name: 'Perubahan jumlah' }).click();
    await expect(window.getByRole('row', { name: /BRS-108-BLK.*Manual.*24.*\+4.*28/ })).toBeVisible();
    await window.getByLabel('Sampai tanggal perubahan').fill('2000-01-01');
    await expect(window.getByText('Belum ada perubahan jumlah pada rentang tanggal ini.')).toBeVisible();
  } finally {
    await application.close();
  }
});

test('Nota keyboard essentials use the platform Ctrl/Cmd+K shortcut and retain focus', async () => {
  const { application, window } = await launch();
  try {
    await openNota(window);
    const back = window.getByRole('button', { name: 'Kembali ke CH Ultimate' });
    await back.focus();
    await window.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
    await expect(window.getByRole('combobox', { name: 'Cari nota' })).toBeFocused();
    await window.keyboard.press('Escape');
    await expect(back).toBeFocused();

    await window.getByLabel('Jenis baris 1', { exact: true }).focus();
    await window.keyboard.press('Enter');
    await expect(window.getByLabel('Jumlah baris 1', { exact: true })).toBeFocused();
    await window.keyboard.press('ArrowDown');
    await expect(window.getByLabel('Jumlah baris 2', { exact: true })).toBeFocused();

    const complete = window.getByRole('button', { name: 'Selesaikan nota' });
    await complete.click();
    const confirmation = window.getByRole('dialog', { name: 'Selesaikan nota?' });
    await expect(confirmation.getByRole('button', { name: 'Batal' })).toBeFocused();
    await window.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(complete).toBeFocused();
  } finally {
    await application.close();
  }
});

test('Nota pages support A/B switching and cancellation recovery from Sampah', async () => {
  const { application, window } = await launch();
  try {
    await openNota(window);
    await expect(window.getByRole('button', { name: 'Halaman A', exact: true })).toHaveCSS('background-color', 'rgb(211, 47, 47)');
    await window.getByRole('button', { name: 'Halaman B', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Halaman B', exact: true })).toHaveCSS('background-color', 'rgb(21, 101, 192)');
    await expect(window.getByTestId('nota-grid-row-1')).toContainText('1B');
    await window.getByRole('button', { name: 'Tambah Nota C' }).click();
    await expect(window.getByRole('button', { name: 'Halaman C', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await window.getByRole('button', { name: 'Batalkan halaman C' }).click();
    await expect(window.getByRole('button', { name: 'Urungkan' })).toHaveCount(0);
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await window.getByRole('button', { name: 'Arsip Nota' }).click();
    await window.getByRole('tab', { name: 'Sampah' }).click();
    await window.getByRole('button', { name: 'Pulihkan' }).click();
    await expect(window.getByRole('button', { name: 'Halaman C', exact: true })).toBeVisible();
    const price = window.getByLabel('Harga PCS baris 3', { exact: true });
    await price.pressSequentially('52000');
    await expect(price).toHaveValue('52.000');
  } finally {
    await application.close();
  }
});

test('Nota title case and empty-stock restock planning stay frontend-only', async () => {
  const { application, window } = await launch();
  try {
    await openNota(window);
    await expect(window.getByRole('region', { name: 'SKU Gudang' })).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await window.getByLabel('Nama barang baris 3', { exact: true }).fill('kopi hITAM ch001 XL');
    await window.getByLabel('Jenis baris 3', { exact: true }).fill('minuman grosir');
    await expect(window.getByLabel('Nama barang baris 3', { exact: true })).toHaveValue('Kopi Hitam CH001 XL');
    await expect(window.getByLabel('Jenis baris 3', { exact: true })).toHaveValue('Minuman Grosir');
    await expect(window.getByRole('button', { name: 'Undo perubahan' })).toHaveCount(0);

    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await window.getByRole('button', { name: 'Barang Kosong' }).click();
    await expect(window.getByLabel('Kondisi stok')).toHaveValue('empty');
    await expect(window.getByRole('textbox', { name: 'Jumlah restock ACC-204-SLV' })).toHaveCount(0);
    await window.getByLabel('Pilih ACC-204-SLV').check();
    const quantity = window.getByRole('textbox', { name: 'Jumlah restock ACC-204-SLV' });
    await expect(quantity).toHaveValue('0');
    await window.getByRole('button', { name: 'Tambah jumlah restock ACC-204-SLV' }).click();
    await expect(window.getByTestId('empty-report-preview')).toContainText('LAPORAN BARANG KOSONG');
    await expect(window.getByTestId('empty-report-preview')).toContainText('Jumlah: 1');
    await window.getByLabel('Pilih ACC-204-SLV').uncheck();
    await expect(quantity).toHaveCount(0);
    await expect(window.getByTestId('empty-report-preview')).not.toContainText('ACC-204-SLV');

    await window.getByRole('button', { name: 'SKU Gudang' }).click();
    await expect(window.getByTestId('sku-stock-sku-3')).toHaveText('-3');
  } finally {
    await application.close();
  }
});

test('Template Label and Invoice configures a movable session-only invoice preview', async () => {
  const { application, window } = await launch();
  try {
    await window.getByRole('button', { name: 'Template Label & Invoice' }).click();
    await expect(window.getByTestId('label-qr')).toBeVisible();
    await window.getByRole('tab', { name: 'Invoice' }).click();
    await window.getByLabel('Lebar invoice (mm)').fill('190');
    await window.getByLabel('Tinggi invoice (mm)').fill('120');
    await window.getByLabel('Ukuran font invoice').fill('16');
    await window.getByRole('textbox', { name: 'Alamat' }).fill('Jl. Pasar Baru No. 10');
    await window.getByRole('textbox', { name: 'No. Telp' }).fill('0812-3456-7890');
    await window.getByRole('textbox', { name: 'No. rekening' }).fill('BCA 1234567890');
    const preview = window.getByTestId('invoice-preview');
    await expect(preview).toContainText('Jl. Pasar Baru No. 10');
    await expect(preview).toContainText('0812-3456-7890');
    await expect(preview).toHaveAttribute('style', /width: 190mm; min-height: 120mm; font-size: 16px/);
    await window.getByRole('button', { name: 'Naikkan No. rekening' }).click();
    await expect(preview.locator('[data-testid^="invoice-element-"]')).toHaveCount(4);
    expect(await preview.locator('[data-testid^="invoice-element-"]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')))).toEqual([
      'invoice-element-logo', 'invoice-element-address', 'invoice-element-bank', 'invoice-element-phone',
    ]);
    await expect(window.getByRole('button', { name: 'Print invoice' })).toBeDisabled();
  } finally {
    await application.close();
  }
});

test('Nota lifecycle posts linked and ad-hoc lines, then import resets the session at reload', async ({}, testInfo) => {
  const { application, window } = await launch();
  try {
    await openNota(window);
    await window.getByLabel('Nama barang baris 3', { exact: true }).focus();
    await expect(window.getByText('Target baris 3A', { exact: true })).toBeVisible();
    await window.getByRole('searchbox', { name: 'Cari SKU Gudang' }).fill('Beras Hitam');
    await window.getByRole('option', { name: /BRS-108-BLK/ }).click();
    await expect(window.getByLabel('Nama barang baris 3', { exact: true })).toHaveValue('Beras Hitam Premium 1 kg');
    await window.getByLabel('Jumlah baris 3', { exact: true }).fill('2');
    await window.getByLabel('Nama barang baris 4', { exact: true }).fill('Biaya bungkus manual');
    await window.getByLabel('Jenis baris 4', { exact: true }).fill('Layanan');
    await window.getByLabel('Jumlah baris 4', { exact: true }).fill('1');
    await window.getByLabel('Harga PCS baris 4', { exact: true }).fill('10000');
    await window.getByRole('button', { name: 'PCS baris 4' }).click();
    await finishNota(window);

    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await expectStockAndRevenue(window, 21, 141_000);

    await window.getByRole('button', { name: 'Arsip Nota' }).click();
    await expect(window.getByText('SELESAI · HANYA LIHAT')).toBeVisible();
    const archivePageA = window.getByRole('button', { name: 'Preview halaman A' });
    const archivePageB = window.getByRole('button', { name: 'Preview halaman B' });
    await expect(archivePageA).toHaveCSS('border-color', 'rgb(211, 47, 47)');
    await expect(archivePageA).toHaveCSS('background-color', 'rgb(211, 47, 47)');
    await expect(archivePageB).toHaveCSS('border-color', 'rgb(21, 101, 192)');
    await archivePageB.click();
    await expect(archivePageB).toHaveCSS('background-color', 'rgb(21, 101, 192)');
    await archivePageA.click();
    await expect(archivePageA).toHaveCSS('background-color', 'rgb(211, 47, 47)');
    await window.getByRole('button', { name: 'Lipat preview nota' }).click();
    await expect(window.getByRole('region', { name: 'Preview arsip nota' })).toHaveCount(0);
    await window.getByRole('button', { name: 'Buka preview nota' }).click();
    await expect(window.getByText('SELESAI · HANYA LIHAT')).toBeVisible();
    await window.getByRole('button', { name: 'Buka kembali untuk edit' }).click();
    await window.getByRole('dialog', { name: 'Buka kembali nota?' }).getByRole('button', { name: 'Buka kembali' }).click();
    await window.getByLabel('Jumlah baris 3', { exact: true }).fill('3');
    await finishNota(window);
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await window.getByRole('button', { name: 'SKU Gudang' }).click();
    await expectStockAndRevenue(window, 20, 183_000);

    await window.getByRole('button', { name: 'Arsip Nota' }).click();
    await window.getByRole('button', { name: 'Buka kembali untuk edit' }).click();
    await window.getByRole('dialog', { name: 'Buka kembali nota?' }).getByRole('button', { name: 'Buka kembali' }).click();
    await window.getByRole('button', { name: 'Batalkan transaksi' }).click();
    await window.getByRole('dialog', { name: 'Batalkan transaksi?' }).getByRole('button', { name: 'Batalkan' }).click();
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await window.getByRole('button', { name: 'SKU Gudang' }).click();
    await expectStockAndRevenue(window, 24, 0);

    await window.getByRole('button', { name: 'Arsip Nota' }).click();
    await window.getByRole('tab', { name: 'Sampah' }).click();
    await window.getByRole('button', { name: 'Pulihkan' }).click();
    await expect(window.getByTestId('chu-nota-workspace')).toBeVisible();
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await window.getByRole('button', { name: 'SKU Gudang' }).click();
    await expectStockAndRevenue(window, 20, 0);

    await window.getByRole('button', { name: 'Nota', exact: true }).click();
    await finishNota(window);
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await expectStockAndRevenue(window, 20, 183_000);

    await window.getByRole('button', { name: 'SKU Gudang' }).click();
    window.once('dialog', (dialog) => void dialog.accept());
    await window.getByLabel('Import XLSX').setInputFiles(await createRuntimeWorkbook(testInfo));
    await expect(window.getByRole('status')).toHaveText('2 SKU dimuat · 0 dilewati');
    await expect(window.getByText('runtime-import.xlsx', { exact: true })).toBeVisible();
    await expect(window.getByText('IMP-001', { exact: true })).toBeVisible();
    await expect(window.getByTestId('sku-stock-import-2-IMP-001')).toHaveText('7');
    await expect(window.getByText('IMP-002', { exact: true })).toBeVisible();
    await expect(window.getByTestId('sku-stock-import-3-IMP-002')).toHaveText('9');

    await window.getByRole('button', { name: 'Nota', exact: true }).click();
    await expect(window.getByText('Belum ada nota yang sedang dikerjakan pada sesi ini.')).toBeVisible();

    await window.reload({ waitUntil: 'domcontentloaded' });
    await expect(window.getByText('DEMO DATA · SESSION ONLY')).toBeVisible();
    await expect(window.getByTestId('sku-stock-sku-1')).toHaveText('24');
    await expect(window.getByText('6 SKU', { exact: true })).toBeVisible();
    await window.getByRole('button', { name: 'Nota', exact: true }).click();
    await expect(window.getByRole('button', { name: 'Halaman A', exact: true })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Halaman B', exact: true })).toBeVisible();
    await expect(window.getByLabel('Pelanggan', { exact: true })).toHaveValue('Amelia');
    await expect(window.getByLabel('Tempat', { exact: true })).toHaveValue('Saibah');
    await expect(window.getByLabel('Nama barang baris 3', { exact: true })).toHaveValue('');
  } finally {
    await application.close();
  }
});
