import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/renderer/App';

test('shows all operational modules and switches the active page', () => {
  render(<App />);
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
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Arsip Nota' }));
  expect(screen.getByRole('heading', { name: 'Arsip Nota', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Arsip' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Sampah' })).toBeInTheDocument();
});
