import type {
  IdempotentMutation,
  ProtocolConnection,
} from '../sync/idempotency.js';
import { identifierHash } from './catalogue-writer.js';
import {
  assertIdentifierAvailable,
} from './mariadb-sku-identifiers.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from './mariadb-operation-writes.js';
import type { CreateSkuRequest } from './operations-validation.js';
import {
  balancePayload,
  identifierPayload,
  skuPayload,
  type SkuRepositoryDependencies,
} from './sku-operation-payloads.js';

export async function createSku(
  connection: Pick<ProtocolConnection, 'query'>,
  dependencies: SkuRepositoryDependencies,
  deviceId: string,
  input: CreateSkuRequest,
): Promise<IdempotentMutation<Record<string, unknown>>> {
  const now = dependencies.now();
  const skuId = dependencies.uuid();
  const identifierId = dependencies.uuid();
  const priceHistoryId = dependencies.uuid();
  const hash = identifierHash(input.skuNumber);
  await assertIdentifierAvailable(connection, hash);

  await connection.query(
    `INSERT INTO skus
       (id, primary_identifier, name, price_rupiah, source_image_url,
        source_note, row_version, created_at, updated_at)
     VALUES
       (UNHEX(REPLACE(?, '-', '')), ?, ?, ?, NULLIF(?, ''), ?, 1, ?, ?)`,
    [
      skuId,
      input.skuNumber,
      input.name,
      input.referencePrice,
      input.imageUrl ?? '',
      input.note ?? '',
      now,
      now,
    ],
  );
  await connection.query(
    `INSERT INTO sku_identifiers
       (id, sku_id, identifier_value, identifier_hash, identifier_kind,
        created_at)
     VALUES
       (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
        ?, ?, 'primary', ?)`,
    [identifierId, skuId, input.skuNumber, hash, now],
  );
  if (input.tracked) {
    await connection.query(
      `INSERT INTO stock_balances
         (sku_id, quantity_pcs, row_version, updated_at)
       VALUES (UNHEX(REPLACE(?, '-', '')), ?, 1, ?)`,
      [skuId, input.openingStock, now],
    );
  }
  await connection.query(
    `INSERT INTO price_history
       (id, sku_id, price_rupiah, source, changed_by_device_id, effective_at)
     VALUES
       (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
        'manual', UNHEX(REPLACE(?, '-', '')), ?)`,
    [priceHistoryId, skuId, input.referencePrice, deviceId, now],
  );
  await writeOperationAudit(
    connection,
    deviceId,
    'sku.create',
    'sku',
    skuId,
    { primaryIdentifier: input.skuNumber },
    now,
  );

  const payload = skuPayload(skuId, {
    skuNumber: input.skuNumber,
    name: input.name,
    referencePrice: input.referencePrice,
    note: input.note ?? '',
    imageHash: null,
    sourceImageUrl: input.imageUrl || null,
    rowVersion: '1',
    archivedAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
  let revision = await writeOperationChange(
    connection,
    'sku',
    skuId,
    payload,
    now,
  );
  revision = await writeOperationChange(
    connection,
    'sku_identifier',
    identifierId,
    identifierPayload(
      identifierId,
      skuId,
      input.skuNumber,
      'primary',
      now,
    ),
    now,
  );
  if (input.tracked) {
    revision = await writeOperationChange(
      connection,
      'stock_balance',
      skuId,
      balancePayload(skuId, input.openingStock, now),
      now,
    );
  }
  revision = await writeOperationChange(
    connection,
    'price_history',
    priceHistoryId,
    {
      id: priceHistoryId,
      skuId,
      priceRupiah: input.referencePrice.toString(),
      beforePriceRupiah: input.referencePrice.toString(),
      source: 'manual',
      changedByDeviceId: deviceId,
      effectiveAt: now.toISOString(),
    },
    now,
  );
  return {
    statusCode: 201,
    body: {
      serverRevision: revision,
      entityVersion: '1',
      entity: {
        id: skuId,
        skuNumber: input.skuNumber,
        aliases: [],
        identifiers: [
          {
            id: identifierId,
            skuId,
            value: input.skuNumber,
            kind: 'primary',
            createdAt: now.toISOString(),
          },
        ],
        name: input.name,
        referencePrice: input.referencePrice,
        stock: input.openingStock,
        tracked: input.tracked,
        note: input.note ?? '',
        imageUrl: input.imageUrl ?? '',
        createdAt: now.toISOString(),
        archived: false,
      },
    },
    audits: [],
    changes: [],
  };
}
