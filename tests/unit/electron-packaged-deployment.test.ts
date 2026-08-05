import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensurePackagedCoreDeployment } from '../../src/electron/core-packaged-deployment';

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'ch-core-packaged-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function deploymentFixture() {
  const root = await temporaryDirectory();
  const resourcesPath = join(root, 'resources');
  const userDataPath = join(root, 'user-data');
  await mkdir(resourcesPath, { recursive: true });
  await writeFile(
    join(resourcesPath, 'ch-core-deployment.json'),
    JSON.stringify({ endpoint: 'https://192.168.50.14:8443' }),
  );
  await writeFile(
    join(resourcesPath, 'ch-core-ca.pem'),
    '-----BEGIN CERTIFICATE-----\npublic-ca\n-----END CERTIFICATE-----\n',
  );
  return { resourcesPath, userDataPath };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('packaged CH Core deployment bootstrap', () => {
  it('uses a Vite-managed relative renderer asset for the sidebar mark', async () => {
    const [app, rendererConfig] = await Promise.all([
      readFile('src/renderer/App.tsx', 'utf8'),
      readFile('vite.renderer.config.ts', 'utf8'),
    ]);

    expect(app).toContain(
      "import chUltimateMark from './assets/ch-ultimate-mark.svg';",
    );
    expect(app).not.toContain('src="/brand/ch-ultimate-mark.svg"');
    expect(rendererConfig).toContain("base: './'");
  });

  it('seeds the fixed endpoint and public CA into user data', async () => {
    const fixture = await deploymentFixture();

    const configPath = await ensurePackagedCoreDeployment(fixture);
    const caFile = join(fixture.userDataPath, 'ch-core-ca.pem');

    expect(configPath).toBe(join(fixture.userDataPath, 'ch-core-config.json'));
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      endpoint: 'https://192.168.50.14:8443',
      caFile,
    });
    expect(await readFile(caFile, 'utf8')).toContain('BEGIN CERTIFICATE');
  });

  it('migrates only the exact old canonical config without changing its CA', async () => {
    const fixture = await deploymentFixture();
    await mkdir(fixture.userDataPath, { recursive: true });
    const configPath = join(fixture.userDataPath, 'ch-core-config.json');
    const caFile = join(fixture.userDataPath, 'ch-core-ca.pem');
    await writeFile(
      configPath,
      JSON.stringify({
        endpoint: 'https://192.168.1.14:8443',
        caFile,
      }),
      { mode: 0o600 },
    );
    await writeFile(caFile, 'old-private-ca', { mode: 0o600 });

    await ensurePackagedCoreDeployment(fixture);

    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      endpoint: 'https://192.168.50.14:8443',
      caFile,
    });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(caFile, 'utf8')).toBe('old-private-ca');

    await ensurePackagedCoreDeployment(fixture);

    expect(await readFile(caFile, 'utf8')).toBe('old-private-ca');
  });

  it('preserves custom, malformed, and extra-key configs with the existing CA', async () => {
    const configs = [
      '{"preserved":true}',
      'not-json',
      JSON.stringify({
        endpoint: 'https://192.168.1.14:8443',
        caFile: '/custom/ch-core-ca.pem',
      }),
      JSON.stringify({
        endpoint: 'https://192.168.1.14:8443',
        caFile: '/private/ch-core-ca.pem',
        extra: true,
      }),
    ];

    for (const contents of configs) {
      const fixture = await deploymentFixture();
      await mkdir(fixture.userDataPath, { recursive: true });
      const configPath = join(fixture.userDataPath, 'ch-core-config.json');
      const caFile = join(fixture.userDataPath, 'ch-core-ca.pem');
      await writeFile(configPath, contents, { mode: 0o600 });
      await writeFile(caFile, 'preserved-ca', { mode: 0o600 });

      await ensurePackagedCoreDeployment(fixture);

      expect(await readFile(configPath, 'utf8')).toBe(contents);
      expect(await readFile(caFile, 'utf8')).toBe('preserved-ca');
    }
  });

  it('rejects extra deployment keys before writing user data', async () => {
    const fixture = await deploymentFixture();
    await writeFile(
      join(fixture.resourcesPath, 'ch-core-deployment.json'),
      JSON.stringify({
        endpoint: 'https://192.168.50.14:8443',
        fallback: 'https://example.com',
      }),
    );

    await expect(ensurePackagedCoreDeployment(fixture)).rejects.toThrow(
      'Konfigurasi deployment CH Core tidak valid.',
    );
  });
});
