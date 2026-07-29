import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  IdentityError,
  IdentityService,
  type DeviceRecord,
  type IdentitySession,
  type IdentityStore,
  type PairingRecord,
  type RecoveryRecord,
} from '../src/auth/identity.js';
import { SlidingWindowRateLimiter } from '../src/auth/rate-limit.js';

function cloneDevice(device: DeviceRecord): DeviceRecord {
  return {
    ...device,
    tokenHash: Buffer.from(device.tokenHash),
    previousTokenHash: device.previousTokenHash
      ? Buffer.from(device.previousTokenHash)
      : null,
  };
}

function clonePairing(pairing: PairingRecord): PairingRecord {
  return {
    ...pairing,
    codeHash: Buffer.from(pairing.codeHash),
    claimHash: pairing.claimHash ? Buffer.from(pairing.claimHash) : null,
  };
}

class MemoryIdentityStore implements IdentityStore {
  devices = new Map<string, DeviceRecord>();
  pairings = new Map<string, PairingRecord>();
  recovery: RecoveryRecord | null = null;

  async transaction<T>(
    work: (session: IdentitySession) => Promise<T>,
  ): Promise<T> {
    const devicesBefore = new Map(
      [...this.devices].map(([id, device]) => [id, cloneDevice(device)]),
    );
    const pairingsBefore = new Map(
      [...this.pairings].map(([id, pairing]) => [id, clonePairing(pairing)]),
    );
    const recoveryBefore = this.recovery
      ? {
          ...this.recovery,
          credentialHash: Buffer.from(this.recovery.credentialHash),
        }
      : null;

    const session: IdentitySession = {
      findOwner: async () =>
        [...this.devices.values()].find(
          (device) => device.role === 'owner',
        ) ?? null,
      findRecovery: async () => this.recovery,
      saveRecovery: async (recovery) => {
        this.recovery = {
          ...recovery,
          credentialHash: Buffer.from(recovery.credentialHash),
        };
      },
      findDeviceById: async (id) => this.devices.get(id) ?? null,
      findDeviceByInstallationId: async (installationId) =>
        [...this.devices.values()].find(
          (device) => device.installationId === installationId,
        ) ?? null,
      findDeviceByTokenHash: async (tokenHash) => {
        for (const device of this.devices.values()) {
          if (device.tokenHash.equals(tokenHash)) {
            return { device, tokenKind: 'current' as const };
          }
          if (device.previousTokenHash?.equals(tokenHash)) {
            return { device, tokenKind: 'previous' as const };
          }
        }
        return null;
      },
      listDevices: async () => [...this.devices.values()],
      insertDevice: async (device) => {
        if (
          this.devices.has(device.id) ||
          [...this.devices.values()].some(
            (existing) =>
              existing.installationId === device.installationId ||
              existing.tokenHash.equals(device.tokenHash),
          )
        ) {
          return false;
        }
        this.devices.set(device.id, cloneDevice(device));
        return true;
      },
      saveDevice: async (device) => {
        this.devices.set(device.id, cloneDevice(device));
      },
      revokeOtherOwners: async (exceptDeviceId, revokedAt) => {
        for (const device of this.devices.values()) {
          if (device.role === 'owner' && device.id !== exceptDeviceId) {
            this.devices.set(device.id, { ...device, revokedAt });
          }
        }
      },
      findPairingById: async (id) => this.pairings.get(id) ?? null,
      findPairingByCodeHash: async (codeHash) =>
        [...this.pairings.values()].find((pairing) =>
          pairing.codeHash.equals(codeHash),
        ) ?? null,
      insertPairing: async (pairing) => {
        if (
          this.pairings.has(pairing.id) ||
          [...this.pairings.values()].some((existing) =>
            existing.codeHash.equals(pairing.codeHash),
          )
        ) {
          return false;
        }
        this.pairings.set(pairing.id, clonePairing(pairing));
        return true;
      },
      savePairing: async (pairing) => {
        this.pairings.set(pairing.id, clonePairing(pairing));
      },
    };

    try {
      return await work(session);
    } catch (error) {
      this.devices = devicesBefore;
      this.pairings = pairingsBefore;
      this.recovery = recoveryBefore;
      throw error;
    }
  }
}

function createHarness(options: {
  bootstrapSecret?: string;
  start?: string;
} = {}) {
  const store = new MemoryIdentityStore();
  let now = new Date(options.start ?? '2026-07-29T00:00:00.000Z');
  let randomByte = 1;
  let pairingCode = 12_345_678;
  const service = new IdentityService({
    store,
    ...(options.bootstrapSecret === undefined
      ? {}
      : { bootstrapSecret: options.bootstrapSecret }),
    now: () => now,
    randomBytes: (size) => Buffer.alloc(size, randomByte++),
    randomInt: () => pairingCode++,
    randomUuid: randomUUID,
    redeemLimiter: new SlidingWindowRateLimiter({
      limit: 5,
      windowMs: 10 * 60 * 1_000,
      now: () => now.getTime(),
    }),
  });

  return {
    service,
    store,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

const ownerInstallationId = '11111111-1111-4111-8111-111111111111';
const clientInstallationId = '22222222-2222-4222-8222-222222222222';

async function bootstrapOwner(
  service: IdentityService,
  secret = 's'.repeat(32),
) {
  return service.bootstrapOwner({
    mode: 'bootstrap',
    bootstrapSecret: secret,
    installationId: ownerInstallationId,
    displayName: 'Owner Mac',
    platform: 'macos',
  });
}

describe('owner bootstrap and recovery', () => {
  it('fails closed when no minimum-length bootstrap secret is configured', async () => {
    const { service } = createHarness();

    await expect(bootstrapOwner(service)).rejects.toMatchObject({
      code: 'BOOTSTRAP_DISABLED',
      statusCode: 403,
    });
  });

  it('returns opaque credentials once and stores only SHA-256 hashes', async () => {
    const { service, store } = createHarness({
      bootstrapSecret: 's'.repeat(32),
    });

    const result = await bootstrapOwner(service);
    const [device] = [...store.devices.values()];

    expect(Buffer.from(result.deviceToken, 'base64url')).toHaveLength(32);
    expect(Buffer.from(result.recoveryCredential, 'base64url')).toHaveLength(32);
    expect(result.device.tokenExpiresAt).toBe('2027-01-25T00:00:00.000Z');
    expect(device?.tokenHash).toHaveLength(32);
    expect(device?.tokenHash.toString('base64url')).not.toBe(result.deviceToken);
    expect(store.recovery?.credentialHash).toHaveLength(32);
    expect(store.recovery?.credentialHash.toString('base64url')).not.toBe(
      result.recoveryCredential,
    );
    await expect(bootstrapOwner(service)).rejects.toMatchObject({
      code: 'OWNER_EXISTS',
      statusCode: 409,
    });
  });

  it('replaces the owner installation and atomically rotates recovery', async () => {
    const { service, store } = createHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const initial = await bootstrapOwner(service);
    const replacementInstallationId =
      '33333333-3333-4333-8333-333333333333';

    const recovered = await service.bootstrapOwner({
      mode: 'recovery',
      recoveryCredential: initial.recoveryCredential,
      installationId: replacementInstallationId,
      displayName: 'Replacement Mac',
      platform: 'macos',
    });

    expect(recovered.recoveryCredential).not.toBe(initial.recoveryCredential);
    expect(
      [...store.devices.values()].find(
        (device) => device.installationId === ownerInstallationId,
      )?.revokedAt,
    ).not.toBeNull();
    expect(
      [...store.devices.values()].find(
        (device) => device.installationId === replacementInstallationId,
      )?.role,
    ).toBe('owner');
    await expect(
      service.bootstrapOwner({
        mode: 'recovery',
        recoveryCredential: initial.recoveryCredential,
        installationId: ownerInstallationId,
        displayName: 'Attacker',
        platform: 'unknown',
      }),
    ).rejects.toMatchObject({ code: 'RECOVERY_REJECTED' });
  });
});

describe('pairing', () => {
  it('uses an eight-digit one-use code and gives no detail for expired or reused codes', async () => {
    const { service, store, setNow } = createHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapOwner(service);
    const expired = await service.createPairing(owner.device.id);
    expect(expired.code).toMatch(/^\d{8}$/);

    setNow('2026-07-29T00:10:00.001Z');
    await expect(
      service.claimPairing('198.51.100.1', {
        code: expired.code,
        installationId: clientInstallationId,
        displayName: 'Client Phone',
        platform: 'android',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'PAIRING_REJECTED',
        message: 'Pairing request rejected',
      }),
    );

    const active = await service.createPairing(owner.device.id);
    const claim = await service.claimPairing('198.51.100.2', {
      code: active.code,
      installationId: clientInstallationId,
      displayName: 'Client Phone',
      platform: 'android',
    });
    expect(claim.status).toBe('pending');
    expect(Buffer.from(claim.claimSecret, 'base64url')).toHaveLength(32);
    const storedClaim = store.pairings.get(claim.pairingId);
    expect(storedClaim?.claimHash).toHaveLength(32);
    expect(storedClaim?.claimHash?.toString('base64url')).not.toBe(
      claim.claimSecret,
    );

    await expect(
      service.claimPairing('198.51.100.3', {
        code: active.code,
        installationId: clientInstallationId,
        displayName: 'Client Phone',
        platform: 'android',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'PAIRING_REJECTED',
        message: 'Pairing request rejected',
      }),
    );
  });

  it('requires explicit owner approval before issuing a one-time client token', async () => {
    const { service, store } = createHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapOwner(service);
    const pairing = await service.createPairing(owner.device.id);
    const claim = await service.claimPairing('198.51.100.4', {
      code: pairing.code,
      installationId: clientInstallationId,
      displayName: 'Client Phone',
      platform: 'android',
    });

    await expect(
      service.completePairing({
        pairingId: claim.pairingId,
        claimSecret: claim.claimSecret,
      }),
    ).rejects.toMatchObject({ code: 'PAIRING_REJECTED' });

    await expect(
      service.approvePairing(owner.device.id, claim.pairingId),
    ).resolves.toEqual({ status: 'approved' });
    const completed = await service.completePairing({
      pairingId: claim.pairingId,
      claimSecret: claim.claimSecret,
    });

    expect(completed.device.role).toBe('client');
    expect(Buffer.from(completed.deviceToken, 'base64url')).toHaveLength(32);
    expect(
      [...store.devices.values()].find(
        (device) => device.id === completed.device.id,
      )?.tokenHash.toString('base64url'),
    ).not.toBe(completed.deviceToken);
    await expect(
      service.completePairing({
        pairingId: claim.pairingId,
        claimSecret: claim.claimSecret,
      }),
    ).rejects.toMatchObject({ code: 'PAIRING_REJECTED' });
  });

  it('limits initial redemption to five attempts per source in ten minutes', async () => {
    const { service } = createHarness({
      bootstrapSecret: 's'.repeat(32),
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.claimPairing('198.51.100.5', {
          code: '99999999',
          installationId: clientInstallationId,
          displayName: 'Client Phone',
          platform: 'android',
        }),
      ).rejects.toMatchObject({ code: 'PAIRING_REJECTED' });
    }
    await expect(
      service.claimPairing('198.51.100.5', {
        code: '99999999',
        installationId: clientInstallationId,
        displayName: 'Client Phone',
        platform: 'android',
      }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      statusCode: 429,
    });
  });
});

describe('device authentication', () => {
  it('accepts the current token and the previous token for exactly seven days', async () => {
    const { service, setNow } = createHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapOwner(service);

    const rotated = await service.rotateDeviceToken(
      owner.device.id,
      owner.deviceToken,
    );
    await expect(service.authenticate(rotated.deviceToken)).resolves.toMatchObject({
      id: owner.device.id,
      tokenKind: 'current',
    });
    await expect(service.authenticate(owner.deviceToken)).resolves.toMatchObject({
      id: owner.device.id,
      tokenKind: 'previous',
    });

    setNow('2026-08-05T00:00:00.001Z');
    await expect(service.authenticate(owner.deviceToken)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
    await expect(service.authenticate(rotated.deviceToken)).resolves.toMatchObject({
      id: owner.device.id,
    });
  });

  it('revokes current and previous tokens immediately', async () => {
    const { service } = createHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapOwner(service);
    const rotated = await service.rotateDeviceToken(
      owner.device.id,
      owner.deviceToken,
    );

    await service.revokeDevice(owner.device.id, owner.device.id);

    for (const token of [owner.deviceToken, rotated.deviceToken]) {
      await expect(service.authenticate(token)).rejects.toBeInstanceOf(
        IdentityError,
      );
      await expect(service.authenticate(token)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }
  });
});
