import { IdempotencyError } from './idempotency-contract.js';

function canonicalValue(value: unknown): string {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new IdempotencyError(
        'INVALID_JSON',
        400,
        'Payload must be valid JSON',
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(',')}]`;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(object[key])}`)
      .join(',')}}`;
  }
  throw new IdempotencyError(
    'INVALID_JSON',
    400,
    'Payload must be valid JSON',
  );
}

export function canonicalizeJson(value: unknown): string {
  return canonicalValue(value);
}

export function parseStoredJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value);
  }
  if (Buffer.isBuffer(value)) {
    return JSON.parse(value.toString('utf8'));
  }
  return value;
}
