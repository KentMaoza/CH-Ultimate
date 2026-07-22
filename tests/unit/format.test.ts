import { capitalizeSentenceStarts } from '../../src/renderer/format';

test('capitalizes sentence starts while preserving all other typed letters', () => {
  expect(capitalizeSentenceStarts('amelia. tinggal di saipah? ya! selesai\nbaris baru')).toBe('Amelia. Tinggal di saipah? Ya! Selesai\nBaris baru');
  expect(capitalizeSentenceStarts('aMELIA tetap')).toBe('AMELIA tetap');
  expect(capitalizeSentenceStarts('harga 52.000 rupiah. selesai')).toBe('Harga 52.000 rupiah. Selesai');
});

test('preserves existing uppercase sentence starts', () => {
  expect(capitalizeSentenceStarts('CH001')).toBe('CH001');
  expect(capitalizeSentenceStarts('BRS-108-BLK')).toBe('BRS-108-BLK');
});
