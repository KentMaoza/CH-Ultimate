import { fireEvent, render, screen } from '@testing-library/react';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import type { SyncPhase } from '../../src/gateway/operations-gateway-contract';
import { App } from '../../src/renderer/App';

function coreGatewayAt(phase: SyncPhase) {
  const gateway = new MockOperationsGateway();
  gateway.getSyncSnapshot = () => ({
    phase,
    trustedV2Bootstrap: true,
    serverRevision: '8',
    pendingCount: 0,
    conflictCount: 0,
    message:
      phase === 'upgrade-required'
        ? 'Invalid CH Core bootstrap envelope'
        : undefined,
  });
  return gateway;
}

test('requires an explicitly injected operations gateway', () => {
  expect(() => render(<App gateway={undefined as never} />)).toThrow(
    'OperationsGateway is required.',
  );
});

test('shows all operational modules and switches the active page', () => {
  render(<App gateway={new MockOperationsGateway()} />);
  expect(screen.getByRole('img', { name: 'CH Ultimate' })).toHaveAttribute(
    'src',
    '/src/renderer/assets/ch-ultimate-mark.svg',
  );
  for (const label of ['SKU Gudang', 'Cek Stok', 'Perubahan SKU', 'Rekomendasi Share', 'Ekspor Data', 'Buat SKU', 'Template Label & Invoice', 'Nota', 'Arsip Nota', 'Laporan Omzet', 'Barang Kosong', 'Settings']) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  }
  const navigation = screen.getByRole('navigation', { name: 'Modul CH Ultimate' });
  expect(navigation.querySelectorAll('.nav-glyph')).toHaveLength(12);
  expect(navigation.querySelectorAll('.nav-glyph svg')).toHaveLength(12);
  const navigationLabels = Array.from(navigation.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'));
  expect(navigationLabels.slice(0, 3)).toEqual(['SKU Gudang', 'Cek Stok', 'Perubahan SKU']);
  expect(screen.getByText('DEMO DATA · SESSION ONLY')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Template Label & Invoice' }));
  expect(screen.getByRole('heading', { name: 'Template Label & Invoice', level: 1 })).toBeInTheDocument();
});

test('opens Cek Stok as a first-class desktop module', () => {
  render(<App gateway={new MockOperationsGateway()} />);

  fireEvent.click(screen.getByRole('button', { name: 'Cek Stok' }));

  expect(screen.getByRole('heading', { name: 'Cek Stok', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Cek Stok' })).toBeInTheDocument();
});

test('opens Arsip Nota as a dedicated sidebar module', () => {
  render(<App gateway={new MockOperationsGateway()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Arsip Nota' }));
  expect(screen.getByRole('heading', { name: 'Arsip Nota', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Arsip' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Sampah' })).toBeInTheDocument();
});

test('shows synchronization status without stale demo labels for CH Core', () => {
  const gateway = coreGatewayAt('online');

  render(<App gateway={gateway} coreBacked />);

  expect(screen.getByText('Tersinkronisasi')).toBeInTheDocument();
  expect(screen.getByText('CH ULTIMATE / CH CORE')).toBeInTheDocument();
  expect(screen.queryByText('DEMO DATA · SESSION ONLY')).not.toBeInTheDocument();
  expect(screen.queryByText('Keluar / reload = data hilang')).not.toBeInTheDocument();
});

test.each([
  ['connecting', 'Menghubungkan'],
  ['offline', 'Offline'],
] as const)('does not present %s Core data as synchronized', (phase, label) => {
  render(<App gateway={coreGatewayAt(phase)} coreBacked />);

  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.queryByText(/Tersinkronisasi/i)).not.toBeInTheDocument();
});

test('blocks desktop business modules when Core needs an upgrade', () => {
  render(<App gateway={coreGatewayAt('upgrade-required')} coreBacked />);

  expect(
    screen.getByText(
      'Versi CH Core tidak kompatibel. Perbarui CH Core, lalu coba hubungkan kembali.',
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText('Invalid CH Core bootstrap envelope')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'SKU Gudang' })).not.toBeInTheDocument();
});

test('uses truthful CH Core copy across persisted desktop workflows', () => {
  const gateway = coreGatewayAt('online');
  render(<App gateway={gateway} coreBacked />);

  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByText('DATA CH CORE')).toBeInTheDocument();
  expect(screen.getByText('Tersimpan terpusat di NAS')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reset data demo' })).not.toBeInTheDocument();
  expect(screen.getByText(/Node API · MariaDB/)).toBeInTheDocument();
  expect(screen.getByText('CH Ultimate 0.2.2')).toBeInTheDocument();
  expect(
    screen.getByText(
      'Data bisnis disinkronkan melalui CH Core pada NAS lokal. Auto-update belum tersedia. Cetak dan Simpan PDF memakai dialog sistem.',
    ),
  ).toBeInTheDocument();
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
    screen.getByText('Tersimpan di CH Core · dialog sistem aktif'),
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
    screen.getByText('Session-only · dialog sistem aktif'),
  ).toBeInTheDocument();
});
