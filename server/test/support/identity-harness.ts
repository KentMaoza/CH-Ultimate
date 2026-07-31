import { randomUUID } from 'node:crypto';

import {
  IdentityService,
  type DeviceRecord,
  type IdentityAuditEvent,
  type IdentityChangeEvent,
  type IdentitySession,
  type IdentityStore,
  type PairingRecord,
  type RecoveryRecord,
} from '../../src/auth/identity.js';
import { SlidingWindowRateLimiter } from '../../src/auth/rate-limit.js';

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

export class MemoryIdentityStore implements IdentityStore {
  devices = new Map<string, DeviceRecord>();
  pairings = new Map<string, PairingRecord>();
  recovery: RecoveryRecord | null = null;
  audits: IdentityAuditEvent[] = [];
  changes: IdentityChangeEvent[] = [];
  failAudit = false;

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
    const auditsBefore = structuredClone(this.audits);
    const changesBefore = structuredClone(this.changes);

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
          [...this.pairings.values()].some(
            (existing) =>
              existing.codeHash.equals(pairing.codeHash) ||
              (pairing.requestId !== null &&
                existing.requestId === pairing.requestId),
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
      writeAudit: async (event) => {
        if (this.failAudit) {
          throw new Error('deliberate audit failure');
        }
        this.audits.push(structuredClone(event));
      },
      writeChange: async (event) => {
        this.changes.push(structuredClone(event));
      },
    };

    try {
      return await work(session);
    } catch (error) {
      this.devices = devicesBefore;
      this.pairings = pairingsBefore;
      this.recovery = recoveryBefore;
      this.audits = auditsBefore;
      this.changes = changesBefore;
      throw error;
    }
  }
}

export function createIdentityHarness(options: {
  bootstrapSecret?: string;
  start?: string;
} = {}) {
  const store = new MemoryIdentityStore();
  let now = new Date(options.start ?? '2026-07-29T00:00:00.000Z');
  let pairingCode = 12_345_678;
  const service = new IdentityService({
    store,
    ...(options.bootstrapSecret === undefined
      ? {}
      : { bootstrapSecret: options.bootstrapSecret }),
    now: () => now,
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

export const ownerInstallationId =
  '11111111-1111-4111-8111-111111111111';
export const clientInstallationId =
  '22222222-2222-4222-8222-222222222222';

export function opaqueSecret(byte: number): string {
  return Buffer.alloc(32, byte).toString('base64url');
}

export async function bootstrapTestOwner(
  service: IdentityService,
  secret = 's'.repeat(32),
) {
  const deviceToken = opaqueSecret(90);
  const recoveryCredential = opaqueSecret(91);
  const result = await service.bootstrapOwner({
    mode: 'bootstrap',
    bootstrapSecret: secret,
    installationId: ownerInstallationId,
    displayName: 'Owner Mac',
    platform: 'macos',
    deviceToken,
    recoveryCredential,
  });
  return { ...result, deviceToken, recoveryCredential };
}
