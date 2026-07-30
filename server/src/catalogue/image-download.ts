import { lookup as nodeLookup } from 'node:dns/promises';
import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
} from 'node:http';
import {
  request as nodeHttpsRequest,
  type RequestOptions,
} from 'node:https';
import { isIP } from 'node:net';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_IMAGE_DIMENSION = 12_000;
const MAX_IMAGE_PIXELS = 40_000_000;

export class ImageDownloadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImageDownloadError';
  }
}

export interface ResolvedImageAddress {
  address: string;
  family: number;
}

export interface ImageFetchInput {
  url: URL;
  address: string;
  family: number;
  timeoutMs: number;
  maximumBytes: number;
}

export interface ImageFetchResponse {
  status: number;
  headers: Record<string, string | undefined>;
  bytes: Buffer;
}

export interface ImageDownloadDependencies {
  resolve(hostname: string): Promise<ResolvedImageAddress[]>;
  fetch(input: ImageFetchInput): Promise<ImageFetchResponse>;
}

export interface DownloadedCatalogueImage {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

type RequestImplementation = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

function imageError(code: string, message: string): never {
  throw new ImageDownloadError(code, message);
}

function requireApprovedUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch {
    return imageError(
      'IMAGE_URL_NOT_ALLOWED',
      'Tautan gambar tidak diizinkan.',
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname.toLowerCase() !== 'res.bigseller.pro' ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return imageError(
      'IMAGE_URL_NOT_ALLOWED',
      'Tautan gambar tidak diizinkan.',
    );
  }
  return url;
}

function ipv4Bytes(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const bytes = address.split('.').map(Number);
  return bytes.length === 4 ? bytes : null;
}

function publicIpv4(address: string): boolean {
  const bytes = ipv4Bytes(address);
  if (!bytes) return false;
  const [first, second, third] = bytes;
  if (first === undefined || second === undefined || third === undefined) {
    return false;
  }
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function expandedIpv6(address: string): number[] | null {
  if (isIP(address) !== 6 || address.includes('.')) return null;
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const words = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ].map((word) => Number.parseInt(word || '0', 16));
  return words.length === 8 &&
    words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null;
}

function publicIpv6(address: string): boolean {
  const words = expandedIpv6(address);
  if (!words) return false;
  const first = words[0]!;
  const second = words[1]!;
  return (
    (first & 0xe000) === 0x2000 &&
    !(first === 0x2001 && second === 0x0db8) &&
    first !== 0x2002
  );
}

function requirePublicAddresses(
  addresses: ResolvedImageAddress[],
): ResolvedImageAddress {
  if (
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) =>
        !(
          (family === 4 && publicIpv4(address)) ||
          (family === 6 && publicIpv6(address))
        ),
    )
  ) {
    return imageError(
      'IMAGE_ADDRESS_NOT_PUBLIC',
      'Alamat jaringan gambar tidak publik.',
    );
  }
  return addresses[0]!;
}

function contentType(headers: Record<string, string | undefined>): string {
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

function validateImage(
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

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function createPinnedImageFetch(
  requestImpl: RequestImplementation = nodeHttpsRequest,
): ImageDownloadDependencies['fetch'] {
  return (input) =>
    new Promise((resolve, reject) => {
      let settled = false;
      let totalTimer: NodeJS.Timeout | undefined;
      const finish = (
        action: () => void,
      ): void => {
        if (settled) return;
        settled = true;
        if (totalTimer) clearTimeout(totalTimer);
        action();
      };
      const fail = (code: string, message: string): void =>
        finish(() => reject(new ImageDownloadError(code, message)));
      const request = requestImpl(
        {
          protocol: 'https:',
          hostname: input.address,
          family: input.family,
          port: 443,
          servername: input.url.hostname,
          method: 'GET',
          path: `${input.url.pathname}${input.url.search}`,
          headers: {
            accept: 'image/png,image/jpeg,image/gif,image/webp',
            host: input.url.host,
          },
          rejectUnauthorized: true,
          timeout: input.timeoutMs,
        },
        (response) => {
          const length = Number(headerValue(response.headers, 'content-length'));
          if (Number.isFinite(length) && length > input.maximumBytes) {
            response.destroy();
            fail('IMAGE_TOO_LARGE', 'Ukuran gambar melebihi 5 MiB.');
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer | string) => {
            if (settled) return;
            const encoded = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk);
            size += encoded.length;
            if (size > input.maximumBytes) {
              response.destroy();
              fail('IMAGE_TOO_LARGE', 'Ukuran gambar melebihi 5 MiB.');
              return;
            }
            chunks.push(encoded);
          });
          response.on('error', () =>
            fail('IMAGE_NETWORK_ERROR', 'Gambar tidak dapat diunduh.'),
          );
          response.on('end', () =>
            finish(() =>
              resolve({
                status: response.statusCode ?? 0,
                headers: {
                  'content-type': headerValue(
                    response.headers,
                    'content-type',
                  ),
                  location: headerValue(response.headers, 'location'),
                },
                bytes: Buffer.concat(chunks),
              }),
            ),
          );
        },
      );
      request.on('error', () =>
        fail('IMAGE_NETWORK_ERROR', 'Gambar tidak dapat diunduh.'),
      );
      request.setTimeout(input.timeoutMs, () => {
        request.destroy();
        fail(
          'IMAGE_TIMEOUT',
          'Pengunduhan gambar melewati batas waktu.',
        );
      });
      totalTimer = setTimeout(() => {
        request.destroy();
        fail(
          'IMAGE_TIMEOUT',
          'Pengunduhan gambar melewati batas waktu.',
        );
      }, input.timeoutMs);
      totalTimer.unref();
      request.end();
    });
}

const defaultDependencies: ImageDownloadDependencies = {
  resolve: (hostname) =>
    nodeLookup(hostname, { all: true, verbatim: true }).then((addresses) =>
      addresses.map(({ address, family }) => ({ address, family })),
    ),
  fetch: createPinnedImageFetch(),
};

export class CatalogueImageDownloader {
  constructor(
    private readonly dependencies: ImageDownloadDependencies =
      defaultDependencies,
  ) {}

  async download(sourceUrl: string): Promise<DownloadedCatalogueImage> {
    let url = requireApprovedUrl(sourceUrl);
    for (let redirectCount = 0; ; redirectCount += 1) {
      const pinned = requirePublicAddresses(
        await this.dependencies.resolve(url.hostname),
      );
      const response = await this.dependencies.fetch({
        url,
        address: pinned.address,
        family: pinned.family,
        timeoutMs: IMAGE_TIMEOUT_MS,
        maximumBytes: MAX_IMAGE_BYTES,
      });
      if (response.status >= 300 && response.status <= 399) {
        if (redirectCount >= MAX_REDIRECTS) {
          return imageError(
            'IMAGE_TOO_MANY_REDIRECTS',
            'Pengalihan gambar melebihi batas.',
          );
        }
        const location = response.headers.location;
        if (!location) {
          return imageError(
            'IMAGE_INVALID_REDIRECT',
            'Tujuan pengalihan gambar tidak valid.',
          );
        }
        try {
          url = requireApprovedUrl(new URL(location, url));
        } catch (error) {
          if (error instanceof ImageDownloadError) throw error;
          return imageError(
            'IMAGE_INVALID_REDIRECT',
            'Tujuan pengalihan gambar tidak valid.',
          );
        }
        continue;
      }
      if (response.status !== 200) {
        return imageError(
          'IMAGE_HTTP_ERROR',
          'Server gambar mengembalikan respons gagal.',
        );
      }
      const metadata = validateImage(
        response.bytes,
        contentType(response.headers),
      );
      return { bytes: response.bytes, ...metadata };
    }
  }
}
