import { fireEvent, render, screen } from '@testing-library/react';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { App } from '../../src/renderer/App';

test('requires an explicitly injected operations gateway', () => {
  expect(() => render(<App gateway={undefined as never} />)).toThrow(
    'OperationsGateway is required.',
  );
});

test('shows all operational modules and switches the active page', () => {
  render(<App gateway={new MockOperationsGateway()} />);
  for (const label of ['SKU Gudang', 'Perubahan SKU', 'Rekomendasi Share', 'Buat SKU', 'Template Label & Invoice', 'Nota', 'Arsip Nota', 'Laporan Omzet', 'Barang Kosong', 'Settings']) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  }
  const navigation = screen.getByRole('navigation', { name: 'Modul CH Ultimate' });
  expect(navigation.querySelectorAll('.nav-glyph')).toHaveLength(10);
  expect(navigation.querySelectorAll('.nav-glyph svg')).toHaveLength(10);
  const navigationLabels = Array.from(navigation.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'));
  expect(navigationLabels.slice(0, 3)).toEqual(['SKU Gudang', 'Perubahan SKU', 'Rekomendasi Share']);
  expect(screen.getByText('DEMO DATA · SESSION ONLY')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Template Label & Invoice' }));
  expect(screen.getByRole('heading', { name: 'Template Label & Invoice', level: 1 })).toBeInTheDocument();
});

test('opens Arsip Nota as a dedicated sidebar module', () => {
  render(<App gateway={new MockOperationsGateway()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Arsip Nota' }));
  expect(screen.getByRole('heading', { name: 'Arsip Nota', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Arsip' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Sampah' })).toBeInTheDocument();
});

test('shows synchronization status without stale demo labels for CH Core', () => {
  const gateway = new MockOperationsGateway();
  gateway.getSyncSnapshot = () => ({
    phase: 'online',
    serverRevision: '8',
    pendingCount: 0,
    conflictCount: 0,
  });

  render(<App gateway={gateway} coreBacked />);

  expect(screen.getByText('Terhubung')).toBeInTheDocument();
  expect(screen.getByText('CH ULTIMATE / CH CORE')).toBeInTheDocument();
  expect(screen.queryByText('DEMO DATA · SESSION ONLY')).not.toBeInTheDocument();
  expect(screen.queryByText('Keluar / reload = data hilang')).not.toBeInTheDocument();
});
