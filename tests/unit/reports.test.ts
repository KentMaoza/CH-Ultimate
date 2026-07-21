import { createInitialState } from '../../src/domain/operations';
import { buildEmptyStockItems, buildRevenueReport } from '../../src/domain/reports';
import { createDraftNota } from '../../src/domain/nota';

test('revenue includes ad-hoc totals but SKU trends only include linked lines', () => {
  const state = createInitialState();
  const nota = createDraftNota(1);
  nota.status = 'completed';
  nota.completedAt = '2026-07-21T02:00:00.000Z';
  nota.lines = [
    { id: 'l1', skuId: 'sku-1', description: 'Beras', quantity: 2, unit: 'pcs', unitPrice: 42000 },
    { id: 'l2', description: 'Jasa', quantity: 1, unit: 'pcs', unitPrice: 10000 },
  ];
  const report = buildRevenueReport({ ...state, notas: [nota] }, new Date('2026-07-21T12:00:00.000Z'));
  expect(report.today).toBe(94000);
  expect(report.bySku).toEqual([{ skuId: 'sku-1', name: 'Beras Hitam Premium 1 kg', units: 2, revenue: 84000 }]);
});

test('revenue date range uses the WITA completion date', () => {
  const state = createInitialState();
  const included = createDraftNota(1);
  included.id = 'included';
  included.status = 'completed';
  included.completedAt = '2026-07-20T16:30:00.000Z';
  included.lines = [{ id: 'l1', description: 'Jasa', quantity: 1, unit: 'pcs', unitPrice: 50000 }];
  const excluded = createDraftNota(2);
  excluded.id = 'excluded';
  excluded.status = 'completed';
  excluded.completedAt = '2026-07-19T15:00:00.000Z';
  excluded.lines = [{ id: 'l2', description: 'Jasa lama', quantity: 1, unit: 'pcs', unitPrice: 90000 }];
  const report = buildRevenueReport(
    { ...state, notas: [included, excluded] },
    new Date('2026-07-21T12:00:00.000Z'),
    { from: '2026-07-21', to: '2026-07-21' },
  );
  expect(report.today).toBe(50000);
  expect(report.byDay).toEqual([{ date: '2026-07-21', revenue: 50000 }]);
});

test('empty-stock report includes only tracked zero and negative balances', () => {
  const items = buildEmptyStockItems(createInitialState());
  expect(items.map((item) => item.sku.skuNumber)).toEqual(['ACC-204-SLV', 'SNK-044']);
});
