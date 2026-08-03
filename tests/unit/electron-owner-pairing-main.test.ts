import { describe, expect, it, vi } from 'vitest';

import type { CoreApiRequest } from '../../src/gateway/core-api-transport';
import type { CoreCredentialStore } from '../../src/electron/core-credential-store';
import { createCoreOwnerPairingMain } from '../../src/electron/core-owner-pairing-main';

const pairingId = '33333333-3333-4333-8333-333333333333';
const token = Buffer.alloc(32, 9).toString('base64url');
const expiresAt = '2026-08-03T04:10:00.000Z';

function store(): CoreCredentialStore {
  return {
    load: vi.fn(),
    save: vi.fn(),
    getCurrentToken: vi.fn().mockResolvedValue(token),
  };
}

describe('Electron owner pairing main boundary', () => {
  it('uses only fixed authenticated requests and returns public fields', async () => {
    const requests: Array<{
      request: CoreApiRequest;
      authorization?: string;
    }> = [];
    const responses = [
      {
        status: 201,
        body: { pairingId, code: '12345678', expiresAt },
      },
      {
        status: 200,
        body: {
          pairingId,
          state: 'pending',
          expiresAt,
          requestedDevice: { displayName: 'HP Gudang', platform: 'android' },
        },
      },
      { status: 200, body: { status: 'approved' } },
    ];
    const send = vi.fn(
      async (request: CoreApiRequest, authorization?: string) => {
        requests.push({ request: structuredClone(request), authorization });
        return responses.shift()!;
      },
    );
    const owner = createCoreOwnerPairingMain({ store: store(), send });

    const created = await owner.createOwnerPairing();
    const inspected = await owner.getOwnerPairing(pairingId);
    const approved = await owner.approveOwnerPairing(pairingId);

    expect(requests).toEqual([
      {
        request: { method: 'POST', path: '/v1/pairings' },
        authorization: `Bearer ${token}`,
      },
      {
        request: { method: 'GET', path: `/v1/pairings/${pairingId}` },
        authorization: `Bearer ${token}`,
      },
      {
        request: {
          method: 'POST',
          path: `/v1/pairings/${pairingId}/approve`,
        },
        authorization: `Bearer ${token}`,
      },
    ]);
    expect(created).toEqual({ pairingId, code: '12345678', expiresAt });
    expect(inspected).toEqual({
      pairingId,
      state: 'pending',
      expiresAt,
      requestedDevice: { displayName: 'HP Gudang', platform: 'android' },
    });
    expect(approved).toEqual({ status: 'approved' });
    expect(JSON.stringify([created, inspected, approved])).not.toContain(token);
  });

  it.each(['available', 'pending', 'approved', 'consumed', 'expired'] as const)(
    'accepts the public %s pairing state',
    async (state) => {
      const owner = createCoreOwnerPairingMain({
        store: store(),
        send: vi.fn().mockResolvedValue({
          status: 200,
          body: { pairingId, state, expiresAt },
        }),
      });

      await expect(owner.getOwnerPairing(pairingId)).resolves.toEqual({
        pairingId,
        state,
        expiresAt,
      });
    },
  );

  it.each([
    { pairingId, code: '1234567', expiresAt },
    { pairingId: 'not-a-uuid', code: '12345678', expiresAt },
    { pairingId, code: '12345678', expiresAt: 'not-a-date' },
    { pairingId, code: '12345678', expiresAt, claimSecret: 'private' },
  ])('rejects a malformed or private create response %#', async (body) => {
    const owner = createCoreOwnerPairingMain({
      store: store(),
      send: vi.fn().mockResolvedValue({ status: 201, body }),
    });

    await expect(owner.createOwnerPairing()).rejects.toThrow(
      'Respons pemasangan CH Core tidak valid.',
    );
  });

  it('rejects private inspection fields and invalid IDs before sending', async () => {
    const credentials = store();
    const send = vi.fn().mockResolvedValue({
      status: 200,
      body: {
        pairingId,
        state: 'pending',
        expiresAt,
        requestedDevice: { displayName: 'HP Gudang', platform: 'android' },
        installationId: '44444444-4444-4444-8444-444444444444',
      },
    });
    const owner = createCoreOwnerPairingMain({ store: credentials, send });

    await expect(owner.getOwnerPairing(pairingId)).rejects.toThrow(
      'Respons pemasangan CH Core tidak valid.',
    );
    await expect(owner.getOwnerPairing('not-a-uuid')).rejects.toThrow(
      'Permintaan pemasangan CH Core tidak valid.',
    );
    await expect(owner.approveOwnerPairing('not-a-uuid')).rejects.toThrow(
      'Permintaan pemasangan CH Core tidak valid.',
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(credentials.getCurrentToken).toHaveBeenCalledTimes(1);
  });

  it('rejects unexpected status codes and approval response fields', async () => {
    const responses = [
      { status: 200, body: { pairingId, code: '12345678', expiresAt } },
      { status: 200, body: { status: 'approved', deviceToken: 'private' } },
    ];
    const owner = createCoreOwnerPairingMain({
      store: store(),
      send: vi.fn(async () => responses.shift()!),
    });

    await expect(owner.createOwnerPairing()).rejects.toThrow(
      'Respons pemasangan CH Core tidak valid.',
    );
    await expect(owner.approveOwnerPairing(pairingId)).rejects.toThrow(
      'Respons pemasangan CH Core tidak valid.',
    );
  });

  it('maps a forbidden owner operation to fixed public copy', async () => {
    const owner = createCoreOwnerPairingMain({
      store: store(),
      send: vi.fn().mockResolvedValue({
        status: 403,
        body: { code: 'FORBIDDEN', privateDetail: 'must not escape' },
      }),
    });

    await expect(owner.createOwnerPairing()).rejects.toThrow(
      'Hanya perangkat pemilik yang dapat mengatur pemasangan.',
    );
  });
});
