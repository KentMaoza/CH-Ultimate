import { _electron as electron, expect, test } from '@playwright/test';

test('launches CH Ultimate and switches operational modules', async ({}, testInfo) => {
  const application = await electron.launch({ args: ['.vite/build/main.js'] });
  try {
    const window = await application.firstWindow();
    await expect(window).toHaveTitle('CH Ultimate');
    await expect(window.getByText('DEMO DATA · SESSION ONLY')).toBeVisible();
    await window.keyboard.press('Tab');
    await expect(window.getByRole('button', { name: 'Kecilkan navigasi' })).toBeFocused();
    await window.keyboard.press('Enter');
    await expect(window.getByRole('button', { name: 'Besarkan navigasi' })).toBeVisible();
    await window.keyboard.press('Enter');
    await expect(window.getByRole('button', { name: 'Kecilkan navigasi' })).toBeVisible();

    for (const viewport of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await window.setViewportSize(viewport);
      await expect(window.getByRole('navigation', { name: 'Modul CH Ultimate' })).toBeVisible();
      expect(
        await window.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await window.screenshot({
        path: testInfo.outputPath(`inventory-${viewport.width}x${viewport.height}.png`),
      });
    }

    await window.getByRole('button', { name: 'Label' }).click();
    await expect(window.getByRole('heading', { name: 'Label', level: 1 })).toBeVisible();
    await expect(window.getByTestId('label-qr')).toBeVisible();
  } finally {
    await application.close();
  }
});
