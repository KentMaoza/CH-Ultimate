import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { App } from '../../src/renderer/App';

describe('authoritative template error states', () => {
  it('shows a label save failure without discarding the local builder value', async () => {
    const gateway = new MockOperationsGateway();
    vi.spyOn(gateway, 'setLabelTemplate').mockRejectedValue(
      new Error('Template berubah di perangkat lain. Sinkronkan ulang.'),
    );
    render(<App gateway={gateway} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Template Label & Invoice' }),
    );

    fireEvent.change(screen.getByLabelText('Ukuran font'), {
      target: { value: '12' },
    });

    expect(
      await screen.findByText(
        'Template berubah di perangkat lain. Sinkronkan ulang.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Ukuran font')).toHaveValue(10);
  });

  it('shows an invoice save failure in the invoice builder', async () => {
    const gateway = new MockOperationsGateway();
    vi.spyOn(gateway, 'setInvoiceTemplate').mockRejectedValue(
      new Error('Template invoice gagal disimpan.'),
    );
    render(<App gateway={gateway} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Template Label & Invoice' }),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Invoice' }));

    fireEvent.change(screen.getByDisplayValue('BCA 1234567890'), {
      target: { value: 'BCA 123' },
    });

    expect(
      await screen.findByText('Template invoice gagal disimpan.'),
    ).toBeInTheDocument();
  });
});
