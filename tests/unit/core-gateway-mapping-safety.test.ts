import { describe, expect, it } from 'vitest';

import {
  CoreApiSchemaError,
  parseCoreBootstrap,
  type CoreChange,
} from '../../src/gateway/core-api-types';
import {
  mapCoreBootstrapToDemoState,
} from '../../src/gateway/core-bootstrap-mapping';
import {
  applyCoreChange,
  CoreChangeRequiresBootstrapError,
} from '../../src/gateway/core-change-application';
import { asCoreJson } from '../../src/gateway/core-optimistic-state';
import {
  CORE_LABEL_TEMPLATE_DEFAULT,
} from '../../src/gateway/core-presentation-defaults';
import {
  IDENTIFIER_ID,
  LINE_ID,
  NOTA_ID,
  PAGE_ID,
  SKU_ID,
  TEMPLATE_ID,
  bootstrapBody,
  populatedBootstrap,
} from './core-gateway-test-support';

const OTHER_SKU_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_NOTA_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_PAGE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SECOND_TEMPLATE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function mappedState() {
  return mapCoreBootstrapToDemoState(
    parseCoreBootstrap(populatedBootstrap('1')),
  );
}

function change(
  entityType: string,
  entityId: string,
  operation: string,
  payload: Record<string, unknown>,
): CoreChange {
  return {
    revision: '2',
    entityType,
    entityId,
    operation,
    payload: asCoreJson(payload),
    createdAt: '2026-07-29T01:00:02.000Z',
  };
}

function templateRow(
  id: string,
  archivedAt: string | null = null,
): Record<string, unknown> {
  return {
    id,
    templateKind: 'label',
    name: 'Label CH',
    definition: CORE_LABEL_TEMPLATE_DEFAULT,
    rowVersion: '1',
    archivedAt,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  };
}

describe('Core gateway mapping safety', () => {
  it.each([
    {
      relation: 'identifier without SKU',
      overrides: {
        skuIdentifiers: [
          {
            ...populatedBootstrap().skuIdentifiers[0]!,
            skuId: OTHER_SKU_ID,
          },
        ],
      },
    },
    {
      relation: 'balance without SKU',
      overrides: {
        balances: [
          {
            ...populatedBootstrap().balances[0]!,
            skuId: OTHER_SKU_ID,
          },
        ],
      },
    },
    {
      relation: 'page without Nota',
      overrides: {
        notaPages: [
          {
            ...populatedBootstrap().notaPages[0]!,
            notaId: OTHER_NOTA_ID,
          },
        ],
      },
    },
    {
      relation: 'line whose Nota does not own its page',
      overrides: {
        notaLines: [
          {
            ...populatedBootstrap().notaLines[0]!,
            notaId: OTHER_NOTA_ID,
          },
        ],
      },
    },
  ])('rejects bootstrap relation: $relation', ({ overrides }) => {
    const bootstrap = parseCoreBootstrap(
      populatedBootstrap('1', overrides),
    );

    expect(() => mapCoreBootstrapToDemoState(bootstrap)).toThrow(
      CoreApiSchemaError,
    );
  });

  it.each([
    {
      relation: 'identifier without SKU',
      remote: change('sku_identifier', IDENTIFIER_ID, 'upsert', {
        ...populatedBootstrap().skuIdentifiers[0]!,
        skuId: OTHER_SKU_ID,
      }),
    },
    {
      relation: 'balance without SKU',
      remote: change('balance', OTHER_SKU_ID, 'upsert', {
        ...populatedBootstrap().balances[0]!,
        skuId: OTHER_SKU_ID,
      }),
    },
    {
      relation: 'page without Nota',
      remote: change('nota_page', PAGE_ID, 'upsert', {
        ...populatedBootstrap().notaPages[0]!,
        notaId: OTHER_NOTA_ID,
      }),
    },
    {
      relation: 'line whose Nota does not own its page',
      remote: change('nota_line', LINE_ID, 'upsert', {
        ...populatedBootstrap().notaLines[0]!,
        notaId: OTHER_NOTA_ID,
      }),
    },
  ])('requires bootstrap for changed $relation', ({ remote }) => {
    expect(() => applyCoreChange(mappedState(), remote)).toThrow(
      CoreChangeRequiresBootstrapError,
    );
  });

  it('fails closed when bootstrap has multiple active templates of one kind', () => {
    const bootstrap = parseCoreBootstrap(
      bootstrapBody('1', {
        templates: [
          templateRow(TEMPLATE_ID),
          templateRow(SECOND_TEMPLATE_ID),
        ],
      }),
    );

    expect(() => mapCoreBootstrapToDemoState(bootstrap)).toThrow(
      CoreApiSchemaError,
    );
  });

  it.each([
    { name: 'active template', archivedAt: null },
    {
      name: 'archived template',
      archivedAt: '2026-07-29T01:00:00.000Z',
    },
  ])('requires bootstrap for an incremental $name change', ({ archivedAt }) => {
    const remote = change(
      'template',
      TEMPLATE_ID,
      'upsert',
      templateRow(TEMPLATE_ID, archivedAt),
    );

    expect(() => applyCoreChange(mappedState(), remote)).toThrow(
      CoreChangeRequiresBootstrapError,
    );
  });

  it('uses no seeded bank account when CH Core has no invoice template', () => {
    const state = mapCoreBootstrapToDemoState(
      parseCoreBootstrap(bootstrapBody('0')),
    );

    expect(state.invoiceTemplate.bankAccount).toBe('');
  });

  it('rejects derived dozen pricing outside the safe integer range', () => {
    const line = {
      ...populatedBootstrap().notaLines[0]!,
      unitPriceRupiah: String(Number.MAX_SAFE_INTEGER),
    };
    const bootstrap = parseCoreBootstrap(
      populatedBootstrap('1', { notaLines: [line] }),
    );

    expect(() => mapCoreBootstrapToDemoState(bootstrap)).toThrow(
      CoreApiSchemaError,
    );
  });

  it('keeps numeric page-position order when suffixes pass Z', () => {
    const pageZero = populatedBootstrap().notaPages[0]!;
    const pageTwentySix = {
      ...pageZero,
      id: OTHER_PAGE_ID,
      pagePosition: 26,
    };
    const state = mapCoreBootstrapToDemoState(
      parseCoreBootstrap(
        populatedBootstrap('1', {
          notaPages: [pageZero, pageTwentySix],
          notaLines: [],
        }),
      ),
    );
    const remote = change('nota_page', SECOND_TEMPLATE_ID, 'upsert', {
      ...pageZero,
      id: SECOND_TEMPLATE_ID,
      pagePosition: 1,
    });

    const next = applyCoreChange(state, remote);

    expect(next.notaTransactions[0]?.pages.map((page) => page.suffix)).toEqual(
      ['A', 'B', 'AA'],
    );
  });
});
