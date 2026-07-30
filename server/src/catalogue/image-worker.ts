import { createHash } from 'node:crypto';

import {
  ImageDownloadError,
  type DownloadedCatalogueImage,
} from './image-download.js';

export interface CatalogueImageJob {
  id: string;
  skuId: string;
  sourceUrl: string;
  attemptCount: number;
}

export interface CatalogueImageAsset {
  contentHash: string;
  mimeType: string;
  byteSize: number;
  width: number;
  height: number;
  storagePath: string;
}

export interface CatalogueImageRepository {
  claimNext(): Promise<CatalogueImageJob | null>;
  complete(
    job: CatalogueImageJob,
    asset: CatalogueImageAsset,
  ): Promise<void>;
  fail(job: CatalogueImageJob, errorCode: string): Promise<void>;
}

export interface CatalogueImageDownloaderPort {
  download(sourceUrl: string): Promise<DownloadedCatalogueImage>;
}

export interface CatalogueImageStorage {
  writeImage(contentHash: string, bytes: Buffer): Promise<string>;
}

export class CatalogueImageWorker {
  private busy = false;
  private stopped = true;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly repository: CatalogueImageRepository,
    private readonly downloader: CatalogueImageDownloaderPort,
    private readonly storage: CatalogueImageStorage,
  ) {}

  async runOnce(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const job = await this.repository.claimNext();
      if (!job) return false;
      try {
        const downloaded = await this.downloader.download(job.sourceUrl);
        const contentHash = createHash('sha256')
          .update(downloaded.bytes)
          .digest('hex');
        const storagePath = await this.storage.writeImage(
          contentHash,
          downloaded.bytes,
        );
        await this.repository.complete(job, {
          contentHash,
          mimeType: downloaded.mimeType,
          byteSize: downloaded.bytes.length,
          width: downloaded.width,
          height: downloaded.height,
          storagePath,
        });
      } catch (error) {
        await this.repository.fail(
          job,
          error instanceof ImageDownloadError
            ? error.code
            : 'IMAGE_DOWNLOAD_FAILED',
        );
      }
      return true;
    } finally {
      this.busy = false;
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.drain().catch(() => undefined);
    this.timer = setInterval(() => {
      void this.drain().catch(() => undefined);
    }, 60_000);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async drain(): Promise<void> {
    while (!this.stopped && (await this.runOnce())) {
      // Intentionally serial: one bounded network job at a time.
    }
  }
}
