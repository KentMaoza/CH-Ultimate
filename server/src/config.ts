import { isAbsolute, resolve } from 'node:path';

import { z } from 'zod';

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
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
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
  dbPoolMax: number;
  privateStorageRoot: string;
  initialCatalogueSha256?: string;
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
    dbPoolMax: result.data.CH_CORE_DB_POOL_MAX,
    privateStorageRoot: result.data.CH_CORE_PRIVATE_STORAGE_ROOT,
    ...(result.data.CH_CORE_INITIAL_CATALOGUE_SHA256 === undefined
      ? {}
      : {
          initialCatalogueSha256:
            result.data.CH_CORE_INITIAL_CATALOGUE_SHA256,
        }),
    ...(result.data.CH_CORE_OWNER_BOOTSTRAP_SECRET === undefined
      ? {}
      : {
          ownerBootstrapSecret:
            result.data.CH_CORE_OWNER_BOOTSTRAP_SECRET,
        }),
  };
}
