import { describe, expect, it } from 'vitest';

import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import {
  NOTA_ID,
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  deferred,
  populatedBootstrap,
} from './core-gateway-test-support';

function emptyPoll(revision = '1') {
  return {
    status: 200,
    body: { serverRevision: revision, nextAfter: revision, changes: [] },
  };
}

async function settleUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('Expected gateway activity did not start');
}

describe('Core gateway lifecycle and Nota flush races', () => {
  it('keeps disposal terminal when initialize is called afterward', async () => {
    const clock = new TestClock();
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(
      transport,
      new MemoryStorage(),
      clock,
    );

    gateway.dispose();
    await gateway.initialize();
    gateway.dispose();

    expect(transport.requests).toEqual([]);
    expect(clock.pendingDelays()).toEqual([]);
    expect(clock.resumeListenerCount()).toBe(0);
    expect(gateway.getSyncSnapshot()).toMatchObject({
      phase: 'connecting',
      serverRevision: '0',
      pendingCount: 0,
    });
  });

  it('disposes timers and resume listeners idempotently across recreated gateways', async () => {
    const clock = new TestClock();
    const firstTransport = new ScriptedTransport();
    const first = createCoreOperationsGateway(
      firstTransport,
      new MemoryStorage(),
      clock,
    );
    firstTransport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await first.initialize();

    expect(clock.pendingDelays()).toEqual([2_000]);
    expect(clock.resumeListenerCount()).toBe(1);

    first.dispose();
    first.dispose();
    expect(clock.pendingDelays()).toEqual([]);
    expect(clock.resumeListenerCount()).toBe(0);
    await clock.resume();
    expect(firstTransport.requests).toHaveLength(1);

    const secondTransport = new ScriptedTransport();
    const second = createCoreOperationsGateway(
      secondTransport,
      new MemoryStorage(),
      clock,
    );
    secondTransport.enqueue({ status: 200, body: populatedBootstrap('2') });
    await second.initialize();

    expect(clock.pendingDelays()).toEqual([2_000]);
    expect(clock.resumeListenerCount()).toBe(1);
    second.dispose();
    expect(clock.pendingDelays()).toEqual([]);
    expect(clock.resumeListenerCount()).toBe(0);
  });

  it('does not reschedule an in-flight poll after disposal', async () => {
    const clock = new TestClock();
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(
      transport,
      new MemoryStorage(),
      clock,
    );
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    const poll = deferred<ReturnType<typeof emptyPoll>>();
    transport.enqueue(() => poll.promise);

    const running = clock.runNext();
    await Promise.resolve();
    gateway.dispose();
    poll.resolve(emptyPoll());
    await running;

    expect(clock.pendingDelays()).toEqual([]);
    expect(clock.resumeListenerCount()).toBe(0);
  });

  it('keeps flushing Nota writes queued while an earlier write is in flight', async () => {
    const transport = new ScriptedTransport();
    const gateway = createCoreOperationsGateway(
      transport,
      new MemoryStorage(),
      new TestClock(),
    );
    transport.enqueue({ status: 200, body: populatedBootstrap('1') });
    await gateway.initialize();
    const firstResponse = deferred<{ status: number; body: unknown }>();
    const secondResponse = deferred<{ status: number; body: unknown }>();
    transport.enqueue(() => firstResponse.promise);
    transport.enqueue(emptyPoll());
    transport.enqueue(() => secondResponse.promise);
    transport.enqueue(emptyPoll());
    transport.enqueue({ status: 200, body: { serverRevision: '3' } });
    transport.enqueue(emptyPoll());

    const first = gateway.updateNotaTransaction(NOTA_ID, {
      customerName: 'Amina',
    });
    await settleUntil(
      () =>
        transport.requests.filter((request) =>
          request.path.endsWith('/header'),
        ).length === 1,
    );
    const completion = gateway.completeNotaTransaction(NOTA_ID);
    const second = gateway.updateNotaTransaction(NOTA_ID, {
      customerPlace: 'Banjarbaru',
    });

    firstResponse.resolve({ status: 200, body: { serverRevision: '2' } });
    await settleUntil(() => transport.requests.length >= 4);
    expect(transport.requests[3]?.path).toContain('/header');
    expect(
      transport.requests.some((request) => request.path.endsWith('/complete')),
    ).toBe(false);

    secondResponse.resolve({ status: 200, body: { serverRevision: '3' } });
    await Promise.all([first, second, completion]);

    const paths = transport.requests.map((request) => request.path);
    const lastHeaderIndex = paths.reduce(
      (last, path, index) => (path.endsWith('/header') ? index : last),
      -1,
    );
    expect(paths.filter((path) => path.endsWith('/header'))).toHaveLength(2);
    expect(paths.findIndex((path) => path.endsWith('/complete'))).toBeGreaterThan(
      lastHeaderIndex,
    );
  });
});
