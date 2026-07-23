import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import type { NotaVoicePlayer, NotaVoicePlayerOptions, NotaVoiceRequest } from '../../src/renderer/nota/nota-voice';

const voice = vi.hoisted(() => {
  const players: Array<NotaVoicePlayer & { speak: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn>; test: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = [];
  let onPlaybackError: ((error: unknown) => void) | undefined;
  return {
    players,
    get onPlaybackError() { return onPlaybackError; },
    create(options: NotaVoicePlayerOptions = {}) {
      onPlaybackError = options.onPlaybackError;
      const player = { speak: vi.fn(), cancel: vi.fn(), test: vi.fn(), dispose: vi.fn() };
      players.push(player);
      return player;
    },
    reset() { players.length = 0; onPlaybackError = undefined; },
  };
});

vi.mock('../../src/renderer/nota/nota-voice', () => ({ createNotaVoicePlayer: voice.create }));

function openNota(gateway = new MockOperationsGateway()) {
  const result = render(<App gateway={gateway} />);
  fireEvent.click(screen.getByRole('button', { name: 'Nota' }));
  return { gateway, ...result };
}

function commitQuantity(row: number, value: string) {
  const input = screen.getByLabelText(`Jumlah baris ${row}`);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function commitPrice(row: number, unit: 'PCS' | 'LSN', value: string) {
  const input = screen.getByLabelText(`Harga ${unit} baris ${row}`);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

beforeEach(() => voice.reset());

test('first active price commit and later quantity revision speak the complete PCS or LSN request', () => {
  const { gateway } = openNota();
  const player = voice.players[0]!;
  const page = gateway.getSnapshot().notaTransactions[0]!.pages[0]!;
  const row = page.lines[2]!;
  fireEvent.change(screen.getByLabelText('Nama barang baris 3'), { target: { value: 'Kopi' } });

  commitQuantity(3, '2');
  expect(player.speak).not.toHaveBeenCalled();
  commitPrice(3, 'PCS', '32000');
  fireEvent.click(screen.getByRole('button', { name: 'LSN baris 3' }));
  commitPrice(3, 'LSN', '384000');
  commitQuantity(3, '3');

  expect(player.speak).toHaveBeenNthCalledWith(1, { rowNumber: 3, suffix: 'A', quantity: 2, unit: 'pcs', price: 32_000 });
  expect(player.speak).toHaveBeenNthCalledWith(2, { rowNumber: 3, suffix: 'A', quantity: 2, unit: 'lsn', price: 384_000 });
  expect(player.speak).toHaveBeenNthCalledWith(3, { rowNumber: 3, suffix: 'A', quantity: 3, unit: 'lsn', price: 384_000 });
  expect(gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines[2]).toMatchObject({ id: row.id, description: 'Kopi', quantity: 3, unit: 'lsn' });
});

test('Harga PCS commit speaks while the line unit is LSN', () => {
  openNota();
  const player = voice.players[0]!;

  commitQuantity(3, '1');
  fireEvent.click(screen.getByRole('button', { name: 'LSN baris 3' }));
  commitPrice(3, 'PCS', '165000');

  expect(player.speak).toHaveBeenCalledOnce();
  expect(player.speak).toHaveBeenCalledWith({
    rowNumber: 3,
    suffix: 'A',
    quantity: 1,
    unit: 'lsn',
    price: 165_000,
  });
});

test('Enter, arrow, and click focus changes use one quantity blur commit each', () => {
  openNota();
  const player = voice.players[0]!;
  for (const row of [3, 4, 5]) {
    fireEvent.change(screen.getByLabelText(`Nama barang baris ${row}`), { target: { value: `Barang ${row}` } });
    commitPrice(row, 'PCS', '10000');
  }
  player.speak.mockClear();

  const enter = screen.getByLabelText('Jumlah baris 3');
  act(() => enter.focus()); fireEvent.change(enter, { target: { value: '2' } }); fireEvent.keyDown(enter, { key: 'Enter' });
  const arrow = screen.getByLabelText('Jumlah baris 4');
  act(() => arrow.focus()); fireEvent.change(arrow, { target: { value: '3' } }); fireEvent.keyDown(arrow, { key: 'ArrowDown' });
  const click = screen.getByLabelText('Jumlah baris 5');
  act(() => click.focus()); fireEvent.change(click, { target: { value: '4' } }); act(() => screen.getByRole('button', { name: 'PCS baris 5' }).focus()); fireEvent.click(screen.getByRole('button', { name: 'PCS baris 5' }));

  expect(player.speak).toHaveBeenCalledTimes(3);
  expect(player.speak).toHaveBeenNthCalledWith(1, { rowNumber: 3, suffix: 'A', quantity: 2, unit: 'pcs', price: 10_000 });
  expect(player.speak).toHaveBeenNthCalledWith(2, { rowNumber: 4, suffix: 'A', quantity: 3, unit: 'pcs', price: 10_000 });
  expect(player.speak).toHaveBeenNthCalledWith(3, { rowNumber: 5, suffix: 'A', quantity: 4, unit: 'pcs', price: 10_000 });
});

test('unchanged, zero, 49, invalid quantities, and out-of-range prices stay silent', () => {
  openNota();
  const player = voice.players[0]!;
  fireEvent.focus(screen.getByLabelText('Jumlah baris 1')); fireEvent.blur(screen.getByLabelText('Jumlah baris 1'));
  for (const [row, value] of [[3, '0'], [4, '49'], [5, 'x']] as const) {
    fireEvent.change(screen.getByLabelText(`Nama barang baris ${row}`), { target: { value: `Barang ${row}` } });
    commitPrice(row, 'PCS', '10000');
    commitQuantity(row, value);
  }
  fireEvent.change(screen.getByLabelText('Nama barang baris 7'), { target: { value: 'Mahal' } });
  commitQuantity(7, '2');
  commitPrice(7, 'PCS', '1000001');

  expect(player.speak).not.toHaveBeenCalled();
});

test('a valid quantity and price speak even when the SKU name is empty', () => {
  openNota();
  const player = voice.players[0]!;

  commitQuantity(6, '2');
  commitPrice(6, 'PCS', '10000');

  expect(player.speak).toHaveBeenCalledOnce();
  expect(player.speak).toHaveBeenCalledWith({
    rowNumber: 6,
    suffix: 'A',
    quantity: 2,
    unit: 'pcs',
    price: 10_000,
  });
});

test('formatting-only quantity changes stay silent', () => {
  openNota();
  const player = voice.players[0]!;
  fireEvent.change(screen.getByLabelText('Nama barang baris 3'), { target: { value: 'Kopi' } });
  commitPrice(3, 'PCS', '32000');
  commitQuantity(3, '2');
  player.speak.mockClear();

  const input = screen.getByLabelText('Jumlah baris 3');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '02' } });
  fireEvent.blur(input);

  expect(player.speak).not.toHaveBeenCalled();
});

test('Tab blur commits a changed quantity exactly once', () => {
  openNota();
  const player = voice.players[0]!;
  fireEvent.change(screen.getByLabelText('Nama barang baris 4'), { target: { value: 'Teh' } });
  commitPrice(4, 'PCS', '12000');
  const input = screen.getByLabelText('Jumlah baris 4');
  act(() => input.focus());
  fireEvent.change(input, { target: { value: '2' } });
  fireEvent.keyDown(input, { key: 'Tab' });
  act(() => screen.getByRole('button', { name: 'PCS baris 4' }).focus());

  expect(player.speak).toHaveBeenCalledTimes(1);
  expect(player.speak).toHaveBeenCalledWith({ rowNumber: 4, suffix: 'A', quantity: 2, unit: 'pcs', price: 12_000 });
});

test('deleting a row after changing quantity stays silent', () => {
  const { gateway } = openNota();
  const player = voice.players[0]!;
  const input = screen.getByLabelText('Jumlah baris 3');
  fireEvent.change(screen.getByLabelText('Nama barang baris 3'), { target: { value: 'Kopi' } });
  commitPrice(3, 'PCS', '32000');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: '2' } });
  const remove = within(screen.getByTestId('nota-grid-row-3')).getByRole('button', { name: 'Hapus' });
  fireEvent.mouseDown(remove);
  fireEvent.blur(input);
  fireEvent.click(remove);

  expect(player.speak).not.toHaveBeenCalled();
  expect(gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines[2]!.description).toBe('');
});

test.each(['Enter', ' ', 'click'])('deleting from keyboard or assistive %s activation stays silent', (activation) => {
  const { gateway } = openNota();
  const player = voice.players[0]!;
  const input = screen.getByLabelText('Jumlah baris 3');
  fireEvent.change(screen.getByLabelText('Nama barang baris 3'), { target: { value: 'Kopi' } });
  commitPrice(3, 'PCS', '32000');
  act(() => input.focus());
  fireEvent.change(input, { target: { value: '2' } });
  fireEvent.keyDown(input, { key: 'Tab' });
  const remove = within(screen.getByTestId('nota-grid-row-3')).getByRole('button', { name: 'Hapus' });
  act(() => remove.focus());
  if (activation !== 'click') fireEvent.keyDown(remove, { key: activation });
  fireEvent.click(remove);

  expect(player.speak).not.toHaveBeenCalled();
  expect(gateway.getSnapshot().notaTransactions[0]!.pages[0]!.lines[2]!.description).toBe('');
});

test('voice is active by default, toggling cancels and disables test, and unmount disposes', () => {
  const { unmount } = openNota();
  const player = voice.players[0]!;
  const toggle = screen.getByRole('button', { name: 'Suara aktif' });
  const testButton = screen.getByRole('button', { name: 'Tes suara' });

  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(testButton);
  expect(player.test).toHaveBeenCalledTimes(1);
  fireEvent.click(toggle);
  expect(player.cancel).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Suara nonaktif' })).toHaveAttribute('aria-pressed', 'false');
  expect(testButton).toBeDisabled();
  unmount();
  expect(player.dispose).toHaveBeenCalledTimes(1);
});

test('a valid quantity commit stays silent after voice is toggled off', () => {
  openNota();
  const player = voice.players[0]!;
  fireEvent.click(screen.getByRole('button', { name: 'Suara aktif' }));
  fireEvent.change(screen.getByLabelText('Nama barang baris 3'), { target: { value: 'Kopi' } });
  commitPrice(3, 'PCS', '32000');
  commitQuantity(3, '2');

  expect(player.speak).not.toHaveBeenCalled();
});

test('revising the active price speaks again while changing the inactive price stays silent', () => {
  openNota();
  const player = voice.players[0]!;
  fireEvent.change(screen.getByLabelText('Nama barang baris 3'), { target: { value: 'Kopi' } });
  commitQuantity(3, '2');
  commitPrice(3, 'PCS', '32000');
  commitPrice(3, 'LSN', '384000');
  commitPrice(3, 'PCS', '33000');

  expect(player.speak).toHaveBeenCalledTimes(2);
  expect(player.speak).toHaveBeenNthCalledWith(1, { rowNumber: 3, suffix: 'A', quantity: 2, unit: 'pcs', price: 32_000 });
  expect(player.speak).toHaveBeenNthCalledWith(2, { rowNumber: 3, suffix: 'A', quantity: 2, unit: 'pcs', price: 33_000 });
});

test('playback errors become a non-blocking Indonesian status message', () => {
  openNota();
  act(() => voice.onPlaybackError?.(new Error('speaker unavailable')));
  expect(screen.getByText('Suara nota tidak dapat diputar.')).toHaveAttribute('role', 'status');
});
