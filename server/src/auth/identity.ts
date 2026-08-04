import {
  randomInt as cryptoRandomInt,
  randomUUID,
} from 'node:crypto';

import {
  authenticate,
  listDevices,
  revokeDevice,
  rotateDeviceToken,
} from './device-auth.js';
import type {
  AuthenticatedDevice,
  DeviceResult,
  IdentityRuntime,
  IdentityServiceOptions,
  OwnerBootstrapInput,
  PublicPairingStatus,
  PublicDevice,
} from './identity-types.js';
import { bootstrapOwner } from './owner-recovery.js';
import {
  approvePairing,
  claimPairing,
  completePairing,
  createPairing,
  inspectPairing,
} from './pairing.js';

export {
  IdentityError,
  type AuthenticatedDevice,
  type DeviceRecord,
  type DeviceRole,
  type DeviceResult,
  type IdentityAuditEvent,
  type IdentityChangeEvent,
  type IdentitySession,
  type IdentityStore,
  type OwnerBootstrapInput,
  type PairingRecord,
  type PublicPairingState,
  type PublicPairingStatus,
  type PublicDevice,
  type RecoveryRecord,
  type TokenKind,
} from './identity-types.js';

export class IdentityService {
  private readonly runtime: IdentityRuntime;

  constructor(options: IdentityServiceOptions) {
    this.runtime = {
      store: options.store,
      bootstrapSecret: options.bootstrapSecret,
      now: options.now ?? (() => new Date()),
      randomInt:
        options.randomInt ?? ((maximum) => cryptoRandomInt(0, maximum)),
      randomUuid: options.randomUuid ?? randomUUID,
      redeemLimiter: options.redeemLimiter,
    };
  }

  bootstrapOwner(
    input: OwnerBootstrapInput,
  ): Promise<DeviceResult> {
    return bootstrapOwner(this.runtime, input);
  }

  createPairing(
    ownerDeviceId: string,
  ): Promise<{ pairingId: string; code: string; expiresAt: string }> {
    return createPairing(this.runtime, ownerDeviceId);
  }

  inspectPairing(
    ownerDeviceId: string,
    pairingId: string,
  ): Promise<PublicPairingStatus> {
    return inspectPairing(this.runtime, ownerDeviceId, pairingId);
  }

  claimPairing(
    sourceKey: string,
    input: {
      code: string;
      requestId: string;
      claimSecret: string;
      installationId: string;
      displayName: string;
      platform: string;
    },
  ): Promise<{ pairingId: string; status: 'pending' }> {
    return claimPairing(this.runtime, sourceKey, input);
  }

  approvePairing(
    ownerDeviceId: string,
    pairingId: string,
  ): Promise<{ status: 'approved' }> {
    return approvePairing(this.runtime, ownerDeviceId, pairingId);
  }

  completePairing(input: {
    pairingId: string;
    claimSecret: string;
    deviceToken: string;
  }): Promise<DeviceResult> {
    return completePairing(this.runtime, input);
  }

  authenticate(tokenValue: string): Promise<AuthenticatedDevice> {
    return authenticate(this.runtime, tokenValue);
  }

  rotateDeviceToken(
    deviceId: string,
    presentedToken: string,
    nextDeviceToken: string,
  ): Promise<DeviceResult> {
    return rotateDeviceToken(
      this.runtime,
      deviceId,
      presentedToken,
      nextDeviceToken,
    );
  }

  listDevices(ownerDeviceId: string): Promise<PublicDevice[]> {
    return listDevices(this.runtime, ownerDeviceId);
  }

  revokeDevice(
    ownerDeviceId: string,
    targetDeviceId: string,
  ): Promise<{ status: 'revoked' }> {
    return revokeDevice(this.runtime, ownerDeviceId, targetDeviceId);
  }
}
