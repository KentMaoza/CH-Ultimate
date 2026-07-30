import type {
  ClientRequest,
  IncomingMessage,
  RequestOptions,
} from 'node:http';
import { request as nodeHttpsRequest } from 'node:https';

import type { CoreApiResponse } from '../gateway/core-api-transport';
import type { CoreMainSendInput } from './core-api-main';

const CONNECTION_ERROR = 'CH Core tidak dapat dihubungi.';
const RESPONSE_ERROR = 'Respons CH Core tidak valid.';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_REQUEST_BYTES = 1_000_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2_000_000;
const BOOTSTRAP_MAX_RESPONSE_BYTES = 5_000_000;
const CATALOGUE_TRANSFER_MAX_BYTES = 7_100_000;
const IMAGE_PATH = /^\/v1\/images\/[0-9a-f]{64}$/;

type RequestImplementation = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export interface CoreHttpsClientOptions {
  requestImpl?: RequestImplementation;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

function serializeBody(body: unknown, maximum: number): Buffer | undefined {
  if (body === undefined) return undefined;
  try {
    const encoded = Buffer.from(JSON.stringify(body), 'utf8');
    if (encoded.length > maximum) throw new Error();
    return encoded;
  } catch {
    throw new Error('Permintaan CH Core terlalu besar.');
  }
}

function parseResponse(chunks: Buffer[], contentType: string | string[] | undefined) {
  const encoded = Buffer.concat(chunks);
  if (encoded.length === 0) return undefined;
  const type = Array.isArray(contentType) ? contentType[0] : contentType;
  if (!type?.toLowerCase().startsWith('application/json')) {
    throw new Error(RESPONSE_ERROR);
  }
  try {
    return JSON.parse(encoded.toString('utf8')) as unknown;
  } catch {
    throw new Error(RESPONSE_ERROR);
  }
}

export function createCoreHttpsClient(options: CoreHttpsClientOptions = {}) {
  const requestImpl = options.requestImpl ?? nodeHttpsRequest;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRequestBytes =
    options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  return {
    send(input: CoreMainSendInput): Promise<CoreApiResponse> {
      const requestLimit =
        options.maxRequestBytes ??
        (input.request.path === '/v1/imports/validate' ||
        input.request.path === '/v1/images'
          ? CATALOGUE_TRANSFER_MAX_BYTES
          : maxRequestBytes);
      const responseLimit =
        options.maxResponseBytes ??
        (input.request.path === '/v1/bootstrap'
          ? BOOTSTRAP_MAX_RESPONSE_BYTES
          : IMAGE_PATH.test(input.request.path)
          ? CATALOGUE_TRANSFER_MAX_BYTES
          : maxResponseBytes);
      const body = serializeBody(input.request.body, requestLimit);
      const endpoint = new URL(input.endpoint);
      const headers: Record<string, string | number> = {
        accept: 'application/json',
      };
      if (input.authorization) headers.authorization = input.authorization;
      if (body) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = body.length;
      }
      if (input.request.idempotencyKey) {
        headers['idempotency-key'] = input.request.idempotencyKey;
      }

      return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (message: string) => {
          if (settled) return;
          settled = true;
          reject(new Error(message));
        };
        const request = requestImpl(
          {
            protocol: 'https:',
            hostname: endpoint.hostname.replace(/^\[|\]$/g, ''),
            port: Number(endpoint.port),
            method: input.request.method,
            path: input.request.path,
            ca: input.ca,
            rejectUnauthorized: true,
            headers,
            timeout: timeoutMs,
          },
          (response) => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer | string) => {
              if (settled) return;
              const encoded = Buffer.isBuffer(chunk)
                ? chunk
                : Buffer.from(chunk);
              size += encoded.length;
              if (size > responseLimit) {
                response.destroy();
                fail(RESPONSE_ERROR);
                return;
              }
              chunks.push(encoded);
            });
            response.on('error', () => fail(CONNECTION_ERROR));
            response.on('end', () => {
              if (settled) return;
              try {
                const result = {
                  status: response.statusCode ?? 0,
                  body: parseResponse(
                    chunks,
                    response.headers['content-type'],
                  ),
                };
                settled = true;
                resolve(result);
              } catch {
                fail(RESPONSE_ERROR);
              }
            });
          },
        );
        request.on('error', () => fail(CONNECTION_ERROR));
        request.setTimeout(timeoutMs, () => {
          request.destroy(new Error('timeout'));
          fail(CONNECTION_ERROR);
        });
        if (body) request.write(body);
        request.end();
      });
    },
  };
}
