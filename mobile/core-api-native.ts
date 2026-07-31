import { registerPlugin } from '@capacitor/core';

import type {
  CoreApiRequest,
  CoreApiResponse,
} from '../src/gateway/core-api-transport';

export interface MobileCredentialStatus {
  production: boolean;
  configuration: 'ready' | 'missing' | 'invalid';
  credential: 'unpaired' | 'pending' | 'paired';
  message?: string;
  deviceId?: string;
  pairingId?: string;
}

export interface NativeCoreApiPlugin {
  request(request: CoreApiRequest): Promise<CoreApiResponse>;
  installationId(): Promise<{ installationId: string }>;
  credentialStatus(): Promise<MobileCredentialStatus>;
  claimPairing(input: {
    code: string;
    displayName: string;
  }): Promise<{ status: 'pending'; pairingId: string }>;
  completePairing(): Promise<{ status: 'paired'; deviceId: string }>;
  rotateToken(): Promise<{ status: 'rotated' }>;
}

export type MobileCoreBridge = Omit<
  NativeCoreApiPlugin,
  'installationId'
> & {
  installationId(): Promise<string>;
};

export const NativeCoreApi =
  registerPlugin<NativeCoreApiPlugin>('CoreApi');

function sanitizeStatus(
  status: MobileCredentialStatus,
): MobileCredentialStatus {
  const result: MobileCredentialStatus = {
    production: status.production === true,
    configuration: status.configuration,
    credential: status.credential,
  };
  if (typeof status.message === 'string') result.message = status.message;
  if (typeof status.deviceId === 'string') result.deviceId = status.deviceId;
  if (typeof status.pairingId === 'string') result.pairingId = status.pairingId;
  return result;
}

export function createNativeCoreApiBridge(
  plugin: NativeCoreApiPlugin = NativeCoreApi,
): MobileCoreBridge {
  return {
    request: (request) => plugin.request(request),
    installationId: async () => {
      const result = await plugin.installationId();
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          result.installationId,
        )
      ) {
        throw new Error('Identitas instalasi CH Core tidak valid.');
      }
      return result.installationId;
    },
    credentialStatus: async () =>
      sanitizeStatus(await plugin.credentialStatus()),
    claimPairing: async (input) => {
      const result = await plugin.claimPairing(input);
      return {
        status: 'pending',
        pairingId: result.pairingId,
      };
    },
    completePairing: async () => {
      const result = await plugin.completePairing();
      return {
        status: 'paired',
        deviceId: result.deviceId,
      };
    },
    rotateToken: async () => {
      await plugin.rotateToken();
      return { status: 'rotated' };
    },
  };
}
