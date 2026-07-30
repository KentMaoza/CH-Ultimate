import { randomUUID } from 'node:crypto';

import { hexToUuid } from '../auth/mariadb-row-utils.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from '../catalogue/mariadb-operation-writes.js';
import {
  canonicalizeJson,
  type ProtocolConnection,
} from '../sync/idempotency.js';
import { MariaDbNotaLifecycleRepository } from '../nota/mariadb-nota-lifecycle-repository.js';
import {
  coreLinePayload,
  coreNotaPayload,
  corePagePayload,
  domainEntity,
  mutationBody,
  notaVersionState,
  readLines,
  readPages,
  requireNota,
  type Dependencies as NotaDependencies,
  type Mutation,
} from '../nota/mariadb-nota-shared.js';
import {
  formatWitaBusinessDate,
  formatWitaNotaNumber,
} from '../nota/numbering.js';
import type { OfflineRepository } from './service.js';
import { adjustOfflineStock } from './mariadb-stock-adjustment.js';
import type { OfflineNotaRequest } from './validation.js';

interface OfflineRepositoryDependencies extends NotaDependencies {
  complete(
    connection: ProtocolConnection,
    deviceId: string,
    operationId: string,
    id: string,
    destination: 'archive' | 'finished',
  ): Promise<Mutation>;
  emitImportedChanges(
    connection: ProtocolConnection,
    id: string,
    now: Date,
  ): Promise<string>;
  draftMutation(
    connection: ProtocolConnection,
    id: string,
    revision: string,
  ): Promise<Mutation>;
}

function defaultDependencies(): OfflineRepositoryDependencies {
  const lifecycle = new MariaDbNotaLifecycleRepository();
  return {
    uuid: randomUUID,
    now: () => new Date(),
    complete: (connection, deviceId, operationId, id, destination) =>
      lifecycle.complete(connection, deviceId, operationId, id, {
        lifecycleVersion: '1',
        destination,
      }),
    emitImportedChanges,
    draftMutation: async (connection, id, revision) => {
      const row = await requireNota(connection, id);
      return mutationBody(
        revision,
        '1',
        await domainEntity(connection, row),
        await notaVersionState(connection, row),
      );
    },
  };
}

export class MariaDbOfflineRepository implements OfflineRepository {
  private readonly dependencies: OfflineRepositoryDependencies;

  constructor(
    dependencies: Partial<OfflineRepositoryDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies(), ...dependencies };
  }

  importNota: OfflineRepository['importNota'] = async (
    connection,
    deviceId,
    operationId,
    input,
  ) => {
    const now = this.dependencies.now();
    const businessDate = formatWitaBusinessDate(now);
    const sequenceResult = await connection.query<{ insertId?: unknown }>(
      `INSERT INTO nota_daily_sequences (business_date, next_sequence)
       VALUES (?, LAST_INSERT_ID(1))
       ON DUPLICATE KEY UPDATE
         next_sequence = LAST_INSERT_ID(next_sequence + 1)`,
      [businessDate],
    );
    const sequence = Number(sequenceResult.insertId);
    const notaId = this.dependencies.uuid();
    const notaNumber = formatWitaNotaNumber(businessDate, sequence);
    const header = {
      customerName: input.snapshot.customerName,
      customerPlace: input.snapshot.customerPlace,
      transactionDate: input.snapshot.transactionDate,
      payment: input.snapshot.payment,
    };
    const versions = {
      customerName: '1',
      customerPlace: '1',
      transactionDate: '1',
      payment: '1',
    };
    await connection.query(
      `INSERT INTO notas
         (id, nota_number, business_date, status, header_json, field_versions,
          structure_version, lifecycle_version, created_by_device_id,
          created_at, updated_at)
       VALUES
         (UNHEX(REPLACE(?, '-', '')), ?, ?, 'draft', ?, ?, 1, 1,
          UNHEX(REPLACE(?, '-', '')), ?, ?)`,
      [
        notaId,
        notaNumber,
        businessDate,
        canonicalizeJson(header),
        canonicalizeJson(versions),
        deviceId,
        now,
        now,
      ],
    );

    const skuSnapshots = new Map(
      input.skuSnapshots.map((snapshot) => [snapshot.skuId, snapshot]),
    );
    for (
      let pagePosition = 0;
      pagePosition < input.snapshot.pages.length;
      pagePosition += 1
    ) {
      const page = input.snapshot.pages[pagePosition]!;
      const pageId = this.dependencies.uuid();
      await connection.query(
        `INSERT INTO nota_pages
           (id, nota_id, page_position, status, row_version,
            lifecycle_version, created_at, updated_at)
         VALUES
           (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')), ?,
            ?, 1, 1, ?, ?)`,
        [pageId, notaId, pagePosition, page.status, now, now],
      );
      for (let linePosition = 0; linePosition < 15; linePosition += 1) {
        const source = page.lines[linePosition];
        const populated = source ? isPopulated(source) : false;
        const snapshot =
          populated && source?.skuId
            ? skuSnapshots.get(source.skuId)
            : undefined;
        let relatedSkuId: string | null = null;
        if (source?.skuId && snapshot) {
          relatedSkuId = await this.resolveNotaSku(
            connection,
            deviceId,
            notaId,
            source.skuId,
            snapshot,
            now,
          );
        }
        const quantityPcs =
          populated && source
            ? source.quantity * (source.unit === 'lsn' ? 12 : 1)
            : 0;
        const unitPrice =
          populated && source
            ? source.unit === 'lsn'
              ? source.lsnPrice
              : source.pcsPrice
            : 0;
        const total =
          populated && source ? source.quantity * unitPrice : 0;
        await connection.query(
          `INSERT INTO nota_lines
             (id, nota_id, page_id, sku_id, line_position,
              sku_identifier_snapshot, sku_name_snapshot, kind_snapshot,
              quantity_pcs, unit_kind, unit_price_rupiah, pcs_price_rupiah,
              lsn_price_rupiah, line_total_rupiah, row_version,
              created_at, updated_at)
           VALUES
             (UNHEX(REPLACE(?, '-', '')), UNHEX(REPLACE(?, '-', '')),
              UNHEX(REPLACE(?, '-', '')),
              CASE WHEN ? IS NULL THEN NULL ELSE UNHEX(REPLACE(?, '-', '')) END,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            this.dependencies.uuid(),
            notaId,
            pageId,
            relatedSkuId,
            relatedSkuId,
            linePosition,
            snapshot?.identifier ?? '',
            snapshot?.name ?? source?.description ?? '',
            populated ? source?.kind ?? '' : '',
            quantityPcs,
            populated ? source?.unit ?? 'pcs' : 'pcs',
            unitPrice,
            populated ? source?.pcsPrice ?? 0 : 0,
            populated ? source?.lsnPrice ?? 0 : 0,
            total,
            now,
            now,
          ],
        );
      }
    }

    await writeOperationAudit(
      connection,
      deviceId,
      'offline.nota.import',
      'nota',
      notaId,
      {
        provisionalId: input.provisionalId,
        notaNumber,
        completed: input.completed,
      },
      now,
    );
    const completion = input.completed
      ? await this.dependencies.complete(
          connection,
          deviceId,
          operationId,
          notaId,
          input.destination,
        )
      : undefined;
    const revision = await this.dependencies.emitImportedChanges(
      connection,
      notaId,
      now,
    );
    const result =
      completion ??
      (await this.dependencies.draftMutation(
        connection,
        notaId,
        revision,
      ));
    return {
      ...result,
      statusCode: 201,
      body: {
        ...result.body,
        serverRevision: revision,
        entityId: notaId,
      },
    };
  };

  adjustStock: OfflineRepository['adjustStock'] = async (
    connection,
    deviceId,
    operationId,
    input,
  ) =>
    adjustOfflineStock(
      connection,
      deviceId,
      operationId,
      input,
      this.dependencies,
    );

  private async resolveNotaSku(
    connection: ProtocolConnection,
    deviceId: string,
    notaId: string,
    skuId: string,
    snapshot: OfflineNotaRequest['skuSnapshots'][number],
    now: Date,
  ): Promise<string | null> {
    const rows = await connection.query<
      Array<{ id_hex: unknown; archived_at: unknown }>
    >(
      `SELECT HEX(id) AS id_hex, archived_at
       FROM skus
       WHERE id = UNHEX(REPLACE(?, '-', ''))
       FOR UPDATE`,
      [skuId],
    );
    const row = rows[0];
    if (!row) {
      await this.writeSnapshotWarning(
        connection,
        deviceId,
        'offline.nota.sku_missing_snapshot',
        notaId,
        snapshot,
        now,
      );
      return null;
    }
    if (hexToUuid(row.id_hex) !== skuId) {
      throw new Error('Resolved offline Nota SKU did not match');
    }
    if (row.archived_at) {
      await this.writeSnapshotWarning(
        connection,
        deviceId,
        'offline.nota.sku_archived_snapshot',
        notaId,
        snapshot,
        now,
      );
    }
    return skuId;
  }

  private writeSnapshotWarning(
    connection: ProtocolConnection,
    deviceId: string,
    action: string,
    entityId: string,
    snapshot: unknown,
    now: Date,
  ): Promise<void> {
    return writeOperationAudit(
      connection,
      deviceId,
      action,
      'nota',
      entityId,
      { warning: true, capturedSnapshot: snapshot },
      now,
    );
  }
}

function isPopulated(
  line: OfflineNotaRequest['snapshot']['pages'][number]['lines'][number],
): boolean {
  return (
    Boolean(line.skuId) ||
    Boolean(line.description.trim()) ||
    Boolean(line.kind.trim()) ||
    line.quantity !== 0 ||
    line.pcsPrice !== 0 ||
    line.lsnPrice !== 0
  );
}

async function emitImportedChanges(
  connection: ProtocolConnection,
  id: string,
  now: Date,
): Promise<string> {
  let revision = '0';
  for (const page of await readPages(connection, id)) {
    revision = await writeOperationChange(
      connection,
      'nota_page',
      hexToUuid(page.id_hex),
      corePagePayload(page),
      now,
    );
  }
  for (const line of await readLines(connection, id)) {
    revision = await writeOperationChange(
      connection,
      'nota_line',
      hexToUuid(line.id_hex),
      coreLinePayload(line),
      now,
    );
  }
  const nota = await requireNota(connection, id);
  return writeOperationChange(
    connection,
    'nota',
    id,
    coreNotaPayload(nota),
    now,
  );
}
