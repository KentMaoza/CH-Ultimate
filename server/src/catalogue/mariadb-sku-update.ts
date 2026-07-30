import { databaseDate, nullableDatabaseDate } from '../auth/mariadb-row-utils.js';
import type {
  IdempotentMutation,
  ProtocolConnection,
} from '../sync/idempotency.js';
import {
  readSkuForUpdate,
  replacePrimaryIdentifier,
} from './mariadb-sku-identifiers.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from './mariadb-operation-writes.js';
import type { UpdateSkuRequest } from './operations-validation.js';
import {
  CatalogueConflictError,
  CatalogueOperationError,
  skuPayload,
  type SkuRepositoryDependencies,
} from './sku-operation-payloads.js';

export async function updateSku(
  connection: Pick<ProtocolConnection, 'query'>,
  dependencies: SkuRepositoryDependencies,
  deviceId: string,
  skuId: string,
  input: UpdateSkuRequest,
): Promise<IdempotentMutation<Record<string, unknown>>> {
  const current = await readSkuForUpdate(connection, skuId);
  if (!current) {
    throw new CatalogueOperationError('SKU_NOT_FOUND', 404, 'SKU not found');
  }
  const currentVersion = BigInt(String(current.row_version));
  if (currentVersion.toString() !== input.rowVersion) {
    throw new CatalogueConflictError({
      id: dependencies.uuid(),
      entityType: 'sku',
      entityId: skuId,
      base: input.base,
      mine: input.patch,
      server: {
        name: String(current.name),
        skuNumber: String(current.primary_identifier),
        referencePrice: Number(current.price_rupiah),
        note: String(current.source_note ?? ''),
        imageUrl: String(current.source_image_url ?? ''),
        imageHash:
          current.image_hash === null || current.image_hash === undefined
            ? null
            : Buffer.from(current.image_hash as Uint8Array).toString('hex'),
        sourceImageUrl:
          current.source_image_url === null
            ? null
            : String(current.source_image_url),
        archived: current.archived_at !== null,
        rowVersion: currentVersion.toString(),
      },
    });
  }

  const now = dependencies.now();
  const nextVersion = (currentVersion + 1n).toString();
  const nextNumber =
    input.patch.skuNumber ?? String(current.primary_identifier);
  const nextName = input.patch.name ?? String(current.name);
  const nextPrice =
    input.patch.referencePrice ?? Number(current.price_rupiah);
  const nextNote = input.patch.note ?? String(current.source_note ?? '');
  const currentImageHash =
    current.image_hash === null || current.image_hash === undefined
      ? null
      : Buffer.from(current.image_hash as Uint8Array).toString('hex');
  const nextImageHash =
    input.patch.imageHash === undefined
      ? currentImageHash
      : input.patch.imageHash;
  const nextSourceImageUrl =
    input.patch.sourceImageUrl !== undefined
      ? input.patch.sourceImageUrl
      : input.patch.imageUrl !== undefined
        ? input.patch.imageUrl || null
        : current.source_image_url === null
          ? null
          : String(current.source_image_url);
  const currentArchived = nullableDatabaseDate(current.archived_at);
  const nextArchived =
    input.patch.archived === undefined
      ? currentArchived?.toISOString() ?? null
      : input.patch.archived
        ? now.toISOString()
        : null;
  const identifierChanges =
    nextNumber === String(current.primary_identifier)
      ? []
      : await replacePrimaryIdentifier(
          connection,
          dependencies,
          skuId,
          nextNumber,
          now,
        );

  await connection.query(
    `UPDATE skus
     SET primary_identifier = ?, name = ?, price_rupiah = ?,
         source_note = ?, image_hash = UNHEX(?), source_image_url = ?,
         archived_at = ?, row_version = ?, updated_at = ?
     WHERE id = UNHEX(REPLACE(?, '-', '')) AND row_version = ?`,
    [
      nextNumber,
      nextName,
      nextPrice,
      nextNote,
      nextImageHash,
      nextSourceImageUrl,
      nextArchived === null ? null : now,
      nextVersion,
      now,
      skuId,
      input.rowVersion,
    ],
  );
  let priceHistoryId: string | undefined;
  if (nextPrice !== Number(current.price_rupiah)) {
    priceHistoryId = dependencies.uuid();
    await connection.query(
      `INSERT INTO price_history
         (id, sku_id, price_rupiah, source, changed_by_device_id, effective_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
          'manual', UNHEX(REPLACE(?, '-', '')), ?)`,
      [priceHistoryId, skuId, nextPrice, deviceId, now],
    );
  }
  await writeOperationAudit(
    connection,
    deviceId,
    'sku.update',
    'sku',
    skuId,
    { rowVersion: nextVersion, fields: Object.keys(input.patch) },
    now,
  );
  const payload = skuPayload(skuId, {
    skuNumber: nextNumber,
    name: nextName,
    referencePrice: nextPrice,
    note: nextNote,
    imageHash: nextImageHash,
    sourceImageUrl: nextSourceImageUrl,
    rowVersion: nextVersion,
    archivedAt: nextArchived,
    createdAt: databaseDate(current.created_at).toISOString(),
    updatedAt: now.toISOString(),
  });
  let revision = await writeOperationChange(
    connection,
    'sku',
    skuId,
    payload,
    now,
  );
  for (const identifier of identifierChanges) {
    revision = await writeOperationChange(
      connection,
      'sku_identifier',
      identifier.id,
      identifier.payload,
      now,
    );
  }
  if (priceHistoryId) {
    revision = await writeOperationChange(
      connection,
      'price_history',
      priceHistoryId,
      {
        id: priceHistoryId,
        skuId,
        priceRupiah: nextPrice.toString(),
        beforePriceRupiah: String(current.price_rupiah),
        source: 'manual',
        changedByDeviceId: deviceId,
        effectiveAt: now.toISOString(),
      },
      now,
    );
  }
  return {
    statusCode: 200,
    body: {
      serverRevision: revision,
      entityVersion: nextVersion,
      entity: payload,
    },
    audits: [],
    changes: [],
  };
}
