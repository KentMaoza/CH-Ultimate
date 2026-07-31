import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
    JSON.stringify({ endpoint: 'https://192.168.1.14:8443' }),
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
  it('seeds the fixed endpoint and public CA into user data', async () => {
    const fixture = await deploymentFixture();

    const configPath = await ensurePackagedCoreDeployment(fixture);
    const caFile = join(fixture.userDataPath, 'ch-core-ca.pem');

    expect(configPath).toBe(join(fixture.userDataPath, 'ch-core-config.json'));
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toEqual({
      endpoint: 'https://192.168.1.14:8443',
      caFile,
    });
    expect(await readFile(caFile, 'utf8')).toContain('BEGIN CERTIFICATE');
  });

  it('does not overwrite an existing installation config or CA', async () => {
    const fixture = await deploymentFixture();
    await mkdir(fixture.userDataPath, { recursive: true });
    const configPath = join(fixture.userDataPath, 'ch-core-config.json');
    const caFile = join(fixture.userDataPath, 'ch-core-ca.pem');
    await writeFile(configPath, '{"preserved":true}');
    await writeFile(caFile, 'preserved-ca');

    await ensurePackagedCoreDeployment(fixture);

    expect(await readFile(configPath, 'utf8')).toBe('{"preserved":true}');
    expect(await readFile(caFile, 'utf8')).toBe('preserved-ca');
  });

  it('rejects extra deployment keys before writing user data', async () => {
    const fixture = await deploymentFixture();
    await writeFile(
      join(fixture.resourcesPath, 'ch-core-deployment.json'),
      JSON.stringify({
        endpoint: 'https://192.168.1.14:8443',
        fallback: 'https://example.com',
      }),
    );

    await expect(ensurePackagedCoreDeployment(fixture)).rejects.toThrow(
      'Konfigurasi deployment CH Core tidak valid.',
    );
  });
});
