import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

import { MobileNotaView } from '../../mobile/components/MobileNotaView';
import { createMobileDemoState } from '../../src/domain/mobile-demo-state';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';

vi.mock('../../src/renderer/nota/nota-voice', () => ({
  createNotaVoicePlayer: () => ({
    speak: vi.fn(),
    cancel: vi.fn(),
    dispose: vi.fn(),
    test: vi.fn(),
  }),
}));

afterEach(cleanup);

const scanner = { scan: async () => null };

class RejectingEditGateway extends MockOperationsGateway {
  override async updateNotaTransaction(): Promise<void> {
    throw new Error('Perubahan pelanggan gagal disimpan.');
  }
}

class RejectingCreateGateway extends MockOperationsGateway {
  override async createNotaTransaction(): Promise<never> {
    throw new Error('Nota baru gagal dibuat.');
  }
}

test('mobile Nota shows a save error instead of dropping a rejected header edit', async () => {
  const gateway = new RejectingEditGateway(createMobileDemoState);
  render(<MobileNotaView coreBacked gateway={gateway} scanner={scanner} />);

  fireEvent.change(await screen.findByLabelText('Pelanggan'), {
    target: { value: 'Amelia' },
  });

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Perubahan pelanggan gagal disimpan.',
  );
});

test('mobile Nota explains when its initial transaction cannot be created', async () => {
  const gateway = new RejectingCreateGateway(() => ({
    ...createMobileDemoState(),
    notaTransactions: [],
  }));
  render(<MobileNotaView coreBacked gateway={gateway} scanner={scanner} />);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Nota baru gagal dibuat.',
  );
});
