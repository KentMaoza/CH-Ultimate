import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const endpoint = 'https://192.168.50.14:8443';
const caFingerprint =
  '39:7C:7A:74:5A:F5:99:ED:D7:F8:98:CE:FF:50:D3:F5:11:7C:7F:7D:1B:61:00:AC:8F:9C:AB:7D:E9:98:76:3C';

describe('pilot deployment assets', () => {
  it('bundles the same fixed endpoint and public CA for Android and Windows', async () => {
    const [windowsDeployment, windowsCa, androidConfig, androidCa] =
      await Promise.all([
        readFile('resources/ch-core-deployment.json', 'utf8'),
        readFile('resources/ch-core-ca.pem', 'utf8'),
        readFile(
          'android/app/src/main/res/values/ch_core_config.xml',
          'utf8',
        ),
        readFile('android/app/src/main/res/raw/ch_core_ca.pem', 'utf8'),
      ]);

    expect(JSON.parse(windowsDeployment)).toEqual({ endpoint });
    expect(androidConfig).toContain(
      `<string name="ch_core_endpoint" translatable="false">${endpoint}</string>`,
    );
    expect(androidCa).toBe(windowsCa);
    expect(new X509Certificate(androidCa).fingerprint256).toBe(caFingerprint);
  });
});
