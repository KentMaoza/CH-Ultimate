import { vi, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { IdentityError } from '../src/auth/identity.js';
import { SyncError } from '../src/sync/service.js';

const owner = {
  id: '11111111-1111-4111-8111-111111111111',
  installationId: '22222222-2222-4222-8222-222222222222',
  role: 'owner' as const,
  displayName: 'Owner Mac',
  platform: 'macos',
  tokenExpiresAt: '2027-01-25T00:00:00.000Z',
  approvedAt: '2026-07-29T00:00:00.000Z',
  revokedAt: null,
  tokenKind: 'current' as const,
};

function opaqueSecret(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

function createProtocol() {
  return {
    identity: {
      bootstrapOwner: vi.fn(async () => ({
        device: owner,
      })),
      authenticate: vi.fn(async (token: string) => {
        if (token === 'owner-token') {
          return owner;
        }
        if (token === 'client-token') {
          return { ...owner, id: 'client-id', role: 'client' as const };
        }
        throw new IdentityError('UNAUTHORIZED', 401, 'Unauthorized');
      }),
      createPairing: vi.fn(async () => ({
        pairingId: '33333333-3333-4333-8333-333333333333',
        code: '12345678',
        expiresAt: '2026-07-29T00:10:00.000Z',
      })),
      inspectPairing: vi.fn(async () => ({
        pairingId: '33333333-3333-4333-8333-333333333333',
        state: 'pending' as const,
        expiresAt: '2026-07-29T00:10:00.000Z',
        requestedDevice: {
          displayName: 'HP Gudang',
          platform: 'android',
        },
      })),
      claimPairing: vi.fn(async () => ({
        pairingId: '33333333-3333-4333-8333-333333333333',
        status: 'pending' as const,
      })),
      approvePairing: vi.fn(async () => ({ status: 'approved' as const })),
      completePairing: vi.fn(async () => ({
        device: { ...owner, role: 'client' as const },
      })),
      listDevices: vi.fn(async () => [owner]),
      revokeDevice: vi.fn(async () => ({ status: 'revoked' as const })),
      rotateDeviceToken: vi.fn(async () => ({
        device: owner,
      })),
    },
    sync: {
      bootstrap: vi.fn(async () => ({
        serverRevision: '7',
        skuIdentifiers: [],
        skus: [],
        balances: [],
        notas: [],
        notaPages: [],
        notaLines: [],
        templates: [],
      })),
      changes: vi.fn(async () => ({
        serverRevision: '7',
        nextAfter: '7',
        changes: [],
      })),
    },
  };
}

function appWithProtocol(protocol = createProtocol()) {
  return {
    app: buildApp({
      pool: {
        async query<T>() {
          return [{ version: 7 }] as T;
        },
      },
      protocol,
    }),
    protocol,
  };
}

describe('CH Core protocol routes', () => {
  it('keeps owner routes unavailable to authenticated clients', async () => {
    const { app, protocol } = appWithProtocol();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/pairings',
      headers: { authorization: 'Bearer client-token' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: 'FORBIDDEN' });
    expect(protocol.identity.createPairing).not.toHaveBeenCalled();
    await app.close();
  });

  it('carries the authenticated device role in each bootstrap envelope', async () => {
    const { app } = appWithProtocol();

    const ownerResponse = await app.inject({
      method: 'GET',
      url: '/v1/bootstrap',
      headers: { authorization: 'Bearer owner-token' },
    });
    const clientResponse = await app.inject({
      method: 'GET',
      url: '/v1/bootstrap',
      headers: { authorization: 'Bearer client-token' },
    });

    expect(ownerResponse.json()).toMatchObject({ deviceRole: 'owner' });
    expect(clientResponse.json()).toMatchObject({ deviceRole: 'client' });
    await app.close();
  });

  it('creates an owner-only pairing code and redeems both claim phases', async () => {
    const { app, protocol } = appWithProtocol();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/pairings',
      headers: { authorization: 'Bearer owner-token' },
    });
    const claimed = await app.inject({
      method: 'POST',
      url: '/v1/pairings/redeem',
      payload: {
        phase: 'claim',
        code: '12345678',
        requestId: '55555555-5555-4555-8555-555555555555',
        claimSecret: opaqueSecret(1),
        installationId: '44444444-4444-4444-8444-444444444444',
        displayName: 'Client Phone',
        platform: 'android',
      },
    });
    const completed = await app.inject({
      method: 'POST',
      url: '/v1/pairings/redeem',
      payload: {
        phase: 'complete',
        pairingId: '33333333-3333-4333-8333-333333333333',
        claimSecret: opaqueSecret(1),
        deviceToken: opaqueSecret(2),
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json().code).toBe('12345678');
    expect(claimed.statusCode).toBe(202);
    expect(completed.statusCode).toBe(200);
    expect(protocol.identity.claimPairing).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: '12345678' }),
    );
    expect(protocol.identity.completePairing).toHaveBeenCalledWith({
      pairingId: '33333333-3333-4333-8333-333333333333',
      claimSecret: opaqueSecret(1),
      deviceToken: opaqueSecret(2),
    });
    await app.close();
  });

  it('lets only the owner inspect a validated public pairing status', async () => {
    const { app, protocol } = appWithProtocol();
    const pairingId = '33333333-3333-4333-8333-333333333333';

    const response = await app.inject({
      method: 'GET',
      url: `/v1/pairings/${pairingId}`,
      headers: { authorization: 'Bearer owner-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      pairingId,
      state: 'pending',
      expiresAt: '2026-07-29T00:10:00.000Z',
      requestedDevice: { displayName: 'HP Gudang', platform: 'android' },
    });
    expect(protocol.identity.inspectPairing).toHaveBeenCalledWith(
      owner.id,
      pairingId,
    );

    for (const request of [
      { url: `/v1/pairings/${pairingId}` },
      {
        url: `/v1/pairings/${pairingId}`,
        headers: { authorization: 'Bearer client-token' },
      },
      {
        url: '/v1/pairings/not-a-uuid',
        headers: { authorization: 'Bearer owner-token' },
      },
    ]) {
      const rejected = await app.inject({ method: 'GET', ...request });
      expect(rejected.statusCode).toBe(
        request.url.endsWith('not-a-uuid') ? 400 : request.headers ? 403 : 401,
      );
    }
    expect(protocol.identity.inspectPairing).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('requires device authentication for bootstrap and changes', async () => {
    const { app } = appWithProtocol();

    for (const url of ['/v1/bootstrap', '/v1/changes?after=0&limit=100']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ code: 'UNAUTHORIZED' });
    }
    await app.close();
  });

  it.each(['expired-token', 'revoked-token'])(
    'maps an %s bearer credential to 401',
    async (token) => {
      const { app } = appWithProtocol();

      const response = await app.inject({
        method: 'GET',
        url: '/v1/bootstrap',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ code: 'UNAUTHORIZED' });
      await app.close();
    },
  );

  it('rotates only the authenticated installation token', async () => {
    const { app, protocol } = appWithProtocol();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/token/rotate',
      headers: { authorization: 'Bearer owner-token' },
      payload: { nextDeviceToken: opaqueSecret(3) },
    });

    expect(response.statusCode).toBe(200);
    expect(protocol.identity.rotateDeviceToken).toHaveBeenCalledWith(
      owner.id,
      'owner-token',
      opaqueSecret(3),
    );
    await app.close();
  });

  it('maps stale cursor errors to the required generic 410 body', async () => {
    const protocol = createProtocol();
    protocol.sync.changes.mockRejectedValueOnce(
      new SyncError(
        'CURSOR_EXPIRED',
        410,
        'sensitive database detail',
        true,
      ),
    );
    const { app } = appWithProtocol(protocol);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/changes?after=1&limit=100',
      headers: { authorization: 'Bearer owner-token' },
    });

    expect(response.statusCode).toBe(410);
    expect(response.json()).toEqual({ code: 'CURSOR_EXPIRED' });
    expect(response.body).not.toContain('sensitive');
    await app.close();
  });

  it('preserves the bootstrap instruction for a cursor ahead error', async () => {
    const protocol = createProtocol();
    protocol.sync.changes.mockRejectedValueOnce(
      new SyncError(
        'CURSOR_AHEAD',
        409,
        'sensitive database detail',
        true,
      ),
    );
    const { app } = appWithProtocol(protocol);

    const response = await app.inject({
      method: 'GET',
      url: '/v1/changes?after=9&limit=100',
      headers: { authorization: 'Bearer owner-token' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 'CURSOR_AHEAD',
      bootstrapRequired: true,
    });
    expect(response.body).not.toContain('sensitive');
    await app.close();
  });

  it('exposes initial owner bootstrap without logging or echoing its secret', async () => {
    const { app, protocol } = appWithProtocol();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/bootstrap',
      payload: {
        mode: 'bootstrap',
        bootstrapSecret: 'b'.repeat(32),
        deviceToken: opaqueSecret(4),
        recoveryCredential: opaqueSecret(5),
        installationId: '22222222-2222-4222-8222-222222222222',
        displayName: 'Owner Mac',
        platform: 'macos',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body).not.toContain('b'.repeat(32));
    expect(protocol.identity.bootstrapOwner).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'bootstrap' }),
    );
    await app.close();
  });

  it.each([
    {
      name: 'claim without an explicit phase',
      request: {
        method: 'POST' as const,
        url: '/v1/pairings/redeem',
        payload: {
          code: '12345678',
          requestId: '55555555-5555-4555-8555-555555555555',
          claimSecret: opaqueSecret(1),
          installationId: '44444444-4444-4444-8444-444444444444',
          displayName: 'Client Phone',
          platform: 'android',
        },
      },
      call: 'claimPairing' as const,
    },
    {
      name: 'mixed pairing phases',
      request: {
        method: 'POST' as const,
        url: '/v1/pairings/redeem',
        payload: {
          phase: 'complete',
          pairingId: '33333333-3333-4333-8333-333333333333',
          claimSecret: opaqueSecret(1),
          deviceToken: opaqueSecret(2),
          code: '12345678',
        },
      },
      call: 'completePairing' as const,
    },
    {
      name: 'non-decimal change limit',
      request: {
        method: 'GET' as const,
        url: '/v1/changes?after=0&limit=1e2',
        headers: { authorization: 'Bearer owner-token' },
      },
      call: null,
    },
    {
      name: 'invalid approval path UUID',
      request: {
        method: 'POST' as const,
        url: '/v1/pairings/not-a-uuid/approve',
        headers: { authorization: 'Bearer owner-token' },
      },
      call: 'approvePairing' as const,
    },
  ])('rejects $name with a generic code-only body', async ({ request, call }) => {
    const { app, protocol } = appWithProtocol();

    const response = await app.inject(request);

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: 'INVALID_REQUEST' });
    if (call) {
      expect(protocol.identity[call]).not.toHaveBeenCalled();
    } else {
      expect(protocol.sync.changes).not.toHaveBeenCalled();
    }
    await app.close();
  });

  it('does not trust a forwarded address for pairing rate-limit identity', async () => {
    const { app, protocol } = appWithProtocol();

    const response = await app.inject({
      method: 'POST',
      url: '/v1/pairings/redeem',
      headers: { 'x-forwarded-for': '203.0.113.90' },
      payload: {
        phase: 'claim',
        code: '12345678',
        requestId: '55555555-5555-4555-8555-555555555555',
        claimSecret: opaqueSecret(1),
        installationId: '44444444-4444-4444-8444-444444444444',
        displayName: 'Client Phone',
        platform: 'android',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(protocol.identity.claimPairing).toHaveBeenCalledWith(
      '127.0.0.1',
      expect.any(Object),
    );
    await app.close();
  });
});
