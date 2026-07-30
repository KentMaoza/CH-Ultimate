import { inflateRawSync } from 'node:zlib';

export const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const MAX_XLSX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_XLSX_ENTRIES = 2_048;
const END_RECORD_BYTES = 22;
const MAX_ZIP_COMMENT_BYTES = 65_535;

export class CatalogueValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogueValidationError';
  }
}

function invalid(code: string, message: string): never {
  throw new CatalogueValidationError(code, message);
}

function findEndRecord(bytes: Buffer): number {
  const minimum = Math.max(
    0,
    bytes.length - END_RECORD_BYTES - MAX_ZIP_COMMENT_BYTES,
  );
  for (let offset = bytes.length - END_RECORD_BYTES; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return invalid('MALFORMED_XLSX_ZIP', 'Arsip XLSX tidak valid.');
}

function safeEntryName(name: string): boolean {
  return (
    name.length > 0 &&
    !name.startsWith('/') &&
    !name.includes('\\') &&
    !name.includes('\0') &&
    !name.split('/').some((segment) => segment === '..')
  );
}

export function assertSafeXlsxArchive(bytes: Buffer): void {
  if (bytes.length > MAX_XLSX_BYTES) {
    invalid('XLSX_TOO_LARGE', 'Ukuran XLSX melebihi 5 MiB.');
  }
  if (bytes.length < END_RECORD_BYTES) {
    invalid('MALFORMED_XLSX_ZIP', 'Arsip XLSX tidak valid.');
  }

  const endOffset = findEndRecord(bytes);
  const commentLength = bytes.readUInt16LE(endOffset + 20);
  if (endOffset + END_RECORD_BYTES + commentLength !== bytes.length) {
    invalid('MALFORMED_XLSX_ZIP', 'Arsip XLSX tidak valid.');
  }
  const disk = bytes.readUInt16LE(endOffset + 4);
  const directoryDisk = bytes.readUInt16LE(endOffset + 6);
  const diskEntries = bytes.readUInt16LE(endOffset + 8);
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const directorySize = bytes.readUInt32LE(endOffset + 12);
  const directoryOffset = bytes.readUInt32LE(endOffset + 16);
  if (
    disk !== 0 ||
    directoryDisk !== 0 ||
    diskEntries !== entryCount ||
    entryCount === 0 ||
    entryCount > MAX_XLSX_ENTRIES ||
    entryCount === 0xffff ||
    directoryOffset === 0xffffffff ||
    directorySize === 0xffffffff ||
    directoryOffset + directorySize !== endOffset
  ) {
    invalid('MALFORMED_XLSX_ZIP', 'Arsip XLSX tidak valid.');
  }

  const names = new Set<string>();
  let expandedBytes = 0;
  let offset = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > endOffset ||
      bytes.readUInt32LE(offset) !== 0x02014b50
    ) {
      invalid('MALFORMED_XLSX_ZIP', 'Direktori XLSX tidak valid.');
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const compressionMethod = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const expandedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const entryCommentLength = bytes.readUInt16LE(offset + 32);
    const entryDisk = bytes.readUInt16LE(offset + 34);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const nextOffset =
      offset + 46 + nameLength + extraLength + entryCommentLength;
    if (
      nameLength === 0 ||
      nextOffset > endOffset ||
      entryDisk !== 0 ||
      localOffset === 0xffffffff ||
      expandedSize === 0xffffffff ||
      compressedSize === 0xffffffff ||
      (flags & 1) !== 0 ||
      ![0, 8].includes(compressionMethod) ||
      compressedSize > bytes.length ||
      localOffset + 30 > directoryOffset ||
      bytes.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      invalid('MALFORMED_XLSX_ZIP', 'Entri XLSX tidak valid.');
    }
    const name = bytes
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8');
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localDataOffset =
      localOffset + 30 + localNameLength + localExtraLength;
    if (
      !safeEntryName(name) ||
      names.has(name) ||
      localDataOffset + compressedSize > directoryOffset ||
      bytes
        .subarray(localOffset + 30, localOffset + 30 + localNameLength)
        .toString('utf8') !== name
    ) {
      invalid('MALFORMED_XLSX_ZIP', 'Nama entri XLSX tidak valid.');
    }
    names.add(name);
    const compressed = bytes.subarray(
      localDataOffset,
      localDataOffset + compressedSize,
    );
    let actualExpandedSize: number;
    try {
      actualExpandedSize =
        compressionMethod === 0
          ? compressed.length
          : inflateRawSync(compressed, {
              maxOutputLength:
                MAX_XLSX_EXPANDED_BYTES - expandedBytes + 1,
            }).length;
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        Reflect.get(error, 'code') === 'ERR_BUFFER_TOO_LARGE'
      ) {
        invalid(
          'XLSX_EXPANSION_TOO_LARGE',
          'Ekspansi arsip XLSX melebihi batas aman.',
        );
      }
      invalid('MALFORMED_XLSX_ZIP', 'Data entri XLSX tidak valid.');
    }
    expandedBytes += actualExpandedSize;
    if (
      !Number.isSafeInteger(expandedBytes) ||
      expandedBytes > MAX_XLSX_EXPANDED_BYTES
    ) {
      invalid(
        'XLSX_EXPANSION_TOO_LARGE',
        'Ekspansi arsip XLSX melebihi batas aman.',
      );
    }
    if (actualExpandedSize !== expandedSize) {
      invalid('MALFORMED_XLSX_ZIP', 'Ukuran entri XLSX tidak valid.');
    }

    const lowerName = name.toLowerCase();
    if (
      lowerName.endsWith('vbaproject.bin') ||
      lowerName.endsWith('vbaprojectsignature.bin') ||
      lowerName.includes('/activex/')
    ) {
      invalid('XLSX_MACRO_NOT_ALLOWED', 'Macro XLSX tidak diizinkan.');
    }
    if (lowerName.startsWith('xl/externallinks/')) {
      invalid(
        'XLSX_EXTERNAL_LINK_NOT_ALLOWED',
        'Tautan eksternal XLSX tidak diizinkan.',
      );
    }
    offset = nextOffset;
  }
  if (
    offset !== endOffset ||
    !names.has('[Content_Types].xml') ||
    !names.has('xl/workbook.xml')
  ) {
    invalid('MALFORMED_XLSX_ZIP', 'Struktur XLSX tidak lengkap.');
  }
}
