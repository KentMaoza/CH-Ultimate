import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/renderer/App';

test('shows all operational modules and switches the active page', () => {
  render(<App />);
  for (const label of ['SKU Gudang', 'Buat SKU', 'Template Label & Invoice', 'Nota', 'Arsip Nota', 'Laporan Omzet', 'Barang Kosong', 'Settings']) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  }
  expect(screen.getByText('DEMO DATA · SESSION ONLY')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Template Label & Invoice' }));
  expect(screen.getByRole('heading', { name: 'Template Label & Invoice', level: 1 })).toBeInTheDocument();
});

test('opens Arsip Nota as a dedicated sidebar module', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Arsip Nota' }));
  expect(screen.getByRole('heading', { name: 'Arsip Nota', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Arsip' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Sampah' })).toBeInTheDocument();
});
