import { describe, expect, it } from 'vitest';

import { formatWitaBusinessDate, formatWitaNotaNumber } from '../src/nota/numbering.js';

describe('Nota WITA numbering', () => {
  it('uses the WITA business date across the UTC day boundary', () => {
    const instant = new Date('2026-07-29T16:30:00.000Z');
    expect(formatWitaBusinessDate(instant)).toBe('2026-07-30');
    expect(formatWitaNotaNumber('2026-07-30', 7)).toBe('CHU-20260730-0007');
  });

  it('rejects an exhausted daily sequence', () => {
    expect(() => formatWitaNotaNumber('2026-07-30', 10_000)).toThrow(
      'Nota daily sequence is exhausted',
    );
  });
});
