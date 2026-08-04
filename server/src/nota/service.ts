import type {
  NotaHttpService,
  NotaMutationContext,
} from '../http/nota-routes.js';
import {
  executeIdempotent,
  type IdempotentMutation,
  type ProtocolConnection,
  type ProtocolPool,
} from '../sync/idempotency.js';
import { MariaDbNotaRepository } from './mariadb-repository.js';
import type {
  AddPageRequest,
  CompleteNotaRequest,
  CreateNotaRequest,
  DeleteLineRequest,
  NotaLifecycleRequest,
  PageLifecycleRequest,
  ResolveConflictRequest,
  UpdateHeaderRequest,
  UpdateLineRequest,
} from './validation.js';

export interface NotaConflictMaterial {
  id: string;
  entityType: string;
  entityId: string;
  field?: string;
  base: unknown;
  mine: unknown;
  server: unknown;
}

export class NotaConflictError extends Error {
  constructor(readonly conflict: NotaConflictMaterial) {
    super('Nota conflict');
    this.name = 'NotaConflictError';
  }
}

export class NotaOperationError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'NotaOperationError';
  }
}

type Mutation = IdempotentMutation<Record<string, unknown>>;

export interface NotaRepository {
  create(connection: ProtocolConnection, deviceId: string, input: CreateNotaRequest): Promise<Mutation>;
  addPage(connection: ProtocolConnection, deviceId: string, operationId: string, id: string, input: AddPageRequest): Promise<Mutation>;
  cancelPage(connection: ProtocolConnection, deviceId: string, operationId: string, id: string, pageId: string, input: PageLifecycleRequest): Promise<Mutation>;
  restorePage(connection: ProtocolConnection, deviceId: string, operationId: string, id: string, pageId: string, input: PageLifecycleRequest): Promise<Mutation>;
  updateHeader(connection: ProtocolConnection, deviceId: string, operationId: string, id: string, input: UpdateHeaderRequest): Promise<Mutation>;
  updateLine(connection: ProtocolConnection, deviceId: string, operationId: string, id: string, pageId: string, lineId: string, input: UpdateLineRequest): Promise<Mutation>;
  deleteLine(connection: ProtocolConnection, deviceId: string, operationId: string, id: string, pageId: string, lineId: string, input: DeleteLineRequest): Promise<Mutation>;
  complete(connection: ProtocolConnection, deviceId: string, operationId: string, id: string, input: CompleteNotaRequest): Promise<Mutation>;
  reopen(connection: ProtocolConnection, deviceId: string, operationId: string, id: string, input: NotaLifecycleRequest): Promise<Mutation>;
  cancel(connection: ProtocolConnection, deviceId: string, operationId: string, id: string, input: NotaLifecycleRequest): Promise<Mutation>;
  restore(connection: ProtocolConnection, deviceId: string, operationId: string, id: string, input: NotaLifecycleRequest): Promise<Mutation>;
  resolveConflict(connection: ProtocolConnection, deviceId: string, operationId: string, id: string, input: ResolveConflictRequest): Promise<Mutation>;
}

export class NotaOperationsService implements NotaHttpService {
  private readonly repository: NotaRepository;

  constructor(
    private readonly pool: ProtocolPool,
    repository: Partial<NotaRepository> = {},
  ) {
    this.repository = {
      ...new MariaDbNotaRepository(),
      ...repository,
    };
  }

  create(context: NotaMutationContext, input: CreateNotaRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.create', input }, (connection) =>
      this.repository.create(connection, context.deviceId, input));
  }

  addPage(context: NotaMutationContext, id: string, input: AddPageRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.page.add', id, input }, (connection) =>
      this.repository.addPage(connection, context.deviceId, context.idempotencyKey, id, input));
  }

  cancelPage(context: NotaMutationContext, id: string, pageId: string, input: PageLifecycleRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.page.cancel', id, pageId, input }, (connection) =>
      this.repository.cancelPage(connection, context.deviceId, context.idempotencyKey, id, pageId, input));
  }

  restorePage(context: NotaMutationContext, id: string, pageId: string, input: PageLifecycleRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.page.restore', id, pageId, input }, (connection) =>
      this.repository.restorePage(connection, context.deviceId, context.idempotencyKey, id, pageId, input));
  }

  updateHeader(context: NotaMutationContext, id: string, input: UpdateHeaderRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.header.update', id, input }, (connection) =>
      this.repository.updateHeader(connection, context.deviceId, context.idempotencyKey, id, input));
  }

  updateLine(context: NotaMutationContext, id: string, pageId: string, lineId: string, input: UpdateLineRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.line.update', id, pageId, lineId, input }, (connection) =>
      this.repository.updateLine(connection, context.deviceId, context.idempotencyKey, id, pageId, lineId, input));
  }

  deleteLine(context: NotaMutationContext, id: string, pageId: string, lineId: string, input: DeleteLineRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.line.delete', id, pageId, lineId, input }, (connection) =>
      this.repository.deleteLine(connection, context.deviceId, context.idempotencyKey, id, pageId, lineId, input));
  }

  complete(context: NotaMutationContext, id: string, input: CompleteNotaRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.complete', id, input }, (connection) =>
      this.repository.complete(connection, context.deviceId, context.idempotencyKey, id, input));
  }

  reopen(context: NotaMutationContext, id: string, input: NotaLifecycleRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.reopen', id, input }, (connection) =>
      this.repository.reopen(connection, context.deviceId, context.idempotencyKey, id, input));
  }

  cancel(context: NotaMutationContext, id: string, input: NotaLifecycleRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.cancel', id, input }, (connection) =>
      this.repository.cancel(connection, context.deviceId, context.idempotencyKey, id, input));
  }

  restore(context: NotaMutationContext, id: string, input: NotaLifecycleRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.restore', id, input }, (connection) =>
      this.repository.restore(connection, context.deviceId, context.idempotencyKey, id, input));
  }

  resolveConflict(context: NotaMutationContext, id: string, input: ResolveConflictRequest): Promise<unknown> {
    return this.execute(context, { action: 'nota.conflict.resolve', id, input }, (connection) =>
      this.repository.resolveConflict(connection, context.deviceId, context.idempotencyKey, id, input));
  }

  private async execute(
    context: NotaMutationContext,
    payload: unknown,
    mutation: (connection: ProtocolConnection) => Promise<Mutation>,
  ): Promise<unknown> {
    const result = await executeIdempotent(
      this.pool,
      {
        deviceId: context.deviceId,
        idempotencyKey: context.idempotencyKey,
        payload,
      },
      mutation,
    );
    if (
      result.statusCode === 409 &&
      result.body.code === 'CONFLICT' &&
      result.body.conflict
    ) {
      throw new NotaConflictError(result.body.conflict as unknown as NotaConflictMaterial);
    }
    return result.body;
  }
}
