import { formatTitleCaseWords } from '../../src/renderer/format';

test('formats every typed word as title case', () => {
  expect(formatTitleCaseWords('amelia pelanggan lama')).toBe('Amelia Pelanggan Lama');
  expect(formatTitleCaseWords('baju hITAM ukuran besar')).toBe('Baju Hitam Ukuran Besar');
  expect(formatTitleCaseWords('harga 52.000 rupiah\nbaris baru')).toBe('Harga 52.000 Rupiah\nBaris Baru');
});

test('preserves uppercase codes and normalizes CH supplier codes', () => {
  expect(formatTitleCaseWords('kaos wanita ch001 XL')).toBe('Kaos Wanita CH001 XL');
  expect(formatTitleCaseWords('BRS-108-BLK')).toBe('BRS-108-BLK');
});
