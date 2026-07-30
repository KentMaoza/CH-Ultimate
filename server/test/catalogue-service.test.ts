import { createHash } from 'node:crypto';

import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';

import {
  CatalogueService,
  type CatalogueCommitResult,
  type CatalogueImportRecord,
  type CatalogueRepository,
  type PrivateCatalogueStorage,
} from '../src/catalogue/service.js';

const owner = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'owner' as const,
};
const client = { ...owner, role: 'client' as const };

async function workbookBytes(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('SKU');
  sheet.addRow([
    'Nomor SKU',
    'Judul',
    'Modal Referensi',
    'Harga Jual Referensi',
    'Semua Total Stok',
    'Tautan Gambar',
    'Catatan SKU Gudang',
    'Kode Produk',
    'Waktu Dibuat',
  ]);
  sheet.addRow([
    'SKU-A',
    'Produk A',
    12000,
    15000,
    12,
    'https://res.bigseller.pro/a.jpg',
    'Rak A',
    '87000001',
    '2026-07-30 09:24',
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function harness(expectedWorkbookSha256?: string) {
  const records = new Map<string, CatalogueImportRecord>();
  const committed = new Map<string, CatalogueCommitResult>();
  const stored = new Map<string, Buffer>();
  const storage: PrivateCatalogueStorage = {
    writeStaged: vi.fn(async (sha256, bytes) => {
      const path = `staged/${sha256}.xlsx`;
      stored.set(path, Buffer.from(bytes));
      return path;
    }),
    readStaged: vi.fn(async (path) => Buffer.from(stored.get(path)!)),
  };
  const repository: CatalogueRepository = {
    findByHash: vi.fn(async (hash) =>
      [...records.values()].find((record) => record.workbookSha256 === hash) ??
      null,
    ),
    findById: vi.fn(async (id) => records.get(id) ?? null),
    createStage: vi.fn(async (record) => {
      records.set(record.id, structuredClone(record));
      return record;
    }),
    commit: vi.fn(async (record, workbook, committedAt) => {
      const existing = committed.get(record.id);
      if (existing) return { ...existing, replayed: true };
      const result: CatalogueCommitResult = {
        importId: record.id,
        workbookSha256: record.workbookSha256,
        rowCount: workbook.preview.rowCount,
        imageJobCount: workbook.preview.imageJobCount,
        committedAt: committedAt.toISOString(),
        replayed: false,
      };
      committed.set(record.id, result);
      records.set(record.id, {
        ...record,
        status: 'committed',
        result,
        committedAt: committedAt.toISOString(),
      });
      return result;
    }),
  };
  return {
    service: new CatalogueService({
      repository,
      storage,
      now: () => new Date('2026-07-30T01:30:00.000Z'),
      randomUuid: () => '22222222-2222-4222-8222-222222222222',
      ...(expectedWorkbookSha256 ? { expectedWorkbookSha256 } : {}),
    }),
    repository,
    storage,
  };
}

describe('staged catalogue service', () => {
  it('stages the owner workbook for 24 hours and reuses an identical hash', async () => {
    const bytes = await workbookBytes();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { service, repository, storage } = harness(sha256);

    const first = await service.validate(owner, {
      fileName: 'catalogue.xlsx',
      bytes,
    });
    const replay = await service.validate(owner, {
      fileName: 'renamed.xlsx',
      bytes,
    });

    expect(first).toMatchObject({
      importId: '22222222-2222-4222-8222-222222222222',
      workbookSha256: sha256,
      sourceFileName: 'catalogue.xlsx',
      status: 'staged',
      expiresAt: '2026-07-31T01:30:00.000Z',
      preview: { rowCount: 1, imageJobCount: 1 },
    });
    expect(replay).toEqual(first);
    expect(storage.writeStaged).toHaveBeenCalledOnce();
    expect(repository.createStage).toHaveBeenCalledOnce();
  });

  it('commits once and returns the original result on replay', async () => {
    const bytes = await workbookBytes();
    const { service, repository } = harness();
    const stage = await service.validate(owner, {
      fileName: 'catalogue.xlsx',
      bytes,
    });

    const first = await service.commit(owner, stage.importId);
    const replay = await service.commit(owner, stage.importId);

    expect(first).toMatchObject({
      importId: stage.importId,
      rowCount: 1,
      imageJobCount: 1,
      committedAt: '2026-07-30T01:30:00.000Z',
      replayed: false,
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(repository.commit).toHaveBeenCalledOnce();
  });

  it('allows only owners and rejects an unexpected production workbook hash', async () => {
    const bytes = await workbookBytes();
    const { service } = harness('0'.repeat(64));

    await expect(
      service.validate(client, { fileName: 'catalogue.xlsx', bytes }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    await expect(
      service.validate(owner, { fileName: 'catalogue.xlsx', bytes }),
    ).rejects.toMatchObject({
      code: 'UNEXPECTED_WORKBOOK_HASH',
      statusCode: 422,
    });
  });
});
