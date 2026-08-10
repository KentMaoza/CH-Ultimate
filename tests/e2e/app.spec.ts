import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFile, listPackage } from '@electron/asar';
import ExcelJS from 'exceljs';
import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { launchTestElectron } from './electron-launch';

async function launch() {
  const application = await launchTestElectron();
  const window = await application.firstWindow();
  await expect(window).toHaveTitle('CH Ultimate');
  return { application, window };
}

test('packaged renderer emits a decodable Vite-managed sidebar mark', async () => {
  const packagedResourcesDirectory = join(
    'out',
    `CH Ultimate-${process.platform}-${process.arch}`,
    ...(process.platform === 'darwin'
      ? ['CH Ultimate.app', 'Contents', 'Resources']
      : ['resources']),
  );
  const archivePath = join(packagedResourcesDirectory, 'app.asar');
  const rendererFiles = listPackage(archivePath, { isPack: false });
  const indexPath = rendererFiles.find(
    (path) => path.endsWith('/renderer/main_window/index.html'),
  );
  expect(indexPath).toBeDefined();
  const index = extractFile(archivePath, indexPath!.slice(1)).toString('utf8');
  const bundleName = index.match(/src="\.\/assets\/(index-[^"]+\.js)"/)?.[1];
  expect(bundleName).toBeDefined();
  const bundle = extractFile(
    archivePath,
    `.vite/renderer/main_window/assets/${bundleName}`,
  ).toString('utf8');
  const markDataUrl = bundle.match(
    /data:image\/svg\+xml,%3csvg(?=[^"]*CH%20Ultimate%20mark)[^"]+/,
  )?.[0];

  expect(bundle).not.toContain('/brand/ch-ultimate-mark.svg');
  expect(markDataUrl).toBeDefined();

  let temporaryDirectory: string | undefined;
  let application: ElectronApplication | undefined;

  try {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'ch-ultimate-packaged-logo-'));
    const launcherPath = join(temporaryDirectory, 'packaged-mark-launch.cjs');
    const imagePage = `data:text/html,${encodeURIComponent('<!doctype html><img id="mark" alt="CH Ultimate">')}`;
    await writeFile(
      launcherPath,
      `const { app, BrowserWindow } = require('electron');\napp.whenReady().then(() => new BrowserWindow({ webPreferences: { contextIsolation: true } }).loadURL(${JSON.stringify(imagePage)}));\n`,
    );
    application = await electron.launch({ args: [launcherPath] });
    const window = await application.firstWindow();
    const mark = window.getByRole('img', { name: 'CH Ultimate' });
    await mark.evaluate((image, source) => {
      (image as HTMLImageElement).src = source;
    }, markDataUrl!);

    await expect.poll(
      async () => mark.evaluate((image) => {
        const rendered = image as HTMLImageElement;
        return rendered.complete && rendered.naturalWidth > 0;
      }),
    ).toBe(true);
    await expect(mark).toHaveAttribute('src', markDataUrl!);
    expect(await mark.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  } finally {
    await application?.close().catch(() => undefined);
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
});

async function openNota(window: Page) {
  await window.getByRole('button', { name: 'Nota', exact: true }).click();
  await expect(window.getByTestId('chu-nota-workspace')).toBeVisible();
}

async function finishNota(window: Page) {
  await window.getByRole('button', { name: 'Selesaikan nota' }).click();
  const confirmation = window.getByRole('dialog', { name: 'Selesaikan nota?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: '2. Barang dikirim nanti' }).click();
  const success = window.getByRole('dialog', { name: 'Nota berhasil disimpan' });
  await expect(success).toContainText('Nota berhasil disimpan di Arsip.');
  await success.getByRole('button', { name: 'Tutup' }).click();
}

async function expectStockAndRevenue(window: Page, stock: number, revenue: number) {
  await expect(window.getByTestId('sku-stock-sku-1')).toHaveText(String(stock));
  await window.getByRole('button', { name: 'Laporan Omzet' }).click();
  if (await window.getByRole('button', { name: 'Atur password di Settings' }).count()) {
    await expect(window.getByTestId('revenue-today')).toHaveCount(0);
    await window.getByRole('button', { name: 'Atur password di Settings' }).click();
    await window.getByLabel('Password omzet baru').fill('demo-omzet');
    await window.getByLabel('Konfirmasi password omzet').fill('demo-omzet');
    await window.getByRole('button', { name: 'Simpan password omzet' }).click();
    await window.getByRole('button', { name: 'Laporan Omzet' }).click();
  }
  if (await window.getByRole('button', { name: 'Buka Laporan Omzet' }).count()) {
    await window.getByLabel('Password Laporan Omzet').fill('demo-omzet');
    await window.getByRole('button', { name: 'Buka Laporan Omzet' }).click();
  }
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
    await expect(window.locator('.nav-glyph svg')).toHaveCount(12);
    const rail = await window.locator('.app-rail').boundingBox();
    const templateLabel = await window.getByRole('button', { name: 'Template Label & Invoice' }).locator('span').last().boundingBox();
    expect(rail?.width).toBeGreaterThanOrEqual(288);
    expect(templateLabel!.x + templateLabel!.width).toBeLessThanOrEqual(rail!.x + rail!.width);
  } finally {
    await application.close();
  }
});

test('SKU changes record price and quantity history and export filtered prices', async () => {
  const { application, window } = await launch();
  try {
    const skuRow = window.getByRole('row', { name: /BRS-108-BLK/ });
    const imageButton = skuRow.getByRole('button', { name: 'Ubah gambar BRS-108-BLK' });
    await imageButton.hover();
    await expect(imageButton.getByTestId('sku-image-hover-preview')).toBeVisible();
    const fileChooserPromise = window.waitForEvent('filechooser');
    await imageButton.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'beras.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wl3sAAAAASUVORK5CYII=', 'base64'),
    });
    await expect(window.getByRole('status')).toHaveText('Gambar BRS-108-BLK diperbarui.');
    await expect(imageButton.getByRole('img', { name: 'Gambar BRS-108-BLK' })).toHaveAttribute('src', /^data:image\/png;base64,/);

    await skuRow.getByRole('button', { name: 'Print barcode BRS-108-BLK' }).click();
    const barcodeQuantity = window.getByLabel('Jumlah barcode');
    await barcodeQuantity.focus();
    await window.keyboard.press('ControlOrMeta+A');
    await window.keyboard.press('Backspace');
    await expect(barcodeQuantity).toHaveValue('');
    await expect(window.getByRole('button', { name: 'Print barcode sekarang' })).toBeDisabled();
    await barcodeQuantity.pressSequentially('2');
    await expect(barcodeQuantity).toHaveValue('2');
    await expect(window.getByTestId('barcode-print-item')).toHaveCount(2);
    await window.getByRole('button', { name: 'Print barcode sekarang' }).click();
    await expect(window.getByRole('status')).toHaveText('Dialog print barcode dibuka.');
    await window.getByRole('button', { name: 'Tutup print barcode' }).click();

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

    await window.getByLabel('Jumlah baris 3', { exact: true }).fill('5');
    await window.getByRole('button', { name: 'LSN baris 3' }).click();
    await window.getByLabel('Harga PCS baris 3', { exact: true }).fill('165000');
    await expect(window.getByLabel('Total baris 3', { exact: true })).toHaveText('9.900.000');

    const complete = window.getByRole('button', { name: 'Selesaikan nota' });
    await complete.click();
    const confirmation = window.getByRole('dialog', { name: 'Selesaikan nota?' });
    await expect(confirmation.getByRole('button', { name: '1. Barang dikirim sekarang' })).toBeFocused();
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
    await openNota(window);
    await window.getByRole('button', { name: 'Halaman B', exact: true }).click();
    await window.getByLabel('Nama barang baris 1', { exact: true }).fill('Barang Nota B');
    await window.getByLabel('Jenis baris 1', { exact: true }).fill('Layanan');
    await window.getByLabel('Jumlah baris 1', { exact: true }).fill('1');
    await window.getByLabel('Harga PCS baris 1', { exact: true }).fill('112000');
    await window.getByLabel('Harga LSN baris 1', { exact: true }).fill('1344000');
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
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
    await expect(preview).toContainText('Nota A');
    await expect(preview).toContainText('1A');
    await expect(preview).not.toContainText('Barang Nota B');
    await expect(preview.getByTestId('invoice-note-total')).toContainText('Rp 41.964');
    await expect(preview.getByTestId('invoice-ppn')).toContainText('PPN 12%');
    await expect(preview.getByTestId('invoice-ppn')).toContainText('Rp 5.036');
    await expect(preview.getByTestId('invoice-transaction-total')).toContainText('Rp 47.000');
    await window.getByRole('button', { name: 'Preview Nota B' }).click();
    await expect(preview).toContainText('Nota B');
    await expect(preview).toContainText('1B');
    await expect(preview).toContainText('Barang Nota B');
    await expect(preview).not.toContainText('Beras Hitam Premium 1 kg');
    expect(await preview.locator('thead th').allTextContents()).toEqual([
      'NO', 'NAMA BARANG', 'JENIS', 'JUMLAH', 'PCS/LSN', 'HARGA PCS', 'HARGA LSN', 'TOTAL',
    ]);
    await expect(preview.getByTestId('invoice-kind-1B')).toHaveText('Layanan');
    await expect(preview.getByTestId('invoice-price-pcs-1B')).toHaveText('112.000');
    await expect(preview.getByTestId('invoice-price-lsn-1B')).toHaveText('1.344.000');
    await expect(preview.getByTestId('invoice-unit-1B')).toHaveText('PCS');
    await expect(preview.getByTestId('invoice-unit-1B')).not.toHaveClass(/is-active/);
    await expect(preview.getByTestId('invoice-customer-name')).toHaveText('Amelia');
    await expect(preview.getByTestId('invoice-customer-place')).toHaveText('Saibah');
    await expect(preview.getByTestId('invoice-customer-date')).toHaveText(/\d{4}-\d{2}-\d{2}/);
    const gridCellStyle = await preview.locator('tbody td').first().evaluate((cell) => {
      const style = getComputedStyle(cell);
      return { borderLeftStyle: style.borderLeftStyle, borderLeftWidth: style.borderLeftWidth };
    });
    expect(gridCellStyle).toEqual({ borderLeftStyle: 'solid', borderLeftWidth: '1px' });
    const customerFontSize = await preview.getByTestId('invoice-customer-name').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(customerFontSize).toBeGreaterThan(16);
    for (const [index, viewport] of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ].entries()) {
      await window.setViewportSize(viewport);
      const layout = await preview.evaluate((paper) => {
        const table = paper.querySelector('[data-testid="invoice-items-grid"]');
        const panel = paper.closest('.invoice-preview-wrap');
        if (!table || !panel) return null;
        const paperRect = paper.getBoundingClientRect();
        const tableRect = table.getBoundingClientRect();
        return {
          tableInsidePaper: tableRect.left >= paperRect.left && tableRect.right <= paperRect.right,
          panelOverflow: panel.scrollWidth > panel.clientWidth,
        };
      });
      expect(layout?.tableInsidePaper).toBe(true);
      expect(layout?.panelOverflow).toBe(index === 0);
    }
    await expect(preview.getByTestId('invoice-note-total')).toContainText('Rp 100.000');
    await expect(preview.getByTestId('invoice-ppn')).toContainText('Rp 12.000');
    await expect(preview.getByTestId('invoice-transaction-total')).toContainText('Rp 112.000');
    await expect(preview).toContainText('Jl. Pasar Baru No. 10');
    await expect(preview).toContainText('0812-3456-7890');
    await expect(preview).toHaveAttribute('style', /width: 190mm; min-height: 120mm; font-size: 16px/);
    await window.getByRole('button', { name: 'Naikkan No. rekening' }).click();
    await expect(preview.locator('[data-testid^="invoice-element-"]')).toHaveCount(4);
    expect(await preview.locator('[data-testid^="invoice-element-"]').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')))).toEqual([
      'invoice-element-logo', 'invoice-element-address', 'invoice-element-bank', 'invoice-element-phone',
    ]);
    await expect(window.getByRole('button', { name: 'Print invoice' })).toBeEnabled();
    await window.getByRole('button', { name: 'Print invoice' }).click();
    await expect(window.getByRole('status')).toHaveText('Dialog print invoice dibuka.');
    await window.getByRole('button', { name: 'Simpan PDF invoice' }).click();
    await expect(window.getByRole('status')).toHaveText('PDF invoice tersimpan.');
  } finally {
    await application.close();
  }
});

test('minimum thermal and A4 label cards contain fixed QR and copy bounds', async () => {
  const { application, window } = await launch();
  try {
    await window.getByRole('button', { name: 'Template Label & Invoice' }).click();
    await window.getByLabel('Lebar (mm)').fill('20');
    await window.getByLabel('Tinggi (mm)').fill('15');
    await window.getByLabel('Ukuran font').fill('24');
    await window.getByLabel('CHU').check();

    const captureLayout = async (buttonName: 'Print label' | 'Print barcode sekarang') => {
      await window.evaluate(() => {
        const testWindow = globalThis as typeof globalThis & {
          __chuOriginalAnimationFrame?: typeof globalThis.requestAnimationFrame;
        };
        testWindow.__chuOriginalAnimationFrame = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = (callback) => Number(globalThis.setTimeout(
          () => callback(globalThis.performance.now()),
          250,
        ));
      });
      try {
        await window.getByRole('button', { name: buttonName, exact: true }).click();
        const host = window.getByTestId('print-document-host');
        await host.waitFor({ state: 'attached' });
        return await host.evaluate((element) => {
          const tolerance = 0.75;
          const millimetre = 96 / 25.4;
          const pages = [...element.querySelectorAll<HTMLElement>('[data-testid="output-label-page"]')];
          const cards = [...element.querySelectorAll<HTMLElement>('[data-testid="output-product-card"]')];
          const measurements = cards.map((card) => {
            const page = card.closest<HTMLElement>('[data-testid="output-label-page"]')!;
            const qr = card.querySelector<SVGElement>('[data-testid="output-product-qr"]')!;
            const copy = card.querySelector<HTMLElement>('[data-testid="output-product-copy"]')!;
            const cardRect = card.getBoundingClientRect();
            const pageRect = page.getBoundingClientRect();
            const qrRect = qr.getBoundingClientRect();
            const copyRect = copy.getBoundingClientRect();
            return {
              cardWidth: cardRect.width,
              cardHeight: cardRect.height,
              qrWidth: qrRect.width,
              contained:
                cardRect.left >= pageRect.left - tolerance &&
                cardRect.top >= pageRect.top - tolerance &&
                cardRect.right <= pageRect.right + tolerance &&
                cardRect.bottom <= pageRect.bottom + tolerance &&
                qrRect.left >= cardRect.left - tolerance &&
                qrRect.top >= cardRect.top - tolerance &&
                qrRect.right <= cardRect.right + tolerance &&
                qrRect.bottom <= cardRect.bottom + tolerance &&
                copyRect.left >= cardRect.left - tolerance &&
                copyRect.top >= cardRect.top - tolerance &&
                copyRect.right <= cardRect.right + tolerance &&
                copyRect.bottom <= cardRect.bottom + tolerance,
            };
          });
          return {
            pageCount: pages.length,
            cardCount: cards.length,
            allContained: measurements.every((row) => row.contained),
            allCardsExact:
              measurements.every((row) => Math.abs(row.cardWidth - (20 * millimetre)) <= tolerance) &&
              measurements.every((row) => Math.abs(row.cardHeight - (15 * millimetre)) <= tolerance),
            minimumQrWidth: Math.min(...measurements.map((row) => row.qrWidth)),
            expectedQrWidth: 8 * millimetre,
          };
        });
      } finally {
        await window.evaluate(() => {
          const testWindow = globalThis as typeof globalThis & {
            __chuOriginalAnimationFrame?: typeof globalThis.requestAnimationFrame;
          };
          if (testWindow.__chuOriginalAnimationFrame) {
            globalThis.requestAnimationFrame = testWindow.__chuOriginalAnimationFrame;
            delete testWindow.__chuOriginalAnimationFrame;
          }
        });
      }
    };

    await window.getByLabel('Media label').selectOption('thermal');
    await window.getByLabel('Jumlah print').fill('1');
    const thermal = await captureLayout('Print label');
    expect(thermal).toMatchObject({ pageCount: 1, cardCount: 1, allContained: true, allCardsExact: true });
    expect(thermal.minimumQrWidth).toBeGreaterThanOrEqual(thermal.expectedQrWidth - 0.75);
    await expect(window.getByTestId('print-document-host')).toHaveCount(0);

    await window.getByRole('button', { name: 'SKU Gudang' }).click();
    await window.getByRole('row', { name: /BRS-108-BLK/ }).getByRole('button', { name: 'Print barcode BRS-108-BLK' }).click();
    await window.getByLabel('Jumlah barcode').fill('1');
    const thermalBarcode = await captureLayout('Print barcode sekarang');
    expect(thermalBarcode).toMatchObject({ pageCount: 1, cardCount: 1, allContained: true, allCardsExact: true });
    expect(thermalBarcode.minimumQrWidth).toBeGreaterThanOrEqual(thermalBarcode.expectedQrWidth - 0.75);
    await window.getByRole('button', { name: 'Tutup print barcode' }).click();

    await window.getByRole('button', { name: 'Template Label & Invoice' }).click();
    await window.getByLabel('Media label').selectOption('a4');
    await window.getByLabel('Jumlah print').fill('51');
    const a4 = await captureLayout('Print label');
    expect(a4).toMatchObject({ pageCount: 1, cardCount: 51, allContained: true, allCardsExact: true });
    expect(a4.minimumQrWidth).toBeGreaterThanOrEqual(a4.expectedQrWidth - 0.75);

    await window.getByRole('button', { name: 'SKU Gudang' }).click();
    await window.getByRole('row', { name: /BRS-108-BLK/ }).getByRole('button', { name: 'Print barcode BRS-108-BLK' }).click();
    await window.getByLabel('Jumlah barcode').fill('51');
    const a4Barcode = await captureLayout('Print barcode sekarang');
    expect(a4Barcode).toMatchObject({ pageCount: 1, cardCount: 51, allContained: true, allCardsExact: true });
    expect(a4Barcode.minimumQrWidth).toBeGreaterThanOrEqual(a4Barcode.expectedQrWidth - 0.75);
  } finally {
    await application.close();
  }
});

test('Ekspor Data uses deterministic filters and the fake PDF bridge without native dialogs', async () => {
  const { application, window } = await launch();
  try {
    await window.getByRole('button', { name: 'Ekspor Data' }).click();
    await expect(window.getByRole('heading', { name: 'Ekspor Data', level: 1 })).toBeVisible();
    await expect(window.getByLabel('Dataset PDF')).toHaveValue('sku-stock');
    await expect(window.getByText('6 cocok · 6 masuk PDF')).toBeVisible();
    await window.getByLabel('Cari data operasional').fill('BRS-108');
    await expect(window.getByText('1 cocok · 1 masuk PDF')).toBeVisible();
    await expect(window.getByRole('row', { name: /BRS-108-BLK/ })).toBeVisible();
    await window.getByRole('button', { name: 'Simpan PDF data operasional' }).click();
    await expect(window.getByRole('status')).toHaveText('PDF data operasional berhasil disimpan.');
    await expect(window.getByRole('dialog')).toHaveCount(0);
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
    await expect(window.getByText('ARSIP · BARANG DIKIRIM NANTI')).toBeVisible();
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
    await expect(window.getByText('ARSIP · BARANG DIKIRIM NANTI')).toBeVisible();
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
