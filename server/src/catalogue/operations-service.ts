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
import type {
  SkuImageReplacement,
} from './mariadb-sku-image-operations-repository.js';
import { MariaDbStockOperationsRepository } from './mariadb-stock-operations-repository.js';
import { MariaDbTemplateOperationsRepository } from './mariadb-template-operations-repository.js';
import { validateCatalogueImage } from './image-metadata.js';
import type {
  CreateSkuRequest,
  ReplaceSkuImageRequest,
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
  images?: {
    replace(
      connection: ProtocolConnection,
      deviceId: string,
      skuId: string,
      input: SkuImageReplacement,
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
  private readonly repositories: CatalogueOperationRepositories;

  constructor(
    private readonly pool: ProtocolPool,
    repositories: Partial<CatalogueOperationRepositories> = {},
  ) {
    this.repositories = { ...defaultRepositories(), ...repositories };
  }

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

  async replaceSkuImage(
    context: CatalogueMutationContext,
    id: string,
    input: ReplaceSkuImageRequest,
  ): Promise<unknown> {
    const repository = this.repositories.images;
    if (!repository) throw new Error('SKU image operations are unavailable');
    const bytes = Buffer.from(input.bytesBase64, 'base64');
    const metadata = validateCatalogueImage(bytes, input.mimeType);
    return this.execute(
      context,
      { action: 'sku.image.replace', id, input },
      (connection) =>
        repository.replace(connection, context.deviceId, id, {
          rowVersion: input.rowVersion,
          base: input.base,
          bytes,
          mimeType: metadata.mimeType,
          width: metadata.width,
          height: metadata.height,
        }),
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
