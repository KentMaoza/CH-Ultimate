import { _electron as electron, expect, test, type Page } from '@playwright/test';

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

test('Nota keyboard essentials retain focus and grid traversal', async () => {
  const { application, window } = await launch();
  try {
    await openNota(window);
    const back = window.getByRole('button', { name: 'Kembali ke CH Ultimate' });
    await back.focus();
    await window.keyboard.press('Control+K');
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

test('Nota completion lifecycle updates stock and report, then reload restores seeded session data', async () => {
  const { application, window } = await launch();
  try {
    await openNota(window);
    await window.getByLabel('Nama barang baris 3', { exact: true }).fill('Beras Hitam');
    await window.keyboard.press('ArrowDown');
    await window.keyboard.press('Enter');
    await expect(window.getByTestId('nota-grid-row-3').getByText('BRS-108-BLK')).toBeVisible();
    await window.getByLabel('Jumlah baris 3', { exact: true }).fill('2');
    await finishNota(window);

    await window.getByRole('button', { name: 'Tutup Daftar Nota' }).click();
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await window.getByRole('button', { name: 'SKU Gudang' }).click();
    await expect(window.getByRole('row', { name: /BRS-108-BLK/ })).toContainText('21');
    await window.getByRole('button', { name: 'Laporan Omzet' }).click();
    await expect(window.locator('.metric-grid > div').first().getByText('Rp 131.000')).toBeVisible();

    await window.getByRole('button', { name: 'Nota' }).click();
    await window.getByRole('button', { name: 'Daftar Nota' }).click();
    await window.getByRole('button', { name: 'Buka kembali' }).click();
    await window.getByRole('dialog', { name: 'Buka kembali nota?' }).getByRole('button', { name: 'Buka kembali' }).click();
    await window.getByLabel('Jumlah baris 3', { exact: true }).fill('3');
    await finishNota(window);
    await window.getByRole('button', { name: 'Tutup Daftar Nota' }).click();
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await window.getByRole('button', { name: 'SKU Gudang' }).click();
    await expect(window.getByRole('row', { name: /BRS-108-BLK/ })).toContainText('20');

    await window.getByRole('button', { name: 'Nota' }).click();
    await window.getByRole('button', { name: 'Buka Arsip' }).click();
    await window.getByRole('button', { name: 'Buka kembali' }).click();
    await window.getByRole('dialog', { name: 'Buka kembali nota?' }).getByRole('button', { name: 'Buka kembali' }).click();
    await window.getByRole('button', { name: 'Batalkan transaksi' }).click();
    await window.getByRole('dialog', { name: 'Batalkan transaksi?' }).getByRole('button', { name: 'Batalkan' }).click();
    await window.getByRole('dialog', { name: 'Daftar Nota' }).getByRole('button', { name: 'Pulihkan transaksi' }).click();
    await expect(window.getByRole('dialog', { name: 'Nota Dikerjakan' })).toBeVisible();
    await window.getByRole('button', { name: 'Tutup Nota Dikerjakan' }).click();
    await window.getByRole('button', { name: 'Kembali ke CH Ultimate' }).click();
    await window.getByRole('button', { name: 'SKU Gudang' }).click();
    await expect(window.getByRole('row', { name: /BRS-108-BLK/ })).toContainText('20');

    await window.goto(window.url(), { waitUntil: 'domcontentloaded' });
    await expect(window.getByText('DEMO DATA · SESSION ONLY')).toBeVisible();
    await window.getByRole('button', { name: 'Nota' }).click();
    await expect(window.getByRole('button', { name: 'Halaman A', exact: true })).toBeVisible();
    await expect(window.getByRole('button', { name: 'Halaman B', exact: true })).toBeVisible();
    await expect(window.getByLabel('Nama barang baris 3', { exact: true })).toHaveValue('');
  } finally {
    await application.close();
  }
});
