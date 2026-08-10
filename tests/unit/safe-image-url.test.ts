import { describe, expect, it } from 'vitest';

import { safeRemoteImageUrl } from '../../src/gateway/safe-image-url';

describe('safe remote image URL', () => {
  it('accepts only the same HTTPS image host approved by CH Core', () => {
    expect(
      safeRemoteImageUrl('https://res.bigseller.pro/catalogue/a.jpg'),
    ).toBe('https://res.bigseller.pro/catalogue/a.jpg');

    for (const value of [
      'http://res.bigseller.pro/catalogue/a.jpg',
      'https://example.test/a.jpg',
      'https://127.0.0.1/a.jpg',
      'https://192.168.50.14/a.jpg',
      'https://[::1]/a.jpg',
      'https://user:password@res.bigseller.pro/a.jpg',
      'https://res.bigseller.pro:8443/a.jpg',
      'javascript:alert(1)',
    ]) {
      expect(safeRemoteImageUrl(value)).toBe('');
    }
  });
});
