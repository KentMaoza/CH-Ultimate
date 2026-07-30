import { describe, expect, it } from 'vitest';

import {
  decideLineMutation,
  lifecycleEditConflict,
  mergeHeaderFields,
  planEditableConflictOverride,
  parseNotaStoredJson,
  versionConflict,
} from '../src/nota/conflicts.js';

describe('Nota version merges and conflicts', () => {
  it('decodes scalar conflict values without requiring an object', () => {
    expect(parseNotaStoredJson('"Mine"')).toBe('Mine');
    expect(parseNotaStoredJson(Buffer.from('"Server"'))).toBe('Server');
  });

  it('merges independent header fields and increments only their versions', () => {
    const result = mergeHeaderFields(
      {
        customerName: 'Amelia',
        customerPlace: 'Makassar',
        transactionDate: '2026-07-30',
        payment: 'cash',
      },
      {
        customerName: '3',
        customerPlace: '8',
        transactionDate: '2',
        payment: '5',
      },
      {
        customerName: {
          version: '3',
          base: 'Amelia',
          mine: 'Amelia Baru',
        },
        payment: { version: '5', base: 'cash', mine: 'transfer' },
      },
    );

    expect(result).toEqual({
      kind: 'merged',
      header: {
        customerName: 'Amelia Baru',
        customerPlace: 'Makassar',
        transactionDate: '2026-07-30',
        payment: 'transfer',
      },
      versions: {
        customerName: '4',
        customerPlace: '8',
        transactionDate: '2',
        payment: '6',
      },
    });
  });

  it('returns base mine and server for a same-field conflict', () => {
    expect(
      mergeHeaderFields(
        { customerName: 'Server' },
        { customerName: '4' },
        {
          customerName: {
            version: '3',
            base: 'Base',
            mine: 'Mine',
          },
        },
      ),
    ).toEqual({
      kind: 'conflict',
      field: 'customerName',
      base: 'Base',
      mine: 'Mine',
      server: 'Server',
    });
  });

  it('accepts an exact line base and detects edit-versus-delete', () => {
    const base = {
      linePosition: 0,
      skuId: null,
      description: 'Kopi',
      kind: 'Minuman',
      quantity: 2,
      unit: 'pcs' as const,
      pcsPrice: 12000,
      lsnPrice: 144000,
    };
    expect(decideLineMutation('2', base, '2', base, { ...base, quantity: 3 }))
      .toEqual({ kind: 'apply' });
    expect(decideLineMutation('3', null, '2', base, { ...base, quantity: 3 }))
      .toEqual({
        kind: 'conflict',
        base,
        mine: { ...base, quantity: 3 },
        server: null,
      });
  });

  it('treats page structure and lifecycle drift as typed material', () => {
    expect(versionConflict('7', '6', { page: 'A' }, { edit: 'line' }, { page: 'B' }))
      .toEqual({
        kind: 'conflict',
        base: { page: 'A' },
        mine: { edit: 'line' },
        server: { page: 'B' },
      });
  });

  it.each(['header', 'line', 'delete-line', 'add-page', 'cancel-page'])(
    'returns typed lifecycle conflict material before rejecting %s edits',
    (action) => {
      expect(lifecycleEditConflict('completed', '8', '7', action)).toEqual({
        base: { lifecycleVersion: '7' },
        mine: { action },
        server: { status: 'completed', lifecycleVersion: '8' },
      });
    },
  );

  it('permits current draft and reopened edits only', () => {
    expect(lifecycleEditConflict('draft', '3', '3', 'header')).toBeNull();
    expect(lifecycleEditConflict('reopened', '4', '4', 'line')).toBeNull();
  });

  it.each([
    {
      status: 'completed',
      cancelledFromStatus: null,
      before: ['reopen'],
      after: ['complete'],
    },
    {
      status: 'cancelled',
      cancelledFromStatus: 'draft',
      before: ['restore'],
      after: ['cancel'],
    },
    {
      status: 'cancelled',
      cancelledFromStatus: 'reopened',
      before: ['restore'],
      after: ['cancel'],
    },
    {
      status: 'cancelled',
      cancelledFromStatus: 'completed',
      before: ['restore', 'reopen'],
      after: ['complete', 'cancel'],
    },
  ])(
    'plans an auditable editable override for $status from $cancelledFromStatus',
    ({ status, cancelledFromStatus, before, after }) => {
      expect(planEditableConflictOverride({
        status,
        cancelledFromStatus,
        completionDestination: 'finished',
      })).toEqual({
        before,
        after,
        completionDestination: 'finished',
      });
    },
  );
});
