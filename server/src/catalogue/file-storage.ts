import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  link,
  mkdir,
  open,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { MAX_IMAGE_BYTES } from './image-download.js';
import { MAX_XLSX_BYTES } from './xlsx-archive.js';
import type { PrivateCatalogueStorage } from './service.js';

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const STAGED_PATH_PATTERN =
  /^imports\/staged\/([0-9a-f]{64})\.xlsx$/;
const IMAGE_PATH_PATTERN =
  /^images\/sha256\/([0-9a-f]{2})\/([0-9a-f]{64})\.bin$/;

export class CatalogueStorageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CatalogueStorageError';
  }
}

function invalidPath(): never {
  throw new CatalogueStorageError(
    'INVALID_STORAGE_PATH',
    'Lokasi penyimpanan katalog tidak valid.',
  );
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export class FileCatalogueStorage implements PrivateCatalogueStorage {
  private readonly root: string;

  constructor(root: string) {
    if (!isAbsolute(root) || resolve(root) === '/') invalidPath();
    this.root = resolve(root);
  }

  async writeStaged(hash: string, bytes: Buffer): Promise<string> {
    if (
      !HASH_PATTERN.test(hash) ||
      bytes.length > MAX_XLSX_BYTES ||
      sha256(bytes) !== hash
    ) {
      invalidPath();
    }
    const relativePath = `imports/staged/${hash}.xlsx`;
    const directory = join(this.root, 'imports', 'staged');
    const target = join(this.root, relativePath);
    const temporary = join(directory, `.${hash}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, target);
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        Reflect.get(error, 'code') !== 'EEXIST'
      ) {
        throw error;
      }
      const existing = await this.readStaged(relativePath);
      if (sha256(existing) !== hash) {
        throw new CatalogueStorageError(
          'STAGED_HASH_CONFLICT',
          'Workbook tahap memiliki isi berbeda.',
        );
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    await chmod(target, 0o600);
    return relativePath;
  }

  async readStaged(stagedPath: string): Promise<Buffer> {
    if (!STAGED_PATH_PATTERN.test(stagedPath)) invalidPath();
    const absolutePath = join(this.root, stagedPath);
    if (!absolutePath.startsWith(`${this.root}/`)) invalidPath();
    let handle;
    try {
      handle = await open(
        absolutePath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_XLSX_BYTES) {
        invalidPath();
      }
      return await handle.readFile();
    } catch (error) {
      if (error instanceof CatalogueStorageError) throw error;
      throw new CatalogueStorageError(
        'STAGED_FILE_UNAVAILABLE',
        'Workbook tahap tidak dapat dibuka.',
      );
    } finally {
      await handle?.close();
    }
  }

  async writeImage(hash: string, bytes: Buffer): Promise<string> {
    if (
      !HASH_PATTERN.test(hash) ||
      bytes.length > MAX_IMAGE_BYTES ||
      sha256(bytes) !== hash
    ) {
      invalidPath();
    }
    const prefix = hash.slice(0, 2);
    const relativePath = `images/sha256/${prefix}/${hash}.bin`;
    const directory = join(this.root, 'images', 'sha256', prefix);
    const target = join(this.root, relativePath);
    const temporary = join(directory, `.${hash}.${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try {
      await link(temporary, target);
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        Reflect.get(error, 'code') !== 'EEXIST'
      ) {
        throw error;
      }
      const existing = await this.readImage(relativePath);
      if (sha256(existing) !== hash) {
        throw new CatalogueStorageError(
          'IMAGE_HASH_CONFLICT',
          'Gambar tersimpan memiliki isi berbeda.',
        );
      }
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    await chmod(target, 0o600);
    return relativePath;
  }

  async readImage(storagePath: string): Promise<Buffer> {
    const match = IMAGE_PATH_PATTERN.exec(storagePath);
    if (!match || match[1] !== match[2]?.slice(0, 2)) invalidPath();
    const absolutePath = join(this.root, storagePath);
    if (!absolutePath.startsWith(`${this.root}/`)) invalidPath();
    let handle;
    try {
      handle = await open(
        absolutePath,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > MAX_IMAGE_BYTES) {
        invalidPath();
      }
      return await handle.readFile();
    } catch (error) {
      if (error instanceof CatalogueStorageError) throw error;
      throw new CatalogueStorageError(
        'IMAGE_FILE_UNAVAILABLE',
        'Gambar katalog tidak dapat dibuka.',
      );
    } finally {
      await handle?.close();
    }
  }
}
