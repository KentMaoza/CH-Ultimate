import {
  IdentityError,
  UUID_PATTERN,
  type DeviceRecord,
  type IdentityRuntime,
  type InstallationInput,
  type IssuedDevice,
  type PairingRecord,
  publicDevice,
  requireInstallation,
  requireOwner,
} from './identity-types.js';
import {
  PAIRING_LIFETIME_MS,
  TOKEN_LIFETIME_MS,
  addMilliseconds,
  decodeOpaqueSecret,
  hashesEqual,
  hashSecret,
  issueOpaqueSecret,
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
  input: InstallationInput & { code: string },
): Promise<{ pairingId: string; claimSecret: string; status: 'pending' }> {
  if (!runtime.redeemLimiter.consume(sourceKey)) {
    throw new IdentityError('RATE_LIMITED', 429, 'Too many pairing attempts');
  }
  requireInstallation(input);
  if (!/^\d{8}$/.test(input.code)) {
    throw pairingRejected();
  }

  const now = runtime.now();
  const claimSecret = issueOpaqueSecret(runtime);
  return runtime.store.transaction(async (session) => {
    const pairing = await session.findPairingByCodeHash(hashSecret(input.code));
    if (
      !pairing ||
      pairing.redeemedAt !== null ||
      pairing.consumedAt !== null ||
      now.getTime() >= pairing.expiresAt.getTime() ||
      (await session.findDeviceByInstallationId(input.installationId))
    ) {
      throw pairingRejected();
    }

    await session.savePairing({
      ...pairing,
      requestedDisplayName: input.displayName.trim(),
      requestedPlatform: input.platform.trim(),
      requestedInstallationId: input.installationId,
      claimHash: claimSecret.hash,
      redeemedAt: now,
    });
    return {
      pairingId: pairing.id,
      claimSecret: claimSecret.value,
      status: 'pending' as const,
    };
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
    await session.savePairing({
      ...pairing,
      approvedAt: now,
      approvedByDeviceId: ownerDeviceId,
    });
    return { status: 'approved' as const };
  });
}

export async function completePairing(
  runtime: IdentityRuntime,
  input: { pairingId: string; claimSecret: string },
): Promise<IssuedDevice> {
  const claimSecret = decodeOpaqueSecret(input.claimSecret);
  if (!UUID_PATTERN.test(input.pairingId) || !claimSecret) {
    throw pairingRejected();
  }

  const now = runtime.now();
  const token = issueOpaqueSecret(runtime);
  let pairedDevice: DeviceRecord | undefined;
  await runtime.store.transaction(async (session) => {
    const pairing = await session.findPairingById(input.pairingId);
    if (
      !pairing ||
      !pairing.claimHash ||
      !hashesEqual(pairing.claimHash, hashSecret(claimSecret)) ||
      pairing.approvedAt === null ||
      pairing.consumedAt !== null ||
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
      tokenHash: token.hash,
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
    await session.savePairing({
      ...pairing,
      pairedDeviceId: device.id,
      consumedAt: now,
    });
    pairedDevice = device;
  });

  if (!pairedDevice) {
    throw new Error('Pairing transaction returned no device');
  }
  return {
    device: publicDevice(pairedDevice),
    deviceToken: token.value,
  };
}

function pairingRejected(): IdentityError {
  return new IdentityError(
    'PAIRING_REJECTED',
    400,
    'Pairing request rejected',
  );
}
