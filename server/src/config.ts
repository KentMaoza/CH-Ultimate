import { isAbsolute, resolve } from 'node:path';

import { z } from 'zod';

export const APPROVED_INITIAL_CATALOGUE_SHA256 =
  'f18d41b93197a59be3b3b93c5b68ce841716f9eb91b5f0912a81c50470b07d78';

const databaseUrl = z.string().min(1).refine((value) => {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'mariadb:' || parsed.protocol === 'mysql:') &&
      parsed.hostname.length > 0 &&
      parsed.username.length > 0 &&
      parsed.password.length > 0 &&
      /^\/[^/]+$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
});

const environmentSchema = z.object({
  CH_CORE_HOST: z.string().min(1).default('0.0.0.0'),
  CH_CORE_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  CH_CORE_DATABASE_URL: databaseUrl,
  CH_CORE_DATABASE_SOCKET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .refine(
        (value) =>
          isAbsolute(value) &&
          resolve(value) !== '/' &&
          !/[\u0000-\u001f\u007f]/.test(value),
      )
      .optional(),
  ),
  CH_CORE_DB_POOL_MAX: z.coerce.number().int().min(1).max(4).default(4),
  CH_CORE_PRIVATE_STORAGE_ROOT: z
    .string()
    .refine(
      (value) =>
        isAbsolute(value) &&
        resolve(value) !== '/' &&
        !/[\u0000-\u001f\u007f]/.test(value),
    )
    .default('/var/lib/ch-core/private'),
  CH_CORE_INITIAL_CATALOGUE_SHA256: z
    .literal(APPROVED_INITIAL_CATALOGUE_SHA256)
    .default(APPROVED_INITIAL_CATALOGUE_SHA256),
  CH_CORE_OWNER_BOOTSTRAP_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .refine((value) => Buffer.byteLength(value, 'utf8') >= 32)
      .optional(),
  ),
});

export interface ServerConfig {
  host: string;
  port: number;
  databaseUrl: string;
  databaseSocket?: string;
  dbPoolMax: number;
  privateStorageRoot: string;
  initialCatalogueSha256: string;
  ownerBootstrapSecret?: string;
}

export function loadServerConfig(
  env: Record<string, string | undefined>,
): ServerConfig {
  const result = environmentSchema.safeParse(env);
  if (!result.success) {
    throw new Error('Invalid CH Core server configuration');
  }

  return {
    host: result.data.CH_CORE_HOST,
    port: result.data.CH_CORE_PORT,
    databaseUrl: result.data.CH_CORE_DATABASE_URL,
    ...(result.data.CH_CORE_DATABASE_SOCKET === undefined
      ? {}
      : {
          databaseSocket: result.data.CH_CORE_DATABASE_SOCKET,
        }),
    dbPoolMax: result.data.CH_CORE_DB_POOL_MAX,
    privateStorageRoot: result.data.CH_CORE_PRIVATE_STORAGE_ROOT,
    initialCatalogueSha256:
      result.data.CH_CORE_INITIAL_CATALOGUE_SHA256,
    ...(result.data.CH_CORE_OWNER_BOOTSTRAP_SECRET === undefined
      ? {}
      : {
          ownerBootstrapSecret:
            result.data.CH_CORE_OWNER_BOOTSTRAP_SECRET,
        }),
  };
}
