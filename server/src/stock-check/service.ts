import {
  executeIdempotent,
  type ProtocolConnection,
  type ProtocolPool,
} from '../sync/idempotency.js';
import {
  MariaDbStockCheckRepository,
  type StockCheckRepository,
} from './mariadb-repository.js';
import type { OnlineStockCheckRequest, StockCheckRequest } from './validation.js';

export interface StockCheckMutationContext {
  deviceId: string;
  deviceDisplayName: string;
  idempotencyKey: string;
}

export interface StockCheckHttpService {
  checkOnline(
    context: StockCheckMutationContext,
    skuId: string,
    input: OnlineStockCheckRequest,
  ): Promise<unknown>;
  checkOffline(
    context: StockCheckMutationContext,
    input: StockCheckRequest,
  ): Promise<unknown>;
}

export class StockCheckService implements StockCheckHttpService {
  constructor(
    private readonly pool: ProtocolPool,
    private readonly repository: StockCheckRepository = new MariaDbStockCheckRepository(),
  ) {}

  checkOnline(
    context: StockCheckMutationContext,
    skuId: string,
    input: OnlineStockCheckRequest,
  ): Promise<unknown> {
    return this.execute(
      context,
      { action: 'stock.check.online', skuId, input },
      { skuId, ...input },
      false,
    );
  }

  checkOffline(
    context: StockCheckMutationContext,
    input: StockCheckRequest,
  ): Promise<unknown> {
    return this.execute(
      context,
      { action: 'stock.check.offline', input },
      input,
      true,
    );
  }

  private async execute(
    context: StockCheckMutationContext,
    payload: unknown,
    input: StockCheckRequest,
    forcedOffline: boolean,
  ): Promise<unknown> {
    const result = await executeIdempotent(
      this.pool,
      {
        deviceId: context.deviceId,
        idempotencyKey: context.idempotencyKey,
        payload,
      },
      (connection: ProtocolConnection) =>
        this.repository.apply(
          connection,
          {
            deviceId: context.deviceId,
            deviceDisplayName: context.deviceDisplayName,
          },
          context.idempotencyKey,
          input,
          forcedOffline,
        ),
    );
    return result.body;
  }
}
