import type {
  IdempotentMutation,
  ProtocolConnection,
} from '../sync/idempotency.js';
import { createSku } from './mariadb-sku-create.js';
import { requireActiveSku } from './mariadb-sku-identifiers.js';
import { updateSku } from './mariadb-sku-update.js';
import type {
  CreateSkuRequest,
  UpdateSkuRequest,
} from './operations-validation.js';
import {
  defaultSkuRepositoryDependencies,
  type SkuRepositoryDependencies,
} from './sku-operation-payloads.js';

export {
  CatalogueConflictError,
  CatalogueOperationError,
} from './sku-operation-payloads.js';

export class MariaDbSkuOperationsRepository {
  private readonly dependencies: SkuRepositoryDependencies;

  constructor(dependencies: Partial<SkuRepositoryDependencies> = {}) {
    this.dependencies = {
      ...defaultSkuRepositoryDependencies,
      ...dependencies,
    };
  }

  create(
    connection: Pick<ProtocolConnection, 'query'>,
    deviceId: string,
    input: CreateSkuRequest,
  ): Promise<IdempotentMutation<Record<string, unknown>>> {
    return createSku(connection, this.dependencies, deviceId, input);
  }

  update(
    connection: Pick<ProtocolConnection, 'query'>,
    deviceId: string,
    skuId: string,
    input: UpdateSkuRequest,
  ): Promise<IdempotentMutation<Record<string, unknown>>> {
    return updateSku(
      connection,
      this.dependencies,
      deviceId,
      skuId,
      input,
    );
  }

  requireActiveSku(
    connection: Pick<ProtocolConnection, 'query'>,
    skuId: string,
  ): Promise<string> {
    return requireActiveSku(connection, skuId);
  }
}
