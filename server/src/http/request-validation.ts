import { z } from 'zod';

import { IdentityError } from '../auth/identity.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uuid = z.string().regex(UUID_PATTERN);
const opaqueSecret = z.string().refine((value) => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === value;
});
const installation = {
  installationId: uuid,
  displayName: z.string().trim().min(1).max(160),
  platform: z.string().trim().min(1).max(32),
};

export const ownerBootstrapBody = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('bootstrap'),
      bootstrapSecret: z.string().min(1),
      deviceToken: opaqueSecret,
      recoveryCredential: opaqueSecret,
      ...installation,
    })
    .strict(),
  z
    .object({
      mode: z.literal('recovery'),
      recoveryCredential: opaqueSecret,
      nextRecoveryCredential: opaqueSecret,
      deviceToken: opaqueSecret,
      ...installation,
    })
    .strict(),
]);

export const pairingRedeemBody = z.discriminatedUnion('phase', [
  z
    .object({
      phase: z.literal('claim'),
      code: z.string().regex(/^\d{8}$/),
      requestId: uuid,
      claimSecret: opaqueSecret,
      ...installation,
    })
    .strict(),
  z
    .object({
      phase: z.literal('complete'),
      pairingId: uuid,
      claimSecret: opaqueSecret,
      deviceToken: opaqueSecret,
    })
    .strict(),
]);

export const rotateTokenBody = z
  .object({ nextDeviceToken: opaqueSecret })
  .strict();

export const uuidPath = z.object({ id: uuid }).strict();

const decimalLimit = z
  .string()
  .regex(/^[1-9]\d{0,2}$/)
  .transform((value) => Number.parseInt(value, 10))
  .refine((value) => value <= 500);

export const changesQuery = z
  .object({
    after: z.string().regex(/^(0|[1-9]\d*)$/),
    limit: decimalLimit.default(100),
  })
  .strict();

const emptyObject = z.object({}).strict();
const noBody = z.undefined();

export function parseRequest<T>(
  schema: z.ZodType<T>,
  value: unknown,
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new IdentityError('INVALID_REQUEST', 400, 'Invalid request');
  }
  return parsed.data;
}

export function requireEmptyQuery(value: unknown): void {
  parseRequest(emptyObject, value);
}

export function requireNoBody(value: unknown): void {
  parseRequest(noBody, value);
}
