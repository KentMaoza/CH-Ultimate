import { createHash } from 'node:crypto';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileCatalogueStorage } from '../src/catalogue/file-storage.js';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('private catalogue storage', () => {
  it('uses a generated content-hash path with owner-only file permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chu-catalogue-'));
    roots.push(root);
    const storage = new FileCatalogueStorage(root);
    const bytes = Buffer.from('private workbook');
    const hash = createHash('sha256').update(bytes).digest('hex');

    const relativePath = await storage.writeStaged(hash, bytes);

    expect(relativePath).toBe(`imports/staged/${hash}.xlsx`);
    expect(await storage.readStaged(relativePath)).toEqual(bytes);
    expect(await readFile(join(root, relativePath))).toEqual(bytes);
    expect((await stat(join(root, relativePath))).mode & 0o777).toBe(0o600);
  });

  it('rejects traversal, symlink-shaped, and unbounded staged paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chu-catalogue-'));
    roots.push(root);
    const storage = new FileCatalogueStorage(root);

    for (const path of [
      '../catalogue.xlsx',
      '/tmp/catalogue.xlsx',
      `imports/staged/${'A'.repeat(64)}.xlsx`,
      `imports/staged/${'a'.repeat(64)}.xlsx/child`,
    ]) {
      await expect(storage.readStaged(path)).rejects.toMatchObject({
        code: 'INVALID_STORAGE_PATH',
      });
    }
  });
});
