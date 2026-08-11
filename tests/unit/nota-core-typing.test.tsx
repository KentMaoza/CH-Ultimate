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
import { OutputProvider } from '../../src/renderer/output-context';
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

function withLineQuantity(
  transaction: NotaTransaction,
  quantity: number,
): NotaTransaction {
  return {
    ...transaction,
    pages: transaction.pages.map((page) => ({
      ...page,
      lines: page.lines.map((line) =>
        line.id === LINE_ID ? { ...line, quantity } : line,
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
        <OutputProvider bridge={{
          printDocument: async () => ({ status: 'printed' }),
          savePdf: async () => ({ status: 'saved' }),
          saveSpreadsheet: async () => ({ status: 'saved' }),
        }}>
          <NotaWorkspace coreBacked onBack={() => undefined} />
        </OutputProvider>
      </OperationsProvider>,
    );
    return { gateway, storage, transport };
  });
}

describe('Core-backed Nota typing', () => {
  it('buffers rapid line typing locally and sends only the final value after blur', async () => {
    const { gateway, storage, transport } = await renderCoreNota();
    const initial = gateway.getSnapshot().notaTransactions[0]!;
    const mutationStarted = deferred<void>();
    const mutationResponse = deferred<{ status: number; body: unknown }>();
    transport.enqueue((request) => {
      mutationStarted.resolve();
      expect(request.body).toMatchObject({
        mine: { description: 'Produk Core Baru' },
      });
      return mutationResponse.promise;
    });
    transport.enqueue(emptyPoll('2'));
    const savesBeforeTyping = storage.saves.length;
    const description = screen.getByLabelText('Nama barang baris 1');

    act(() => description.focus());
    fireEvent.change(description, { target: { value: 'produk core b' } });
    fireEvent.change(description, { target: { value: 'produk core ba' } });
    fireEvent.change(description, { target: { value: 'produk core baru' } });
    await act(async () => { await Promise.resolve(); });

    expect(description).toHaveValue('Produk Core Baru');
    expect(
      transport.requests.filter((request) => request.path.includes('/lines/')),
    ).toHaveLength(0);
    expect(storage.saves).toHaveLength(savesBeforeTyping);

    fireEvent.blur(description);
    await mutationStarted.promise;
    expect(
      transport.requests.filter((request) => request.path.includes('/lines/')),
    ).toHaveLength(1);
    mutationResponse.resolve(
      acknowledgement(
        withLineDescription(initial, 'Produk Core Baru'),
        '2',
        '1',
        '2',
      ),
    );
    await waitFor(() => expect(storage.saves.at(-1)?.outbox).toEqual([]));
    expect(description).toHaveValue('Produk Core Baru');
    gateway.dispose();
  });

  it('buffers rapid numeric typing locally and sends one final quantity after blur', async () => {
    const { gateway, storage, transport } = await renderCoreNota();
    const initial = gateway.getSnapshot().notaTransactions[0]!;
    const mutationStarted = deferred<void>();
    const mutationResponse = deferred<{ status: number; body: unknown }>();
    transport.enqueue((request) => {
      mutationStarted.resolve();
      expect(request.body).toMatchObject({ mine: { quantity: 234 } });
      return mutationResponse.promise;
    });
    transport.enqueue(emptyPoll('2'));
    const savesBeforeTyping = storage.saves.length;
    const quantity = screen.getByLabelText('Jumlah baris 1');

    act(() => quantity.focus());
    fireEvent.change(quantity, { target: { value: '2' } });
    fireEvent.change(quantity, { target: { value: '23' } });
    fireEvent.change(quantity, { target: { value: '234' } });
    await act(async () => { await Promise.resolve(); });

    expect(quantity).toHaveValue('234');
    expect(
      transport.requests.filter((request) => request.path.includes('/lines/')),
    ).toHaveLength(0);
    expect(storage.saves).toHaveLength(savesBeforeTyping);

    fireEvent.blur(quantity);
    await mutationStarted.promise;
    expect(
      transport.requests.filter((request) => request.path.includes('/lines/')),
    ).toHaveLength(1);
    mutationResponse.resolve(
      acknowledgement(withLineQuantity(initial, 234), '2', '1', '2'),
    );
    await waitFor(() => expect(storage.saves.at(-1)?.outbox).toEqual([]));
    expect(quantity).toHaveValue('234');
    gateway.dispose();
  });

  it('keeps the customer field focused and enabled while characters wait for the LAN', async () => {
    const { gateway, storage, transport } = await renderCoreNota();
    const initial = gateway.getSnapshot().notaTransactions[0]!;
    const firstStarted = deferred<void>();
    const firstResponse = deferred<{ status: number; body: unknown }>();
    const secondStarted = deferred<void>();
    const secondResponse = deferred<{ status: number; body: unknown }>();
    transport.enqueue(() => {
      firstStarted.resolve();
      return firstResponse.promise;
    });
    transport.enqueue(emptyPoll('2'));
    transport.enqueue(() => {
      secondStarted.resolve();
      return secondResponse.promise;
    });
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
      await secondStarted.promise;
    });

    expect(customer).toHaveValue('Ami');
    expect(customer).toHaveFocus();
    expect(customer).not.toBeDisabled();
    await act(async () => {
      secondResponse.resolve(
        acknowledgement({ ...initial, customerName: 'Ami' }, '3', '3', '1'),
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
    const secondStarted = deferred<void>();
    const secondResponse = deferred<{ status: number; body: unknown }>();
    transport.enqueue(() => {
      firstStarted.resolve();
      return firstResponse.promise;
    });
    transport.enqueue(emptyPoll('2'));
    transport.enqueue(() => {
      secondStarted.resolve();
      return secondResponse.promise;
    });
    transport.enqueue(emptyPoll('3'));

    const description = screen.getByLabelText('Nama barang baris 1');
    act(() => description.focus());
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
      await secondStarted.promise;
    });

    expect(description).toHaveValue('Produk Core Baru');
    expect(description).toHaveFocus();
    expect(description).not.toBeDisabled();
    await act(async () => {
      secondResponse.resolve(
        acknowledgement(
          withLineDescription(initial, 'Produk Core Baru'),
          '3',
          '1',
          '3',
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
