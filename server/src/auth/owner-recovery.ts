import {
  IdentityError,
  type DeviceRecord,
  type IdentityRuntime,
  type IssuedDevice,
  type OwnerBootstrapInput,
  publicDevice,
  requireInstallation,
} from './identity-types.js';
import {
  TOKEN_BYTES,
  TOKEN_LIFETIME_MS,
  addMilliseconds,
  configuredSecretsMatch,
  decodeOpaqueSecret,
  hashesEqual,
  hashSecret,
  issueOpaqueSecret,
} from './secrets.js';

export async function bootstrapOwner(
  runtime: IdentityRuntime,
  input: OwnerBootstrapInput,
): Promise<IssuedDevice & { recoveryCredential: string }> {
  requireInstallation(input);
  if (input.mode === 'bootstrap') {
    return initialBootstrap(runtime, input);
  }
  return recoverOwner(runtime, input);
}

async function initialBootstrap(
  runtime: IdentityRuntime,
  input: Extract<OwnerBootstrapInput, { mode: 'bootstrap' }>,
): Promise<IssuedDevice & { recoveryCredential: string }> {
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

  const now = runtime.now();
  const token = issueOpaqueSecret(runtime);
  const recovery = issueOpaqueSecret(runtime);
  const device: DeviceRecord = {
    id: runtime.randomUuid(),
    installationId: input.installationId,
    role: 'owner',
    displayName: input.displayName.trim(),
    platform: input.platform.trim(),
    tokenHash: token.hash,
    tokenExpiresAt: addMilliseconds(now, TOKEN_LIFETIME_MS),
    previousTokenHash: null,
    previousTokenExpiresAt: null,
    approvedAt: now,
    revokedAt: null,
    createdAt: now,
  };

  await runtime.store.transaction(async (session) => {
    if (await session.findOwner()) {
      throw new IdentityError('OWNER_EXISTS', 409, 'Owner already exists');
    }
    if (!(await session.insertDevice(device))) {
      throw new IdentityError(
        'BOOTSTRAP_REJECTED',
        409,
        'Owner bootstrap rejected',
      );
    }
    await session.saveRecovery({
      credentialHash: recovery.hash,
      credentialVersion: 1n,
      createdAt: now,
      rotatedAt: null,
    });
  });

  return {
    device: publicDevice(device),
    deviceToken: token.value,
    recoveryCredential: recovery.value,
  };
}

async function recoverOwner(
  runtime: IdentityRuntime,
  input: Extract<OwnerBootstrapInput, { mode: 'recovery' }>,
): Promise<IssuedDevice & { recoveryCredential: string }> {
  const presentedRecovery = decodeOpaqueSecret(input.recoveryCredential);
  if (!presentedRecovery) {
    throw recoveryRejected();
  }

  const now = runtime.now();
  const token = issueOpaqueSecret(runtime);
  const nextRecovery = issueOpaqueSecret(runtime);
  let recoveredDevice: DeviceRecord | undefined;

  await runtime.store.transaction(async (session) => {
    const recovery = await session.findRecovery();
    if (
      !recovery ||
      !hashesEqual(recovery.credentialHash, hashSecret(presentedRecovery))
    ) {
      throw recoveryRejected();
    }

    const existing = await session.findDeviceByInstallationId(
      input.installationId,
    );
    const device: DeviceRecord = {
      id: existing?.id ?? runtime.randomUuid(),
      installationId: input.installationId,
      role: 'owner',
      displayName: input.displayName.trim(),
      platform: input.platform.trim(),
      tokenHash: token.hash,
      tokenExpiresAt: addMilliseconds(now, TOKEN_LIFETIME_MS),
      previousTokenHash: null,
      previousTokenExpiresAt: null,
      approvedAt: now,
      revokedAt: null,
      createdAt: existing?.createdAt ?? now,
    };

    await session.revokeOtherOwners(device.id, now);
    if (existing) {
      await session.saveDevice(device);
    } else if (!(await session.insertDevice(device))) {
      throw recoveryRejected(409);
    }
    await session.saveRecovery({
      credentialHash: nextRecovery.hash,
      credentialVersion: recovery.credentialVersion + 1n,
      createdAt: recovery.createdAt,
      rotatedAt: now,
    });
    recoveredDevice = device;
  });

  if (!recoveredDevice) {
    throw new Error('Owner recovery transaction returned no device');
  }
  return {
    device: publicDevice(recoveredDevice),
    deviceToken: token.value,
    recoveryCredential: nextRecovery.value,
  };
}

function recoveryRejected(statusCode = 403): IdentityError {
  return new IdentityError(
    'RECOVERY_REJECTED',
    statusCode,
    'Owner recovery rejected',
  );
}
