import {
  IdentityError,
  UUID_PATTERN,
  type DeviceRecord,
  type DeviceResult,
  type IdentityRuntime,
  type InstallationInput,
  type PairingRecord,
  publicDevice,
  requireInstallation,
  requireOwner,
} from './identity-types.js';
import {
  writeDeviceChange,
  writePairingChange,
} from './identity-events.js';
import {
  PAIRING_LIFETIME_MS,
  TOKEN_LIFETIME_MS,
  addMilliseconds,
  decodeOpaqueSecret,
  hashesEqual,
  hashSecret,
} from './secrets.js';

export async function createPairing(
  runtime: IdentityRuntime,
  ownerDeviceId: string,
): Promise<{ pairingId: string; code: string; expiresAt: string }> {
  const now = runtime.now();
  return runtime.store.transaction(async (session) => {
    await requireOwner(session, ownerDeviceId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = runtime.randomInt(100_000_000).toString().padStart(8, '0');
      const pairing: PairingRecord = {
        id: runtime.randomUuid(),
        codeHash: hashSecret(code),
        requestId: null,
        requestedDisplayName: null,
        requestedPlatform: null,
        requestedInstallationId: null,
        claimHash: null,
        expiresAt: addMilliseconds(now, PAIRING_LIFETIME_MS),
        redeemedAt: null,
        approvedAt: null,
        approvedByDeviceId: null,
        pairedDeviceId: null,
        consumedAt: null,
        createdAt: now,
      };
      if (await session.insertPairing(pairing)) {
        await session.writeAudit({
          deviceId: ownerDeviceId,
          action: 'pairing.create',
          entityType: 'pairing',
          entityId: pairing.id,
          detail: {},
        });
        await writePairingChange(session, pairing);
        return {
          pairingId: pairing.id,
          code,
          expiresAt: pairing.expiresAt.toISOString(),
        };
      }
    }
    throw new IdentityError(
      'PAIRING_UNAVAILABLE',
      503,
      'Pairing is unavailable',
    );
  });
}

export async function claimPairing(
  runtime: IdentityRuntime,
  sourceKey: string,
  input: InstallationInput & {
    code: string;
    requestId: string;
    claimSecret: string;
  },
): Promise<{ pairingId: string; status: 'pending' }> {
  if (!runtime.redeemLimiter.consume(sourceKey)) {
    throw new IdentityError('RATE_LIMITED', 429, 'Too many pairing attempts');
  }
  requireInstallation(input);
  const claimSecret = decodeOpaqueSecret(input.claimSecret);
  if (
    !/^\d{8}$/.test(input.code) ||
    !UUID_PATTERN.test(input.requestId) ||
    !claimSecret
  ) {
    throw pairingRejected();
  }
  const claimHash = hashSecret(claimSecret);
  const now = runtime.now();
  return runtime.store.transaction(async (session) => {
    const pairing = await session.findPairingByCodeHash(hashSecret(input.code));
    if (pairing && isSameClaim(pairing, input, claimHash)) {
      return { pairingId: pairing.id, status: 'pending' as const };
    }
    if (
      !pairing ||
      pairing.redeemedAt !== null ||
      pairing.consumedAt !== null ||
      now.getTime() >= pairing.expiresAt.getTime() ||
      (await session.findDeviceByInstallationId(input.installationId))
    ) {
      throw pairingRejected();
    }

    const claimed = {
      ...pairing,
      requestId: input.requestId,
      requestedDisplayName: input.displayName.trim(),
      requestedPlatform: input.platform.trim(),
      requestedInstallationId: input.installationId,
      claimHash,
      redeemedAt: now,
    };
    await session.savePairing(claimed);
    await session.writeAudit({
      deviceId: null,
      action: 'pairing.claim',
      entityType: 'pairing',
      entityId: pairing.id,
      detail: { installationId: input.installationId },
    });
    await writePairingChange(session, claimed);
    return { pairingId: pairing.id, status: 'pending' as const };
  });
}

export async function approvePairing(
  runtime: IdentityRuntime,
  ownerDeviceId: string,
  pairingId: string,
): Promise<{ status: 'approved' }> {
  if (!UUID_PATTERN.test(pairingId)) {
    throw pairingRejected();
  }
  const now = runtime.now();
  return runtime.store.transaction(async (session) => {
    await requireOwner(session, ownerDeviceId);
    const pairing = await session.findPairingById(pairingId);
    if (
      !pairing ||
      !pairing.claimHash ||
      pairing.redeemedAt === null ||
      pairing.approvedAt !== null ||
      pairing.consumedAt !== null ||
      now.getTime() >= pairing.expiresAt.getTime()
    ) {
      throw pairingRejected();
    }
    const approved = {
      ...pairing,
      approvedAt: now,
      approvedByDeviceId: ownerDeviceId,
    };
    await session.savePairing(approved);
    await session.writeAudit({
      deviceId: ownerDeviceId,
      action: 'pairing.approve',
      entityType: 'pairing',
      entityId: pairing.id,
      detail: {},
    });
    await writePairingChange(session, approved);
    return { status: 'approved' as const };
  });
}

export async function completePairing(
  runtime: IdentityRuntime,
  input: {
    pairingId: string;
    claimSecret: string;
    deviceToken: string;
  },
): Promise<DeviceResult> {
  const claimSecret = decodeOpaqueSecret(input.claimSecret);
  const token = decodeOpaqueSecret(input.deviceToken);
  if (!UUID_PATTERN.test(input.pairingId) || !claimSecret || !token) {
    throw pairingRejected();
  }
  const claimHash = hashSecret(claimSecret);
  const tokenHash = hashSecret(token);
  const now = runtime.now();

  return runtime.store.transaction(async (session) => {
    const pairing = await session.findPairingById(input.pairingId);
    if (
      pairing?.consumedAt &&
      pairing.pairedDeviceId &&
      pairing.claimHash &&
      hashesEqual(pairing.claimHash, claimHash)
    ) {
      const replayDevice = await session.findDeviceById(pairing.pairedDeviceId);
      if (replayDevice && hashesEqual(replayDevice.tokenHash, tokenHash)) {
        return { device: publicDevice(replayDevice) };
      }
      throw pairingRejected();
    }
    if (
      !pairing ||
      !pairing.claimHash ||
      !hashesEqual(pairing.claimHash, claimHash) ||
      pairing.approvedAt === null ||
      !pairing.requestedInstallationId ||
      !pairing.requestedDisplayName ||
      !pairing.requestedPlatform ||
      now.getTime() >= pairing.expiresAt.getTime() ||
      (await session.findDeviceByInstallationId(pairing.requestedInstallationId))
    ) {
      throw pairingRejected();
    }

    const device: DeviceRecord = {
      id: runtime.randomUuid(),
      installationId: pairing.requestedInstallationId,
      role: 'client',
      displayName: pairing.requestedDisplayName,
      platform: pairing.requestedPlatform,
      tokenHash,
      tokenExpiresAt: addMilliseconds(now, TOKEN_LIFETIME_MS),
      previousTokenHash: null,
      previousTokenExpiresAt: null,
      approvedAt: pairing.approvedAt,
      revokedAt: null,
      createdAt: now,
    };
    if (!(await session.insertDevice(device))) {
      throw pairingRejected();
    }
    const consumed = {
      ...pairing,
      pairedDeviceId: device.id,
      consumedAt: now,
    };
    await session.savePairing(consumed);
    await session.writeAudit({
      deviceId: null,
      action: 'pairing.complete',
      entityType: 'pairing',
      entityId: pairing.id,
      detail: { deviceId: device.id },
    });
    await writeDeviceChange(session, device);
    await writePairingChange(session, consumed);
    return { device: publicDevice(device) };
  });
}

function isSameClaim(
  pairing: PairingRecord,
  input: InstallationInput & { requestId: string },
  claimHash: Buffer,
): boolean {
  return (
    pairing.requestId === input.requestId &&
    pairing.requestedInstallationId === input.installationId &&
    pairing.requestedDisplayName === input.displayName.trim() &&
    pairing.requestedPlatform === input.platform.trim() &&
    pairing.claimHash !== null &&
    hashesEqual(pairing.claimHash, claimHash)
  );
}

function pairingRejected(): IdentityError {
  return new IdentityError(
    'PAIRING_REJECTED',
    400,
    'Pairing request rejected',
  );
}
