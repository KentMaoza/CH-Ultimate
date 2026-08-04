import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
} from 'node:http';
import {
  request as nodeHttpsRequest,
  type RequestOptions,
} from 'node:https';

import {
  ImageDownloadError,
  type ImageDownloadDependencies,
} from './image-download-types.js';

type RequestImplementation = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function createPinnedImageFetch(
  requestImpl: RequestImplementation = nodeHttpsRequest,
): ImageDownloadDependencies['fetch'] {
  return (input) =>
    new Promise((resolve, reject) => {
      let settled = false;
      let totalTimer: NodeJS.Timeout | undefined;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        if (totalTimer) clearTimeout(totalTimer);
        action();
      };
      const fail = (code: string, message: string): void =>
        finish(() => reject(new ImageDownloadError(code, message)));
      const request = requestImpl(
        {
          protocol: 'https:',
          hostname: input.address,
          family: input.family,
          port: 443,
          servername: input.url.hostname,
          method: 'GET',
          path: `${input.url.pathname}${input.url.search}`,
          headers: {
            accept: 'image/png,image/jpeg,image/gif,image/webp',
            host: input.url.host,
          },
          rejectUnauthorized: true,
          timeout: input.timeoutMs,
        },
        (response) => {
          const length = Number(headerValue(response.headers, 'content-length'));
          if (Number.isFinite(length) && length > input.maximumBytes) {
            response.destroy();
            fail('IMAGE_TOO_LARGE', 'Ukuran gambar melebihi 5 MiB.');
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer | string) => {
            if (settled) return;
            const encoded = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += encoded.length;
            if (size > input.maximumBytes) {
              response.destroy();
              fail('IMAGE_TOO_LARGE', 'Ukuran gambar melebihi 5 MiB.');
              return;
            }
            chunks.push(encoded);
          });
          response.on('error', () =>
            fail('IMAGE_NETWORK_ERROR', 'Gambar tidak dapat diunduh.'),
          );
          response.on('end', () =>
            finish(() =>
              resolve({
                status: response.statusCode ?? 0,
                headers: {
                  'content-type': headerValue(
                    response.headers,
                    'content-type',
                  ),
                  location: headerValue(response.headers, 'location'),
                },
                bytes: Buffer.concat(chunks),
              }),
            ),
          );
        },
      );
      request.on('error', () =>
        fail('IMAGE_NETWORK_ERROR', 'Gambar tidak dapat diunduh.'),
      );
      request.setTimeout(input.timeoutMs, () => {
        request.destroy();
        fail(
          'IMAGE_TIMEOUT',
          'Pengunduhan gambar melewati batas waktu.',
        );
      });
      totalTimer = setTimeout(() => {
        request.destroy();
        fail(
          'IMAGE_TIMEOUT',
          'Pengunduhan gambar melewati batas waktu.',
        );
      }, input.timeoutMs);
      totalTimer.unref();
      request.end();
    });
}
