import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCoreCredentialStore,
  type CoreCredentialState,
  type SafeStoragePort,
} from '../../src/electron/core-credential-store';

const temporaryDirectories: string[] = [];

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chu-credentials-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function encryptedSafeStorage(): SafeStoragePort {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext) =>
      Buffer.from(`encrypted:${Buffer.from(plaintext).toString('base64')}`),
    decryptString: (ciphertext) => {
      const value = ciphertext.toString();
      if (!value.startsWith('encrypted:')) throw new Error('corrupt');
      return Buffer.from(value.slice('encrypted:'.length), 'base64').toString();
    },
  };
}

const currentToken = Buffer.alloc(32, 1).toString('base64url');
const recoveryCredential = Buffer.alloc(32, 2).toString('base64url');
const claimSecret = Buffer.alloc(32, 3).toString('base64url');
const pendingDeviceToken = Buffer.alloc(32, 4).toString('base64url');
const replacementToken = Buffer.alloc(32, 6).toString('base64url');

const credentialState: CoreCredentialState = {
  version: 1,
  installationId: '11111111-1111-4111-8111-111111111111',
  current: {
    deviceId: '22222222-2222-4222-8222-222222222222',
    token: currentToken,
  },
  recoveryCredential,
  pendingPairing: {
    code: '12345678',
    requestId: '33333333-3333-4333-8333-333333333333',
    claimSecret,
    displayName: 'Mac Gudang',
  },
};

describe('safeStorage credential persistence', () => {
  it('rejects malformed decrypted credential states with strict nested validation', async () => {
    const invalidStates: unknown[] = [
      { ...credentialState, unexpected: true },
      { ...credentialState, installationId: 'not-a-uuid' },
      {
        ...credentialState,
        current: { ...credentialState.current, role: 'owner' },
      },
      {
        ...credentialState,
        current: {
          ...credentialState.current,
          token: 'structurally-plausible-secret',
        },
      },
      {
        version: 1,
        installationId: credentialState.installationId,
        pendingPairing: {
          ...credentialState.pendingPairing,
          deviceToken: pendingDeviceToken,
        },
      },
      {
        version: 1,
        installationId: credentialState.installationId,
        pendingEnrollment: {
          mode: 'recovery',
          deviceToken: pendingDeviceToken,
          recoveryCredential,
          displayName: 'Perangkat Gudang',
        },
      },
    ];

    for (const state of invalidStates) {
      const userDataPath = await temporaryDirectory();
      const safeStorage = encryptedSafeStorage();
      await writeFile(
        path.join(userDataPath, 'ch-core-credentials.bin'),
        safeStorage.encryptString(JSON.stringify(state)),
      );
      const store = createCoreCredentialStore({ safeStorage, userDataPath });

      await expect(store.load()).rejects.toThrow(
        'Kredensial CH Core tidak dapat dibuka.',
      );
    }
  });

  it('refuses to persist a malformed credential state', async () => {
    const userDataPath = await temporaryDirectory();
    const store = createCoreCredentialStore({
      safeStorage: encryptedSafeStorage(),
      userDataPath,
    });

    await expect(
      store.save({
        ...credentialState,
        current: {
          ...credentialState.current!,
          token: '',
        },
      }),
    ).rejects.toThrow('Kredensial CH Core tidak dapat disimpan.');
    expect(await readdir(userDataPath)).toEqual([]);
  });

  it('rejects an oversized encrypted credential before decryption', async () => {
    const userDataPath = await temporaryDirectory();
    const safeStorage = encryptedSafeStorage();
    safeStorage.decryptString = vi.fn(() => JSON.stringify(credentialState));
    await writeFile(
      path.join(userDataPath, 'ch-core-credentials.bin'),
      Buffer.alloc(1024 * 1024, 1),
    );
    const store = createCoreCredentialStore({ safeStorage, userDataPath });

    await expect(store.load()).rejects.toThrow(
      'Kredensial CH Core tidak dapat dibuka.',
    );
    expect(safeStorage.decryptString).not.toHaveBeenCalled();
  });

  it('fails enrollment when safeStorage is unavailable or encryption is disabled', async () => {
    for (const safeStorage of [
      undefined,
      { ...encryptedSafeStorage(), isEncryptionAvailable: () => false },
    ]) {
      const userDataPath = await temporaryDirectory();
      const store = createCoreCredentialStore({ safeStorage, userDataPath });

      await expect(store.save(credentialState)).rejects.toThrow(
        'Penyimpanan aman tidak tersedia. Perangkat tidak dapat dipasangkan.',
      );
      expect(await readdir(userDataPath)).toEqual([]);
    }
  });

  it('persists only encrypted bytes with restrictive permissions', async () => {
    const userDataPath = await temporaryDirectory();
    const store = createCoreCredentialStore({
      safeStorage: encryptedSafeStorage(),
      userDataPath,
    });

    await store.save(credentialState);

    const files = await readdir(userDataPath);
    expect(files).toEqual(['ch-core-credentials.bin']);
    const filePath = path.join(userDataPath, files[0]!);
    const bytes = await readFile(filePath);
    expect(bytes.toString()).not.toContain('current-device-token');
    expect(bytes.toString()).not.toContain('owner-recovery-credential');
    expect(bytes.toString()).not.toContain('pending-claim-secret');
    if (process.platform !== 'win32') {
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
      expect((await stat(userDataPath)).mode & 0o777).toBe(0o700);
    }
    await expect(store.load()).resolves.toEqual(credentialState);
  });

  it('keeps the previous credential file intact when atomic promotion fails', async () => {
    const userDataPath = await temporaryDirectory();
    const rename = vi
      .fn<typeof import('node:fs/promises').rename>()
      .mockImplementationOnce(
        async (oldPath, newPath) =>
          import('node:fs/promises').then((fs) => fs.rename(oldPath, newPath)),
      )
      .mockRejectedValueOnce(new Error('disk unavailable'));
    const store = createCoreCredentialStore({
      safeStorage: encryptedSafeStorage(),
      userDataPath,
      fileSystem: {
        ...await import('node:fs/promises'),
        rename,
      },
    });
    await store.save(credentialState);

    await expect(
      store.save({
        ...credentialState,
        current: {
          ...credentialState.current!,
          token: replacementToken,
        },
      }),
    ).rejects.toThrow('Kredensial CH Core tidak dapat disimpan.');

    await expect(store.load()).resolves.toEqual(credentialState);
  });

  it('fails generically when safeStorage cannot decrypt the credential file', async () => {
    const userDataPath = await temporaryDirectory();
    const safeStorage = encryptedSafeStorage();
    const store = createCoreCredentialStore({ safeStorage, userDataPath });
    await store.save(credentialState);
    safeStorage.decryptString = () => {
      throw new Error('keychain changed');
    };

    await expect(store.load()).rejects.toThrow(
      'Kredensial CH Core tidak dapat dibuka.',
    );
  });
});
