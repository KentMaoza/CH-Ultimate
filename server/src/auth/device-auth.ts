import {
  IdentityError,
  type AuthenticatedDevice,
  type DeviceResult,
  type IdentityRuntime,
  type PublicDevice,
  publicDevice,
  requireOwner,
} from './identity-types.js';
import { writeDeviceChange } from './identity-events.js';
import {
  PREVIOUS_TOKEN_OVERLAP_MS,
  TOKEN_LIFETIME_MS,
  addMilliseconds,
  decodeOpaqueSecret,
  hashesEqual,
  hashSecret,
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
  nextTokenValue: string,
): Promise<DeviceResult> {
  const presented = decodeOpaqueSecret(presentedToken);
  const next = decodeOpaqueSecret(nextTokenValue);
  if (!presented || !next) {
    throw unauthorized();
  }
  const presentedHash = hashSecret(presented);
  const nextHash = hashSecret(next);
  const now = runtime.now();

  return runtime.store.transaction(async (session) => {
    const device = await session.findDeviceById(deviceId);
    if (!device || device.revokedAt !== null) {
      throw unauthorized();
    }
    if (
      hashesEqual(device.tokenHash, nextHash) &&
      (hashesEqual(device.tokenHash, presentedHash) ||
        (device.previousTokenHash !== null &&
          device.previousTokenExpiresAt !== null &&
          now.getTime() < device.previousTokenExpiresAt.getTime() &&
          hashesEqual(device.previousTokenHash, presentedHash)))
    ) {
      return { device: publicDevice(device) };
    }
    if (
      now.getTime() >= device.tokenExpiresAt.getTime() ||
      !hashesEqual(device.tokenHash, presentedHash)
    ) {
      throw unauthorized();
    }

    const updated = {
      ...device,
      tokenHash: nextHash,
      tokenExpiresAt: addMilliseconds(now, TOKEN_LIFETIME_MS),
      previousTokenHash: device.tokenHash,
      previousTokenExpiresAt: addMilliseconds(
        now,
        PREVIOUS_TOKEN_OVERLAP_MS,
      ),
    };
    await session.saveDevice(updated);
    await session.writeAudit({
      deviceId,
      action: 'device.token.rotate',
      entityType: 'device',
      entityId: deviceId,
      detail: {},
    });
    await writeDeviceChange(session, updated);
    return { device: publicDevice(updated) };
  });
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
    const revoked = { ...target, revokedAt: now };
    await session.saveDevice(revoked);
    await session.writeAudit({
      deviceId: ownerDeviceId,
      action: 'device.revoke',
      entityType: 'device',
      entityId: targetDeviceId,
      detail: {},
    });
    await writeDeviceChange(session, revoked, 'revoke');
    return { status: 'revoked' as const };
  });
}

function unauthorized(): IdentityError {
  return new IdentityError('UNAUTHORIZED', 401, 'Unauthorized');
}
