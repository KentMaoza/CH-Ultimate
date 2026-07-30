import type JSZip from 'jszip';
import { SaxesParser } from 'saxes';

import { CatalogueValidationError } from './xlsx-archive.js';

export const MAX_WORKSHEET_XML_BYTES = 32 * 1024 * 1024;
export const MAX_WORKBOOK_ROWS = 10_001;
export const MAX_WORKBOOK_CELLS = 200_000;
export const MAX_SHARED_STRINGS_XML_BYTES = 32 * 1024 * 1024;
export const MAX_CELL_TEXT_BYTES = 16 * 1024;
const MAX_METADATA_XML_BYTES = 2 * 1024 * 1024;

function invalid(code: string, message: string): never {
  throw new CatalogueValidationError(code, message);
}

function occurrences(xml: string, pattern: RegExp): number {
  let count = 0;
  for (const _match of xml.matchAll(pattern)) count += 1;
  return count;
}

function maximumRowReference(xml: string): number {
  let maximum = 0;
  for (const match of xml.matchAll(/<(?:\w+:)?row\b[^>]*\br=["'](\d+)["']/gi)) {
    const row = Number(match[1]);
    if (!Number.isSafeInteger(row)) {
      invalid('XLSX_TOO_MANY_ROWS', 'Workbook melebihi batas baris aman.');
    }
    maximum = Math.max(maximum, row);
  }
  for (const match of xml.matchAll(/<(?:\w+:)?c\b[^>]*\br=["'][A-Z]+(\d+)["']/gi)) {
    const row = Number(match[1]);
    if (!Number.isSafeInteger(row)) {
      invalid('XLSX_TOO_MANY_ROWS', 'Workbook melebihi batas baris aman.');
    }
    maximum = Math.max(maximum, row);
  }
  return maximum;
}

async function boundedXml(
  archive: JSZip,
  name: string,
  maximumBytes: number,
  code: string,
): Promise<string> {
  const entry = archive.file(name);
  if (!entry) {
    return invalid('MALFORMED_XLSX', `Bagian XLSX ${name} tidak tersedia.`);
  }
  const bytes = await entry.async('nodebuffer');
  if (bytes.length > maximumBytes) {
    return invalid(code, `Bagian XLSX ${name} melebihi batas aman.`);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalid('MALFORMED_XLSX', `Bagian XLSX ${name} tidak valid.`);
  }
}

function assertSafeContentTypes(xml: string): void {
  if (
    /(?:macroenabled|vbaproject|activex|oleobject)/i.test(xml)
  ) {
    invalid('XLSX_MACRO_NOT_ALLOWED', 'Macro XLSX tidak diizinkan.');
  }
}

function assertSafeRelationships(xml: string): void {
  if (
    /TargetMode\s*=\s*["']External["']/i.test(xml) ||
    /Type\s*=\s*["'][^"']*(?:externalLink)[^"']*["']/i.test(xml)
  ) {
    invalid(
      'XLSX_EXTERNAL_LINK_NOT_ALLOWED',
      'Tautan eksternal XLSX tidak diizinkan.',
    );
  }
  if (
    /Type\s*=\s*["'][^"']*(?:vbaProject|activeX|oleObject)[^"']*["']/i.test(
      xml,
    )
  ) {
    invalid('XLSX_MACRO_NOT_ALLOWED', 'Macro XLSX tidak diizinkan.');
  }
}

function assertSafeSharedStrings(xml: string): void {
  let depth = 0;
  let rootSeen = false;
  let activeStringBytes: number | null = null;
  let textDepth: number | null = null;

  const malformed = (): never =>
    invalid('MALFORMED_XLSX', 'Shared string XLSX tidak valid.');
  const localName = (name: string): string =>
    name.slice(name.lastIndexOf(':') + 1);
  const addText = (text: string): void => {
    if (textDepth === null) {
      if (text.trim() !== '') malformed();
      return;
    }
    const priorBytes = activeStringBytes;
    if (priorBytes === null) return malformed();
    const nextBytes = priorBytes + Buffer.byteLength(text, 'utf8');
    activeStringBytes = nextBytes;
    if (nextBytes > MAX_CELL_TEXT_BYTES) {
      invalid(
        'CELL_TEXT_TOO_LONG',
        'Teks shared string XLSX melebihi 16 KiB.',
      );
    }
  };

  const parser = new SaxesParser({ xmlns: false, position: false });
  parser.on('doctype', malformed);
  parser.on('error', malformed);
  parser.on('opentag', (tag) => {
    depth += 1;
    const name = localName(tag.name);
    if (depth === 1) {
      if (rootSeen || name !== 'sst') malformed();
      rootSeen = true;
      return;
    }
    if (!rootSeen || textDepth !== null) malformed();
    if (name === 'si') {
      if (depth !== 2 || activeStringBytes !== null) malformed();
      activeStringBytes = 0;
    } else if (name === 't') {
      if (activeStringBytes === null) malformed();
      textDepth = depth;
    }
  });
  parser.on('text', addText);
  parser.on('cdata', addText);
  parser.on('closetag', (tag) => {
    const name = localName(tag.name);
    if (name === 't') {
      if (textDepth !== depth) malformed();
      textDepth = null;
    } else if (name === 'si') {
      if (activeStringBytes === null || textDepth !== null) malformed();
      activeStringBytes = null;
    }
    depth -= 1;
  });

  parser.write(xml).close();
  if (
    !rootSeen ||
    depth !== 0 ||
    activeStringBytes !== null ||
    textDepth !== null
  ) {
    malformed();
  }
}

export async function assertSafeXlsxPackage(archive: JSZip): Promise<void> {
  const contentTypes = await boundedXml(
    archive,
    '[Content_Types].xml',
    MAX_METADATA_XML_BYTES,
    'XLSX_METADATA_TOO_LARGE',
  );
  assertSafeContentTypes(contentTypes);

  let rowCount = 0;
  let cellCount = 0;
  for (const [name, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    const lowerName = name.toLowerCase();
    if (lowerName === 'xl/sharedstrings.xml') {
      const xml = await boundedXml(
        archive,
        name,
        MAX_SHARED_STRINGS_XML_BYTES,
        'XLSX_SHARED_STRINGS_TOO_LARGE',
      );
      assertSafeSharedStrings(xml);
      continue;
    }
    if (lowerName.endsWith('.rels')) {
      const xml = await boundedXml(
        archive,
        name,
        MAX_METADATA_XML_BYTES,
        'XLSX_METADATA_TOO_LARGE',
      );
      assertSafeRelationships(xml);
      continue;
    }
    if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) continue;

    const xml = await boundedXml(
      archive,
      name,
      MAX_WORKSHEET_XML_BYTES,
      'XLSX_WORKSHEET_TOO_LARGE',
    );
    if (/<(?:\w+:)?f(?:\s|>)/i.test(xml)) {
      invalid(
        'FORMULA_NOT_ALLOWED',
        `Formula tidak diizinkan pada ${name}.`,
      );
    }
    rowCount += occurrences(xml, /<(?:\w+:)?row\b/gi);
    cellCount += occurrences(xml, /<(?:\w+:)?c\b/gi);
    if (
      rowCount > MAX_WORKBOOK_ROWS ||
      maximumRowReference(xml) > MAX_WORKBOOK_ROWS
    ) {
      invalid('XLSX_TOO_MANY_ROWS', 'Workbook melebihi batas baris aman.');
    }
    if (cellCount > MAX_WORKBOOK_CELLS) {
      invalid('XLSX_TOO_MANY_CELLS', 'Workbook melebihi batas sel aman.');
    }
  }
}
