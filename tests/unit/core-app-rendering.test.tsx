import { render, screen } from '@testing-library/react';

import { createCoreOperationsGateway } from '../../src/gateway/core-operations-gateway';
import { App } from '../../src/renderer/App';
import {
  MemoryStorage,
  ScriptedTransport,
  TestClock,
  bootstrapBody,
} from './core-gateway-test-support';

test('renders the CH Core application after an empty owner bootstrap', async () => {
  const transport = new ScriptedTransport();
  transport.enqueue({ status: 200, body: bootstrapBody('0') });
  const gateway = createCoreOperationsGateway(
    transport,
    new MemoryStorage(),
    new TestClock(),
  );

  await gateway.initialize();
  render(<App gateway={gateway} coreBacked />);

  expect(
    screen.getByRole('heading', { name: 'SKU Gudang' }),
  ).toBeInTheDocument();
});
