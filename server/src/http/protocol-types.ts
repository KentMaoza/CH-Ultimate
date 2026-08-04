import type { IdentityService } from '../auth/identity.js';
import type { SyncService } from '../sync/service.js';

export type ProtocolIdentityService = Pick<
  IdentityService,
  | 'bootstrapOwner'
  | 'authenticate'
  | 'createPairing'
  | 'inspectPairing'
  | 'claimPairing'
  | 'approvePairing'
  | 'completePairing'
  | 'listDevices'
  | 'revokeDevice'
  | 'rotateDeviceToken'
>;

export type ProtocolSyncService = Pick<SyncService, 'bootstrap' | 'changes'>;

export interface ProtocolServices {
  identity: ProtocolIdentityService;
  sync: ProtocolSyncService;
}
