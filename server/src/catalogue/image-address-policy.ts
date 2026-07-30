import { isIP } from 'node:net';

import {
  imageError,
  type ResolvedImageAddress,
} from './image-download-types.js';

export function requireApprovedImageUrl(input: string | URL): URL {
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

function publicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const bytes = address.split('.').map(Number);
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

export function requirePublicImageAddress(
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
