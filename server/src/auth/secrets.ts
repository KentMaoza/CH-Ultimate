import {
  createHash,
  timingSafeEqual,
} from 'node:crypto';

export const TOKEN_BYTES = 32;
export const TOKEN_LIFETIME_MS = 180 * 24 * 60 * 60 * 1_000;
export const PREVIOUS_TOKEN_OVERLAP_MS = 7 * 24 * 60 * 60 * 1_000;
export const PAIRING_LIFETIME_MS = 10 * 60 * 1_000;

export function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

export function hashSecret(secret: Buffer | string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function hashesEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function configuredSecretsMatch(
  expected: string,
  presented: string,
): boolean {
  return hashesEqual(hashSecret(expected), hashSecret(presented));
}

export function decodeOpaqueSecret(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.length !== TOKEN_BYTES ||
    decoded.toString('base64url') !== value
  ) {
    return null;
  }
  return decoded;
}
