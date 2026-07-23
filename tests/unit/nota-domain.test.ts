import { linePieces, lineTotal, noteSuffixFromIndex, selectedPrice, suggestedPrice } from '../../src/domain/nota';

test('uses spreadsheet-style suffixes and a 12-piece lsn conversion', () => {
  expect(noteSuffixFromIndex(0)).toBe('A');
  expect(noteSuffixFromIndex(25)).toBe('Z');
  expect(noteSuffixFromIndex(26)).toBe('AA');
  expect(suggestedPrice(42_000, 'lsn')).toBe(504_000);
});

test('selects the active price and converts lsn quantities to pieces', () => {
  const line = { id: 'l1', description: 'Beras', kind: 'Pangan', quantity: 2, unit: 'lsn' as const, pcsPrice: 42_000, lsnPrice: 504_000 };
  expect(selectedPrice(line)).toBe(504_000);
  expect(lineTotal(line)).toBe(1_008_000);
  expect(linePieces(line)).toBe(24);
});

test('derives an lsn total from twelve pieces when only a pcs price is entered', () => {
  const fallbackLine = {
    id: 'fallback', description: 'Barang', kind: '', quantity: 5,
    unit: 'lsn' as const, pcsPrice: 165_000, lsnPrice: 0,
  };
  const overrideLine = { ...fallbackLine, lsnPrice: 1_900_000 };

  expect(selectedPrice(fallbackLine)).toBe(1_980_000);
  expect(lineTotal(fallbackLine)).toBe(9_900_000);
  expect(selectedPrice(overrideLine)).toBe(1_900_000);
  expect(lineTotal(overrideLine)).toBe(9_500_000);
  expect(linePieces(fallbackLine)).toBe(60);
});
