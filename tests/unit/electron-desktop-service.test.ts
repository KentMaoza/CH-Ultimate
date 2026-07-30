import type { RequestOptions } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

import type {
  CoreCredentialState,
  CoreCredentialStore,
} from '../../src/electron/core-credential-store';
import { createCoreDesktopService } from '../../src/electron/core-desktop-service';

class MemoryCredentialStore implements CoreCredentialStore {
  constructor(public state?: CoreCredentialState) {}
  async load() {
    return this.state;
  }
  async save(state: CoreCredentialState) {
    this.state = state;
  }
  async getCurrentToken() {
    if (!this.state?.current) throw new Error('missing');
    return this.state.current.token;
  }
}

const configPath = '/private/ch-core-config.json';
const caFile = '/private/ch-core-ca.pem';
const currentToken = Buffer.alloc(32, 1).toString('base64url');
const recoveryCredential = Buffer.alloc(32, 2).toString('base64url');

describe('CH Core desktop service configuration', () => {
  it('fails closed when the config or private CA exceeds its bounded read limit', async () => {
    const validConfig = JSON.stringify({
      endpoint: 'https://192.168.1.14:8443',
      caFile,
    });
    const oversizedConfig = Buffer.from(
      `${validConfig}${' '.repeat(64 * 1024)}`,
    );
    const oversizedCa = Buffer.alloc(1024 * 1024, 1);

    for (const [oversizedPath, oversizedBytes, expectedMessage] of [
      [
        configPath,
        oversizedConfig,
        'Konfigurasi CH Core tidak dapat dibuka.',
      ],
      [caFile, oversizedCa, 'Sertifikat CH Core tidak dapat dibuka.'],
    ] as const) {
      const readFile = vi.fn(async (filePath: string) => {
        if (filePath === oversizedPath) return oversizedBytes;
        return Buffer.from(validConfig);
      });
      const service = await createCoreDesktopService({
        configPath,
        production: true,
        store: new MemoryCredentialStore(),
        readFile,
        platform: 'macos',
      });

      await expect(service.credentialStatus()).resolves.toMatchObject({
        configuration: 'invalid',
        message: expectedMessage,
      });
    }
  });

  it('fails closed with a public setup status when config is missing', async () => {
    const network = vi.fn();
    const readFile = vi.fn(async () => {
      const error = new Error('missing');
      Object.assign(error, { code: 'ENOENT' });
      throw error;
    });
    const service = await createCoreDesktopService({
      configPath,
      production: true,
      store: new MemoryCredentialStore(),
      readFile,
      requestImpl: network,
      platform: 'macos',
    });

    await expect(service.credentialStatus()).resolves.toEqual({
      production: true,
      configuration: 'missing',
      credential: 'unpaired',
      message: 'Konfigurasi CH Core belum tersedia.',
    });
    await expect(
      service.request({ method: 'GET', path: '/v1/bootstrap' }),
    ).rejects.toThrow('CH Core belum dikonfigurasi.');
    expect(network).not.toHaveBeenCalled();
  });

  it('fails closed when the configured private CA cannot be loaded', async () => {
    const network = vi.fn();
    const readFile = vi.fn(async (filePath: string) => {
      if (filePath === configPath) {
        return Buffer.from(
          JSON.stringify({
            endpoint: 'https://192.168.1.14:8443',
            caFile,
          }),
        );
      }
      throw new Error('CA missing');
    });
    const service = await createCoreDesktopService({
      configPath,
      production: true,
      store: new MemoryCredentialStore(),
      readFile,
      requestImpl: network,
      platform: 'macos',
    });

    await expect(service.credentialStatus()).resolves.toMatchObject({
      production: true,
      configuration: 'invalid',
      credential: 'unpaired',
      message: 'Sertifikat CH Core tidak dapat dibuka.',
    });
    await expect(
      service.request({ method: 'GET', path: '/v1/bootstrap' }),
    ).rejects.toThrow('CH Core belum dikonfigurasi.');
    expect(network).not.toHaveBeenCalled();
  });

  it('reports only non-secret paired status when config and credentials are ready', async () => {
    const readFile = vi.fn(async (filePath: string) =>
      filePath === configPath
        ? Buffer.from(
            JSON.stringify({
              endpoint: 'https://192.168.1.14:8443',
              caFile,
            }),
          )
        : Buffer.from('private-ca'),
    );
    const requestImpl = vi.fn((_options: RequestOptions) => {
      throw new Error('not called by status');
    });
    const store = new MemoryCredentialStore({
      version: 1,
      installationId: '11111111-1111-4111-8111-111111111111',
      current: {
        deviceId: '22222222-2222-4222-8222-222222222222',
        token: currentToken,
      },
      recoveryCredential,
    });
    const service = await createCoreDesktopService({
      configPath,
      production: true,
      store,
      readFile,
      requestImpl,
      platform: 'macos',
    });

    const status = await service.credentialStatus();

    expect(status).toEqual({
      production: true,
      configuration: 'ready',
      credential: 'paired',
      deviceId: '22222222-2222-4222-8222-222222222222',
    });
    expect(JSON.stringify(status)).not.toContain(currentToken);
    expect(JSON.stringify(status)).not.toContain(recoveryCredential);
  });
});
