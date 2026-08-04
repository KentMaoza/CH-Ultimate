import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { OperationsSyncStatus as MobileStatus } from '../../mobile/components/OperationsSyncStatus';
import { MockOperationsGateway } from '../../src/gateway/operations-gateway';
import { OperationsSyncStatus as DesktopStatus } from '../../src/renderer/OperationsSyncStatus';

class ConflictGateway extends MockOperationsGateway {
  override getSyncSnapshot = () => ({
    phase: 'conflict' as const,
    serverRevision: '7',
    pendingCount: 1,
    conflictCount: 1,
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
  fireEvent.click(screen.getByRole('button', { name: 'Gunakan perubahan saya' }));
  fireEvent.click(screen.getByRole('button', { name: 'Gunakan versi server' }));

  expect(gateway.resolveConflict).toHaveBeenNthCalledWith(
    1,
    '88888888-8888-4888-8888-888888888888',
    'mine',
  );
  expect(gateway.resolveConflict).toHaveBeenNthCalledWith(
    2,
    '88888888-8888-4888-8888-888888888888',
    'server',
  );
});
