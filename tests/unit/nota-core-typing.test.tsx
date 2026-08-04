import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { NotaTransaction } from '../../src/domain/types';
import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import { OperationsProvider } from '../../src/renderer/operations-context';
import { NotaWorkspace } from '../../src/renderer/nota/NotaWorkspace';
import {
  LINE_ID,
  NOTA_ID,
  PAGE_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  deferred,
  populatedBootstrap,
} from './core-gateway-test-support';

afterEach(cleanup);

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

function renderCoreNota() {
  const transport = new ScriptedTransport();
  const storage = new MemoryStorage();
  const gateway = createCoreOperationsGateway(
    transport,
    storage,
    new TestClock(),
  );
  transport.enqueue({ status: 200, body: populatedBootstrap('1') });
  return gateway.initialize().then(() => {
    render(
      <OperationsProvider gateway={gateway}>
        <NotaWorkspace coreBacked onBack={() => undefined} />
      </OperationsProvider>,
    );
    return { gateway, storage, transport };
  });
}

describe('Core-backed Nota typing', () => {
  it('keeps the customer field focused and enabled while characters wait for the LAN', async () => {
    const { gateway, storage, transport } = await renderCoreNota();
    const initial = gateway.getSnapshot().notaTransactions[0]!;
    const firstStarted = deferred<void>();
    const firstResponse = deferred<{ status: number; body: unknown }>();
    transport.enqueue(() => {
      firstStarted.resolve();
      return firstResponse.promise;
    });
    transport.enqueue(emptyPoll('2'));
    transport.enqueue(
      acknowledgement({ ...initial, customerName: 'Ami' }, '3', '3', '1'),
    );
    transport.enqueue(emptyPoll('3'));

    const customer = screen.getByLabelText('Pelanggan');
    customer.focus();
    await act(async () => {
      fireEvent.change(customer, { target: { value: 'a' } });
      await firstStarted.promise;
    });

    expect(customer).toHaveFocus();
    expect(customer).not.toBeDisabled();

    fireEvent.change(customer, { target: { value: 'am' } });
    fireEvent.change(customer, { target: { value: 'ami' } });
    await act(async () => {
      firstResponse.resolve(
        acknowledgement({ ...initial, customerName: 'A' }, '2', '2', '1'),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(storage.saves.at(-1)?.outbox).toEqual([]));
    expect(customer).toHaveValue('Ami');
    expect(customer).toHaveFocus();
    gateway.dispose();
  });

  it('keeps a line description focused and enabled during an in-flight edit', async () => {
    const { gateway, storage, transport } = await renderCoreNota();
    const initial = gateway.getSnapshot().notaTransactions[0]!;
    const firstStarted = deferred<void>();
    const firstResponse = deferred<{ status: number; body: unknown }>();
    transport.enqueue(() => {
      firstStarted.resolve();
      return firstResponse.promise;
    });
    transport.enqueue(emptyPoll('2'));
    transport.enqueue(
      acknowledgement(
        withLineDescription(initial, 'Produk Core Baru'),
        '3',
        '1',
        '3',
      ),
    );
    transport.enqueue(emptyPoll('3'));

    const description = screen.getByLabelText('Nama barang baris 1');
    description.focus();
    await act(async () => {
      fireEvent.change(description, { target: { value: 'produk core b' } });
      await firstStarted.promise;
    });

    expect(description).toHaveFocus();
    expect(description).not.toBeDisabled();

    fireEvent.change(description, { target: { value: 'produk core baru' } });
    await act(async () => {
      firstResponse.resolve(
        acknowledgement(
          withLineDescription(initial, 'Produk Core B'),
          '2',
          '1',
          '2',
        ),
      );
      await Promise.resolve();
    });

    await waitFor(() => expect(storage.saves.at(-1)?.outbox).toEqual([]));
    expect(description).toHaveValue('Produk Core Baru');
    expect(description).toHaveFocus();
    gateway.dispose();
  });
});
