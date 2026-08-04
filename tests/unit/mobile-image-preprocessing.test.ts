import { expect, test } from 'vitest';

import { preprocessMobileSkuImage } from '../../mobile/image-preprocessing';

test('corrects orientation through the decoder, scales the longest edge to 1600, and iterates JPEG quality under five MiB', async () => {
  const close = vi.fn();
  const decode = vi.fn(async () => ({ width: 4000, height: 2000, source: {} as CanvasImageSource, close }));
  const encode = vi.fn(async (_source, width: number, height: number, quality: number) => {
    const size = quality > 0.7 ? (5 * 1024 * 1024) + 1 : 1024;
    return new Blob([new Uint8Array(size)], { type: 'image/jpeg' });
  });

  const result = await preprocessMobileSkuImage(
    new File(['photo'], 'photo.heic', { type: 'image/heic' }),
    { decode, encode },
  );

  expect(decode).toHaveBeenCalledOnce();
  expect(encode.mock.calls.map((call) => call.slice(1))).toEqual([
    [1600, 800, 0.9],
    [1600, 800, 0.8],
    [1600, 800, 0.7],
  ]);
  expect(result.type).toBe('image/jpeg');
  expect(result.size).toBeLessThanOrEqual(5 * 1024 * 1024);
  expect(close).toHaveBeenCalledOnce();
});

test('rejects a non-image before decoding', async () => {
  const decode = vi.fn();
  await expect(preprocessMobileSkuImage(
    new File(['text'], 'note.txt', { type: 'text/plain' }),
    { decode, encode: vi.fn() },
  )).rejects.toThrow('Pilih file gambar yang valid.');
  expect(decode).not.toHaveBeenCalled();
});
