import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChCoreBridge } from '../../src/electron/core-bridge-contract';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { App } from '../../src/renderer/App';

function bridge(): ChCoreBridge {
  return {
    request: vi.fn(),
    installationId: vi.fn(),
    credentialStatus: vi.fn(),
    enrollOwner: vi.fn(),
    claimPairing: vi.fn(),
    completePairing: vi.fn(),
    createOwnerPairing: vi.fn(),
    getOwnerPairing: vi.fn(),
    approveOwnerPairing: vi.fn(),
    rotateToken: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'chCore');
});

describe('Settings owner pairing integration', () => {
  it('shows the current v0.2.7 desktop release version', () => {
    render(<App gateway={new MockOperationsGateway()} coreBacked />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'CH Ultimate 0.2.7' })).toBeVisible();
    expect(screen.queryByText('CH Ultimate 0.2.0')).not.toBeInTheDocument();
  });

  it('shows pairing controls only in the CH Core-backed application', () => {
    Object.defineProperty(window, 'chCore', {
      configurable: true,
      value: bridge(),
    });
    render(<App gateway={new MockOperationsGateway()} coreBacked />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(
      screen.getByRole('button', { name: 'Buat kode pemasangan' }),
    ).toBeVisible();
    expect(screen.getByText('PEMASANGAN PERANGKAT')).toBeVisible();
  });

  it('does not add CH Core pairing controls to the demo application', () => {
    Object.defineProperty(window, 'chCore', {
      configurable: true,
      value: bridge(),
    });
    render(<App gateway={new MockOperationsGateway()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(
      screen.queryByRole('button', { name: 'Buat kode pemasangan' }),
    ).not.toBeInTheDocument();
  });
});
