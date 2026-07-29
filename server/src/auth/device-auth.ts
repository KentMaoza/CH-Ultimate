import {
  IdentityError,
  type AuthenticatedDevice,
  type DeviceRecord,
  type IdentityRuntime,
  type IssuedDevice,
  type PublicDevice,
  publicDevice,
  requireOwner,
} from './identity-types.js';
import {
  PREVIOUS_TOKEN_OVERLAP_MS,
  TOKEN_LIFETIME_MS,
  addMilliseconds,
  decodeOpaqueSecret,
  hashesEqual,
  hashSecret,
  issueOpaqueSecret,
} from './secrets.js';

export async function authenticate(
  runtime: IdentityRuntime,
  tokenValue: string,
): Promise<AuthenticatedDevice> {
  const token = decodeOpaqueSecret(tokenValue);
  if (!token) {
    throw unauthorized();
  }
  const now = runtime.now();
  return runtime.store.transaction(async (session) => {
    const match = await session.findDeviceByTokenHash(hashSecret(token));
    if (!match || match.device.revokedAt !== null) {
      throw unauthorized();
    }
    const expiresAt =
      match.tokenKind === 'current'
        ? match.device.tokenExpiresAt
        : match.device.previousTokenExpiresAt;
    if (!expiresAt || now.getTime() >= expiresAt.getTime()) {
      throw unauthorized();
    }
    return {
      ...publicDevice(match.device),
      tokenKind: match.tokenKind,
    };
  });
}

export async function rotateDeviceToken(
  runtime: IdentityRuntime,
  deviceId: string,
  presentedToken: string,
): Promise<IssuedDevice> {
  const presented = decodeOpaqueSecret(presentedToken);
  if (!presented) {
    throw unauthorized();
  }
  const now = runtime.now();
  const next = issueOpaqueSecret(runtime);
  let updated: DeviceRecord | undefined;

  await runtime.store.transaction(async (session) => {
    const device = await session.findDeviceById(deviceId);
    if (
      !device ||
      device.revokedAt !== null ||
      now.getTime() >= device.tokenExpiresAt.getTime() ||
      !hashesEqual(device.tokenHash, hashSecret(presented))
    ) {
      throw unauthorized();
    }
    updated = {
      ...device,
      tokenHash: next.hash,
      tokenExpiresAt: addMilliseconds(now, TOKEN_LIFETIME_MS),
      previousTokenHash: device.tokenHash,
      previousTokenExpiresAt: addMilliseconds(
        now,
        PREVIOUS_TOKEN_OVERLAP_MS,
      ),
    };
    await session.saveDevice(updated);
  });

  if (!updated) {
    throw new Error('Token rotation transaction returned no device');
  }
  return { device: publicDevice(updated), deviceToken: next.value };
}

export async function listDevices(
  runtime: IdentityRuntime,
  ownerDeviceId: string,
): Promise<PublicDevice[]> {
  return runtime.store.transaction(async (session) => {
    await requireOwner(session, ownerDeviceId);
    return (await session.listDevices()).map(publicDevice);
  });
}

export async function revokeDevice(
  runtime: IdentityRuntime,
  ownerDeviceId: string,
  targetDeviceId: string,
): Promise<{ status: 'revoked' }> {
  const now = runtime.now();
  return runtime.store.transaction(async (session) => {
    await requireOwner(session, ownerDeviceId);
    const target = await session.findDeviceById(targetDeviceId);
    if (!target) {
      throw new IdentityError('NOT_FOUND', 404, 'Device not found');
    }
    await session.saveDevice({ ...target, revokedAt: now });
    return { status: 'revoked' as const };
  });
}

function unauthorized(): IdentityError {
  return new IdentityError('UNAUTHORIZED', 401, 'Unauthorized');
}
