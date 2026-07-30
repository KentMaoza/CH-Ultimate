import { randomUUID } from 'node:crypto';

import { databaseDate, hexToUuid } from '../auth/mariadb-row-utils.js';
import type { IdempotentMutation, ProtocolConnection } from '../sync/idempotency.js';
import {
  CatalogueConflictError,
  CatalogueOperationError,
} from './mariadb-sku-operations-repository.js';
import {
  writeOperationAudit,
  writeOperationChange,
} from './mariadb-operation-writes.js';
import type { TemplateUpdateRequest } from './operations-validation.js';

interface RepositoryDependencies {
  uuid(): string;
  now(): Date;
}

const defaults: RepositoryDependencies = {
  uuid: randomUUID,
  now: () => new Date(),
};

interface TemplateRow extends Record<string, unknown> {
  id_hex: unknown;
  template_kind: unknown;
  name: unknown;
  definition_json: unknown;
  row_version: unknown;
  archived_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

function parseJson(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return JSON.parse(value.toString('utf8'));
  if (typeof value === 'string') return JSON.parse(value);
  return value;
}

export class MariaDbTemplateOperationsRepository {
  private readonly dependencies: RepositoryDependencies;

  constructor(dependencies: Partial<RepositoryDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async update(
    connection: Pick<ProtocolConnection, 'query'>,
    deviceId: string,
    kind: 'label' | 'invoice',
    input: TemplateUpdateRequest,
  ): Promise<IdempotentMutation<Record<string, unknown>>> {
    const rows = await connection.query<TemplateRow[]>(
      `SELECT HEX(id) AS id_hex, template_kind, name, definition_json,
              row_version, archived_at, created_at, updated_at
       FROM templates
       WHERE template_kind = ? AND archived_at IS NULL
       FOR UPDATE`,
      [kind],
    );
    if (rows.length > 1) {
      throw new CatalogueOperationError(
        'TEMPLATE_DUPLICATE_ACTIVE',
        500,
        `Multiple active ${kind} templates exist`,
      );
    }
    const current = rows[0];
    const currentVersion = current
      ? BigInt(String(current.row_version)).toString()
      : null;
    if (currentVersion !== input.rowVersion) {
      throw new CatalogueConflictError({
        id: this.dependencies.uuid(),
        entityType: 'template',
        entityId: current
          ? hexToUuid(current.id_hex)
          : this.dependencies.uuid(),
        base: input.base,
        mine: input.definition,
        server: current
          ? {
              definition: parseJson(current.definition_json),
              rowVersion: currentVersion,
            }
          : null,
      });
    }

    const now = this.dependencies.now();
    const id = current
      ? hexToUuid(current.id_hex)
      : this.dependencies.uuid();
    const nextVersion = current
      ? (BigInt(currentVersion!) + 1n).toString()
      : '1';
    const name = kind === 'label' ? 'Label' : 'Invoice';
    const definitionJson = JSON.stringify(input.definition);
    if (current) {
      await connection.query(
        `UPDATE templates
         SET name = ?, definition_json = ?, row_version = ?, updated_at = ?
         WHERE id = UNHEX(REPLACE(?, '-', '')) AND row_version = ?`,
        [name, definitionJson, nextVersion, now, id, currentVersion],
      );
    } else {
      await connection.query(
        `INSERT INTO templates
           (id, template_kind, name, definition_json, row_version,
            created_at, updated_at)
         VALUES
           (UNHEX(REPLACE(?, '-', '')), ?, ?, ?, 1, ?, ?)`,
        [id, kind, name, definitionJson, now, now],
      );
    }
    await writeOperationAudit(
      connection,
      deviceId,
      current ? 'template.update' : 'template.create',
      'template',
      id,
      { kind, rowVersion: nextVersion },
      now,
    );
    const entity = {
      id,
      templateKind: kind,
      name,
      definition: input.definition,
      rowVersion: nextVersion,
      archivedAt: null,
      createdAt: current
        ? databaseDate(current.created_at).toISOString()
        : now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const revision = await writeOperationChange(
      connection,
      'template',
      id,
      entity,
      now,
    );
    return {
      statusCode: 200,
      body: {
        serverRevision: revision,
        entityVersion: nextVersion,
        entity,
      },
      audits: [],
      changes: [],
    };
  }
}
