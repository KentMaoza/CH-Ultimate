import { describe, expect, it, vi } from 'vitest';

import {
  createCoreApiMain,
  parseCoreEndpointConfig,
} from '../../src/electron/core-api-main';

const VALID_CONFIG = {
  endpoint: 'https://192.168.50.14:8443',
  caFile: '/private/ch-core-ca.pem',
};

describe('CH Core endpoint configuration', () => {
  it('accepts only the exact fixed HTTPS business LAN origin', () => {
    expect(parseCoreEndpointConfig(VALID_CONFIG)).toEqual(VALID_CONFIG);

    for (const endpoint of [
      'http://192.168.50.14:8443',
      'https://core.local:8443',
      'https://192.168.50.14',
      'https://user:pass@192.168.50.14:8443',
      'https://192.168.50.14:8443/v1',
      'https://192.168.50.14:8443?mode=test',
      'https://192.168.50.14:8443#core',
      'https://192.168.1.14:8443',
      'https://192.168.50.13:8443',
      'https://192.168.50.15:8443',
      'https://192.168.2.14:8443',
      'https://8.8.8.8:8443',
      'https://127.0.0.1:8443',
      'https://169.254.1.14:8443',
      'https://224.0.0.1:8443',
      'https://100.64.0.1:8443',
      'https://[::1]:8443',
    ]) {
      expect(() =>
        parseCoreEndpointConfig({ ...VALID_CONFIG, endpoint }),
      ).toThrow('Konfigurasi CH Core tidak valid.');
    }
  });

  it('rejects missing, unknown, or incomplete configuration', () => {
    for (const input of [
      undefined,
      {},
      { endpoint: VALID_CONFIG.endpoint },
      { ...VALID_CONFIG, token: 'jangan-bocor' },
    ]) {
      expect(() => parseCoreEndpointConfig(input)).toThrow(
        'Konfigurasi CH Core tidak valid.',
      );
    }
  });
});

describe('CH Core operation allowlist', () => {
  const createHarness = () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } });
    const credentials = {
      getCurrentToken: vi.fn().mockResolvedValue('caller-held-token'),
    };
    const api = createCoreApiMain({
      config: VALID_CONFIG,
      ca: Buffer.from('private-ca'),
      credentials,
      send,
    });
    return { api, credentials, send };
  };

  it('allows current sync and centralized business routes', async () => {
    const { api, send } = createHarness();
    const requests = [
      { method: 'GET' as const, path: '/v1/bootstrap' },
      { method: 'GET' as const, path: '/v1/changes?after=0&limit=500' },
      {
        method: 'POST' as const,
        path: '/v1/imports/validate',
        body: { fileName: 'catalogue.xlsx', workbookBase64: 'eGxzeA==' },
      },
      {
        method: 'POST' as const,
        path: '/v1/imports/11111111-1111-4111-8111-111111111111/commit',
      },
      {
        method: 'GET' as const,
        path: `/v1/images/${'a'.repeat(64)}`,
      },
      {
        method: 'POST' as const,
        path: '/v1/skus/11111111-1111-4111-8111-111111111111/image',
        body: { mimeType: 'image/png', bytesBase64: 'iVBORw==' },
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      },
      { method: 'POST' as const, path: '/v1/skus', body: { name: 'Beras' } },
      {
        method: 'POST' as const,
        path: '/v1/offline/notas',
        body: { provisionalId: '11111111-1111-4111-8111-111111111111' },
        idempotencyKey: '55555555-5555-4555-8555-555555555555',
      },
      {
        method: 'POST' as const,
        path: '/v1/offline/stock-adjustments',
        body: { skuId: '11111111-1111-4111-8111-111111111111', delta: 1 },
        idempotencyKey: '56565656-5656-4656-8656-565656565656',
      },
      {
        method: 'POST' as const,
        path: '/v1/skus/11111111-1111-4111-8111-111111111111/stock-checks',
        body: { countedQuantityPcs: 8 },
        idempotencyKey: '57575757-5757-4757-8757-575757575757',
      },
      {
        method: 'POST' as const,
        path: '/v1/offline/stock-checks',
        body: { skuId: '11111111-1111-4111-8111-111111111111' },
        idempotencyKey: '58585858-5858-4858-8858-585858585858',
      },
      {
        method: 'POST' as const,
        path: '/v1/skus/11111111-1111-4111-8111-111111111111/package-barcodes',
        body: { identifierValue: 'PKG-001' },
        idempotencyKey: '59595959-5959-4959-8959-595959595959',
      },
      {
        method: 'PATCH' as const,
        path: '/v1/package-barcodes/22222222-2222-4222-8222-222222222222',
        body: { skuId: '11111111-1111-4111-8111-111111111111' },
        idempotencyKey: '60606060-6060-4060-8060-606060606060',
      },
      {
        method: 'DELETE' as const,
        path: '/v1/package-barcodes/22222222-2222-4222-8222-222222222222',
        idempotencyKey: '61616161-6161-4161-8161-616161616161',
      },
      {
        method: 'PATCH' as const,
        path: '/v1/notas/11111111-1111-4111-8111-111111111111/header',
        body: { customerName: 'Sari' },
      },
      {
        method: 'DELETE' as const,
        path: '/v1/notas/11111111-1111-4111-8111-111111111111/pages/22222222-2222-4222-8222-222222222222/lines/33333333-3333-4333-8333-333333333333',
      },
      {
        method: 'POST' as const,
        path: '/v1/conflicts/44444444-4444-4444-8444-444444444444/resolve',
        body: { choice: 'server' },
      },
    ];

    for (const request of requests) {
      await expect(api.request(request)).resolves.toEqual({
        status: 200,
        body: { ok: true },
      });
    }
    expect(send).toHaveBeenCalledTimes(requests.length);
  });

  it('rejects origin, traversal, control characters, and unknown routes before networking', async () => {
    const { api, credentials, send } = createHarness();
    const paths = [
      'https://192.168.50.14:8443/v1/bootstrap',
      '//192.168.50.14:8443/v1/bootstrap',
      '/v1/../bootstrap',
      '/v1/%2e%2e/bootstrap',
      '/v1/bootstrap\nX-Test: yes',
      '/v1/not-a-route',
      `/v1/images/${'a'.repeat(63)}`,
      '/v1/images',
    ];

    for (const path of paths) {
      await expect(api.request({ method: 'GET', path })).rejects.toThrow(
        'Permintaan CH Core tidak valid.',
      );
    }
    expect(credentials.getCurrentToken).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('accepts only the canonical changes query and approved method combinations', async () => {
    const { api, credentials, send } = createHarness();
    const requests = [
      { method: 'GET' as const, path: '/v1/changes?limit=500&after=0' },
      { method: 'GET' as const, path: '/v1/changes?after=00&limit=500' },
      { method: 'GET' as const, path: '/v1/changes?after=0&limit=100' },
      { method: 'GET' as const, path: '/v1/bootstrap?after=0' },
      { method: 'POST' as const, path: '/v1/bootstrap' },
      { method: 'GET' as const, path: '/v1/skus' },
      { method: 'POST' as const, path: '/v1/pairings/redeem' },
      {
        method: 'POST' as const,
        path: '/v1/imports/initial-catalogue',
      },
      {
        method: 'GET' as const,
        path: '/v1/bootstrap',
        headers: { authorization: 'Bearer renderer-token' },
      },
      {
        method: 'GET' as const,
        path: '/v1/bootstrap',
        origin: 'https://198.51.100.9:8443',
      },
      {
        method: 'POST' as const,
        path: '/v1/notas/11111111-1111-4111-8111-111111111111/transfer',
      },
    ];

    for (const request of requests) {
      await expect(api.request(request as never)).rejects.toThrow(
        'Permintaan CH Core tidak valid.',
      );
    }
    expect(credentials.getCurrentToken).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
