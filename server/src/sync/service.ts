const MAX_UNSIGNED_BIGINT = 18_446_744_073_709_551_615n;

export interface BootstrapCollections {
  skuIdentifiers: unknown[];
  skus: unknown[];
  balances: unknown[];
  notas: unknown[];
  notaPages: unknown[];
  notaLines: unknown[];
  templates: unknown[];
}

export interface ChangeRecord {
  revision: bigint;
  entityType: string;
  entityId: string;
  operation: string;
  payload: unknown;
  createdAt: Date;
}

export interface SyncReadSession {
  getWatermark(): Promise<bigint>;
  getMinimumRevision(): Promise<bigint | null>;
  getBootstrapCollections(): Promise<BootstrapCollections>;
  getChanges(
    after: bigint,
    watermark: bigint,
    limit: number,
  ): Promise<ChangeRecord[]>;
}

export interface SyncStore {
  readConsistent<T>(
    work: (session: SyncReadSession) => Promise<T>,
  ): Promise<T>;
  pruneRetainedChanges(): Promise<number>;
}

export class SyncError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
    readonly bootstrapRequired = false,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

type JsonSafe =
  | null
  | string
  | number
  | boolean
  | JsonSafe[]
  | { [key: string]: JsonSafe };

function jsonSafe(value: unknown): JsonSafe {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Sync row contains a non-finite number');
    }
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(jsonSafe);
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, jsonSafe(nested)]),
    );
  }
  throw new Error('Sync row contains a non-JSON value');
}

function parseCursor(value: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new SyncError('INVALID_CURSOR', 400, 'Invalid change cursor');
  }
  const cursor = BigInt(value);
  if (cursor > MAX_UNSIGNED_BIGINT) {
    throw new SyncError('INVALID_CURSOR', 400, 'Invalid change cursor');
  }
  return cursor;
}

function validateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new SyncError('INVALID_LIMIT', 400, 'Invalid change page limit');
  }
}

export class SyncService {
  constructor(private readonly store: SyncStore) {}

  async bootstrap(): Promise<
    { serverRevision: string } & {
      [Key in keyof BootstrapCollections]: JsonSafe[];
    }
  > {
    return this.store.readConsistent(async (session) => {
      const watermark = await session.getWatermark();
      const collections = await session.getBootstrapCollections();
      return {
        serverRevision: watermark.toString(),
        skuIdentifiers: collections.skuIdentifiers.map(jsonSafe),
        skus: collections.skus.map(jsonSafe),
        balances: collections.balances.map(jsonSafe),
        notas: collections.notas.map(jsonSafe),
        notaPages: collections.notaPages.map(jsonSafe),
        notaLines: collections.notaLines.map(jsonSafe),
        templates: collections.templates.map(jsonSafe),
      };
    });
  }

  async changes(input: { after: string; limit: number }): Promise<{
    serverRevision: string;
    nextAfter: string;
    changes: JsonSafe[];
  }> {
    const after = parseCursor(input.after);
    validateLimit(input.limit);

    return this.store.readConsistent(async (session) => {
      const watermark = await session.getWatermark();
      if (after > watermark) {
        throw new SyncError(
          'CURSOR_AHEAD',
          409,
          'Change cursor is ahead; full bootstrap required',
          true,
        );
      }

      const minimum = await session.getMinimumRevision();
      if (minimum !== null && after + 1n < minimum) {
        throw new SyncError(
          'CURSOR_EXPIRED',
          410,
          'Retained changes no longer cover this cursor',
          true,
        );
      }

      const rows = await session.getChanges(after, watermark, input.limit);
      const ordered = [...rows].sort((left, right) =>
        left.revision < right.revision ? -1 : left.revision > right.revision ? 1 : 0,
      );
      const changes = ordered.map((row) =>
        jsonSafe({
          revision: row.revision,
          entityType: row.entityType,
          entityId: row.entityId,
          operation: row.operation,
          payload: row.payload,
          createdAt: row.createdAt,
        }),
      );
      return {
        serverRevision: watermark.toString(),
        nextAfter: ordered.at(-1)?.revision.toString() ?? after.toString(),
        changes,
      };
    });
  }

  pruneRetainedChanges(): Promise<number> {
    return this.store.pruneRetainedChanges();
  }
}
