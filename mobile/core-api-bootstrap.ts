import type {
  CoreGatewayClock,
  CoreGatewayStorage,
  CoreOperationsGateway,
} from '../src/gateway/core-operations-gateway';
import { createCoreOperationsGateway } from '../src/gateway/core-operations-gateway';
import type { OperationsGateway } from '../src/gateway/operations-gateway';
import {
  createCoreGatewayClock,
  createCoreGatewayStorage,
} from '../src/renderer/core-browser-adapters';
import type {
  MobileCoreBridge,
  MobileCredentialStatus,
} from './core-api-native';

export type MobileBootstrapResult =
  | {
      kind: 'gateway';
      source: 'core';
      gateway: CoreOperationsGateway;
    }
  | {
      kind: 'gateway';
      source: 'demo';
      gateway: OperationsGateway;
    }
  | {
      kind: 'connection';
      status: MobileCredentialStatus;
    };

export interface MobileBootstrapOptions {
  native: boolean;
  bridge?: MobileCoreBridge;
  demoFactory?: () => OperationsGateway;
  storage?: CoreGatewayStorage;
  clock?: CoreGatewayClock;
}

export async function bootstrapMobileGateway(
  options: MobileBootstrapOptions,
): Promise<MobileBootstrapResult> {
  if (!options.native) {
    if (!options.demoFactory) {
      throw new Error('Gateway demo mobile tidak tersedia.');
    }
    return {
      kind: 'gateway',
      source: 'demo',
      gateway: options.demoFactory(),
    };
  }

  if (!options.bridge) {
    return {
      kind: 'connection',
      status: {
        production: true,
        configuration: 'missing',
        credential: 'unpaired',
        message: 'Jembatan Android CH Core tidak tersedia.',
      },
    };
  }

  let status: MobileCredentialStatus;
  try {
    status = await options.bridge.credentialStatus();
  } catch {
    return {
      kind: 'connection',
      status: {
        production: true,
        configuration: 'missing',
        credential: 'unpaired',
        message: 'Jembatan Android CH Core tidak tersedia.',
      },
    };
  }
  if (
    status.configuration !== 'ready' ||
    status.credential !== 'paired'
  ) {
    return { kind: 'connection', status };
  }

  const gateway = createCoreOperationsGateway(
    options.bridge,
    options.storage ?? createCoreGatewayStorage(),
    options.clock ?? createCoreGatewayClock(),
  );
  try {
    await gateway.initialize();
  } catch {
    gateway.dispose();
    return {
      kind: 'connection',
      status: {
        ...status,
        message: 'CH Core tidak dapat dimulai. Coba lagi.',
      },
    };
  }
  return { kind: 'gateway', source: 'core', gateway };
}
