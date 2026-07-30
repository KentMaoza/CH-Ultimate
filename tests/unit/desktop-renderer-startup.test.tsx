import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  vi.resetModules();
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
});
