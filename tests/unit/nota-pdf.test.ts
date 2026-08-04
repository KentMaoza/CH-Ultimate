import { expect, test } from 'vitest';

import { createDraftNotaTransaction } from '../../src/domain/nota';
import { buildNotaDocumentPlan } from '../../src/domain/output-documents';
import { createInitialState } from '../../src/domain/operations';
import { createNotaPdfBlob } from '../../src/domain/nota-pdf';

test('mobile Nota PDF is generated from the shared document plan', async () => {
  const state = createInitialState();
  const transaction = createDraftNotaTransaction(1);
  transaction.pages[0]!.lines[0] = {
    id: 'line-1', description: 'Beras Hitam', kind: 'Pangan', quantity: 2,
    unit: 'pcs', pcsPrice: 42_000, lsnPrice: 504_000,
  };
  const plan = buildNotaDocumentPlan(transaction, state.invoiceTemplate, {
    kind: 'nota', scope: 'current', currentPageId: transaction.pages[0]!.id,
  });

  const blob = await createNotaPdfBlob(plan);
  expect(blob.type).toBe('application/pdf');
  expect(await blob.slice(0, 5).text()).toBe('%PDF-');
});
