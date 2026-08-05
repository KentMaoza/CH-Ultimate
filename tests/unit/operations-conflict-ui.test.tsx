import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { OperationsSyncStatus as MobileStatus } from '../../mobile/components/OperationsSyncStatus';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { OperationsSyncStatus as DesktopStatus } from '../../src/renderer/OperationsSyncStatus';

class ConflictGateway extends MockOperationsGateway {
  override getSyncSnapshot = () => ({
    phase: 'conflict' as const,
    trustedV2Bootstrap: true,
    serverRevision: '7',
    pendingCount: 2,
    conflictCount: 2,
  });
  override getConflicts = () => [
    {
      id: '88888888-8888-4888-8888-888888888888',
      entityType: 'nota',
      entityId: '33333333-3333-4333-8333-333333333333',
      field: 'customerName',
      base: 'Amelia',
      mine: 'Amina',
      server: 'Amelia Baru',
    },
    {
      id: '99999999-9999-4999-8999-999999999999',
      entityType: 'nota_line',
      entityId: '44444444-4444-4444-8444-444444444444',
      field: 'description',
      base: 'Kopi',
      mine: 'Kopi Susu',
      server: 'Kopi Hitam',
    },
  ];
  override resolveConflict = vi.fn(async () => undefined);
}

it.each([
  ['desktop', DesktopStatus],
  ['mobile', MobileStatus],
] as const)('%s conflict status shows context and both resolution actions', (_name, Status) => {
  const gateway = new ConflictGateway();
  render(<Status gateway={gateway} />);

  expect(screen.getByText('Dasar: Amelia')).toBeInTheDocument();
  expect(screen.getByText('Saya: Amina')).toBeInTheDocument();
  expect(screen.getByText('Server: Amelia Baru')).toBeInTheDocument();
  expect(screen.getByText('Saya: Kopi Susu')).toBeInTheDocument();
  expect(screen.getAllByRole('region', { name: 'Detail konflik data' })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole('button', { name: 'Versi saya' })[0]!);
  fireEvent.click(screen.getAllByRole('button', { name: 'Versi server' })[1]!);

  expect(gateway.resolveConflict).toHaveBeenNthCalledWith(
    1,
    '88888888-8888-4888-8888-888888888888',
    'mine',
  );
  expect(gateway.resolveConflict).toHaveBeenNthCalledWith(
    2,
    '99999999-9999-4999-8999-999999999999',
    'server',
  );
});
