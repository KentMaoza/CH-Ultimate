import {
  randomBytes as cryptoRandomBytes,
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
  IdentityRuntime,
  IdentityServiceOptions,
  IssuedDevice,
  OwnerBootstrapInput,
  PublicDevice,
} from './identity-types.js';
import { bootstrapOwner } from './owner-recovery.js';
import {
  approvePairing,
  claimPairing,
  completePairing,
  createPairing,
} from './pairing.js';

export {
  IdentityError,
  type AuthenticatedDevice,
  type DeviceRecord,
  type DeviceRole,
  type IdentitySession,
  type IdentityStore,
  type IssuedDevice,
  type OwnerBootstrapInput,
  type PairingRecord,
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
      randomBytes: options.randomBytes ?? cryptoRandomBytes,
      randomInt:
        options.randomInt ?? ((maximum) => cryptoRandomInt(0, maximum)),
      randomUuid: options.randomUuid ?? randomUUID,
      redeemLimiter: options.redeemLimiter,
    };
  }

  bootstrapOwner(
    input: OwnerBootstrapInput,
  ): Promise<IssuedDevice & { recoveryCredential: string }> {
    return bootstrapOwner(this.runtime, input);
  }

  createPairing(
    ownerDeviceId: string,
  ): Promise<{ pairingId: string; code: string; expiresAt: string }> {
    return createPairing(this.runtime, ownerDeviceId);
  }

  claimPairing(
    sourceKey: string,
    input: {
      code: string;
      installationId: string;
      displayName: string;
      platform: string;
    },
  ): Promise<{ pairingId: string; claimSecret: string; status: 'pending' }> {
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
  }): Promise<IssuedDevice> {
    return completePairing(this.runtime, input);
  }

  authenticate(tokenValue: string): Promise<AuthenticatedDevice> {
    return authenticate(this.runtime, tokenValue);
  }

  rotateDeviceToken(
    deviceId: string,
    presentedToken: string,
  ): Promise<IssuedDevice> {
    return rotateDeviceToken(this.runtime, deviceId, presentedToken);
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
