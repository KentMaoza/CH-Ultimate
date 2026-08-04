import type { Sku } from '../domain/types';
import type { CoreApiTransport } from './core-api-transport';
import { CORE_API_PATHS, parseCatalogueImage } from './core-api-types';
import type { CoreGatewayClock, CoreGatewayStorage } from './core-cache';
import type { CoreGatewayState } from './core-gateway-state';
import type { ImagePrefetchSnapshot } from './operations-gateway-contract';

const SHA256 = /^[0-9a-f]{64}$/;
const CONCURRENCY = 2;

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
  private failedHashes = new Set<string>();
  private queue: string[] = [];
  private active = 0;
  private generation = 0;
  private userPaused = false;
  private disposed = false;
  private readonly inFlight = new Map<string, Promise<Blob>>();
  private networkActive = 0;
  private readonly networkWaiters: Array<() => void> = [];

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
    try {
      await this.storage.saveImage(validated, image);
      this.cachedHashes.add(validated);
      this.failedHashes.delete(validated);
    } catch {
      this.failedHashes.add(validated);
      this.userPaused = true;
    }
    this.publish();
  }

  async refresh(pruneUnreferenced: boolean): Promise<void> {
    if (this.disposed || !supportsImageStorage(this.storage)) return;
    const generation = ++this.generation;
    const skus = this.getSkus();
    this.referencedHashes = new Set(
      skus.flatMap((sku) => sku.imageHash ? [requireHash(sku.imageHash)] : []),
    );
    let cached = new Set(
      (await this.storage.listImageHashes()).filter((hash) => SHA256.test(hash)),
    );
    if (this.disposed || generation !== this.generation) return;
    if (pruneUnreferenced) {
      const stale = [...cached].filter((hash) => !this.referencedHashes.has(hash));
      if (stale.length > 0) {
        await this.storage.deleteImages(stale);
        cached = new Set([...cached].filter((hash) => this.referencedHashes.has(hash)));
      }
    }
    if (this.disposed || generation !== this.generation) return;
    this.cachedHashes = cached;
    this.failedHashes = new Set(
      [...this.failedHashes].filter((hash) => this.referencedHashes.has(hash)),
    );
    this.queue = [...this.referencedHashes].filter(
      (hash) => !cached.has(hash) && !this.failedHashes.has(hash) && !this.inFlight.has(hash),
    );
    this.publish();
    this.pump(generation);
  }

  pause(): void {
    this.userPaused = true;
    this.publish();
  }

  retry(): void {
    this.userPaused = false;
    this.failedHashes.clear();
    void this.refresh(false);
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.queue = [];
  }

  private pump(generation: number): void {
    if (
      this.disposed || generation !== this.generation || this.userPaused ||
      !this.clock.isForeground() || !this.isBusinessOnline()
    ) {
      this.publish();
      return;
    }
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const hash = this.queue.shift()!;
      this.active += 1;
      void this.fetchAndStore(hash)
        .then(() => {
          if (this.referencedHashes.has(hash)) {
            this.cachedHashes.add(hash);
            this.failedHashes.delete(hash);
          }
        })
        .catch((error) => {
          if (this.referencedHashes.has(hash)) this.failedHashes.add(hash);
          if (error instanceof DOMException && error.name === 'QuotaExceededError') {
            this.userPaused = true;
          }
        })
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
    const request = this.withNetworkSlot(async () => {
      const response = await this.transport.request({
        method: 'GET',
        path: CORE_API_PATHS.image(hash),
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          typeof response.body === 'object' && response.body &&
          typeof Reflect.get(response.body, 'code') === 'string'
            ? String(Reflect.get(response.body, 'code'))
            : 'IMAGE_UNAVAILABLE',
        );
      }
      const image = parseCatalogueImage(response.body);
      const blob = imageBlobFromBase64(image.mimeType, image.bytesBase64);
      if (this.storage.saveImage) await this.storage.saveImage(hash, blob);
      return blob;
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

  private publish(): void {
    const total = this.getSkus().length;
    const serverAvailable = this.referencedHashes.size;
    const cached = [...this.referencedHashes]
      .filter((hash) => this.cachedHashes.has(hash)).length;
    const failed = [...this.referencedHashes]
      .filter((hash) => this.failedHashes.has(hash)).length;
    const hasPending = cached + failed < serverAvailable;
    const phase: ImagePrefetchSnapshot['phase'] =
      this.userPaused ||
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
