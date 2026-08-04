import { describe, expect, it } from 'vitest';

import type { CoreCacheEnvelope, CoreGatewayStorage } from '../../src/gateway/core-cache';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  bootstrapBody,
  deferred,
  populatedBootstrap,
} from './core-gateway-test-support';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

class ImageMemoryStorage extends MemoryStorage implements CoreGatewayStorage {
  readonly images = new Map<string, Blob>();
  failNextImageSave = false;

  async loadImage(hash: string): Promise<Blob | undefined> {
    return this.images.get(hash);
  }

  async saveImage(hash: string, image: Blob): Promise<void> {
    if (this.failNextImageSave) {
      this.failNextImageSave = false;
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    this.images.set(hash, image);
  }

  async listImageHashes(): Promise<string[]> {
    return [...this.images.keys()];
  }

  async deleteImages(hashes: string[]): Promise<void> {
    hashes.forEach((hash) => this.images.delete(hash));
  }

  override async save(value: CoreCacheEnvelope): Promise<void> {
    await super.save(value);
    expect(JSON.stringify(value)).not.toContain('iVBORw');
  }
}

function imageBootstrap(hashes: Array<string | null>, revision = '1') {
  const original = populatedBootstrap(revision);
  const skuId = (index: number) =>
    `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
  return bootstrapBody(revision, {
    skus: hashes.map((hash, index) => ({
      ...original.skus[0]!,
      id: skuId(index),
      primaryIdentifier: `SKU-${index + 1}`,
      imageHash: hash,
      sourceImageUrl: hash ? `https://example.test/${hash}.jpg` : null,
    })),
    balances: hashes.map((_, index) => ({
      ...original.balances[0]!,
      skuId: skuId(index),
    })),
  });
}

function imageResponse(bytesBase64 = 'iVBORw==') {
  return { status: 200, body: { mimeType: 'image/png', bytesBase64 } };
}

describe('Core durable image cache and prefetch', () => {
  it('loads a cached hash without requesting the server', async () => {
    const storage = new ImageMemoryStorage();
    storage.images.set(HASH_A, new Blob(['cached'], { type: 'image/webp' }));
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });

    await gateway.initialize();
    await expect(gateway.loadSkuImage(gateway.getSnapshot().skus[0]!))
      .resolves.toBe('data:image/webp;base64,Y2FjaGVk');
    expect(transport.requests).toHaveLength(1);
  });

  it('stores one fetched image Blob by lowercase SHA-256 outside the snapshot', async () => {
    const storage = new ImageMemoryStorage();
    const transport = new ScriptedTransport();
    const clock = new TestClock();
    const gateway = createCoreOperationsGateway(transport, storage, clock);
    gateway.pauseImagePrefetch();
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });
    await gateway.initialize();
    transport.enqueue(imageResponse());

    await expect(gateway.loadSkuImage(gateway.getSnapshot().skus[0]!))
      .resolves.toBe('data:image/png;base64,iVBORw==');
    expect(storage.images.get(HASH_A)).toBeInstanceOf(Blob);
    expect(storage.images.get(HASH_A)?.type).toBe('image/png');
  });

  it('seeds the acknowledged image hash after a successful authoritative upload', async () => {
    const storage = new ImageMemoryStorage();
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    gateway.pauseImagePrefetch();
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '2',
        entityVersion: '2',
        entity: {
          ...populatedBootstrap().skus[0]!,
          imageHash: HASH_B,
          sourceImageUrl: null,
          rowVersion: '2',
        },
      },
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '2', nextAfter: '1', changes: [] },
    });

    await gateway.updateSku(gateway.getSnapshot().skus[0]!.id, {
      imageUrl: 'data:image/png;base64,iVBORw==',
    });

    await expect(storage.images.get(HASH_B)?.arrayBuffer())
      .resolves.toEqual(Uint8Array.from([137, 80, 78, 71]).buffer);
    expect(JSON.stringify(storage.value)).not.toContain('iVBORw');
  });

  it('rejects uploads above five MiB before transport', async () => {
    const storage = new ImageMemoryStorage();
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    gateway.pauseImagePrefetch();
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    const overLimit = 'AAAA'.repeat(Math.ceil(((5 * 1024 * 1024) + 1) / 3));

    await expect(gateway.updateSku(gateway.getSnapshot().skus[0]!.id, {
      imageUrl: `data:image/jpeg;base64,${overLimit}`,
    })).rejects.toThrow('terlalu besar');
    expect(transport.requests).toHaveLength(1);
  });

  it('prefetches distinct authoritative hashes with exactly two concurrent requests', async () => {
    const storage = new ImageMemoryStorage();
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    const first = deferred<{ status: number; body: unknown }>();
    const second = deferred<{ status: number; body: unknown }>();
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A, HASH_A, HASH_B, HASH_C]) });
    transport.enqueue(() => first.promise);
    transport.enqueue(() => second.promise);
    transport.enqueue(imageResponse('Yw=='));

    await gateway.initialize();
    await vi.waitFor(() => expect(transport.requests).toHaveLength(3));
    expect(transport.requests.slice(1).map((request) => request.path)).toEqual([
      `/v1/images/${HASH_A}`,
      `/v1/images/${HASH_B}`,
    ]);
    expect(gateway.getSyncSnapshot().imagePrefetch).toEqual({
      phase: 'running', total: 4, serverAvailable: 3, cached: 0, failed: 0,
    });

    first.resolve(imageResponse('YQ=='));
    await vi.waitFor(() => expect(transport.requests).toHaveLength(4));
    second.resolve(imageResponse('Yg=='));
    await vi.waitFor(() => expect(storage.images.size).toBe(3));
    expect(gateway.getSyncSnapshot().imagePrefetch).toEqual({
      phase: 'complete', total: 4, serverAvailable: 3, cached: 3, failed: 0,
    });
  });

  it('pauses new work, retries failures, and resumes missing hashes from cached keys', async () => {
    const storage = new ImageMemoryStorage();
    storage.images.set(HASH_A, new Blob(['a'], { type: 'image/jpeg' }));
    const transport = new ScriptedTransport();
    const clock = new TestClock();
    const gateway = createCoreOperationsGateway(transport, storage, clock);
    const first = deferred<{ status: number; body: unknown }>();
    const second = deferred<{ status: number; body: unknown }>();
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A, HASH_B, HASH_C, HASH_D]) });
    transport.enqueue(() => first.promise);
    transport.enqueue(() => second.promise);

    await gateway.initialize();
    await vi.waitFor(() => expect(transport.requests).toHaveLength(3));
    gateway.pauseImagePrefetch();
    first.resolve({ status: 503, body: { code: 'IMAGE_UNAVAILABLE' } });
    second.resolve(imageResponse('Yw=='));
    await vi.waitFor(() => expect(gateway.getSyncSnapshot().imagePrefetch).toMatchObject({
      phase: 'paused', cached: 2, failed: 1,
    }));
    expect(transport.requests).toHaveLength(3);

    transport.enqueue(imageResponse('Yg=='));
    transport.enqueue(imageResponse('ZA=='));
    gateway.retryImagePrefetch();
    await vi.waitFor(() => expect(storage.images.size).toBe(4));
    expect(gateway.getSyncSnapshot().imagePrefetch).toEqual({
      phase: 'complete', total: 4, serverAvailable: 4, cached: 4, failed: 0,
    });
  });

  it('reports quota failure without blocking online business sync', async () => {
    const storage = new ImageMemoryStorage();
    storage.failNextImageSave = true;
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });
    transport.enqueue(imageResponse());

    await expect(gateway.initialize()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(gateway.getSyncSnapshot().imagePrefetch?.failed).toBe(1));
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'online',
      imagePrefetch: { phase: 'paused', cached: 0, failed: 1 },
    });
  });

  it('keeps manual image retry paused while business sync is offline', async () => {
    const storage = new ImageMemoryStorage();
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    gateway.pauseImagePrefetch();
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });
    await gateway.initialize();
    transport.enqueue(new Error('LAN unavailable'));
    await gateway.retryPending();
    expect(gateway.getSyncSnapshot().phase).toBe('offline');

    transport.enqueue(imageResponse());
    gateway.retryImagePrefetch();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.requests).toHaveLength(2);
    expect(gateway.getSyncSnapshot().imagePrefetch?.phase).toBe('paused');
  });

  it('prunes only unreferenced hashes after a successful authoritative bootstrap', async () => {
    const storage = new ImageMemoryStorage();
    storage.images.set(HASH_A, new Blob(['a']));
    storage.images.set(HASH_B, new Blob(['b']));
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });

    await gateway.initialize();
    await vi.waitFor(() => expect([...storage.images.keys()]).toEqual([HASH_A]));
  });

  it('prefetches a changed authoritative hash without pruning the prior hash on a change poll', async () => {
    const storage = new ImageMemoryStorage();
    storage.images.set(HASH_A, new Blob(['a'], { type: 'image/jpeg' }));
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });
    await gateway.initialize();
    const entityId = '10000000-0000-4000-8000-000000000001';
    const nextSku = {
      ...imageBootstrap([HASH_B], '2').skus[0]!,
      id: entityId,
      rowVersion: '2',
    };
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '2', nextAfter: '2',
        changes: [{
          revision: '2', entityType: 'sku', entityId,
          operation: 'upsert', payload: nextSku,
          createdAt: '2026-08-04T12:00:00.000Z',
        }],
      },
    });
    transport.enqueue(imageResponse('Yg=='));

    await gateway.retryPending();
    await vi.waitFor(() => expect(storage.images.has(HASH_B)).toBe(true));
    expect(storage.images.has(HASH_A)).toBe(true);
  });

  it('lets two devices resolve the same authoritative hash through their own caches', async () => {
    const loadDevice = async () => {
      const storage = new ImageMemoryStorage();
      const transport = new ScriptedTransport();
      const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
      gateway.pauseImagePrefetch();
      transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });
      transport.enqueue(imageResponse('c2FtZQ=='));
      await gateway.initialize();
      const source = await gateway.loadSkuImage(gateway.getSnapshot().skus[0]!);
      return { source, storage };
    };

    const [desktop, mobile] = await Promise.all([loadDevice(), loadDevice()]);
    expect(desktop.source).toBe('data:image/png;base64,c2FtZQ==');
    expect(mobile.source).toBe(desktop.source);
    expect(desktop.storage.images.get(HASH_A)).not.toBe(
      mobile.storage.images.get(HASH_A),
    );
  });
});
