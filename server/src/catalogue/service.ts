import { createHash, randomUUID } from 'node:crypto';

import type { CataloguePreview, CatalogueWorkbook } from './workbook.js';
import { parseCatalogueWorkbook } from './workbook.js';

const STAGE_TTL_MS = 24 * 60 * 60 * 1_000;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CatalogueError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogueError';
  }
}

export interface CatalogueDevice {
  id: string;
  role: 'owner' | 'client';
}

export interface CatalogueCommitResult {
  importId: string;
  workbookSha256: string;
  rowCount: number;
  imageJobCount: number;
  committedAt: string;
  replayed: boolean;
}

export interface CatalogueImportRecord {
  id: string;
  workbookSha256: string;
  sourceFileName: string;
  stagedPath: string;
  status: 'staged' | 'committed';
  preview: CataloguePreview;
  createdByDeviceId: string;
  createdAt: string;
  expiresAt: string;
  committedAt: string | null;
  result: CatalogueCommitResult | null;
}

export interface CatalogueValidationResult {
  importId: string;
  workbookSha256: string;
  sourceFileName: string;
  status: 'staged' | 'committed';
  preview: CataloguePreview;
  expiresAt: string;
  committedAt: string | null;
}

export interface PrivateCatalogueStorage {
  writeStaged(sha256: string, bytes: Buffer): Promise<string>;
  readStaged(stagedPath: string): Promise<Buffer>;
  deleteStaged(stagedPath: string): Promise<void>;
}

export interface CatalogueRepository {
  findByHash(sha256: string): Promise<CatalogueImportRecord | null>;
  findById(id: string): Promise<CatalogueImportRecord | null>;
  createStage(record: CatalogueImportRecord): Promise<CatalogueImportRecord>;
  refreshStage(record: CatalogueImportRecord): Promise<CatalogueImportRecord>;
  listExpiredStagePaths(expiredAt: Date): Promise<string[]>;
  commit(
    record: CatalogueImportRecord,
    workbook: CatalogueWorkbook,
    committedAt: Date,
  ): Promise<CatalogueCommitResult>;
}

export interface CatalogueServiceOptions {
  repository: CatalogueRepository;
  storage: PrivateCatalogueStorage;
  now?: () => Date;
  randomUuid?: () => string;
  expectedWorkbookSha256: string;
}

function requireOwner(device: CatalogueDevice): void {
  if (device.role !== 'owner') {
    throw new CatalogueError('FORBIDDEN', 403, 'Owner access required');
  }
}

function requireSourceFileName(fileName: string): string {
  if (
    fileName.length === 0 ||
    fileName.length > 255 ||
    !fileName.toLowerCase().endsWith('.xlsx') ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(fileName)
  ) {
    throw new CatalogueError(
      'INVALID_FILE_NAME',
      400,
      'Nama file XLSX tidak valid.',
    );
  }
  return fileName;
}

function publicStage(record: CatalogueImportRecord): CatalogueValidationResult {
  return {
    importId: record.id,
    workbookSha256: record.workbookSha256,
    sourceFileName: record.sourceFileName,
    status: record.status,
    preview: record.preview,
    expiresAt: record.expiresAt,
    committedAt: record.committedAt,
  };
}

function workbookHash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class CatalogueService {
  private readonly now: () => Date;
  private readonly randomUuid: () => string;

  constructor(private readonly options: CatalogueServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.randomUuid = options.randomUuid ?? randomUUID;
    if (
      !SHA256_PATTERN.test(options.expectedWorkbookSha256)
    ) {
      throw new Error('Expected workbook SHA-256 is invalid');
    }
  }

  async validate(
    device: CatalogueDevice,
    input: { fileName: string; bytes: Buffer },
  ): Promise<CatalogueValidationResult> {
    requireOwner(device);
    const sourceFileName = requireSourceFileName(input.fileName);
    const sha256 = workbookHash(input.bytes);
    if (
      sha256 !== this.options.expectedWorkbookSha256
    ) {
      throw new CatalogueError(
        'UNEXPECTED_WORKBOOK_HASH',
        422,
        'Workbook bukan katalog awal yang disetujui.',
      );
    }
    const existing = await this.options.repository.findByHash(sha256);
    const now = this.now();
    if (
      existing &&
      (existing.status === 'committed' ||
        new Date(existing.expiresAt).getTime() > now.getTime())
    ) {
      return publicStage(existing);
    }
    const workbook = await parseCatalogueWorkbook(input.bytes);
    if (existing) {
      await this.options.storage.deleteStaged(existing.stagedPath);
      const stagedPath = await this.options.storage.writeStaged(
        sha256,
        input.bytes,
      );
      const refreshed: CatalogueImportRecord = {
        ...existing,
        sourceFileName,
        stagedPath,
        status: 'staged',
        preview: workbook.preview,
        createdByDeviceId: device.id,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + STAGE_TTL_MS).toISOString(),
        committedAt: null,
        result: null,
      };
      return publicStage(
        await this.options.repository.refreshStage(refreshed),
      );
    }
    const stagedPath = await this.options.storage.writeStaged(
      sha256,
      input.bytes,
    );
    const record: CatalogueImportRecord = {
      id: this.randomUuid(),
      workbookSha256: sha256,
      sourceFileName,
      stagedPath,
      status: 'staged',
      preview: workbook.preview,
      createdByDeviceId: device.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + STAGE_TTL_MS).toISOString(),
      committedAt: null,
      result: null,
    };
    if (!UUID_PATTERN.test(record.id)) {
      throw new Error('Catalogue service generated an invalid UUID');
    }
    return publicStage(await this.options.repository.createStage(record));
  }

  async commit(
    device: CatalogueDevice,
    importId: string,
  ): Promise<CatalogueCommitResult> {
    requireOwner(device);
    if (!UUID_PATTERN.test(importId)) {
      throw new CatalogueError('INVALID_IMPORT_ID', 400, 'Import tidak valid.');
    }
    const record = await this.options.repository.findById(importId);
    if (!record) {
      throw new CatalogueError('IMPORT_NOT_FOUND', 404, 'Import tidak ditemukan.');
    }
    if (record.status === 'committed' && record.result) {
      return { ...record.result, replayed: true };
    }
    if (record.workbookSha256 !== this.options.expectedWorkbookSha256) {
      throw new CatalogueError(
        'UNEXPECTED_WORKBOOK_HASH',
        422,
        'Workbook bukan katalog awal yang disetujui.',
      );
    }
    const now = this.now();
    if (new Date(record.expiresAt).getTime() <= now.getTime()) {
      await this.options.storage.deleteStaged(record.stagedPath);
      throw new CatalogueError('IMPORT_EXPIRED', 410, 'Tahap import telah kedaluwarsa.');
    }
    const bytes = await this.options.storage.readStaged(record.stagedPath);
    const sha256 = workbookHash(bytes);
    if (sha256 !== record.workbookSha256) {
      throw new CatalogueError(
        'STAGED_WORKBOOK_CHANGED',
        409,
        'Workbook tahap tidak lagi sesuai dengan hash.',
      );
    }
    if (sha256 !== this.options.expectedWorkbookSha256) {
      throw new CatalogueError(
        'UNEXPECTED_WORKBOOK_HASH',
        422,
        'Workbook bukan katalog awal yang disetujui.',
      );
    }
    const workbook = await parseCatalogueWorkbook(bytes);
    return this.options.repository.commit(record, workbook, now);
  }

  async purgeExpiredStagedBytes(): Promise<number> {
    const paths = await this.options.repository.listExpiredStagePaths(
      this.now(),
    );
    for (const path of paths) {
      await this.options.storage.deleteStaged(path);
    }
    return paths.length;
  }
}
