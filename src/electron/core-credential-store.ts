import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const FILE_NAME = 'ch-core-credentials.bin';
const STORAGE_UNAVAILABLE =
  'Penyimpanan aman tidak tersedia. Perangkat tidak dapat dipasangkan.';
const SAVE_ERROR = 'Kredensial CH Core tidak dapat disimpan.';
const LOAD_ERROR = 'Kredensial CH Core tidak dapat dibuka.';

export interface SafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Buffer;
  decryptString(ciphertext: Buffer): string;
}

export interface CoreCredentialState {
  version: 1;
  installationId: string;
  current?: { deviceId: string; token: string };
  previousToken?: string;
  recoveryCredential?: string;
  pendingEnrollment?: {
    mode: 'bootstrap' | 'recovery';
    deviceToken: string;
    recoveryCredential: string;
    nextRecoveryCredential?: string;
    displayName: string;
  };
  pendingPairing?: {
    code: string;
    requestId: string;
    claimSecret: string;
    displayName: string;
    pairingId?: string;
    deviceToken?: string;
  };
  pendingRotation?: { nextToken: string };
}

interface CredentialFileSystem {
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  writeFile: typeof writeFile;
  rename: typeof rename;
  chmod: typeof chmod;
  unlink: typeof unlink;
}

export interface CoreCredentialStoreOptions {
  safeStorage?: SafeStoragePort;
  userDataPath: string;
  fileSystem?: CredentialFileSystem;
}

export interface CoreCredentialStore {
  load(): Promise<CoreCredentialState | undefined>;
  save(state: CoreCredentialState): Promise<void>;
  getCurrentToken(): Promise<string>;
}

const defaultFileSystem: CredentialFileSystem = {
  mkdir,
  readFile,
  writeFile,
  rename,
  chmod,
  unlink,
};

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === 'ENOENT'
  );
}

function parseCredentialState(plaintext: string): CoreCredentialState {
  const value = JSON.parse(plaintext) as unknown;
  if (
    typeof value !== 'object' ||
    value === null ||
    Reflect.get(value, 'version') !== 1 ||
    typeof Reflect.get(value, 'installationId') !== 'string'
  ) {
    throw new Error(LOAD_ERROR);
  }
  return value as CoreCredentialState;
}

export function createCoreCredentialStore(
  options: CoreCredentialStoreOptions,
): CoreCredentialStore {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const filePath = path.join(options.userDataPath, FILE_NAME);

  const requireSafeStorage = (): SafeStoragePort => {
    if (!options.safeStorage?.isEncryptionAvailable()) {
      throw new Error(STORAGE_UNAVAILABLE);
    }
    return options.safeStorage;
  };

  return {
    async load(): Promise<CoreCredentialState | undefined> {
      let ciphertext: Buffer;
      try {
        ciphertext = await fileSystem.readFile(filePath);
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw new Error(LOAD_ERROR);
      }
      try {
        const plaintext = requireSafeStorage().decryptString(ciphertext);
        return parseCredentialState(plaintext);
      } catch {
        throw new Error(LOAD_ERROR);
      }
    },

    async save(state: CoreCredentialState): Promise<void> {
      const safeStorage = requireSafeStorage();
      let ciphertext: Buffer;
      try {
        ciphertext = safeStorage.encryptString(JSON.stringify(state));
      } catch {
        throw new Error(SAVE_ERROR);
      }
      const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
      try {
        await fileSystem.mkdir(options.userDataPath, {
          recursive: true,
          mode: 0o700,
        });
        await fileSystem.chmod(options.userDataPath, 0o700);
        await fileSystem.writeFile(temporaryPath, ciphertext, {
          flag: 'wx',
          mode: 0o600,
        });
        await fileSystem.chmod(temporaryPath, 0o600);
        await fileSystem.rename(temporaryPath, filePath);
        await fileSystem.chmod(filePath, 0o600);
      } catch {
        try {
          await fileSystem.unlink(temporaryPath);
        } catch {
          // The temporary file may not have been created.
        }
        throw new Error(SAVE_ERROR);
      }
    },

    async getCurrentToken(): Promise<string> {
      const state = await this.load();
      if (!state?.current?.token) {
        throw new Error('Perangkat CH Core belum dipasangkan.');
      }
      return state.current.token;
    },
  };
}
