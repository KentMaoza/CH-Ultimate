import { fireEvent, render, screen } from '@testing-library/react';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { App } from '../../src/renderer/App';

function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
}

function openRevenue() {
  fireEvent.click(screen.getByRole('button', { name: 'Laporan Omzet' }));
}

function createPassword(password = 'rahasia') {
  openSettings();
  fireEvent.change(screen.getByLabelText('Password omzet baru'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Konfirmasi password omzet'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan password omzet' }));
}

test('hides every revenue metric until a password is configured and unlocked', () => {
  render(<App gateway={new MockOperationsGateway()} />);
  openRevenue();

  expect(screen.getByText('Password omzet belum diatur')).toBeInTheDocument();
  expect(screen.queryByText('OMZET HARI INI')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Atur password di Settings' }));
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Password omzet baru'), { target: { value: 'rahasia' } });
  fireEvent.change(screen.getByLabelText('Konfirmasi password omzet'), { target: { value: 'berbeda' } });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan password omzet' }));
  expect(screen.getByRole('status')).toHaveTextContent('Konfirmasi password tidak cocok');
  expect(screen.getByText('Password belum diatur')).toBeInTheDocument();
});

test('rejects a wrong password and keeps a successful unlock for the current session', () => {
  render(<App gateway={new MockOperationsGateway()} />);
  createPassword();
  expect(screen.getByRole('status')).toHaveTextContent('Password omzet disimpan');

  openRevenue();
  expect(screen.queryByText('OMZET HARI INI')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Password Laporan Omzet'), { target: { value: 'salah' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buka Laporan Omzet' }));
  expect(screen.getByRole('status')).toHaveTextContent('Password salah');
  expect(screen.queryByText('OMZET HARI INI')).not.toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Password Laporan Omzet'), { target: { value: 'rahasia' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buka Laporan Omzet' }));
  expect(screen.getByText('OMZET HARI INI')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'SKU Gudang' }));
  openRevenue();
  expect(screen.getByText('OMZET HARI INI')).toBeInTheDocument();
});

test('requires the current password before changing it and relocks revenue after success', () => {
  render(<App gateway={new MockOperationsGateway()} />);
  createPassword();
  openRevenue();
  fireEvent.change(screen.getByLabelText('Password Laporan Omzet'), { target: { value: 'rahasia' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buka Laporan Omzet' }));
  expect(screen.getByText('OMZET HARI INI')).toBeInTheDocument();

  openSettings();
  fireEvent.change(screen.getByLabelText('Password omzet saat ini'), { target: { value: 'salah' } });
  fireEvent.change(screen.getByLabelText('Password omzet baru'), { target: { value: 'baru' } });
  fireEvent.change(screen.getByLabelText('Konfirmasi password omzet'), { target: { value: 'baru' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ubah password omzet' }));
  expect(screen.getByRole('status')).toHaveTextContent('Password saat ini salah');

  fireEvent.change(screen.getByLabelText('Password omzet saat ini'), { target: { value: 'rahasia' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ubah password omzet' }));
  expect(screen.getByRole('status')).toHaveTextContent('Password omzet diubah');

  openRevenue();
  expect(screen.queryByText('OMZET HARI INI')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Password Laporan Omzet'), { target: { value: 'rahasia' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buka Laporan Omzet' }));
  expect(screen.getByRole('status')).toHaveTextContent('Password salah');
  fireEvent.change(screen.getByLabelText('Password Laporan Omzet'), { target: { value: 'baru' } });
  fireEvent.click(screen.getByRole('button', { name: 'Buka Laporan Omzet' }));
  expect(screen.getByText('OMZET HARI INI')).toBeInTheDocument();
});
