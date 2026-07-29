import {
  IdentityError,
  type DeviceRecord,
  type DeviceResult,
  type IdentityRuntime,
  type OwnerBootstrapInput,
  publicDevice,
  requireInstallation,
} from './identity-types.js';
import { writeDeviceChange } from './identity-events.js';
import {
  TOKEN_BYTES,
  TOKEN_LIFETIME_MS,
  addMilliseconds,
  configuredSecretsMatch,
  decodeOpaqueSecret,
  hashesEqual,
  hashSecret,
} from './secrets.js';

export async function bootstrapOwner(
  runtime: IdentityRuntime,
  input: OwnerBootstrapInput,
): Promise<DeviceResult> {
  requireInstallation(input);
  if (input.mode === 'bootstrap') {
    return initialBootstrap(runtime, input);
  }
  return recoverOwner(runtime, input);
}

async function initialBootstrap(
  runtime: IdentityRuntime,
  input: Extract<OwnerBootstrapInput, { mode: 'bootstrap' }>,
): Promise<DeviceResult> {
  const configuredSecret = runtime.bootstrapSecret;
  if (
    configuredSecret === undefined ||
    Buffer.byteLength(configuredSecret, 'utf8') < TOKEN_BYTES
  ) {
    throw new IdentityError(
      'BOOTSTRAP_DISABLED',
      403,
      'Owner bootstrap is disabled',
    );
  }
  if (!configuredSecretsMatch(configuredSecret, input.bootstrapSecret)) {
    throw new IdentityError(
      'BOOTSTRAP_REJECTED',
      403,
      'Owner bootstrap rejected',
    );
  }

  const token = decodeOpaqueSecret(input.deviceToken);
  const recoveryCredential = decodeOpaqueSecret(input.recoveryCredential);
  if (!token || !recoveryCredential) {
    throw new IdentityError('INVALID_REQUEST', 400, 'Invalid request');
  }
  const tokenHash = hashSecret(token);
  const recoveryHash = hashSecret(recoveryCredential);
  const now = runtime.now();

  return runtime.store.transaction(async (session) => {
    const owner = await session.findOwner();
    const recovery = await session.findRecovery();
    if (owner || recovery) {
      if (
        owner &&
        recovery &&
        owner.installationId === input.installationId &&
        owner.displayName === input.displayName.trim() &&
        owner.platform === input.platform.trim() &&
        owner.revokedAt === null &&
        hashesEqual(owner.tokenHash, tokenHash) &&
        hashesEqual(recovery.credentialHash, recoveryHash)
      ) {
        return { device: publicDevice(owner) };
      }
      throw new IdentityError('OWNER_EXISTS', 409, 'Owner already exists');
    }

    const device: DeviceRecord = {
      id: runtime.randomUuid(),
      installationId: input.installationId,
      role: 'owner',
      displayName: input.displayName.trim(),
      platform: input.platform.trim(),
      tokenHash,
      tokenExpiresAt: addMilliseconds(now, TOKEN_LIFETIME_MS),
      previousTokenHash: null,
      previousTokenExpiresAt: null,
      approvedAt: now,
      revokedAt: null,
      createdAt: now,
    };
    if (!(await session.insertDevice(device))) {
      throw new IdentityError(
        'BOOTSTRAP_REJECTED',
        409,
        'Owner bootstrap rejected',
      );
    }
    await session.saveRecovery({
      credentialHash: recoveryHash,
      credentialVersion: 1n,
      createdAt: now,
      rotatedAt: null,
    });
    await session.writeAudit({
      deviceId: null,
      action: 'owner.bootstrap',
      entityType: 'device',
      entityId: device.id,
      detail: { installationId: device.installationId },
    });
    await writeDeviceChange(session, device);
    return { device: publicDevice(device) };
  });
}

async function recoverOwner(
  runtime: IdentityRuntime,
  input: Extract<OwnerBootstrapInput, { mode: 'recovery' }>,
): Promise<DeviceResult> {
  const currentRecovery = decodeOpaqueSecret(input.recoveryCredential);
  const nextRecovery = decodeOpaqueSecret(input.nextRecoveryCredential);
  const token = decodeOpaqueSecret(input.deviceToken);
  if (!currentRecovery || !nextRecovery || !token) {
    throw recoveryRejected();
  }
  const currentRecoveryHash = hashSecret(currentRecovery);
  const nextRecoveryHash = hashSecret(nextRecovery);
  const tokenHash = hashSecret(token);
  const now = runtime.now();

  return runtime.store.transaction(async (session) => {
    const recovery = await session.findRecovery();
    const existing = await session.findDeviceByInstallationId(
      input.installationId,
    );
    if (
      recovery &&
      existing &&
      existing.role === 'owner' &&
      existing.revokedAt === null &&
      existing.displayName === input.displayName.trim() &&
      existing.platform === input.platform.trim() &&
      hashesEqual(recovery.credentialHash, nextRecoveryHash) &&
      hashesEqual(existing.tokenHash, tokenHash)
    ) {
      return { device: publicDevice(existing) };
    }
    if (
      !recovery ||
      !hashesEqual(recovery.credentialHash, currentRecoveryHash)
    ) {
      throw recoveryRejected();
    }

    const device: DeviceRecord = {
      id: existing?.id ?? runtime.randomUuid(),
      installationId: input.installationId,
      role: 'owner',
      displayName: input.displayName.trim(),
      platform: input.platform.trim(),
      tokenHash,
      tokenExpiresAt: addMilliseconds(now, TOKEN_LIFETIME_MS),
      previousTokenHash: null,
      previousTokenExpiresAt: null,
      approvedAt: now,
      revokedAt: null,
      createdAt: existing?.createdAt ?? now,
    };
    const previousOwners = (await session.listDevices()).filter(
      (candidate) =>
        candidate.role === 'owner' &&
        candidate.id !== device.id &&
        candidate.revokedAt === null,
    );
    await session.revokeOtherOwners(device.id, now);
    if (existing) {
      await session.saveDevice(device);
    } else if (!(await session.insertDevice(device))) {
      throw recoveryRejected(409);
    }
    await session.saveRecovery({
      credentialHash: nextRecoveryHash,
      credentialVersion: recovery.credentialVersion + 1n,
      createdAt: recovery.createdAt,
      rotatedAt: now,
    });
    await session.writeAudit({
      deviceId: null,
      action: 'owner.recover',
      entityType: 'device',
      entityId: device.id,
      detail: { installationId: device.installationId },
    });
    for (const previousOwner of previousOwners) {
      const revokedOwner = { ...previousOwner, revokedAt: now };
      await writeDeviceChange(session, revokedOwner, 'revoke');
    }
    await writeDeviceChange(session, device);
    return { device: publicDevice(device) };
  });
}

function recoveryRejected(statusCode = 403): IdentityError {
  return new IdentityError(
    'RECOVERY_REJECTED',
    statusCode,
    'Owner recovery rejected',
  );
}
