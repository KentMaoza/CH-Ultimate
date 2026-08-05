import { describe, expect, it, vi } from 'vitest';

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

class DelayedDeleteImageStorage extends ImageMemoryStorage {
  readonly deleteStarted = deferred<void>();
  readonly releaseDelete = deferred<void>();
  readonly deleteFinished = deferred<void>();

  override async deleteImages(hashes: string[]): Promise<void> {
    this.deleteStarted.resolve(undefined);
    await this.releaseDelete.promise;
    await super.deleteImages(hashes);
    this.deleteFinished.resolve(undefined);
  }
}

class DelayedEnumerationImageStorage extends ImageMemoryStorage {
  readonly firstEnumerationStarted = deferred<void>();
  readonly releaseFirstEnumeration = deferred<void>();
  readonly deleteCalls: string[][] = [];
  private enumerationCount = 0;

  override async listImageHashes(): Promise<string[]> {
    this.enumerationCount += 1;
    if (this.enumerationCount === 1) {
      this.firstEnumerationStarted.resolve(undefined);
      await this.releaseFirstEnumeration.promise;
    }
    return super.listImageHashes();
  }

  override async deleteImages(hashes: string[]): Promise<void> {
    this.deleteCalls.push([...hashes]);
    await super.deleteImages(hashes);
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
  it('makes a malformed prefetch image terminal and does not start the next queued image', async () => {
    const storage = new ImageMemoryStorage();
    const transport = new ScriptedTransport();
    const diagnostics = vi.fn();
    const gateway = createCoreOperationsGateway(
      transport,
      storage,
      new TestClock(),
      diagnostics,
    );
    const second = deferred<{ status: number; body: unknown }>();
    transport.enqueue({
      status: 200,
      body: imageBootstrap([HASH_A, HASH_B, HASH_C]),
    });
    transport.enqueue({ status: 200, body: 'invalid-image' });
    transport.enqueue(() => second.promise);

    await gateway.initialize();
    await vi.waitFor(() => expect(gateway.getSyncSnapshot().phase).toBe(
      'upgrade-required',
    ));
    second.resolve(imageResponse());
    await vi.waitFor(() => expect(
      transport.requests.filter((request) =>
        request.path.startsWith('/v1/images/'),
      ),
    ).toHaveLength(2));

    expect(diagnostics).toHaveBeenCalledWith({
      event: 'core-schema-incompatibility',
      source: 'image-prefetch',
      errorName: 'CoreApiSchemaError',
      errorMessage: 'Invalid CH Core catalogue image envelope',
    });
    expect(
      transport.requests.some((request) => request.path.endsWith(HASH_C)),
    ).toBe(false);
  });

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

  it('automatically retries transient image failures after an authenticated reconnect', async () => {
    const storage = new ImageMemoryStorage();
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });
    transport.enqueue(new Error('LAN image request interrupted'));

    await gateway.initialize();
    await vi.waitFor(() => expect(gateway.getSyncSnapshot().imagePrefetch).toMatchObject({
      phase: 'paused', failed: 1,
    }));
    transport.enqueue({
      status: 200,
      body: { serverRevision: '1', nextAfter: '1', changes: [] },
    });
    transport.enqueue(imageResponse('cmVjb25uZWN0ZWQ='));

    await gateway.retryPending();

    await vi.waitFor(() => expect(storage.images.has(HASH_A)).toBe(true));
    expect(gateway.getSyncSnapshot().imagePrefetch).toMatchObject({
      phase: 'complete', cached: 1, failed: 0,
    });
  });

  it('does not override an explicit image pause on authenticated reconnect', async () => {
    const storage = new ImageMemoryStorage();
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });
    transport.enqueue(new Error('LAN image request interrupted'));
    await gateway.initialize();
    await vi.waitFor(() => expect(gateway.getSyncSnapshot().imagePrefetch?.failed).toBe(1));
    gateway.pauseImagePrefetch();
    transport.enqueue({
      status: 200,
      body: { serverRevision: '1', nextAfter: '1', changes: [] },
    });
    transport.enqueue(imageResponse('dW51c2Vk'));

    await gateway.retryPending();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.requests.map((request) => request.path)).toEqual([
      '/v1/bootstrap',
      `/v1/images/${HASH_A}`,
      '/v1/changes?after=1&limit=500',
    ]);
    expect(gateway.getSyncSnapshot().imagePrefetch).toMatchObject({
      phase: 'paused', cached: 0,
    });
  });

  it('does not override a quota image pause on authenticated reconnect', async () => {
    const storage = new ImageMemoryStorage();
    storage.failNextImageSave = true;
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });
    transport.enqueue(imageResponse());
    await gateway.initialize();
    await vi.waitFor(() => expect(gateway.getSyncSnapshot().imagePrefetch?.failed).toBe(1));
    transport.enqueue({
      status: 200,
      body: { serverRevision: '1', nextAfter: '1', changes: [] },
    });
    transport.enqueue(imageResponse('dW51c2Vk'));

    await gateway.retryPending();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.requests.map((request) => request.path)).toEqual([
      '/v1/bootstrap',
      `/v1/images/${HASH_A}`,
      '/v1/changes?after=1&limit=500',
    ]);
    expect(gateway.getSyncSnapshot().imagePrefetch).toMatchObject({
      phase: 'paused', cached: 0, failed: 1,
    });
  });

  it('keeps a non-transient source failure for manual retry after reconnect', async () => {
    const storage = new ImageMemoryStorage();
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });
    transport.enqueue({ status: 404, body: { code: 'IMAGE_UNAVAILABLE' } });
    await gateway.initialize();
    await vi.waitFor(() => expect(gateway.getSyncSnapshot().imagePrefetch?.failed).toBe(1));
    transport.enqueue({
      status: 200,
      body: { serverRevision: '1', nextAfter: '1', changes: [] },
    });
    transport.enqueue(imageResponse('bWFudWFs'));

    await gateway.retryPending();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(transport.requests).toHaveLength(3);
    expect(gateway.getSyncSnapshot().imagePrefetch).toMatchObject({
      phase: 'paused', cached: 0, failed: 1,
    });

    gateway.retryImagePrefetch();
    await vi.waitFor(() => expect(storage.images.has(HASH_A)).toBe(true));
    expect(gateway.getSyncSnapshot().imagePrefetch).toMatchObject({
      phase: 'complete', cached: 1, failed: 0,
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

  it('renders an on-demand cache miss when its Blob write exceeds quota and stops queued work', async () => {
    const storage = new ImageMemoryStorage();
    storage.failNextImageSave = true;
    const transport = new ScriptedTransport();
    const clock = new TestClock();
    const gateway = createCoreOperationsGateway(transport, storage, clock);
    gateway.pauseImagePrefetch();
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A, HASH_B]) });
    await gateway.initialize();
    expect(gateway.getSyncSnapshot().phase).toBe('online');
    clock.foreground = false;
    gateway.retryImagePrefetch();
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock.foreground = true;
    transport.enqueue(imageResponse('dmlzaWJsZQ=='));

    await expect(gateway.loadSkuImage(gateway.getSnapshot().skus[0]!))
      .resolves.toBe('data:image/png;base64,dmlzaWJsZQ==');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.requests.map((request) => request.path)).toEqual([
      '/v1/bootstrap',
      `/v1/images/${HASH_A}`,
    ]);
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'online',
      imagePrefetch: { phase: 'paused', cached: 0, failed: 1 },
    });
  });

  it('records an on-demand network failure through the shared transient classifier', async () => {
    const storage = new ImageMemoryStorage();
    const transport = new ScriptedTransport();
    const clock = new TestClock();
    const gateway = createCoreOperationsGateway(transport, storage, clock);
    gateway.pauseImagePrefetch();
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });
    await gateway.initialize();
    clock.foreground = false;
    gateway.retryImagePrefetch();
    await new Promise((resolve) => setTimeout(resolve, 0));
    clock.foreground = true;
    transport.enqueue(new Error('LAN image request interrupted'));

    await expect(gateway.loadSkuImage(gateway.getSnapshot().skus[0]!))
      .rejects.toThrow('LAN image request interrupted');

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

  it('does not delete a newly referenced seeded hash when stale bootstrap pruning is in flight', async () => {
    const storage = new DelayedDeleteImageStorage();
    storage.images.set(HASH_B, new Blob(['prior'], { type: 'image/png' }));
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A]) });
    await gateway.initialize();
    await storage.deleteStarted.promise;
    const sku = gateway.getSnapshot().skus[0]!;
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '2',
        entityVersion: '2',
        entity: {
          ...imageBootstrap([HASH_B], '2').skus[0]!,
          id: sku.id,
          rowVersion: '2',
        },
      },
    });
    transport.enqueue({
      status: 200,
      body: { serverRevision: '2', nextAfter: '1', changes: [] },
    });
    const update = gateway.updateSku(sku.id, {
      imageUrl: 'data:image/png;base64,aW1hZ2U=',
    });
    await vi.waitFor(() => expect(gateway.getSnapshot().skus[0]?.imageHash).toBe(HASH_B));

    storage.releaseDelete.resolve(undefined);
    await update;
    await storage.deleteFinished.promise;

    expect(storage.images.has(HASH_B)).toBe(true);
    expect(gateway.getSnapshot().skus[0]?.imageHash).toBe(HASH_B);
    expect(transport.requests.map((request) => request.path)).toEqual([
      '/v1/bootstrap',
      `/v1/skus/${sku.id}/image`,
      '/v1/changes?after=1&limit=500',
    ]);
    await vi.waitFor(() => expect(gateway.getSyncSnapshot().imagePrefetch).toMatchObject({
      serverAvailable: 1, cached: 1, failed: 0,
    }));
  });

  it('publishes a newer cache-hit reference before stale prune preparation can delete it', async () => {
    const storage = new DelayedEnumerationImageStorage();
    storage.images.set(HASH_B, new Blob(['b'], { type: 'image/png' }));
    storage.images.set(HASH_C, new Blob(['c'], { type: 'image/png' }));
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(transport, storage, new TestClock());
    transport.enqueue({ status: 200, body: imageBootstrap([HASH_A, null]) });
    await gateway.initialize();
    await storage.firstEnumerationStarted.promise;
    const next = imageBootstrap([HASH_B, HASH_C], '3');
    transport.enqueue({
      status: 200,
      body: {
        serverRevision: '3',
        nextAfter: '3',
        changes: next.skus.map((payload, index) => ({
          revision: String(index + 2),
          entityType: 'sku',
          entityId: String(payload.id),
          operation: 'upsert',
          payload: { ...payload, rowVersion: String(index + 2) },
          createdAt: `2026-08-04T12:00:0${index}.000Z`,
        })),
      },
    });

    await gateway.retryPending();
    const referencesPublishedBeforeStorageRelease =
      gateway.getSyncSnapshot().imagePrefetch?.serverAvailable;
    storage.releaseFirstEnumeration.resolve(undefined);
    await vi.waitFor(() => expect(gateway.getSyncSnapshot().imagePrefetch).toMatchObject({
      serverAvailable: 2, cached: 2, failed: 0,
    }));

    expect(referencesPublishedBeforeStorageRelease).toBe(2);
    expect(storage.deleteCalls.flat()).not.toContain(HASH_B);
    expect(storage.deleteCalls.flat()).not.toContain(HASH_C);
    expect(storage.images.has(HASH_B)).toBe(true);
    expect(storage.images.has(HASH_C)).toBe(true);
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
