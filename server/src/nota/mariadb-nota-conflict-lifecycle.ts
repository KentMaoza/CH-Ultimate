import type { ProtocolConnection } from '../sync/idempotency.js';
import {
  planReopenConflictOverride,
  type EditableOverrideAction,
} from './conflicts.js';
import type { NotaRepository } from './service.js';
import { NotaOperationError } from './service.js';
import type { CompleteNotaRequest } from './validation.js';
import {
  type Mutation,
  requireNota,
} from './mariadb-nota-shared.js';

type LifecycleConflictAction = 'complete' | 'reopen' | 'cancel' | 'restore';
type LifecycleOperations = Pick<
  NotaRepository,
  'complete' | 'reopen' | 'cancel' | 'restore'
>;

interface LifecycleContext {
  connection: ProtocolConnection;
  operations: LifecycleOperations;
  deviceId: string;
  operationId: string;
  notaId: string;
}

function stale(message: string): never {
  throw new NotaOperationError('CONFLICT_OVERRIDE_STALE', 409, message);
}

function assertSuccessfulMutation(result: Mutation): void {
  if (result.statusCode >= 400) {
    stale('The Nota changed again before conflict resolution');
  }
}

export async function runRequiredLifecycleAction(
  context: LifecycleContext,
  action: EditableOverrideAction,
  destination: 'archive' | 'finished',
): Promise<void> {
  const row = await requireNota(context.connection, context.notaId);
  const status = String(row.status);
  const lifecycleVersion = String(row.lifecycle_version);
  let expectedStatus: string;
  let result: Mutation;

  if (action === 'restore') {
    if (status !== 'cancelled') {
      stale('The cancelled Nota can no longer be restored');
    }
    expectedStatus = ['draft', 'reopened', 'completed'].includes(
      String(row.cancelled_from_status),
    )
      ? String(row.cancelled_from_status)
      : 'draft';
    result = await context.operations.restore(
      context.connection,
      context.deviceId,
      context.operationId,
      context.notaId,
      { lifecycleVersion },
    );
  } else if (action === 'reopen') {
    if (status !== 'completed') {
      stale('Only a completed Nota can be reopened');
    }
    expectedStatus = 'reopened';
    result = await context.operations.reopen(
      context.connection,
      context.deviceId,
      context.operationId,
      context.notaId,
      { lifecycleVersion },
    );
  } else if (action === 'complete') {
    if (!['draft', 'reopened'].includes(status)) {
      stale('Only an editable Nota can be completed');
    }
    expectedStatus = 'completed';
    result = await context.operations.complete(
      context.connection,
      context.deviceId,
      context.operationId,
      context.notaId,
      { lifecycleVersion, destination },
    );
  } else {
    if (!['draft', 'reopened', 'completed'].includes(status)) {
      stale('The Nota can no longer be cancelled');
    }
    expectedStatus = 'cancelled';
    result = await context.operations.cancel(
      context.connection,
      context.deviceId,
      context.operationId,
      context.notaId,
      { lifecycleVersion },
    );
  }

  assertSuccessfulMutation(result);
  const updated = await requireNota(context.connection, context.notaId);
  if (String(updated.status) !== expectedStatus) {
    stale('The requested Nota lifecycle state was not applied');
  }
  if (
    action === 'complete' &&
    String(updated.completion_destination) !== destination
  ) {
    stale('The requested completion destination was not applied');
  }
}

async function reapplyCompletionIntent(
  context: LifecycleContext,
  destination: 'archive' | 'finished',
): Promise<void> {
  let row = await requireNota(context.connection, context.notaId);
  if (String(row.status) === 'cancelled') {
    await runRequiredLifecycleAction(context, 'restore', destination);
    row = await requireNota(context.connection, context.notaId);
  }
  if (
    String(row.status) === 'completed' &&
    String(row.completion_destination) !== destination
  ) {
    await runRequiredLifecycleAction(context, 'reopen', destination);
    row = await requireNota(context.connection, context.notaId);
  }
  if (['draft', 'reopened'].includes(String(row.status))) {
    await runRequiredLifecycleAction(context, 'complete', destination);
  }
  const updated = await requireNota(context.connection, context.notaId);
  if (
    String(updated.status) !== 'completed' ||
    String(updated.completion_destination) !== destination
  ) {
    stale('The requested completion state cannot be applied');
  }
}

async function reapplyReopenIntent(context: LifecycleContext): Promise<void> {
  const row = await requireNota(context.connection, context.notaId);
  const plan = planReopenConflictOverride({
    status: String(row.status),
    cancelledFromStatus: row.cancelled_from_status,
  });
  if (!plan) {
    stale('The requested reopen state cannot be applied');
  }
  for (const action of plan) {
    await runRequiredLifecycleAction(context, action, 'archive');
  }
  const updated = await requireNota(context.connection, context.notaId);
  if (String(updated.status) !== 'reopened') {
    stale('The requested reopen state was not applied');
  }
}

async function reapplyCancelIntent(context: LifecycleContext): Promise<void> {
  const row = await requireNota(context.connection, context.notaId);
  if (String(row.status) !== 'cancelled') {
    await runRequiredLifecycleAction(context, 'cancel', 'archive');
  }
  const updated = await requireNota(context.connection, context.notaId);
  if (String(updated.status) !== 'cancelled') {
    stale('The requested cancellation state was not applied');
  }
}

async function reapplyRestoreIntent(context: LifecycleContext): Promise<void> {
  const row = await requireNota(context.connection, context.notaId);
  if (String(row.status) === 'cancelled') {
    await runRequiredLifecycleAction(context, 'restore', 'archive');
  } else if (!['draft', 'reopened', 'completed'].includes(String(row.status))) {
    stale('The requested restore state cannot be applied');
  }
  const updated = await requireNota(context.connection, context.notaId);
  if (String(updated.status) === 'cancelled') {
    stale('The requested restore state was not applied');
  }
}

export async function reapplyLifecycleConflictIntent(
  context: LifecycleContext,
  action: LifecycleConflictAction,
  input: Record<string, unknown>,
): Promise<void> {
  if (action === 'complete') {
    const destination: CompleteNotaRequest['destination'] =
      input.destination === 'finished' ? 'finished' : 'archive';
    await reapplyCompletionIntent(context, destination);
  } else if (action === 'reopen') {
    await reapplyReopenIntent(context);
  } else if (action === 'cancel') {
    await reapplyCancelIntent(context);
  } else {
    await reapplyRestoreIntent(context);
  }
}
