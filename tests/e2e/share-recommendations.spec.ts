import { _electron as electron, expect, test } from '@playwright/test';

test('desktop recommendation downloads one catalogue PDF for the active tab', async ({}, testInfo) => {
  const application = await electron.launch({ args: ['.vite/build/main.js'] });
  const window = await application.firstWindow();
  try {
    await window.setViewportSize({ width: 1024, height: 720 });
    await window.getByRole('button', { name: 'Rekomendasi Share' }).click();
    const recommendationDate = await window.getByLabel('Tanggal rekomendasi').inputValue();

    await expect(window.getByRole('button', { name: 'Download PDF Harian' })).toBeVisible();
    await expect(window.getByRole('button', { name: /^Bagikan SKU / })).toHaveCount(0);
    await window.screenshot({ path: testInfo.outputPath('recommendations-page-1024x720.png') });
    await window.evaluate(() => {
      const testWindow = window as typeof window & {
        __recommendationPdf?: { blob?: Blob; fileName?: string; revokedUrl?: string };
      };
      testWindow.__recommendationPdf = {};
      URL.createObjectURL = (blob) => {
        if (blob instanceof Blob) testWindow.__recommendationPdf!.blob = blob;
        return 'blob:recommendation-pdf';
      };
      URL.revokeObjectURL = (url) => {
        testWindow.__recommendationPdf!.revokedUrl = url;
      };
      HTMLAnchorElement.prototype.click = function click() {
        testWindow.__recommendationPdf!.fileName = this.download;
      };
    });
    await window.getByRole('button', { name: 'Download PDF Harian' }).click();
    await expect(window.getByRole('status')).toHaveText('PDF Rekomendasi Harian berhasil diunduh.');
    const download = await window.evaluate(async () => {
      const captured = (window as typeof window & {
        __recommendationPdf?: { blob?: Blob; fileName?: string; revokedUrl?: string };
      }).__recommendationPdf;
      const bytes = new Uint8Array(await captured!.blob!.arrayBuffer());
      return {
        fileName: captured?.fileName,
        type: captured?.blob?.type,
        size: captured?.blob?.size,
        signature: String.fromCharCode(...bytes.slice(0, 4)),
        revokedUrl: captured?.revokedUrl,
      };
    });
    expect(download).toMatchObject({
      fileName: `CHU-Rekomendasi-Harian-${recommendationDate}.pdf`,
      type: 'application/pdf',
      signature: '%PDF',
      revokedUrl: 'blob:recommendation-pdf',
    });
    expect(download.size).toBeGreaterThan(1_000);
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
