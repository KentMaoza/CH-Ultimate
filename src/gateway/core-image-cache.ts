import type { Sku } from '../domain/types';
import type { CoreApiTransport } from './core-api-transport';
import { CORE_API_PATHS, parseCatalogueImage } from './core-api-types';
import type { CoreGatewayClock, CoreGatewayStorage } from './core-cache';
import type { CoreGatewayState } from './core-gateway-state';
import type { ImagePrefetchSnapshot } from './operations-gateway-contract';

const SHA256 = /^[0-9a-f]{64}$/;
const CONCURRENCY = 2;
type ImageFailureKind = 'transient' | 'quota' | 'source';

class ImageRequestError extends Error {
  constructor(
    readonly kind: Extract<ImageFailureKind, 'transient' | 'source'>,
    message: string,
  ) {
    super(message);
  }
}

function requireHash(hash: string): string {
  if (!SHA256.test(hash)) throw new Error('Hash gambar SHA-256 tidak valid.');
  return hash;
}

export function imageBlobFromBase64(mimeType: string, bytesBase64: string): Blob {
  const binary = atob(bytesBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export async function imageBlobToDataUrl(image: Blob): Promise<string> {
  const bytes = new Uint8Array(await image.arrayBuffer());
  let binary = '';
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${image.type};base64,${btoa(binary)}`;
}

function supportsImageStorage(storage: CoreGatewayStorage): storage is Required<
  Pick<CoreGatewayStorage, 'loadImage' | 'saveImage' | 'listImageHashes' | 'deleteImages'>
> & CoreGatewayStorage {
  return Boolean(
    storage.loadImage && storage.saveImage &&
    storage.listImageHashes && storage.deleteImages,
  );
}

export class CoreImageCacheCoordinator {
  private snapshot: ImagePrefetchSnapshot = {
    phase: 'idle', total: 0, serverAvailable: 0, cached: 0, failed: 0,
  };
  private referencedHashes = new Set<string>();
  private cachedHashes = new Set<string>();
  private failures = new Map<string, ImageFailureKind>();
  private queue: string[] = [];
  private active = 0;
  private generation = 0;
  private userPaused = false;
  private quotaPaused = false;
  private disposed = false;
  private readonly inFlight = new Map<string, Promise<Blob>>();
  private networkActive = 0;
  private readonly networkWaiters: Array<() => void> = [];
  private storageOperations: Promise<void> = Promise.resolve();

  constructor(
    private readonly transport: CoreApiTransport,
    private readonly storage: CoreGatewayStorage,
    private readonly clock: CoreGatewayClock,
    private readonly state: CoreGatewayState,
    private readonly getSkus: () => Sku[],
  ) {
    state.publishImagePrefetch(this.snapshot);
  }

  isEnabled(): boolean {
    return supportsImageStorage(this.storage);
  }

  getSnapshot(): ImagePrefetchSnapshot {
    return { ...this.snapshot };
  }

  async load(hash: string, beforeFetch?: () => void): Promise<Blob> {
    const validated = requireHash(hash);
    if (this.storage.loadImage) {
      const cached = await this.storage.loadImage(validated);
      if (cached) return cached;
    }
    beforeFetch?.();
    return this.fetchAndStore(validated);
  }

  async seed(hash: string, image: Blob): Promise<void> {
    const validated = requireHash(hash);
    if (!this.storage.saveImage) return;
    this.generation += 1;
    await this.storeBlob(validated, image);
    this.publish();
  }

  async refresh(
    pruneUnreferenced: boolean,
    retryTransient = false,
  ): Promise<void> {
    if (this.disposed || !supportsImageStorage(this.storage)) return;
    const storage = this.storage;
    const generation = ++this.generation;
    const refreshReferences = new Set(
      this.getSkus().flatMap(
        (sku) => sku.imageHash ? [requireHash(sku.imageHash)] : [],
      ),
    );
    this.referencedHashes = refreshReferences;
    this.queue = [];
    this.publish();
    await this.runStorageOperation(async () => {
      if (this.disposed || generation !== this.generation) return;
      let cached = new Set(
        (await storage.listImageHashes()).filter((hash) => SHA256.test(hash)),
      );
      if (this.disposed || generation !== this.generation) return;
      if (pruneUnreferenced) {
        const candidates = [...cached].filter(
          (hash) => !refreshReferences.has(hash),
        );
        if (this.disposed || generation !== this.generation) return;
        const stillUnreferenced = candidates.filter(
          (hash) => !this.referencedHashes.has(hash),
        );
        if (stillUnreferenced.length > 0) {
          await storage.deleteImages(stillUnreferenced);
          const deleted = new Set(stillUnreferenced);
          cached = new Set([...cached].filter((hash) => !deleted.has(hash)));
        }
      }
      if (this.disposed || generation !== this.generation) return;
      this.cachedHashes = cached;
      this.failures = new Map(
        [...this.failures].filter(([hash]) => this.referencedHashes.has(hash)),
      );
      if (retryTransient) {
        this.failures.forEach((kind, hash) => {
          if (kind === 'transient') this.failures.delete(hash);
        });
      }
      this.queue = [...this.referencedHashes].filter(
        (hash) => !cached.has(hash) && !this.failures.has(hash) && !this.inFlight.has(hash),
      );
      this.publish();
      this.pump(generation);
    });
  }

  pause(): void {
    this.userPaused = true;
    this.publish();
  }

  retry(): void {
    this.userPaused = false;
    this.quotaPaused = false;
    this.failures.clear();
    void this.refresh(false);
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.queue = [];
  }

  private pump(generation: number): void {
    if (
      this.disposed || generation !== this.generation ||
      this.userPaused || this.quotaPaused ||
      !this.clock.isForeground() || !this.isBusinessOnline()
    ) {
      this.publish();
      return;
    }
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const hash = this.queue.shift()!;
      this.active += 1;
      void this.fetchAndStore(hash)
        .catch(() => {})
        .finally(() => {
          this.active -= 1;
          this.publish();
          this.pump(this.generation);
        });
    }
    this.publish();
  }

  private fetchAndStore(hash: string): Promise<Blob> {
    const existing = this.inFlight.get(hash);
    if (existing) return existing;
    this.queue = this.queue.filter((candidate) => candidate !== hash);
    const request = this.withNetworkSlot(async () => {
      const response = await this.transport.request({
        method: 'GET',
        path: CORE_API_PATHS.image(hash),
      });
      if (response.status < 200 || response.status >= 300) {
        throw new ImageRequestError(
          response.status >= 500 || response.status === 408 || response.status === 429
            ? 'transient'
            : 'source',
          typeof response.body === 'object' && response.body &&
          typeof Reflect.get(response.body, 'code') === 'string'
            ? String(Reflect.get(response.body, 'code'))
            : 'IMAGE_UNAVAILABLE',
        );
      }
      const image = parseCatalogueImage(response.body);
      const blob = imageBlobFromBase64(image.mimeType, image.bytesBase64);
      await this.storeBlob(hash, blob);
      return blob;
    }).catch((error) => {
      if (this.referencedHashes.has(hash)) this.recordFailure(hash, error);
      throw error;
    }).finally(() => this.inFlight.delete(hash));
    this.inFlight.set(hash, request);
    return request;
  }

  private async withNetworkSlot<T>(task: () => Promise<T>): Promise<T> {
    if (this.networkActive >= CONCURRENCY) {
      await new Promise<void>((resolve) => this.networkWaiters.push(resolve));
    }
    this.networkActive += 1;
    try {
      return await task();
    } finally {
      this.networkActive -= 1;
      this.networkWaiters.shift()?.();
    }
  }

  private async storeBlob(hash: string, blob: Blob): Promise<boolean> {
    if (!this.storage.saveImage) return false;
    return this.runStorageOperation(async () => {
      try {
        await this.storage.saveImage!(hash, blob);
        this.cachedHashes.add(hash);
        this.failures.delete(hash);
        return true;
      } catch (error) {
        this.recordFailure(hash, error);
        return false;
      }
    });
  }

  private runStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.storageOperations.then(operation, operation);
    this.storageOperations = result.then(() => undefined, () => undefined);
    return result;
  }

  private recordFailure(hash: string, error: unknown): void {
    const kind: ImageFailureKind =
      error instanceof DOMException && error.name === 'QuotaExceededError'
        ? 'quota'
        : error instanceof ImageRequestError
          ? error.kind
          : 'transient';
    this.failures.set(hash, kind);
    if (kind === 'quota') this.quotaPaused = true;
    this.publish();
  }

  private publish(): void {
    const total = this.getSkus().length;
    const serverAvailable = this.referencedHashes.size;
    const cached = [...this.referencedHashes]
      .filter((hash) => this.cachedHashes.has(hash)).length;
    const failed = [...this.referencedHashes]
      .filter((hash) => this.failures.has(hash)).length;
    const hasPending = cached + failed < serverAvailable;
    const phase: ImagePrefetchSnapshot['phase'] =
      this.userPaused || this.quotaPaused ||
      (failed > 0 && this.active === 0 && this.queue.length === 0) ||
      ((!this.clock.isForeground() || !this.isBusinessOnline()) && hasPending)
        ? 'paused'
        : this.active > 0 || this.queue.length > 0
          ? 'running'
          : serverAvailable > 0 && !hasPending
            ? 'complete'
            : 'idle';
    this.snapshot = { phase, total, serverAvailable, cached, failed };
    this.state.publishImagePrefetch(this.snapshot);
  }

  private isBusinessOnline(): boolean {
    return this.state.getSyncSnapshot().phase === 'online';
  }
}
