import { createNotaUndoHistory } from '../../src/renderer/nota/nota-undo-history';

test('coalesces consecutive changes to the same field while keeping the earliest undo action', async () => {
  const calls: string[] = [];
  const history = createNotaUndoHistory();
  history.push({ transactionId: 'tx-1', key: 'customerName', createdAt: 100, undo: async () => { calls.push('Amelia'); } });
  history.push({ transactionId: 'tx-1', key: 'customerName', createdAt: 800, undo: async () => { calls.push('Amel'); } });

  await history.pop('tx-1')?.undo();

  expect(calls).toEqual(['Amelia']);
  expect(history.has('tx-1')).toBe(false);
});

test('starts a new undo step after 750 ms and isolates transactions', async () => {
  const calls: string[] = [];
  const history = createNotaUndoHistory();
  history.push({ transactionId: 'tx-1', key: 'customerName', createdAt: 100, undo: async () => { calls.push('first'); } });
  history.push({ transactionId: 'tx-1', key: 'customerName', createdAt: 851, undo: async () => { calls.push('second'); } });
  history.push({ transactionId: 'tx-2', key: 'customerName', createdAt: 900, undo: async () => { calls.push('other'); } });

  await history.pop('tx-1')?.undo();
  await history.pop('tx-1')?.undo();
  await history.pop('tx-2')?.undo();

  expect(calls).toEqual(['second', 'first', 'other']);
});

test('keeps only the latest fifty undo steps per transaction', () => {
  const history = createNotaUndoHistory();
  for (let index = 0; index < 51; index += 1) {
    history.push({ transactionId: 'tx-1', key: `field-${index}`, createdAt: index, undo: async () => {} });
  }

  const keys: string[] = [];
  while (history.has('tx-1')) keys.push(history.pop('tx-1')!.key);
  expect(keys).toHaveLength(50);
  expect(keys).not.toContain('field-0');
  expect(keys[0]).toBe('field-50');
});
