import { describe, expect, test } from 'vitest';
import { notaPageTheme } from '../../src/renderer/nota/nota-page-colors';

describe('nota page colors', () => {
  test('locks A red, B blue, C yellow, and repeats A for AA', () => {
    expect(notaPageTheme(0)).toEqual({ background: '#D32F2F', foreground: '#FFFFFF' });
    expect(notaPageTheme(1)).toEqual({ background: '#1565C0', foreground: '#FFFFFF' });
    expect(notaPageTheme(2)).toEqual({ background: '#FBC02D', foreground: '#111111' });
    expect(notaPageTheme(26)).toEqual(notaPageTheme(0));
  });

  test('gives every A-Z page a unique solid color', () => {
    const colors = Array.from({ length: 26 }, (_, index) => notaPageTheme(index).background);
    expect(new Set(colors).size).toBe(26);
  });
});
