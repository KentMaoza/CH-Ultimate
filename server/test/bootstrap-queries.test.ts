import { describe, expect, it } from 'vitest';

import { readBootstrapCollections } from '../src/sync/mariadb-bootstrap-queries.js';
import type { ProtocolConnection } from '../src/sync/idempotency.js';

describe('readBootstrapCollections', () => {
  it('serializes reads on the single consistent-snapshot connection', async () => {
    let activeQueries = 0;
    let maximumConcurrentQueries = 0;
    const connection: ProtocolConnection = {
      beginTransaction: async () => undefined,
      commit: async () => undefined,
      rollback: async () => undefined,
      release: () => undefined,
      query: async <T>(): Promise<T> => {
        activeQueries += 1;
        maximumConcurrentQueries = Math.max(
          maximumConcurrentQueries,
          activeQueries,
        );
        await new Promise<void>((resolve) => setImmediate(resolve));
        activeQueries -= 1;
        return [] as T;
      },
    };

    await expect(readBootstrapCollections(connection)).resolves.toEqual({
      skuIdentifiers: [],
      skus: [],
      balances: [],
      notas: [],
      notaPages: [],
      notaLines: [],
      templates: [],
    });
    expect(maximumConcurrentQueries).toBe(1);
  });
});
