import { fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/renderer/App';

test('shows revenue cards and tracked empty-stock report preview', () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Laporan Omzet' }));
  expect(screen.getByText('OMZET HARI INI')).toBeInTheDocument();
  expect(screen.getByTestId('revenue-today')).toBeInTheDocument();
  expect(screen.getByTestId('revenue-month')).toBeInTheDocument();
  expect(screen.getByTestId('revenue-year')).toBeInTheDocument();
  expect(screen.getByLabelText('Tanggal mulai')).toBeInTheDocument();
  expect(screen.getByLabelText('Tanggal akhir')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Barang Kosong' }));
  expect(screen.getByText('ACC-204-SLV')).toBeInTheDocument();
  expect(screen.getByText('SNK-044')).toBeInTheDocument();
  expect(screen.queryByText('FSH-LINEN-WHT')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Pilih ACC-204-SLV'));
  expect(screen.getByTestId('empty-report-preview')).toHaveTextContent('ACC-204-SLV');
});

test('settings identifies the session data source and can reset it', async () => {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  expect(screen.getByText('Fixture sintetis')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset data demo' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Sesi demo direset');
});
