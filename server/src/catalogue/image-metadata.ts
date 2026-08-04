import {
  imageError,
  MAX_IMAGE_BYTES,
  type DownloadedCatalogueImage,
} from './image-download-types.js';

const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;

export function imageContentType(
  headers: Record<string, string | undefined>,
): string {
  return (headers['content-type'] ?? '')
    .split(';', 1)[0]!
    .trim()
    .toLowerCase();
}

function pngDimensions(bytes: Buffer): [number, number] | null {
  return bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    bytes.subarray(12, 16).toString('ascii') === 'IHDR'
    ? [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
    : null;
}

function gifDimensions(bytes: Buffer): [number, number] | null {
  const signature = bytes.subarray(0, 6).toString('ascii');
  return bytes.length >= 10 &&
    (signature === 'GIF87a' || signature === 'GIF89a')
    ? [bytes.readUInt16LE(6), bytes.readUInt16LE(8)]
    : null;
}

function jpegDimensions(bytes: Buffer): [number, number] | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const starts = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (starts.has(marker) && length >= 7) {
      return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    }
    offset += length;
  }
  return null;
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function webpDimensions(bytes: Buffer): [number, number] | null {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return null;
  }
  const kind = bytes.subarray(12, 16).toString('ascii');
  if (kind === 'VP8X') {
    return [
      readUInt24LE(bytes, 24) + 1,
      readUInt24LE(bytes, 27) + 1,
    ];
  }
  if (
    kind === 'VP8 ' &&
    bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))
  ) {
    return [
      bytes.readUInt16LE(26) & 0x3fff,
      bytes.readUInt16LE(28) & 0x3fff,
    ];
  }
  if (kind === 'VP8L' && bytes[20] === 0x2f) {
    const packed = bytes.readUInt32LE(21);
    return [(packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1];
  }
  return null;
}

export function validateCatalogueImage(
  bytes: Buffer,
  declaredMime: string,
): Omit<DownloadedCatalogueImage, 'bytes'> {
  if (bytes.length > MAX_IMAGE_BYTES) {
    return imageError('IMAGE_TOO_LARGE', 'Ukuran gambar melebihi 5 MiB.');
  }
  const parsers: Record<
    string,
    (source: Buffer) => [number, number] | null
  > = {
    'image/png': pngDimensions,
    'image/jpeg': jpegDimensions,
    'image/gif': gifDimensions,
    'image/webp': webpDimensions,
  };
  const parser = parsers[declaredMime];
  if (!parser) {
    return imageError(
      'IMAGE_MIME_NOT_ALLOWED',
      'Jenis gambar tidak diizinkan.',
    );
  }
  const dimensions = parser(bytes);
  if (!dimensions) {
    return imageError(
      'IMAGE_MAGIC_MISMATCH',
      'Isi gambar tidak sesuai dengan jenisnya.',
    );
  }
  const [width, height] = dimensions;
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    return imageError(
      'IMAGE_DIMENSIONS_NOT_ALLOWED',
      'Dimensi gambar melebihi batas aman.',
    );
  }
  return { mimeType: declaredMime, width, height };
}
