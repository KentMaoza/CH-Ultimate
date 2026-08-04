import { resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let mobileUrl: string;

test.beforeAll(async () => {
  server = await createServer({
    configFile: resolve(process.cwd(), 'vite.mobile.config.ts'),
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const address = server.httpServer?.address() as AddressInfo | null;
  if (!address) throw new Error('Server mobile tidak memiliki alamat uji.');
  mobileUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await server.close();
});

test('six mobile nav labels stay contained at 360 px and 200 percent text', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(mobileUrl, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Cek Stok' }).click();
  await page.getByRole('heading', { name: 'Cek Stok', level: 1 }).waitFor();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });

  const measurements = await page.locator('.bottom-nav').evaluate((nav) => ({
    nav: { clientWidth: nav.clientWidth, scrollWidth: nav.scrollWidth },
    items: [...nav.querySelectorAll<HTMLButtonElement>('button')].map((button) => {
      const label = button.querySelector<HTMLElement>('.bottom-nav__label');
      return {
        item: { clientWidth: button.clientWidth, scrollWidth: button.scrollWidth },
        label: label
          ? { clientWidth: label.clientWidth, scrollWidth: label.scrollWidth }
          : null,
      };
    }),
  }));

  expect(measurements.items).toHaveLength(6);
  expect(measurements.nav.scrollWidth).toBeLessThanOrEqual(measurements.nav.clientWidth);
  for (const measurement of measurements.items) {
    expect(measurement.item.scrollWidth).toBeLessThanOrEqual(measurement.item.clientWidth);
    expect(measurement.label).not.toBeNull();
    expect(measurement.label!.scrollWidth).toBeLessThanOrEqual(measurement.label!.clientWidth);
  }
});
