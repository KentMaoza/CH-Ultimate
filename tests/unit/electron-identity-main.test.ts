import { describe, expect, it, vi } from 'vitest';

import type { CoreApiRequest } from '../../src/gateway/core-api-transport';
import type {
  CoreCredentialState,
  CoreCredentialStore,
} from '../../src/electron/core-credential-store';
import { createCoreIdentityMain } from '../../src/electron/core-identity-main';

const installationId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const pairingId = '33333333-3333-4333-8333-333333333333';
const deviceId = '44444444-4444-4444-8444-444444444444';
const firstSecret = Buffer.alloc(32, 1).toString('base64url');
const secondSecret = Buffer.alloc(32, 2).toString('base64url');

class MemoryCredentialStore implements CoreCredentialStore {
  state: CoreCredentialState | undefined;
  saves: CoreCredentialState[] = [];

  constructor(initial?: CoreCredentialState) {
    this.state = initial === undefined ? undefined : structuredClone(initial);
  }

  async load() {
    return this.state === undefined ? undefined : structuredClone(this.state);
  }

  async save(state: CoreCredentialState) {
    this.state = structuredClone(state);
    this.saves.push(structuredClone(state));
  }

  async getCurrentToken() {
    if (!this.state?.current) throw new Error('missing');
    return this.state.current.token;
  }
}

function publicDevice(id = deviceId) {
  return {
    device: {
      id,
      installationId,
      role: 'client',
      displayName: 'Mac Gudang',
      platform: 'macos',
      tokenExpiresAt: '2027-01-01T00:00:00.000Z',
      approvedAt: '2026-07-29T00:00:00.000Z',
      revokedAt: null,
    },
  };
}

describe('caller-held Electron pairing credentials', () => {
  it('rejects a non-UUID pairing ID before persisting it', async () => {
    const store = new MemoryCredentialStore();
    const identity = createCoreIdentityMain({
      store,
      send: vi.fn().mockResolvedValue({
        status: 202,
        body: { pairingId: '', status: 'pending' },
      }),
      randomUuid: vi
        .fn()
        .mockReturnValueOnce(installationId)
        .mockReturnValueOnce(requestId),
      randomSecret: () => firstSecret,
      platform: 'macos',
    });

    await expect(
      identity.claimPairing({
        code: '12345678',
        displayName: 'Perangkat Gudang',
      }),
    ).rejects.toThrow('Respons pemasangan CH Core tidak valid.');
    expect(store.state?.pendingPairing?.pairingId).toBeUndefined();
  });

  it('rejects a non-UUID device ID before persisting current credentials', async () => {
    const store = new MemoryCredentialStore({
      version: 1,
      installationId,
      pendingPairing: {
        code: '12345678',
        requestId,
        claimSecret: firstSecret,
        pairingId,
        displayName: 'Perangkat Gudang',
      },
    });
    const identity = createCoreIdentityMain({
      store,
      send: vi.fn().mockResolvedValue({
        status: 200,
        body: publicDevice('not-a-device-uuid'),
      }),
      randomSecret: () => secondSecret,
      platform: 'macos',
    });

    await expect(identity.completePairing()).rejects.toThrow(
      'Respons identitas CH Core tidak valid.',
    );
    expect(store.state?.current).toBeUndefined();
  });

  it('saves and reuses claim credentials after a lost response', async () => {
    const store = new MemoryCredentialStore();
    const requests: CoreApiRequest[] = [];
    const send = vi
      .fn(async (request: CoreApiRequest) => {
        requests.push(structuredClone(request));
        expect(store.state?.pendingPairing).toMatchObject({
          requestId,
          claimSecret: firstSecret,
          code: '12345678',
        });
        if (requests.length === 1) throw new Error('response dropped');
        return {
          status: 202,
          body: { pairingId, status: 'pending' },
        };
      });
    const identity = createCoreIdentityMain({
      store,
      send,
      randomUuid: vi
        .fn()
        .mockReturnValueOnce(installationId)
        .mockReturnValueOnce(requestId),
      randomSecret: () => firstSecret,
      platform: 'macos',
    });

    await expect(
      identity.claimPairing({ code: '12345678', displayName: 'Mac Gudang' }),
    ).rejects.toThrow('response dropped');
    const result = await identity.claimPairing({
      code: '12345678',
      displayName: 'Mac Gudang',
    });

    expect(requests[1]).toEqual(requests[0]);
    expect(result).toEqual({ pairingId, status: 'pending' });
    expect(result).not.toHaveProperty('claimSecret');
    expect(result).not.toHaveProperty('requestId');
  });

  it('saves and reuses the device token before pairing completion', async () => {
    const store = new MemoryCredentialStore({
      version: 1,
      installationId,
      pendingPairing: {
        code: '12345678',
        requestId,
        claimSecret: firstSecret,
        pairingId,
        displayName: 'Mac Gudang',
      },
    });
    const requests: CoreApiRequest[] = [];
    const send = vi.fn(async (request: CoreApiRequest) => {
      requests.push(structuredClone(request));
      expect(store.state?.pendingPairing?.deviceToken).toBe(secondSecret);
      if (requests.length === 1) throw new Error('response dropped');
      return { status: 200, body: publicDevice() };
    });
    const identity = createCoreIdentityMain({
      store,
      send,
      randomUuid: () => requestId,
      randomSecret: () => secondSecret,
      platform: 'macos',
    });

    await expect(identity.completePairing()).rejects.toThrow('response dropped');
    const result = await identity.completePairing();

    expect(requests[1]).toEqual(requests[0]);
    expect(result).toEqual({ status: 'paired', deviceId });
    expect(result).not.toHaveProperty('deviceToken');
    expect(store.state).toMatchObject({
      current: { deviceId, token: secondSecret },
    });
    expect(store.state?.pendingPairing).toBeUndefined();
  });
});

describe('caller-held Electron enrollment and rotation credentials', () => {
  it('stores owner credentials before bootstrap and returns only public status', async () => {
    const store = new MemoryCredentialStore();
    const send = vi.fn(async (request: CoreApiRequest) => {
      expect(store.state?.pendingEnrollment).toMatchObject({
        deviceToken: firstSecret,
        recoveryCredential: secondSecret,
      });
      expect(request.body).toMatchObject({
        deviceToken: firstSecret,
        recoveryCredential: secondSecret,
        bootstrapSecret: 'setup-only',
      });
      return { status: 201, body: publicDevice() };
    });
    const secrets = [firstSecret, secondSecret];
    const identity = createCoreIdentityMain({
      store,
      send,
      randomUuid: () => installationId,
      randomSecret: () => secrets.shift()!,
      platform: 'macos',
    });

    const result = await identity.enrollOwner({
      mode: 'bootstrap',
      bootstrapSecret: 'setup-only',
      displayName: 'Mac Gudang',
    });

    expect(result).toEqual({ status: 'paired', deviceId });
    expect(result).not.toHaveProperty('deviceToken');
    expect(result).not.toHaveProperty('recoveryCredential');
    expect(store.state).toMatchObject({
      current: { deviceId, token: firstSecret },
      recoveryCredential: secondSecret,
    });
  });

  it('promotes the next token only after acknowledgement and retains the old token', async () => {
    const store = new MemoryCredentialStore({
      version: 1,
      installationId,
      current: { deviceId, token: firstSecret },
    });
    const requests: CoreApiRequest[] = [];
    const authorizations: Array<string | undefined> = [];
    const send = vi.fn(
      async (request: CoreApiRequest, authorization?: string) => {
        requests.push(structuredClone(request));
        authorizations.push(authorization);
        expect(store.state?.current?.token).toBe(firstSecret);
        expect(store.state?.pendingRotation?.nextToken).toBe(secondSecret);
        if (requests.length === 1) throw new Error('response dropped');
        return { status: 200, body: publicDevice() };
      },
    );
    const identity = createCoreIdentityMain({
      store,
      send,
      randomUuid: () => requestId,
      randomSecret: () => secondSecret,
      platform: 'macos',
    });

    await expect(identity.rotateToken()).rejects.toThrow('response dropped');
    expect(store.state?.current?.token).toBe(firstSecret);
    await expect(identity.rotateToken()).resolves.toEqual({ status: 'rotated' });

    expect(requests[1]).toEqual(requests[0]);
    expect(authorizations).toEqual([
      `Bearer ${firstSecret}`,
      `Bearer ${firstSecret}`,
    ]);
    expect(store.state).toMatchObject({
      current: { deviceId, token: secondSecret },
      previousToken: firstSecret,
    });
    expect(store.state?.pendingRotation).toBeUndefined();
  });
});
