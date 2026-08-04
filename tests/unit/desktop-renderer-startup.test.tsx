import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

afterEach(() => {
  document.body.innerHTML = '';
  vi.doUnmock('../../src/renderer/App');
  vi.doUnmock('../../src/renderer/core-api-bootstrap');
  vi.restoreAllMocks();
  vi.resetModules();
  window.history.replaceState({}, '', '/');
});

describe('desktop renderer startup', () => {
  it('fails closed to the connection screen when the preload bridge is absent', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    Reflect.deleteProperty(window, 'chCore');

    await act(async () => {
      await import('../../src/renderer/main');
      await Promise.resolve();
    });

    expect(
      await screen.findByRole('heading', { name: 'Tidak terhubung' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Jembatan desktop CH Core tidak tersedia.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('DEMO DATA · SESSION ONLY')).not.toBeInTheDocument();
  });

  it('renders an actionable connection state when bootstrap rejects unexpectedly', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    vi.doMock('../../src/renderer/core-api-bootstrap', async () => {
      const actual = await vi.importActual<
        typeof import('../../src/renderer/core-api-bootstrap')
      >('../../src/renderer/core-api-bootstrap');
      return {
        ...actual,
        bootstrapDesktopGateway: vi
          .fn()
          .mockRejectedValue(new Error('startup exploded')),
      };
    });

    await act(async () => {
      await import('../../src/renderer/main');
      await Promise.resolve();
    });

    expect(
      await screen.findByRole('heading', { name: 'Tidak terhubung' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('CH Core tidak dapat dimulai. Coba lagi.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });

  it('selects an explicit test mock only for the locked E2E renderer marker', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState(
      {},
      '',
      '/?ch-ultimate-e2e-test-mock=1',
    );
    Reflect.deleteProperty(window, 'chCore');
    const gateway = new MockOperationsGateway();
    const bootstrapDesktopGateway = vi.fn().mockResolvedValue({
      kind: 'gateway',
      source: 'test-mock',
      gateway,
    });
    vi.doMock('../../src/renderer/core-api-bootstrap', async () => {
      const actual = await vi.importActual<
        typeof import('../../src/renderer/core-api-bootstrap')
      >('../../src/renderer/core-api-bootstrap');
      return { ...actual, bootstrapDesktopGateway };
    });

    await act(async () => {
      await import('../../src/renderer/main');
      await Promise.resolve();
    });

    expect(bootstrapDesktopGateway).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'test',
        allowTestMock: true,
        mockFactory: expect.any(Function),
      }),
    );
    expect(
      screen.getByText('DEMO DATA · SESSION ONLY'),
    ).toBeInTheDocument();
  });

  it('replaces a renderer crash with a retry that preserves the runtime boundary', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const gateway = new MockOperationsGateway();
    const bootstrapDesktopGateway = vi.fn().mockResolvedValue({
      kind: 'gateway',
      source: 'test-mock',
      gateway,
    });
    vi.doMock('../../src/renderer/core-api-bootstrap', async () => {
      const actual = await vi.importActual<
        typeof import('../../src/renderer/core-api-bootstrap')
      >('../../src/renderer/core-api-bootstrap');
      return { ...actual, bootstrapDesktopGateway };
    });
    vi.doMock('../../src/renderer/App', () => ({
      App: () => {
        throw new Error('renderer exploded');
      },
    }));

    await act(async () => {
      await import('../../src/renderer/main');
      await Promise.resolve();
    });

    expect(
      screen.getByRole('heading', { name: 'Aplikasi tidak dapat ditampilkan' }),
    ).toBeInTheDocument();
    const initialErrorCount = consoleError.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await waitFor(() => expect(bootstrapDesktopGateway).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(consoleError.mock.calls.length).toBeGreaterThan(initialErrorCount),
    );
  });
});
