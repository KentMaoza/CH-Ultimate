import {
  chmod,
  mkdir,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { readBoundedFile } from './bounded-file-read';
import { CORE_SAFE_STORAGE_UNAVAILABLE_MESSAGE } from './core-bridge-contract';

const FILE_NAME = 'ch-core-credentials.bin';
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
  writeFile: typeof writeFile;
  rename: typeof rename;
  chmod: typeof chmod;
  unlink: typeof unlink;
}

export interface CoreCredentialStoreOptions {
  safeStorage?: SafeStoragePort;
  userDataPath: string;
  fileSystem?: CredentialFileSystem;
  readFile?: (filePath: string, maxBytes: number) => Promise<Buffer>;
}

export interface CoreCredentialStore {
  load(): Promise<CoreCredentialState | undefined>;
  save(state: CoreCredentialState): Promise<void>;
  getCurrentToken(): Promise<string>;
}

const defaultFileSystem: CredentialFileSystem = {
  mkdir,
  writeFile,
  rename,
  chmod,
  unlink,
};

const CREDENTIAL_MAX_BYTES = 256 * 1024;
const opaqueSecretSchema = z.string().refine((value) => {
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length === 32 && decoded.toString('base64url') === value;
  } catch {
    return false;
  }
}, 'Secret must be canonical 32-byte base64url.');
const displayNameSchema = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (value) =>
      value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value),
  );
const currentCredentialSchema = z
  .object({
    deviceId: z.string().uuid(),
    token: opaqueSecretSchema,
  })
  .strict();
const bootstrapEnrollmentSchema = z
  .object({
    mode: z.literal('bootstrap'),
    deviceToken: opaqueSecretSchema,
    recoveryCredential: opaqueSecretSchema,
    nextRecoveryCredential: z.undefined().optional(),
    displayName: displayNameSchema,
  })
  .strict();
const recoveryEnrollmentSchema = z
  .object({
    mode: z.literal('recovery'),
    deviceToken: opaqueSecretSchema,
    recoveryCredential: opaqueSecretSchema,
    nextRecoveryCredential: opaqueSecretSchema,
    displayName: displayNameSchema,
  })
  .strict();
const pairingBase = {
  code: z.string().regex(/^\d{8}$/),
  requestId: z.string().uuid(),
  claimSecret: opaqueSecretSchema,
  displayName: displayNameSchema,
};
const pendingPairingSchema = z.union([
  z.object(pairingBase).strict(),
  z
    .object({
      ...pairingBase,
      pairingId: z.string().uuid(),
      deviceToken: opaqueSecretSchema.optional(),
    })
    .strict(),
]);
const credentialStateSchema = z
  .object({
    version: z.literal(1),
    installationId: z.string().uuid(),
    current: currentCredentialSchema.optional(),
    previousToken: opaqueSecretSchema.optional(),
    recoveryCredential: opaqueSecretSchema.optional(),
    pendingEnrollment: z
      .discriminatedUnion('mode', [
        bootstrapEnrollmentSchema,
        recoveryEnrollmentSchema,
      ])
      .optional(),
    pendingPairing: pendingPairingSchema.optional(),
    pendingRotation: z
      .object({ nextToken: opaqueSecretSchema })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((state, context) => {
    if ((state.previousToken || state.pendingRotation) && !state.current) {
      context.addIssue({
        code: 'custom',
        message: 'Credential rotation requires a current credential.',
      });
    }
  });

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === 'ENOENT'
  );
}

function parseCredentialState(plaintext: string): CoreCredentialState {
  return credentialStateSchema.parse(
    JSON.parse(plaintext) as unknown,
  ) as CoreCredentialState;
}

export function createCoreCredentialStore(
  options: CoreCredentialStoreOptions,
): CoreCredentialStore {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const filePath = path.join(options.userDataPath, FILE_NAME);
  const readFile = options.readFile ?? readBoundedFile;

  const requireSafeStorage = (): SafeStoragePort => {
    if (!options.safeStorage?.isEncryptionAvailable()) {
      throw new Error(CORE_SAFE_STORAGE_UNAVAILABLE_MESSAGE);
    }
    return options.safeStorage;
  };

  return {
    async load(): Promise<CoreCredentialState | undefined> {
      let ciphertext: Buffer;
      try {
        ciphertext = await readFile(filePath, CREDENTIAL_MAX_BYTES);
        if (ciphertext.length > CREDENTIAL_MAX_BYTES) throw new Error();
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
        const validated = credentialStateSchema.parse(state);
        ciphertext = safeStorage.encryptString(JSON.stringify(validated));
        if (
          ciphertext.length === 0 ||
          ciphertext.length > CREDENTIAL_MAX_BYTES
        ) {
          throw new Error();
        }
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
