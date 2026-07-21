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
  await window.getByRole('button', { name: 'Nota' }).click();
  await expect(window.getByTestId('chu-nota-workspace')).toBeVisible();
}

async function finishNota(window: Page) {
  await window.getByRole('button', { name: 'Selesaikan nota' }).click();
  const confirmation = window.getByRole('dialog', { name: 'Selesaikan nota?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Selesaikan' }).click();
  await expect(window.getByRole('dialog', { name: 'Daftar Nota' })).toBeVisible();
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

    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await window.setViewportSize(viewport);
      await expect(window.getByRole('columnheader')).toHaveCount(10);
      await expect(window.getByTestId('nota-grid-row-1')).toContainText('1A');
      await expect(window.getByTestId('nota-grid-row-15')).toContainText('15A');
      expect(await window.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await window.screenshot({ path: testInfo.outputPath(`nota-${viewport.width}x${viewport.height}.png`) });
    }

    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await expect(window.getByRole('heading', { name: 'SKU Gudang', level: 1 })).toBeVisible();
    await expect(window.getByRole('navigation', { name: 'Modul CH Ultimate' })).toBeVisible();
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

test('Nota pages support A/B switching and cancellation undo', async () => {
  const { application, window } = await launch();
  try {
    await openNota(window);
    await window.getByRole('button', { name: 'Halaman B' }).click();
    await expect(window.getByTestId('nota-grid-row-1')).toContainText('1B');
    await window.getByRole('button', { name: 'Tambah Nota' }).first().click();
    await expect(window.getByRole('button', { name: 'Halaman C', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await window.getByRole('button', { name: 'Batalkan halaman C' }).click();
    const notice = window.locator('.chu-nota-workspace__notice');
    await expect(notice).toContainText('Halaman C dipindahkan ke Sampah.');
    await notice.getByRole('button', { name: 'Urungkan' }).click();
    await expect(window.getByRole('button', { name: 'Halaman C', exact: true })).toBeVisible();
  } finally {
    await application.close();
  }
});

test('Nota lifecycle posts linked and ad-hoc lines, then import resets the session at reload', async ({}, testInfo) => {
  const { application, window } = await launch();
  try {
    await openNota(window);
    await window.getByLabel('Nama barang baris 3', { exact: true }).fill('Beras Hitam');
    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');
    await expect(window.getByLabel('Nama barang baris 3', { exact: true })).toHaveValue('Beras Hitam Premium 1 kg');
    await window.getByLabel('Jumlah baris 3', { exact: true }).fill('2');
    await window.getByLabel('Nama barang baris 4', { exact: true }).fill('Biaya bungkus manual');
    await window.getByLabel('Jenis baris 4', { exact: true }).fill('Layanan');
    await window.getByLabel('Jumlah baris 4', { exact: true }).fill('1');
    await window.getByLabel('Harga PCS baris 4', { exact: true }).fill('10000');
    await window.getByRole('button', { name: 'PCS baris 4' }).click();
    await finishNota(window);

    await window.getByRole('button', { name: 'Tutup Daftar Nota' }).click();
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await expectStockAndRevenue(window, 21, 141_000);

    await window.getByRole('button', { name: 'Nota' }).click();
    await window.getByRole('button', { name: 'Daftar Nota' }).click();
    await window.getByRole('button', { name: 'Buka kembali' }).click();
    await window.getByRole('dialog', { name: 'Buka kembali nota?' }).getByRole('button', { name: 'Buka kembali' }).click();
    await window.getByLabel('Jumlah baris 3', { exact: true }).fill('3');
    await finishNota(window);
    await window.getByRole('button', { name: 'Tutup Daftar Nota' }).click();
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await expectStockAndRevenue(window, 20, 183_000);

    await window.getByRole('button', { name: 'Nota' }).click();
    await window.getByRole('button', { name: 'Buka Arsip' }).click();
    await window.getByRole('button', { name: 'Buka kembali' }).click();
    await window.getByRole('dialog', { name: 'Buka kembali nota?' }).getByRole('button', { name: 'Buka kembali' }).click();
    await window.getByRole('button', { name: 'Batalkan transaksi' }).click();
    await window.getByRole('dialog', { name: 'Batalkan transaksi?' }).getByRole('button', { name: 'Batalkan' }).click();
    await expect(window.getByRole('dialog', { name: 'Daftar Nota' })).toBeVisible();
    await window.getByRole('button', { name: 'Tutup Daftar Nota' }).click();
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await expectStockAndRevenue(window, 24, 0);

    await window.getByRole('button', { name: 'Nota' }).click();
    await window.getByRole('button', { name: 'Buka Arsip' }).click();
    await window.getByRole('tab', { name: 'Sampah' }).click();
    await window.getByRole('dialog', { name: 'Daftar Nota' }).getByRole('button', { name: 'Pulihkan transaksi' }).click();
    await expect(window.getByRole('dialog', { name: 'Nota Dikerjakan' })).toBeVisible();
    await window.getByRole('button', { name: 'Tutup Nota Dikerjakan' }).click();
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await expectStockAndRevenue(window, 20, 0);

    await window.getByRole('button', { name: 'Nota' }).click();
    await finishNota(window);
    await window.getByRole('button', { name: 'Tutup Daftar Nota' }).click();
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

    await window.getByRole('button', { name: 'Nota' }).click();
    await expect(window.getByText('Belum ada nota yang sedang dikerjakan pada sesi ini.')).toBeVisible();

    await window.reload({ waitUntil: 'domcontentloaded' });
    await expect(window.getByText('DEMO DATA · SESSION ONLY')).toBeVisible();
    await expect(window.getByTestId('sku-stock-sku-1')).toHaveText('24');
    await expect(window.getByText('6 SKU', { exact: true })).toBeVisible();
    await window.getByRole('button', { name: 'Nota' }).click();
    await expect(window.getByRole('button', { name: 'Halaman A', exact: true })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Halaman B', exact: true })).toBeVisible();
    await expect(window.getByLabel('Pelanggan', { exact: true })).toHaveValue('Amelia');
    await expect(window.getByLabel('Tempat', { exact: true })).toHaveValue('Saibah');
    await expect(window.getByLabel('Nama barang baris 3', { exact: true })).toHaveValue('');
  } finally {
    await application.close();
  }
});
