import { describe, expect, it, vi } from 'vitest';

import type { OperationsGateway } from '../../src/gateway/operations-gateway';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import {
  createNativeCoreApiBridge,
  type NativeCoreApiPlugin,
} from '../../mobile/core-api-native';
import { bootstrapMobileGateway } from '../../mobile/core-api-bootstrap';
import {
  MemoryStorage,
  TestClock,
  populatedBootstrap,
} from './core-gateway-test-support';

function nativePlugin(
  status: Awaited<ReturnType<NativeCoreApiPlugin['credentialStatus']>>,
): NativeCoreApiPlugin {
  return {
    request: vi.fn(),
    credentialStatus: vi.fn().mockResolvedValue(status),
    claimPairing: vi.fn(),
    completePairing: vi.fn(),
    rotateToken: vi.fn(),
  };
}

describe('Android CH Core adapter', () => {
  it('forwards only the approved relative operation shape to native code', async () => {
    const plugin = nativePlugin({
      production: true,
      configuration: 'ready',
      credential: 'paired',
    });
    plugin.request = vi.fn().mockResolvedValue({
      status: 200,
      body: { revision: '4' },
    });
    const bridge = createNativeCoreApiBridge(plugin);

    await expect(
      bridge.request({
        method: 'GET',
        path: '/v1/changes?after=0&limit=500',
      }),
    ).resolves.toEqual({
      status: 200,
      body: { revision: '4' },
    });

    expect(plugin.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/v1/changes?after=0&limit=500',
    });
  });

  it('strips native-only endpoint and token data from public status', async () => {
    const plugin = nativePlugin({
      production: true,
      configuration: 'ready',
      credential: 'paired',
      deviceId: '11111111-1111-4111-8111-111111111111',
      deviceToken: 'native-secret',
      endpoint: 'https://192.168.1.14:8443',
    } as never);

    const result = await createNativeCoreApiBridge(plugin).credentialStatus();

    expect(result).toEqual({
      production: true,
      configuration: 'ready',
      credential: 'paired',
      deviceId: '11111111-1111-4111-8111-111111111111',
    });
    expect(JSON.stringify(result)).not.toContain('native-secret');
    expect(JSON.stringify(result)).not.toContain('192.168.1.14');
  });
});

describe('mobile CH Core bootstrap', () => {
  it('uses an explicit visible demo gateway only outside native Capacitor', async () => {
    const gateway = new MockOperationsGateway();
    const demoFactory = vi.fn<() => OperationsGateway>(() => gateway);

    const result = await bootstrapMobileGateway({
      native: false,
      demoFactory,
    });

    expect(result).toEqual({
      kind: 'gateway',
      source: 'demo',
      gateway,
    });
    expect(demoFactory).toHaveBeenCalledTimes(1);
  });

  it('fails closed on native startup when the plugin is unavailable', async () => {
    const demoFactory = vi.fn<() => OperationsGateway>(
      () => new MockOperationsGateway(),
    );

    const result = await bootstrapMobileGateway({
      native: true,
      demoFactory,
    });

    expect(result).toMatchObject({
      kind: 'connection',
      status: {
        production: true,
        configuration: 'missing',
        credential: 'unpaired',
      },
    });
    expect(demoFactory).not.toHaveBeenCalled();
  });

  it('creates the synchronized gateway only for paired native credentials', async () => {
    const plugin = nativePlugin({
      production: true,
      configuration: 'ready',
      credential: 'paired',
      deviceId: '11111111-1111-4111-8111-111111111111',
    });
    plugin.request = vi.fn().mockResolvedValue({
      status: 200,
      body: populatedBootstrap('4'),
    });

    const result = await bootstrapMobileGateway({
      native: true,
      bridge: createNativeCoreApiBridge(plugin),
      storage: new MemoryStorage(),
      clock: new TestClock(),
    });

    expect(result.kind).toBe('gateway');
    if (result.kind !== 'gateway') return;
    expect(result.source).toBe('core');
    expect(plugin.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/v1/bootstrap',
    });
    expect(result.gateway.getSyncSnapshot()).toMatchObject({
      phase: 'online',
      serverRevision: '4',
    });
    if (result.source === 'core') result.gateway.dispose();
  });

  it('does not instantiate demo data when native credentials are unpaired', async () => {
    const plugin = nativePlugin({
      production: true,
      configuration: 'ready',
      credential: 'unpaired',
    });
    const demoFactory = vi.fn<() => OperationsGateway>(
      () => new MockOperationsGateway(),
    );

    const result = await bootstrapMobileGateway({
      native: true,
      bridge: createNativeCoreApiBridge(plugin),
      demoFactory,
    });

    expect(result).toEqual({
      kind: 'connection',
      status: {
        production: true,
        configuration: 'ready',
        credential: 'unpaired',
      },
    });
    expect(demoFactory).not.toHaveBeenCalled();
  });
});
