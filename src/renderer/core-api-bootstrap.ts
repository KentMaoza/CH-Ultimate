import type {
  ChCoreBridge,
  CoreCredentialStatus,
} from '../electron/core-bridge-contract';
import type {
  CoreGatewayClock,
  CoreGatewayStorage,
} from '../gateway/core-operations-gateway';
import { createCoreOperationsGateway } from '../gateway/core-operations-gateway';
import type { OperationsGateway } from '../gateway/operations-gateway';
import {
  createCoreGatewayClock,
  createCoreGatewayStorage,
} from './core-browser-adapters';

export type DesktopRuntimeMode = 'production' | 'development' | 'test';

export type DesktopBootstrapResult =
  | {
      kind: 'gateway';
      source: 'core' | 'test-mock';
      gateway: OperationsGateway;
    }
  | {
      kind: 'connection';
      status: CoreCredentialStatus;
    };

export interface DesktopBootstrapOptions {
  bridge?: ChCoreBridge;
  mode: DesktopRuntimeMode;
  allowTestMock?: boolean;
  mockFactory?: () => OperationsGateway;
  storage?: CoreGatewayStorage;
  clock?: CoreGatewayClock;
}

function missingBridgeStatus(
  production: boolean,
): CoreCredentialStatus {
  return {
    production,
    configuration: 'missing',
    credential: 'unpaired',
    message: 'Jembatan desktop CH Core tidak tersedia.',
  };
}

export async function bootstrapDesktopGateway(
  options: DesktopBootstrapOptions,
): Promise<DesktopBootstrapResult> {
  if (!options.bridge) {
    if (
      options.mode === 'test' &&
      options.allowTestMock === true &&
      options.mockFactory
    ) {
      return {
        kind: 'gateway',
        source: 'test-mock',
        gateway: options.mockFactory(),
      };
    }
    return {
      kind: 'connection',
      status: missingBridgeStatus(options.mode === 'production'),
    };
  }

  let status: CoreCredentialStatus;
  try {
    status = await options.bridge.credentialStatus();
  } catch {
    return {
      kind: 'connection',
      status: missingBridgeStatus(options.mode === 'production'),
    };
  }
  if (
    status.production &&
    (status.configuration !== 'ready' || status.credential !== 'paired')
  ) {
    return { kind: 'connection', status };
  }
  if (status.configuration !== 'ready' || status.credential !== 'paired') {
    return { kind: 'connection', status };
  }

  const gateway = createCoreOperationsGateway(
    { request: (request) => options.bridge!.request(request) },
    options.storage ?? createCoreGatewayStorage(),
    options.clock ?? createCoreGatewayClock(),
  );
  await gateway.initialize();
  return { kind: 'gateway', source: 'core', gateway };
}
