const WITA_OFFSET_MS = 8 * 60 * 60 * 1_000;

export function formatWitaBusinessDate(instant: Date): string {
  return new Date(instant.getTime() + WITA_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

export function formatWitaNotaNumber(
  businessDate: string,
  sequence: number,
): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
    !Number.isInteger(sequence) ||
    sequence < 1
  ) {
    throw new Error('Invalid Nota number input');
  }
  if (sequence > 9_999) {
    throw new Error('Nota daily sequence is exhausted');
  }
  return `CHU-${businessDate.replaceAll('-', '')}-${String(sequence).padStart(4, '0')}`;
}
