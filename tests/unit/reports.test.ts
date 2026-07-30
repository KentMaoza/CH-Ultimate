import { createInitialState } from '../../src/domain/operations';
import { buildEmptyStockItems, buildRevenueReport } from '../../src/domain/reports';
import { createDraftNotaTransaction } from '../../src/domain/nota';

test('revenue flattens active completed pages, includes ad-hoc totals, and excludes reopened and cancelled transactions', () => {
  const state = createInitialState();
  const completed = createDraftNotaTransaction(1);
  completed.status = 'completed';
  completed.completedAt = '2026-07-21T02:00:00.000Z';
  completed.pages[0]!.lines = [
    { id: 'l1', skuId: 'sku-1', description: 'Beras', kind: 'Pangan', quantity: 2, unit: 'pcs', pcsPrice: 42000, lsnPrice: 504000 },
    { id: 'l2', description: 'Jasa', kind: 'Layanan', quantity: 1, unit: 'pcs', pcsPrice: 10000, lsnPrice: 120000 },
  ];
  completed.pages.push({ id: 'page-b', suffix: 'B', status: 'active', lines: [
    { id: 'l3', skuId: 'sku-1', description: 'Beras', kind: 'Pangan', quantity: 1, unit: 'lsn', pcsPrice: 42000, lsnPrice: 504000 },
  ] });
  const reopened = { ...createDraftNotaTransaction(2), status: 'reopened' as const, completedAt: '2026-07-21T02:00:00.000Z' };
  reopened.pages[0]!.lines = [{ id: 'ignored', description: 'Tidak masuk', kind: '', quantity: 1, unit: 'pcs', pcsPrice: 999999, lsnPrice: 0 }];
  const cancelled = { ...createDraftNotaTransaction(3), status: 'cancelled' as const, completedAt: '2026-07-21T02:00:00.000Z' };
  cancelled.pages[0]!.lines = [{ id: 'ignored-too', description: 'Tidak masuk', kind: '', quantity: 1, unit: 'pcs', pcsPrice: 999999, lsnPrice: 0 }];
  const report = buildRevenueReport({ ...state, notaTransactions: [completed, reopened, cancelled] }, new Date('2026-07-21T12:00:00.000Z'));
  expect(report.today).toBe(598000);
  expect(report.bySku).toEqual([{ skuId: 'sku-1', name: 'Beras Hitam Premium 1 kg', units: 14, revenue: 588000 }]);
});

test('revenue date range uses the WITA completion date', () => {
  const state = createInitialState();
  const included = createDraftNotaTransaction(1);
  included.id = 'included';
  included.status = 'completed';
  included.completedAt = '2026-07-20T16:30:00.000Z';
  included.pages[0]!.lines = [{ id: 'l1', description: 'Jasa', kind: 'Layanan', quantity: 1, unit: 'pcs', pcsPrice: 50000, lsnPrice: 600000 }];
  const excluded = createDraftNotaTransaction(2);
  excluded.id = 'excluded';
  excluded.status = 'completed';
  excluded.completedAt = '2026-07-19T15:00:00.000Z';
  excluded.pages[0]!.lines = [{ id: 'l2', description: 'Jasa lama', kind: 'Layanan', quantity: 1, unit: 'pcs', pcsPrice: 90000, lsnPrice: 1080000 }];
  const report = buildRevenueReport(
    { ...state, notaTransactions: [included, excluded] },
    new Date('2026-07-21T12:00:00.000Z'),
    { from: '2026-07-21', to: '2026-07-21' },
  );
  expect(report.today).toBe(50000);
  expect(report.byDay).toEqual([{ date: '2026-07-21', revenue: 50000 }]);
});

test('Core revenue uses immutable posting rows instead of mutable Nota pages', () => {
  const state = createInitialState();
  const completed = createDraftNotaTransaction(1);
  completed.id = '11111111-1111-4111-8111-111111111111';
  completed.status = 'completed';
  completed.completedAt = '2026-07-21T02:00:00.000Z';
  completed.pages[0]!.lines = [{
    id: 'mutable',
    description: 'Nilai yang berubah',
    kind: '',
    quantity: 1,
    unit: 'pcs',
    pcsPrice: 999_999,
    lsnPrice: 0,
  }];
  const postedLine = {
    id: '22222222-2222-4222-8222-222222222222',
    skuId: 'sku-1',
    description: 'Beras saat posting',
    kind: 'Pangan',
    quantity: 2,
    unit: 'pcs' as const,
    pcsPrice: 21_000,
    lsnPrice: 252_000,
  };
  const report = buildRevenueReport({
    ...state,
    notaTransactions: [completed],
    notaPostings: [{
      id: '33333333-3333-4333-8333-333333333333',
      notaId: completed.id,
      postingKind: 'complete',
      amountRupiah: 42_000,
      lines: [postedLine],
      stockEffects: { 'sku-1': -2 },
      trackedLineIds: { [postedLine.id]: 'sku-1' },
      lifecycleVersion: '2',
      postedAt: completed.completedAt,
    }],
    revenuePostings: [{
      id: '44444444-4444-4444-8444-444444444444',
      notaId: completed.id,
      notaPostingId: '33333333-3333-4333-8333-333333333333',
      amountRupiah: 42_000,
      postingKind: 'complete',
      postedAt: completed.completedAt,
    }],
  }, new Date('2026-07-21T12:00:00.000Z'));

  expect(report.today).toBe(42_000);
  expect(report.bySku).toEqual([{
    skuId: 'sku-1',
    name: 'Beras Hitam Premium 1 kg',
    units: 2,
    revenue: 42_000,
  }]);
});

test('empty-stock report includes only tracked zero and negative balances', () => {
  const items = buildEmptyStockItems(createInitialState());
  expect(items.map((item) => item.sku.skuNumber)).toEqual(['ACC-204-SLV', 'SNK-044']);
});

test('low-stock report can include tracked balances up to a requested threshold', () => {
  const state = createInitialState();
  const adjusted = {
    ...state,
    skus: state.skus.map((sku) => sku.id === 'sku-1' ? { ...sku, stock: 1 } : sku.id === 'sku-4' ? { ...sku, stock: 2 } : sku),
  };
  const items = buildEmptyStockItems(adjusted, 2);
  expect(items.map((item) => item.sku.skuNumber)).toEqual(['ACC-204-SLV', 'SNK-044', 'BRS-108-BLK', 'MNM-002']);
});
