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
  expect(screen.getByRole('img', { name: 'CH Ultimate' })).toHaveAttribute(
    'src',
    '/brand/ch-ultimate-mark.svg',
  );
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

test('uses truthful CH Core copy across persisted desktop workflows', () => {
  const gateway = new MockOperationsGateway();
  render(<App gateway={gateway} coreBacked />);

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByText('DATA CH CORE')).toBeInTheDocument();
  expect(screen.getByText('Tersimpan terpusat di NAS')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reset data demo' })).not.toBeInTheDocument();
  expect(screen.getByText(/Node API · MariaDB/)).toBeInTheDocument();
  expect(screen.getByText('CH Ultimate 0.1.3')).toBeInTheDocument();
  expect(screen.getByText('AKSES LOKAL LAPORAN OMZET')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Buat SKU' }));
  expect(screen.getByText('SKU akan disimpan ke CH Core dan disinkronkan ke perangkat lain.')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Perubahan SKU' }));
  expect(screen.getByText('Catatan terpusat harga dan jumlah stok · WITA')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Laporan Omzet' }));
  expect(screen.getByText('AKSES LOKAL LAPORAN OMZET')).toBeInTheDocument();
  expect(screen.queryByText(/Password hilang saat aplikasi direload/)).not.toBeInTheDocument();

  fireEvent.click(
    screen.getByRole('button', { name: 'Template Label & Invoice' }),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Invoice' }));
  expect(
    screen.getByText('Tersimpan di CH Core · output produksi belum aktif'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Session-only/)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Barang Kosong' }));
  expect(screen.getByTestId('empty-report-preview')).toHaveTextContent(
    'Data CH Core · Export PDF belum aktif',
  );
  expect(screen.getByTestId('empty-report-preview')).not.toHaveTextContent(
    'Demo preview',
  );

  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  expect(screen.getByText('CH CORE · TERSINKRONISASI')).toBeInTheDocument();
  expect(screen.queryByText('DEMO DATA · SESSION ONLY')).not.toBeInTheDocument();
});

test('demo invoice preview remains explicitly session-only', () => {
  render(<App gateway={new MockOperationsGateway()} />);

  fireEvent.click(
    screen.getByRole('button', { name: 'Template Label & Invoice' }),
  );
  fireEvent.click(screen.getByRole('tab', { name: 'Invoice' }));

  expect(
    screen.getByText('Session-only · output produksi belum aktif'),
  ).toBeInTheDocument();
});
