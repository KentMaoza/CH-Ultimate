export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TIMEOUT_MS = 10_000;

export class ImageDownloadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImageDownloadError';
  }
}

export interface ResolvedImageAddress {
  address: string;
  family: number;
}

export interface ImageFetchInput {
  url: URL;
  address: string;
  family: number;
  timeoutMs: number;
  maximumBytes: number;
}

export interface ImageFetchResponse {
  status: number;
  headers: Record<string, string | undefined>;
  bytes: Buffer;
}

export interface ImageDownloadDependencies {
  resolve(hostname: string): Promise<ResolvedImageAddress[]>;
  fetch(input: ImageFetchInput): Promise<ImageFetchResponse>;
}

export interface DownloadedCatalogueImage {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export function imageError(code: string, message: string): never {
  throw new ImageDownloadError(code, message);
}
