import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import type {
  ClientRequest,
  IncomingMessage,
  RequestOptions,
} from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileCatalogueStorage } from '../src/catalogue/file-storage.js';
import {
  CatalogueImageDownloader,
  createPinnedImageFetch,
  ImageDownloadError,
  type ImageFetchInput,
  type ImageFetchResponse,
} from '../src/catalogue/image-download.js';
import {
  CatalogueImageWorker,
  type CatalogueImageJob,
  type CatalogueImageRepository,
} from '../src/catalogue/image-worker.js';

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

function png(width = 32, height = 24): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function downloader(
  responses: ImageFetchResponse[],
  addresses: string[][] = [['93.184.216.34']],
) {
  const resolve = vi.fn(async () =>
    (addresses.shift() ?? []).map((address) => ({
      address,
      family: address.includes(':') ? 6 : 4,
    })),
  );
  const fetch = vi.fn(async (_input: ImageFetchInput) => {
    const response = responses.shift();
    if (!response) throw new Error('missing response');
    return response;
  });
  return {
    download: new CatalogueImageDownloader({ resolve, fetch }),
    fetch,
    resolve,
  };
}

describe('catalogue image downloader', () => {
  it('pins a public DNS result for the approved HTTPS host', async () => {
    const fixture = png();
    const { download, fetch } = downloader([
      {
        status: 200,
        headers: { 'content-type': 'image/png' },
        bytes: fixture,
      },
    ]);

    await expect(
      download.download('https://res.bigseller.pro/products/a.png'),
    ).resolves.toEqual({
      bytes: fixture,
      mimeType: 'image/png',
      width: 32,
      height: 24,
    });
    expect(fetch).toHaveBeenCalledWith({
      url: new URL('https://res.bigseller.pro/products/a.png'),
      address: '93.184.216.34',
      family: 4,
      timeoutMs: 10_000,
      maximumBytes: 5 * 1024 * 1024,
    });
  });

  it.each([
    'http://res.bigseller.pro/a.png',
    'https://user:secret@res.bigseller.pro/a.png',
    'https://res.bigseller.pro:8443/a.png',
    'https://cdn.bigseller.pro/a.png',
    'https://127.0.0.1/a.png',
  ])('rejects an unapproved source URL before networking: %s', async (url) => {
    const { download, fetch, resolve } = downloader([]);

    await expect(download.download(url)).rejects.toMatchObject({
      code: 'IMAGE_URL_NOT_ALLOWED',
    });
    expect(resolve).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    '127.0.0.1',
    '169.254.1.2',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.14',
    '224.0.0.1',
    '100.64.0.1',
    '100.100.100.100',
    '::1',
    'fe80::1',
    'fc00::1',
    'ff02::1',
  ])('blocks non-public DNS address %s', async (address) => {
    const { download, fetch } = downloader([], [[address]]);

    await expect(
      download.download('https://res.bigseller.pro/a.png'),
    ).rejects.toMatchObject({ code: 'IMAGE_ADDRESS_NOT_PUBLIC' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('revalidates and pins DNS on every redirect hop', async () => {
    const { download, fetch, resolve } = downloader(
      [
        {
          status: 302,
          headers: { location: '/redirected.png' },
          bytes: Buffer.alloc(0),
        },
      ],
      [['93.184.216.34'], ['127.0.0.1']],
    );

    await expect(
      download.download('https://res.bigseller.pro/a.png'),
    ).rejects.toMatchObject({ code: 'IMAGE_ADDRESS_NOT_PUBLIC' });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('allows at most three redirects', async () => {
    const redirects = Array.from({ length: 4 }, (_, index) => ({
      status: 302,
      headers: { location: `/redirect-${index}.png` },
      bytes: Buffer.alloc(0),
    }));
    const { download, fetch } = downloader(
      redirects,
      Array.from({ length: 4 }, () => ['93.184.216.34']),
    );

    await expect(
      download.download('https://res.bigseller.pro/a.png'),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_MANY_REDIRECTS' });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('rejects false MIME, false magic, unsafe dimensions, and oversized bytes', async () => {
    const cases: Array<{
      response: ImageFetchResponse;
      code: string;
    }> = [
      {
        response: {
          status: 200,
          headers: { 'content-type': 'text/html' },
          bytes: png(),
        },
        code: 'IMAGE_MIME_NOT_ALLOWED',
      },
      {
        response: {
          status: 200,
          headers: { 'content-type': 'image/png' },
          bytes: Buffer.from('<html>not an image</html>'),
        },
        code: 'IMAGE_MAGIC_MISMATCH',
      },
      {
        response: {
          status: 200,
          headers: { 'content-type': 'image/png' },
          bytes: png(50_000, 50_000),
        },
        code: 'IMAGE_DIMENSIONS_NOT_ALLOWED',
      },
      {
        response: {
          status: 200,
          headers: { 'content-type': 'image/png' },
          bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
        },
        code: 'IMAGE_TOO_LARGE',
      },
    ];

    for (const testCase of cases) {
      const { download } = downloader([testCase.response]);
      await expect(
        download.download('https://res.bigseller.pro/a.png'),
      ).rejects.toMatchObject({ code: testCase.code });
    }
  });

  it('preserves a bounded timeout failure code from the pinned fetch', async () => {
    const fetch = vi.fn(async (): Promise<ImageFetchResponse> => {
      throw new ImageDownloadError(
        'IMAGE_TIMEOUT',
        'Pengunduhan gambar melewati batas waktu.',
      );
    });
    const download = new CatalogueImageDownloader({
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch,
    });

    await expect(
      download.download('https://res.bigseller.pro/a.png'),
    ).rejects.toMatchObject({ code: 'IMAGE_TIMEOUT' });
  });

  it('enforces the pinned HTTPS request timeout without following redirects', async () => {
    let timeoutHandler: (() => void) | undefined;
    const request = new EventEmitter() as ClientRequest;
    const destroy = vi.fn();
    Object.assign(request, {
      setTimeout: vi.fn((_milliseconds: number, handler: () => void) => {
        timeoutHandler = handler;
        return request;
      }),
      destroy: vi.fn(() => {
        destroy();
        return request;
      }),
      end: vi.fn(() => timeoutHandler?.()),
    });
    const requestImpl = vi.fn(
      (
        _options: RequestOptions,
        _callback: (response: IncomingMessage) => void,
      ) => request,
    );
    const fetch = createPinnedImageFetch(requestImpl);

    await expect(
      fetch({
        url: new URL('https://res.bigseller.pro/a.png'),
        address: '93.184.216.34',
        family: 4,
        timeoutMs: 25,
        maximumBytes: 5 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'IMAGE_TIMEOUT' });
    expect(requestImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: '93.184.216.34',
        servername: 'res.bigseller.pro',
        rejectUnauthorized: true,
        timeout: 25,
      }),
      expect.any(Function),
    );
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe('content-addressed catalogue image storage', () => {
  it('deduplicates bytes at a traversal-safe hash path with private permissions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chu-image-'));
    roots.push(root);
    const storage = new FileCatalogueStorage(root);
    const bytes = png();
    const hash = createHash('sha256').update(bytes).digest('hex');

    const first = await storage.writeImage(hash, bytes);
    const replay = await storage.writeImage(hash, bytes);

    expect(first).toBe(`images/sha256/${hash.slice(0, 2)}/${hash}.bin`);
    expect(replay).toBe(first);
    expect(await storage.readImage(first)).toEqual(bytes);
    expect((await stat(join(root, first))).mode & 0o777).toBe(0o600);
    expect(
      await readdir(join(root, 'images', 'sha256', hash.slice(0, 2))),
    ).toEqual([`${hash}.bin`]);
    await expect(storage.readImage('../secret')).rejects.toMatchObject({
      code: 'INVALID_STORAGE_PATH',
    });
  });

});

describe('single catalogue image worker', () => {
  it('runs only one claim at a time and records content-hash completion', async () => {
    const job: CatalogueImageJob = {
      id: '11111111-1111-4111-8111-111111111111',
      skuId: '22222222-2222-4222-8222-222222222222',
      sourceUrl: 'https://res.bigseller.pro/a.png',
      attemptCount: 1,
    };
    let releaseClaim!: () => void;
    const claimBlocked = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    const claimNext = vi
      .fn<() => Promise<CatalogueImageJob | null>>()
      .mockImplementationOnce(async () => {
        await claimBlocked;
        return job;
      })
      .mockResolvedValue(null);
    const complete = vi.fn(async () => undefined);
    const repository: CatalogueImageRepository = {
      claimNext,
      complete,
      fail: vi.fn(async () => undefined),
    };
    const bytes = png();
    const downloaderPort = {
      download: vi.fn(async () => ({
        bytes,
        mimeType: 'image/png',
        width: 32,
        height: 24,
      })),
    };
    const storage = {
      writeImage: vi.fn(async (hash: string) =>
        `images/sha256/${hash.slice(0, 2)}/${hash}.bin`),
    };
    const worker = new CatalogueImageWorker(
      repository,
      downloaderPort,
      storage,
    );

    const first = worker.runOnce();
    const concurrent = worker.runOnce();
    releaseClaim();

    await expect(first).resolves.toBe(true);
    await expect(concurrent).resolves.toBe(false);
    const hash = createHash('sha256').update(bytes).digest('hex');
    expect(storage.writeImage).toHaveBeenCalledWith(hash, bytes);
    expect(complete).toHaveBeenCalledWith(job, {
      contentHash: hash,
      mimeType: 'image/png',
      byteSize: bytes.length,
      width: 32,
      height: 24,
      storagePath: `images/sha256/${hash.slice(0, 2)}/${hash}.bin`,
    });
  });

  it('reports a failed job without rolling back the catalogue', async () => {
    const job: CatalogueImageJob = {
      id: '11111111-1111-4111-8111-111111111111',
      skuId: '22222222-2222-4222-8222-222222222222',
      sourceUrl: 'https://res.bigseller.pro/a.png',
      attemptCount: 1,
    };
    const fail = vi.fn(async () => undefined);
    const worker = new CatalogueImageWorker(
      {
        claimNext: vi.fn(async () => job),
        complete: vi.fn(async () => undefined),
        fail,
      },
      {
        download: vi.fn(async () => {
          throw new ImageDownloadError(
            'IMAGE_TIMEOUT',
            'Pengunduhan gambar melewati batas waktu.',
          );
        }),
      },
      {
        writeImage: vi.fn(async () => {
          throw new Error('unreachable');
        }),
      },
    );

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(fail).toHaveBeenCalledWith(job, 'IMAGE_TIMEOUT');
  });
});
