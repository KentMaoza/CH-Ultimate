import type {
  DeviceRecord,
  IdentitySession,
  PairingRecord,
} from './identity-types.js';
import { publicDevice } from './identity-types.js';

export async function writeDeviceChange(
  session: Pick<IdentitySession, 'writeChange'>,
  device: DeviceRecord,
  operation: 'upsert' | 'revoke' = 'upsert',
): Promise<void> {
  await session.writeChange({
    entityType: 'device',
    entityId: device.id,
    operation,
    payload: publicDevice(device),
  });
}

export async function writePairingChange(
  session: Pick<IdentitySession, 'writeChange'>,
  pairing: PairingRecord,
): Promise<void> {
  await session.writeChange({
    entityType: 'pairing',
    entityId: pairing.id,
    operation: 'upsert',
    payload: {
      id: pairing.id,
      status: pairing.consumedAt
        ? 'consumed'
        : pairing.approvedAt
          ? 'approved'
          : pairing.redeemedAt
            ? 'pending'
            : 'created',
      expiresAt: pairing.expiresAt.toISOString(),
    },
  });
}
