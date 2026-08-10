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

function harness(
  expectedWorkbookSha256: string,
  initialNow = new Date('2026-07-30T01:30:00.000Z'),
) {
  let currentNow = initialNow;
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
    deleteStaged: vi.fn(async (path) => {
      stored.delete(path);
    }),
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
    refreshStage: vi.fn(async (record) => {
      records.set(record.id, structuredClone(record));
      return record;
    }),
    listExpiredStagePaths: vi.fn(async (expiredAt) =>
      [...records.values()]
        .filter(
          (record) =>
            record.status === 'staged' &&
            new Date(record.expiresAt).getTime() <= expiredAt.getTime(),
        )
        .map((record) => record.stagedPath),
    ),
    commit: vi.fn(async (record, workbook, committedAt) => {
      const existing = committed.get(record.id);
      if (existing) return { ...existing, replayed: true };
      const result: CatalogueCommitResult = {
        importId: record.id,
        workbookSha256: record.workbookSha256,
        rowCount: workbook.preview.rowCount,
        imageJobCount: workbook.preview.imageJobCount,
        matchedExistingCount: 0,
        createdSkuCount: workbook.preview.rowCount,
        untouchedExistingCount: 0,
        stockAdjustedCount: 0,
        zeroDeltaMatchedCount: 0,
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
      now: () => currentNow,
      randomUuid: () => '22222222-2222-4222-8222-222222222222',
      expectedWorkbookSha256,
    }),
    repository,
    storage,
    setNow: (next: Date) => {
      currentNow = next;
    },
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
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { service, repository } = harness(sha256);
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
      matchedExistingCount: 0,
      createdSkuCount: 1,
      untouchedExistingCount: 0,
      stockAdjustedCount: 0,
      zeroDeltaMatchedCount: 0,
      committedAt: '2026-07-30T01:30:00.000Z',
      replayed: false,
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(repository.commit).toHaveBeenCalledOnce();
  });

  it('rejects an uncommitted stage when the approved baseline hash changes', async () => {
    const bytes = await workbookBytes();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { service, repository, storage } = harness(sha256);
    const stage = await service.validate(owner, {
      fileName: 'catalogue.xlsx',
      bytes,
    });
    const currentBaseline = new CatalogueService({
      repository,
      storage,
      now: () => new Date('2026-07-30T01:30:00.000Z'),
      randomUuid: () => '33333333-3333-4333-8333-333333333333',
      expectedWorkbookSha256: '0'.repeat(64),
    });

    await expect(currentBaseline.commit(owner, stage.importId)).rejects
      .toMatchObject({ code: 'UNEXPECTED_WORKBOOK_HASH', statusCode: 422 });
    expect(repository.commit).not.toHaveBeenCalled();
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

  it('purges and refreshes an expired uncommitted stage under the same provenance', async () => {
    const bytes = await workbookBytes();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { service, repository, storage, setNow } = harness(sha256);
    const first = await service.validate(owner, {
      fileName: 'catalogue.xlsx',
      bytes,
    });
    setNow(new Date('2026-07-31T01:30:00.001Z'));
    await service.purgeExpiredStagedBytes();

    const refreshed = await service.validate(owner, {
      fileName: 'catalogue-refresh.xlsx',
      bytes,
    });

    expect(refreshed).toMatchObject({
      importId: first.importId,
      sourceFileName: 'catalogue-refresh.xlsx',
      expiresAt: '2026-08-01T01:30:00.001Z',
      status: 'staged',
    });
    expect(storage.deleteStaged).toHaveBeenCalledWith(
      `staged/${sha256}.xlsx`,
    );
    expect(storage.deleteStaged).toHaveBeenCalledTimes(2);
    expect(storage.writeStaged).toHaveBeenCalledTimes(2);
    expect(repository.refreshStage).toHaveBeenCalledOnce();
    await expect(
      storage.readStaged(`staged/${sha256}.xlsx`),
    ).resolves.toEqual(bytes);
  });

  it('purges expired uncommitted bytes on commit rejection and remains restageable', async () => {
    const bytes = await workbookBytes();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { service, repository, storage, setNow } = harness(sha256);
    const expiredStage = await service.validate(owner, {
      fileName: 'catalogue.xlsx',
      bytes,
    });
    setNow(new Date('2026-07-31T01:30:00.001Z'));

    await expect(
      service.commit(owner, expiredStage.importId),
    ).rejects.toMatchObject({ code: 'IMPORT_EXPIRED', statusCode: 410 });
    expect(storage.deleteStaged).toHaveBeenCalledOnce();

    const refreshed = await service.validate(owner, {
      fileName: 'catalogue-refresh.xlsx',
      bytes,
    });
    expect(storage.deleteStaged).toHaveBeenCalledTimes(2);
    expect(refreshed).toMatchObject({
      importId: expiredStage.importId,
      status: 'staged',
      sourceFileName: 'catalogue-refresh.xlsx',
    });
    await expect(
      repository.findById(expiredStage.importId),
    ).resolves.toMatchObject({
      id: expiredStage.importId,
      status: 'staged',
      workbookSha256: sha256,
    });
  });

  it('preserves the committed original workbook bytes after its stage TTL', async () => {
    const bytes = await workbookBytes();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const { service, repository, storage, setNow } = harness(sha256);
    const stage = await service.validate(owner, {
      fileName: 'catalogue.xlsx',
      bytes,
    });
    await service.commit(owner, stage.importId);
    setNow(new Date('2026-07-31T01:30:00.001Z'));

    await service.purgeExpiredStagedBytes();

    expect(storage.deleteStaged).not.toHaveBeenCalled();
    await expect(
      storage.readStaged(`staged/${sha256}.xlsx`),
    ).resolves.toEqual(bytes);
    await expect(repository.findById(stage.importId)).resolves.toMatchObject({
      id: stage.importId,
      status: 'committed',
      workbookSha256: sha256,
      result: expect.objectContaining({ importId: stage.importId }),
    });
  });
});
