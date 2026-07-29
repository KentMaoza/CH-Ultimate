import { describe, expect, it, vi } from 'vitest';

import type { ChCoreBridge } from '../../src/electron/core-bridge-contract';
import type { OperationsGateway } from '../../src/gateway/operations-gateway';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { bootstrapDesktopGateway } from '../../src/renderer/core-api-bootstrap';

function bridge(
  status: Awaited<ReturnType<ChCoreBridge['credentialStatus']>>,
): ChCoreBridge {
  return {
    request: vi.fn(),
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
});
