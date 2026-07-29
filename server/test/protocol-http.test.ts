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

function createProtocol() {
  return {
    identity: {
      bootstrapOwner: vi.fn(async () => ({
        device: owner,
        deviceToken: 'device-token',
        recoveryCredential: 'recovery-credential',
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
      claimPairing: vi.fn(async () => ({
        pairingId: '33333333-3333-4333-8333-333333333333',
        claimSecret: 'claim-secret',
        status: 'pending' as const,
      })),
      approvePairing: vi.fn(async () => ({ status: 'approved' as const })),
      completePairing: vi.fn(async () => ({
        device: { ...owner, role: 'client' as const },
        deviceToken: 'client-device-token',
      })),
      listDevices: vi.fn(async () => [owner]),
      revokeDevice: vi.fn(async () => ({ status: 'revoked' as const })),
      rotateDeviceToken: vi.fn(async () => ({
        device: owner,
        deviceToken: 'rotated-token',
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
          return [{ version: 3 }] as T;
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
        code: '12345678',
        installationId: '44444444-4444-4444-8444-444444444444',
        displayName: 'Client Phone',
        platform: 'android',
      },
    });
    const completed = await app.inject({
      method: 'POST',
      url: '/v1/pairings/redeem',
      payload: {
        pairingId: '33333333-3333-4333-8333-333333333333',
        claimSecret: 'claim-secret',
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
      claimSecret: 'claim-secret',
    });
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
    });

    expect(response.statusCode).toBe(200);
    expect(protocol.identity.rotateDeviceToken).toHaveBeenCalledWith(
      owner.id,
      'owner-token',
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

  it('exposes initial owner bootstrap without logging or echoing its secret', async () => {
    const { app, protocol } = appWithProtocol();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/owner/bootstrap',
      payload: {
        bootstrapSecret: 'b'.repeat(32),
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
});
