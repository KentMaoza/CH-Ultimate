import { _electron as electron, expect, test } from '@playwright/test';

test('desktop recommendation opens a stock-free fallback for one SKU', async ({}, testInfo) => {
  const application = await electron.launch({ args: ['.vite/build/main.js'] });
  const window = await application.firstWindow();
  try {
    await window.setViewportSize({ width: 1024, height: 720 });
    await window.evaluate(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    });
    await window.getByRole('button', { name: 'Rekomendasi Share' }).click();

    await expect(window.getByRole('button', { name: /Ekspor PDF/i })).toHaveCount(0);
    const shareButton = window.getByRole('button', { name: /^Bagikan SKU / }).first();
    await expect(shareButton).toBeVisible();
    await window.screenshot({ path: testInfo.outputPath('recommendations-page-1024x720.png') });
    await shareButton.click();

    const dialog = window.getByRole('dialog', { name: 'Bagikan SKU' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/^SKU:/)).toBeVisible();
    await expect(dialog.getByText(/^Rp/)).toBeVisible();
    await expect(dialog.getByText(/Stok/i)).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Salin informasi' }).click();
    await expect(dialog.getByRole('status')).toHaveText('Informasi SKU disalin.');
    expect(await window.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);
    await window.screenshot({ path: testInfo.outputPath('share-dialog-1024x720.png') });
    await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
    await window.setViewportSize({ width: 1440, height: 900 });
    expect(await window.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);
  } finally {
    await application.close();
  }
});
