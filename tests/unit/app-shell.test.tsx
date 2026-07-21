import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/renderer/App';

test('shows all operational modules and switches the active page', () => {
  render(<App />);
  for (const label of ['SKU Gudang', 'Buat SKU', 'Label', 'Nota', 'Laporan Omzet', 'Barang Kosong', 'Settings']) {
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  }
  expect(screen.getByText('DEMO DATA · SESSION ONLY')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Label' }));
  expect(screen.getByRole('heading', { name: 'Label', level: 1 })).toBeInTheDocument();
});
