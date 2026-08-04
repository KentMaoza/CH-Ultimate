import { describe, expect, it } from 'vitest';

import { CORE_API_PATHS } from '../../src/gateway/core-api-types';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import type { NotaTransaction } from '../../src/domain/types';
import {
  LINE_ID,
  NOTA_ID,
  PAGE_ID,
  SKU_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  deferred,
  populatedBootstrap,
} from './core-gateway-test-support';

function readyGateway() {
  const transport = new ScriptedTransport();
  const storage = new MemoryStorage();
  const gateway = createCoreOperationsGateway(
    transport,
    storage,
    new TestClock(),
  );
  transport.enqueue({ status: 200, body: populatedBootstrap('1') });
  return { gateway, storage, transport };
}

function emptyPoll(revision: string) {
  return {
    status: 200,
    body: { serverRevision: revision, nextAfter: revision, changes: [] },
  };
}

function acknowledgement(
  entity: NotaTransaction,
  serverRevision: string,
  customerNameVersion: string,
  lineVersion: string,
) {
  return {
    status: 200,
    body: {
      serverRevision,
      entityVersion: lineVersion,
      entity,
      versionState: {
        notaId: NOTA_ID,
        fieldVersions: {
          customerName: customerNameVersion,
          customerPlace: '1',
          transactionDate: '1',
          payment: '1',
        },
        structureVersion: '1',
        lifecycleVersion: '1',
        pageVersions: { [PAGE_ID]: '1' },
        pageLifecycleVersions: { [PAGE_ID]: '1' },
        lineVersions: { [LINE_ID]: lineVersion },
      },
    },
  };
}

function withLineDescription(
  transaction: NotaTransaction,
  description: string,
): NotaTransaction {
  return {
    ...transaction,
    pages: transaction.pages.map((page) => ({
      ...page,
      lines: page.lines.map((line) =>
        line.id === LINE_ID ? { ...line, description } : line,
      ),
    })),
  };
}

describe('Core rapid Nota editing', () => {
  it('rebases a never-sent header edit after the earlier edit is acknowledged', async () => {
    const { gateway, storage, transport } = readyGateway();
    await gateway.initialize();
    const initial = gateway.getSnapshot().notaTransactions[0]!;
    const firstStarted = deferred<void>();
    const firstResponse = deferred<{ status: number; body: unknown }>();

    transport.enqueue(() => {
      firstStarted.resolve();
      return firstResponse.promise;
    });
    transport.enqueue(emptyPoll('2'));
    transport.enqueue((request) => {
      expect(request.body).toEqual({
        lifecycleVersion: '1',
        fields: {
          customerName: {
            version: '2',
            base: 'Amina',
            mine: 'Amina Baru',
          },
        },
      });
      return acknowledgement(
        { ...initial, customerName: 'Amina Baru' },
        '3',
        '3',
        '1',
      );
    });
    transport.enqueue(emptyPoll('3'));

    const first = gateway.updateNotaTransaction(NOTA_ID, {
      customerName: 'Amina',
    });
    await firstStarted.promise;
    const second = gateway.updateNotaTransaction(NOTA_ID, {
      customerName: 'Amina Baru',
    });
    firstResponse.resolve(
      acknowledgement(
        { ...initial, customerName: 'Amina' },
        '2',
        '2',
        '1',
      ),
    );

    await Promise.all([first, second]);

    expect(gateway.getSnapshot().notaTransactions[0]?.customerName).toBe(
      'Amina Baru',
    );
    expect(storage.saves.at(-1)?.outbox).toEqual([]);
    gateway.dispose();
  });

  it('rebases a never-sent line edit with the acknowledged line as its base', async () => {
    const { gateway, storage, transport } = readyGateway();
    await gateway.initialize();
    const initial = gateway.getSnapshot().notaTransactions[0]!;
    const firstStarted = deferred<void>();
    const firstResponse = deferred<{ status: number; body: unknown }>();

    transport.enqueue(() => {
      firstStarted.resolve();
      return firstResponse.promise;
    });
    transport.enqueue(emptyPoll('2'));
    transport.enqueue((request) => {
      expect(request.body).toEqual({
        lifecycleVersion: '1',
        pageVersion: '1',
        lineVersion: '2',
        base: {
          linePosition: 0,
          skuId: SKU_ID,
          description: 'Produk C',
          kind: '',
          quantity: 1,
          unit: 'pcs',
          pcsPrice: 25000,
          lsnPrice: 300000,
        },
        mine: {
          linePosition: 0,
          skuId: SKU_ID,
          description: 'Produk Core Baru',
          kind: '',
          quantity: 1,
          unit: 'pcs',
          pcsPrice: 25000,
          lsnPrice: 300000,
        },
      });
      return acknowledgement(
        withLineDescription(initial, 'Produk Core Baru'),
        '3',
        '1',
        '3',
      );
    });
    transport.enqueue(emptyPoll('3'));

    const first = gateway.updateNotaLine(NOTA_ID, PAGE_ID, LINE_ID, {
      description: 'Produk C',
    });
    await firstStarted.promise;
    const second = gateway.updateNotaLine(NOTA_ID, PAGE_ID, LINE_ID, {
      description: 'Produk Core Baru',
    });
    firstResponse.resolve(
      acknowledgement(
        withLineDescription(initial, 'Produk C'),
        '2',
        '1',
        '2',
      ),
    );

    await Promise.all([first, second]);

    expect(
      gateway.getSnapshot().notaTransactions[0]?.pages[0]?.lines[0]
        ?.description,
    ).toBe('Produk Core Baru');
    expect(storage.saves.at(-1)?.outbox).toEqual([]);
    gateway.dispose();
  });
});
