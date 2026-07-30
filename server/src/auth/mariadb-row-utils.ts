export function hexToUuid(value: unknown): string {
  const hex = String(value).toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error('Database returned an invalid UUID');
  }
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

export function nullableHexToUuid(value: unknown): string | null {
  return value === null || value === undefined ? null : hexToUuid(value);
}

export function databaseDate(value: unknown): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error('Database returned an invalid timestamp');
  }
  return date;
}

export function nullableDatabaseDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : databaseDate(value);
}

export function databaseDateOnly(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('Database returned an invalid date');
    }
    return value.toISOString().slice(0, 10);
  }
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error('Database returned an invalid date');
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new Error('Database returned an invalid date');
  }
  return text;
}

export function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ER_DUP_ENTRY'
  );
}
