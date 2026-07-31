import type {
  OfflineHttpService,
  OfflineMutationContext,
} from '../http/offline-routes.js';
import {
  executeIdempotent,
  type IdempotentMutation,
  type ProtocolConnection,
  type ProtocolPool,
} from '../sync/idempotency.js';
import { MariaDbOfflineRepository } from './mariadb-repository.js';
import type {
  OfflineNotaRequest,
  OfflineStockRequest,
} from './validation.js';

type Mutation = IdempotentMutation<Record<string, unknown>>;

export interface OfflineRepository {
  importNota(
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    input: OfflineNotaRequest,
  ): Promise<Mutation>;
  adjustStock(
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    input: OfflineStockRequest,
  ): Promise<Mutation>;
}

export class OfflineOperationsService implements OfflineHttpService {
  private readonly repository: OfflineRepository;

  constructor(
    private readonly pool: ProtocolPool,
    repository: Partial<OfflineRepository> = {},
  ) {
    this.repository = {
      ...new MariaDbOfflineRepository(),
      ...repository,
    };
  }

  importNota(
    context: OfflineMutationContext,
    input: OfflineNotaRequest,
  ): Promise<unknown> {
    return this.execute(
      context,
      { action: 'offline.nota.import', input },
      (connection) =>
        this.repository.importNota(
          connection,
          context.deviceId,
          context.idempotencyKey,
          input,
        ),
    );
  }

  adjustStock(
    context: OfflineMutationContext,
    input: OfflineStockRequest,
  ): Promise<unknown> {
    return this.execute(
      context,
      { action: 'offline.stock.adjust', input },
      (connection) =>
        this.repository.adjustStock(
          connection,
          context.deviceId,
          context.idempotencyKey,
          input,
        ),
    );
  }

  private async execute(
    context: OfflineMutationContext,
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
    return result.body;
  }
}
