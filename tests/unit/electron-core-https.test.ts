import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type {
  ClientRequest,
  IncomingMessage,
  RequestOptions,
} from 'node:http';
import { describe, expect, it, vi } from 'vitest';

import { createCoreHttpsClient } from '../../src/electron/core-https-client';

const endpoint = 'https://192.168.1.14:8443';
const ca = Buffer.from('private-ca');
const authorization = 'Bearer caller-held-token';

interface FakeResponse {
  status: number;
  headers?: Record<string, string>;
  chunks?: string[];
}

function respondingRequest(fake: FakeResponse) {
  const calls: RequestOptions[] = [];
  const requestImpl = vi.fn(
    (
      options: RequestOptions,
      callback: (response: IncomingMessage) => void,
    ) => {
      calls.push(options);
      const request = new EventEmitter() as ClientRequest;
      Object.assign(request, {
        write: vi.fn(),
        setTimeout: vi.fn(() => request),
        destroy: vi.fn((error?: Error) => {
          if (error) request.emit('error', error);
          return request;
        }),
        end: vi.fn(() => {
          const response = Readable.from(fake.chunks ?? ['{}']) as IncomingMessage;
          response.statusCode = fake.status;
          response.headers = fake.headers ?? {
            'content-type': 'application/json',
          };
          callback(response);
        }),
      });
      return request;
    },
  );
  return { calls, requestImpl };
}

describe('main-process CH Core HTTPS client', () => {
  it('uses the private CA, strict TLS, internal authorization, timeout, and JSON only', async () => {
    const fake = respondingRequest({
      status: 200,
      chunks: ['{"serverRevision":"7"}'],
    });
    const client = createCoreHttpsClient({
      requestImpl: fake.requestImpl,
      timeoutMs: 4_000,
    });

    const response = await client.send({
      endpoint,
      ca,
      authorization,
      request: {
        method: 'PATCH',
        path: '/v1/templates/label',
        body: { name: 'Gudang' },
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      },
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      protocol: 'https:',
      hostname: '192.168.1.14',
      port: 8443,
      method: 'PATCH',
      path: '/v1/templates/label',
      ca,
      rejectUnauthorized: true,
      headers: {
        accept: 'application/json',
        authorization,
        'content-type': 'application/json',
        'idempotency-key': '11111111-1111-4111-8111-111111111111',
      },
      timeout: 4_000,
    });
    expect(response).toEqual({
      status: 200,
      body: { serverRevision: '7' },
    });
    expect(response).not.toHaveProperty('authorization');
  });

  it('returns a redirect response without issuing a second request', async () => {
    const fake = respondingRequest({
      status: 302,
      headers: {
        'content-type': 'application/json',
        location: 'https://198.51.100.9:8443/v1/bootstrap',
      },
      chunks: ['{"code":"MOVED"}'],
    });
    const client = createCoreHttpsClient({ requestImpl: fake.requestImpl });

    await expect(
      client.send({
        endpoint,
        ca,
        authorization,
        request: { method: 'GET', path: '/v1/bootstrap' },
      }),
    ).resolves.toEqual({ status: 302, body: { code: 'MOVED' } });
    expect(fake.requestImpl).toHaveBeenCalledTimes(1);
  });

  it('omits authorization entirely for unauthenticated identity requests', async () => {
    const fake = respondingRequest({
      status: 202,
      chunks: ['{"pairingId":"public","status":"pending"}'],
    });
    const client = createCoreHttpsClient({ requestImpl: fake.requestImpl });

    await client.send({
      endpoint,
      ca,
      request: {
        method: 'POST',
        path: '/v1/pairings/redeem',
        body: { phase: 'claim' },
      },
    });

    expect(fake.calls[0]?.headers).not.toHaveProperty('authorization');
  });

  it('fails generically when the response exceeds the configured limit', async () => {
    const fake = respondingRequest({
      status: 200,
      chunks: ['{"payload":"', '1234567890', '"}'],
    });
    const client = createCoreHttpsClient({
      requestImpl: fake.requestImpl,
      maxResponseBytes: 16,
    });

    await expect(
      client.send({
        endpoint,
        ca,
        authorization,
        request: { method: 'GET', path: '/v1/bootstrap' },
      }),
    ).rejects.toThrow('Respons CH Core tidak valid.');
  });

  it('destroys timed-out requests and returns a generic connection error', async () => {
    let timeout: (() => void) | undefined;
    const destroy = vi.fn();
    const requestImpl = vi.fn(() => {
      const request = new EventEmitter() as ClientRequest;
      Object.assign(request, {
        write: vi.fn(),
        end: vi.fn(() => timeout?.()),
        setTimeout: vi.fn((_milliseconds: number, callback: () => void) => {
          timeout = callback;
          return request;
        }),
        destroy: vi.fn((error?: Error) => {
          destroy(error);
          if (error) request.emit('error', error);
          return request;
        }),
      });
      return request;
    });
    const client = createCoreHttpsClient({ requestImpl, timeoutMs: 25 });

    await expect(
      client.send({
        endpoint,
        ca,
        authorization,
        request: { method: 'GET', path: '/v1/bootstrap' },
      }),
    ).rejects.toThrow('CH Core tidak dapat dihubungi.');
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
