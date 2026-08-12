import { expect, test } from '@playwright/test';
import { launchTestElectron } from './electron-launch';

test('desktop recommendation downloads one catalogue PDF for the active tab', async ({}, testInfo) => {
  const application = await launchTestElectron();
  const window = await application.firstWindow();
  try {
    await window.setViewportSize({ width: 1024, height: 720 });
    await window.getByRole('button', { name: 'Rekomendasi Share' }).click();

    await expect(window.getByRole('button', { name: 'Download PDF Harian' })).toBeVisible();
    await expect(window.getByRole('button', { name: /^Bagikan SKU / })).toHaveCount(0);
    await window.screenshot({ path: testInfo.outputPath('recommendations-page-1024x720.png') });
    await window.getByRole('button', { name: 'Download PDF Harian' }).click();
    await expect(window.getByRole('status')).toHaveText('PDF Rekomendasi Harian berhasil disimpan.');
    await window.getByRole('tab', { name: 'SKU Urgent' }).click();
    await expect(window.getByRole('button', { name: 'Download PDF Urgent' })).toBeVisible();
    expect(await window.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);
    await window.setViewportSize({ width: 1440, height: 900 });
    expect(await window.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true);
  } finally {
    await application.close();
  }
});
