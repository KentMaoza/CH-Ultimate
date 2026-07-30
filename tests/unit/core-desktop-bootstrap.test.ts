import { describe, expect, it, vi } from 'vitest';

import type { ChCoreBridge } from '../../src/electron/core-bridge-contract';
import type { OperationsGateway } from '../../src/gateway/operations-gateway';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { bootstrapDesktopGateway } from '../../src/renderer/core-api-bootstrap';
import {
  MemoryStorage,
  TestClock,
  populatedBootstrap,
} from './core-gateway-test-support';

const INSTALLATION_ID = '10101010-1010-4010-8010-101010101010';

function bridge(
  status: Awaited<ReturnType<ChCoreBridge['credentialStatus']>>,
): ChCoreBridge {
  return {
    request: vi.fn(),
    installationId: vi.fn().mockResolvedValue(INSTALLATION_ID),
    credentialStatus: vi.fn().mockResolvedValue(status),
    enrollOwner: vi.fn(),
    claimPairing: vi.fn(),
    completePairing: vi.fn(),
    rotateToken: vi.fn(),
  };
}

describe('desktop CH Core bootstrap', () => {
  it('never creates a mock when the production bridge is unpaired', async () => {
    const mockFactory = vi.fn<() => OperationsGateway>(
      () => new MockOperationsGateway(),
    );
    const chCore = bridge({
      production: true,
      configuration: 'ready',
      credential: 'unpaired',
    });

    const result = await bootstrapDesktopGateway({
      bridge: chCore,
      mode: 'test',
      allowTestMock: true,
      mockFactory,
    });

    expect(result).toEqual({
      kind: 'connection',
      status: {
        production: true,
        configuration: 'ready',
        credential: 'unpaired',
      },
    });
    expect(mockFactory).not.toHaveBeenCalled();
  });

  it('fails closed without a production bridge even when a mock factory exists', async () => {
    const mockFactory = vi.fn<() => OperationsGateway>(
      () => new MockOperationsGateway(),
    );

    const result = await bootstrapDesktopGateway({
      mode: 'production',
      allowTestMock: true,
      mockFactory,
    });

    expect(result).toMatchObject({
      kind: 'connection',
      status: {
        production: true,
        configuration: 'missing',
        credential: 'unpaired',
      },
    });
    expect(mockFactory).not.toHaveBeenCalled();
  });

  it('creates a mock only through the explicit test-mode path', async () => {
    const gateway = new MockOperationsGateway();
    const mockFactory = vi.fn<() => OperationsGateway>(() => gateway);

    const result = await bootstrapDesktopGateway({
      mode: 'test',
      allowTestMock: true,
      mockFactory,
    });

    expect(result).toEqual({
      kind: 'gateway',
      source: 'test-mock',
      gateway,
    });
    expect(mockFactory).toHaveBeenCalledTimes(1);
  });

  it('creates the Core gateway for a paired production bridge', async () => {
    const chCore = bridge({
      production: true,
      configuration: 'ready',
      credential: 'paired',
      deviceId: '11111111-1111-4111-8111-111111111111',
    });
    chCore.request = vi.fn().mockResolvedValue({
      status: 200,
      body: populatedBootstrap('4'),
    });

    const result = await bootstrapDesktopGateway({
      bridge: chCore,
      mode: 'production',
      storage: new MemoryStorage(),
      clock: new TestClock(),
    });

    expect(result.kind).toBe('gateway');
    if (result.kind !== 'gateway') return;
    expect(result.source).toBe('core');
    expect(chCore.request).toHaveBeenCalledWith({
      method: 'GET',
      path: '/v1/bootstrap',
    });
    expect(chCore.installationId).toHaveBeenCalled();
    expect(result.gateway.getSyncSnapshot()).toMatchObject({
      phase: 'online',
      serverRevision: '4',
    });
    if (result.source === 'core') result.gateway.dispose();
  });

  it('disposes a partially initialized Core gateway and returns an actionable state', async () => {
    const chCore = bridge({
      production: true,
      configuration: 'ready',
      credential: 'paired',
      deviceId: '11111111-1111-4111-8111-111111111111',
    });
    const clock = new TestClock();
    const storage = {
      load: vi.fn().mockRejectedValue(new Error('IndexedDB gagal')),
      save: vi.fn(),
    };

    const result = await bootstrapDesktopGateway({
      bridge: chCore,
      mode: 'production',
      storage,
      clock,
    });

    expect(result).toEqual({
      kind: 'connection',
      status: {
        production: true,
        configuration: 'ready',
        credential: 'paired',
        deviceId: '11111111-1111-4111-8111-111111111111',
        message: 'CH Core tidak dapat dimulai. Coba lagi.',
      },
    });
    expect(clock.pendingDelays()).toEqual([]);
    expect(clock.resumeListenerCount()).toBe(0);
    expect(chCore.request).not.toHaveBeenCalled();
  });
});
