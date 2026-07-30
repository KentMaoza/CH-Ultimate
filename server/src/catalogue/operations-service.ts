import type {
  CatalogueMutationContext,
  CatalogueOperationHttpService,
} from '../http/catalogue-operation-routes.js';
import {
  executeIdempotent,
  type IdempotentMutation,
  type ProtocolConnection,
  type ProtocolPool,
} from '../sync/idempotency.js';
import { MariaDbSkuOperationsRepository } from './mariadb-sku-operations-repository.js';
import { MariaDbStockOperationsRepository } from './mariadb-stock-operations-repository.js';
import { MariaDbTemplateOperationsRepository } from './mariadb-template-operations-repository.js';
import type {
  CreateSkuRequest,
  StockAdjustmentRequest,
  TemplateUpdateRequest,
  UpdateSkuRequest,
} from './operations-validation.js';

type Mutation = IdempotentMutation<Record<string, unknown>>;

interface CatalogueOperationRepositories {
  sku: {
    create(
      connection: ProtocolConnection,
      deviceId: string,
      input: CreateSkuRequest,
    ): Promise<Mutation>;
    update(
      connection: ProtocolConnection,
      deviceId: string,
      skuId: string,
      input: UpdateSkuRequest,
    ): Promise<Mutation>;
  };
  stock: {
    adjust(
      connection: ProtocolConnection,
      deviceId: string,
      operationId: string,
      skuId: string,
      input: StockAdjustmentRequest,
    ): Promise<Mutation>;
  };
  templates: {
    update(
      connection: ProtocolConnection,
      deviceId: string,
      kind: 'label' | 'invoice',
      input: TemplateUpdateRequest,
    ): Promise<Mutation>;
  };
}

function defaultRepositories(): CatalogueOperationRepositories {
  return {
    sku: new MariaDbSkuOperationsRepository(),
    stock: new MariaDbStockOperationsRepository(),
    templates: new MariaDbTemplateOperationsRepository(),
  };
}

export class CatalogueOperationsService
  implements CatalogueOperationHttpService
{
  constructor(
    private readonly pool: ProtocolPool,
    private readonly repositories = defaultRepositories(),
  ) {}

  async createSku(
    context: CatalogueMutationContext,
    input: CreateSkuRequest,
  ): Promise<unknown> {
    return this.execute(context, { action: 'sku.create', input }, (connection) =>
      this.repositories.sku.create(connection, context.deviceId, input),
    );
  }

  async updateSku(
    context: CatalogueMutationContext,
    id: string,
    input: UpdateSkuRequest,
  ): Promise<unknown> {
    return this.execute(
      context,
      { action: 'sku.update', id, input },
      (connection) =>
        this.repositories.sku.update(connection, context.deviceId, id, input),
    );
  }

  async adjustStock(
    context: CatalogueMutationContext,
    id: string,
    input: StockAdjustmentRequest,
  ): Promise<unknown> {
    return this.execute(
      context,
      { action: 'stock.adjust', id, input },
      (connection) =>
        this.repositories.stock.adjust(
          connection,
          context.deviceId,
          context.idempotencyKey,
          id,
          input,
        ),
    );
  }

  async updateTemplate(
    context: CatalogueMutationContext,
    kind: 'label' | 'invoice',
    input: TemplateUpdateRequest,
  ): Promise<unknown> {
    return this.execute(
      context,
      { action: 'template.update', kind, input },
      (connection) =>
        this.repositories.templates.update(
          connection,
          context.deviceId,
          kind,
          input,
        ),
    );
  }

  private async execute(
    context: CatalogueMutationContext,
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
