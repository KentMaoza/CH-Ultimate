import {
  executeIdempotent,
  type ProtocolConnection,
  type ProtocolPool,
} from '../sync/idempotency.js';
import {
  MariaDbPackageBarcodeRepository,
  type PackageBarcodeRepository,
} from './mariadb-repository.js';

export interface PackageBarcodeMutationContext {
  deviceId: string;
  idempotencyKey: string;
}

export interface PackageBarcodeHttpService {
  register(
    context: PackageBarcodeMutationContext,
    skuId: string,
    identifierValue: string,
  ): Promise<unknown>;
  remove(context: PackageBarcodeMutationContext, identifierId: string): Promise<unknown>;
  reassign(
    context: PackageBarcodeMutationContext,
    identifierId: string,
    skuId: string,
  ): Promise<unknown>;
}

export class PackageBarcodeService implements PackageBarcodeHttpService {
  constructor(
    private readonly pool: ProtocolPool,
    private readonly repository: PackageBarcodeRepository = new MariaDbPackageBarcodeRepository(),
  ) {}

  register(
    context: PackageBarcodeMutationContext,
    skuId: string,
    identifierValue: string,
  ): Promise<unknown> {
    return this.execute(
      context,
      { action: 'package_barcode.register', skuId, identifierValue },
      (connection) => this.repository.register(connection, context.deviceId, skuId, identifierValue),
    );
  }

  remove(
    context: PackageBarcodeMutationContext,
    identifierId: string,
  ): Promise<unknown> {
    return this.execute(
      context,
      { action: 'package_barcode.remove', identifierId },
      (connection) => this.repository.remove(connection, context.deviceId, identifierId),
    );
  }

  reassign(
    context: PackageBarcodeMutationContext,
    identifierId: string,
    skuId: string,
  ): Promise<unknown> {
    return this.execute(
      context,
      { action: 'package_barcode.reassign', identifierId, skuId },
      (connection) => this.repository.reassign(connection, context.deviceId, identifierId, skuId),
    );
  }

  private async execute(
    context: PackageBarcodeMutationContext,
    payload: unknown,
    mutation: (connection: ProtocolConnection) => ReturnType<PackageBarcodeRepository['register']>,
  ): Promise<unknown> {
    const result = await executeIdempotent(
      this.pool,
      { deviceId: context.deviceId, idempotencyKey: context.idempotencyKey, payload },
      mutation,
    );
    return result.body;
  }
}
