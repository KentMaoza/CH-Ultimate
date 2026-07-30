import type {
  CoreApiRequest,
  CoreApiResponse,
} from '../gateway/core-api-transport';
import type {
  OwnerEnrollmentInput,
  PairingClaimInput,
} from './core-identity-main';

export const CH_CORE_IPC_CHANNELS = {
  request: 'ch-core:request',
  credentialStatus: 'ch-core:credential-status',
  enrollOwner: 'ch-core:enroll-owner',
  claimPairing: 'ch-core:claim-pairing',
  completePairing: 'ch-core:complete-pairing',
  rotateToken: 'ch-core:rotate-token',
} as const;

export const CORE_SAFE_STORAGE_UNAVAILABLE_MESSAGE =
  'Penyimpanan aman tidak tersedia. Perangkat tidak dapat dipasangkan.';

export interface CoreCredentialStatus {
  production: boolean;
  configuration: 'ready' | 'missing' | 'invalid';
  credential: 'unpaired' | 'pending' | 'paired';
  message?: string;
  deviceId?: string;
  pairingId?: string;
}

export interface ChCoreBridge {
  request(request: CoreApiRequest): Promise<CoreApiResponse>;
  credentialStatus(): Promise<CoreCredentialStatus>;
  enrollOwner(
    input: OwnerEnrollmentInput,
  ): Promise<{ status: 'paired'; deviceId: string }>;
  claimPairing(
    input: PairingClaimInput,
  ): Promise<{ status: 'pending'; pairingId: string }>;
  completePairing(): Promise<{ status: 'paired'; deviceId: string }>;
  rotateToken(): Promise<{ status: 'rotated' }>;
}

type BridgeInvoke = (channel: string, input?: unknown) => Promise<unknown>;

export function createChCoreBridge(invoke: BridgeInvoke): ChCoreBridge {
  return {
    request: (input) =>
      invoke(CH_CORE_IPC_CHANNELS.request, input) as Promise<CoreApiResponse>,
    credentialStatus: () =>
      invoke(
        CH_CORE_IPC_CHANNELS.credentialStatus,
      ) as Promise<CoreCredentialStatus>,
    enrollOwner: (input) =>
      invoke(CH_CORE_IPC_CHANNELS.enrollOwner, input) as ReturnType<
        ChCoreBridge['enrollOwner']
      >,
    claimPairing: (input) =>
      invoke(CH_CORE_IPC_CHANNELS.claimPairing, input) as ReturnType<
        ChCoreBridge['claimPairing']
      >,
    completePairing: () =>
      invoke(CH_CORE_IPC_CHANNELS.completePairing) as ReturnType<
        ChCoreBridge['completePairing']
      >,
    rotateToken: () =>
      invoke(CH_CORE_IPC_CHANNELS.rotateToken) as ReturnType<
        ChCoreBridge['rotateToken']
      >,
  };
}
