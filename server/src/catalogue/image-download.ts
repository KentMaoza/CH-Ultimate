import { lookup as nodeLookup } from 'node:dns/promises';

import {
  requireApprovedImageUrl,
  requirePublicImageAddress,
} from './image-address-policy.js';
import {
  imageContentType,
  validateCatalogueImage,
} from './image-metadata.js';
import {
  IMAGE_TIMEOUT_MS,
  ImageDownloadError,
  imageError,
  MAX_IMAGE_BYTES,
  type DownloadedCatalogueImage,
  type ImageDownloadDependencies,
} from './image-download-types.js';
import { createPinnedImageFetch } from './pinned-image-fetch.js';

export {
  IMAGE_TIMEOUT_MS,
  ImageDownloadError,
  MAX_IMAGE_BYTES,
  type DownloadedCatalogueImage,
  type ImageDownloadDependencies,
  type ImageFetchInput,
  type ImageFetchResponse,
  type ResolvedImageAddress,
} from './image-download-types.js';
export { createPinnedImageFetch } from './pinned-image-fetch.js';

const MAX_REDIRECTS = 3;

const defaultDependencies: ImageDownloadDependencies = {
  resolve: (hostname) =>
    nodeLookup(hostname, { all: true, verbatim: true }).then((addresses) =>
      addresses.map(({ address, family }) => ({ address, family })),
    ),
  fetch: createPinnedImageFetch(),
};

export class CatalogueImageDownloader {
  constructor(
    private readonly dependencies: ImageDownloadDependencies =
      defaultDependencies,
  ) {}

  async download(sourceUrl: string): Promise<DownloadedCatalogueImage> {
    let url = requireApprovedImageUrl(sourceUrl);
    for (let redirectCount = 0; ; redirectCount += 1) {
      const pinned = requirePublicImageAddress(
        await this.dependencies.resolve(url.hostname),
      );
      const response = await this.dependencies.fetch({
        url,
        address: pinned.address,
        family: pinned.family,
        timeoutMs: IMAGE_TIMEOUT_MS,
        maximumBytes: MAX_IMAGE_BYTES,
      });
      if (response.status >= 300 && response.status <= 399) {
        if (redirectCount >= MAX_REDIRECTS) {
          return imageError(
            'IMAGE_TOO_MANY_REDIRECTS',
            'Pengalihan gambar melebihi batas.',
          );
        }
        const location = response.headers.location;
        if (!location) {
          return imageError(
            'IMAGE_INVALID_REDIRECT',
            'Tujuan pengalihan gambar tidak valid.',
          );
        }
        try {
          url = requireApprovedImageUrl(new URL(location, url));
        } catch (error) {
          if (error instanceof ImageDownloadError) throw error;
          return imageError(
            'IMAGE_INVALID_REDIRECT',
            'Tujuan pengalihan gambar tidak valid.',
          );
        }
        continue;
      }
      if (response.status !== 200) {
        return imageError(
          'IMAGE_HTTP_ERROR',
          'Server gambar mengembalikan respons gagal.',
        );
      }
      const metadata = validateCatalogueImage(
        response.bytes,
        imageContentType(response.headers),
      );
      return { bytes: response.bytes, ...metadata };
    }
  }
}
