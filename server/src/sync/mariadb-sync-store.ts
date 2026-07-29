import type {
  ProtocolConnection,
  ProtocolPool,
} from './idempotency.js';
import { readBootstrapCollections } from './mariadb-bootstrap-queries.js';
import {
  getChanges,
  getMinimumRevision,
  getWatermark,
} from './mariadb-change-queries.js';
import { pruneChangeLog } from './retention.js';
import type {
  SyncReadSession,
  SyncStore,
} from './service.js';

function createSession(connection: ProtocolConnection): SyncReadSession {
  return {
    getWatermark: () => getWatermark(connection),
    getMinimumRevision: () => getMinimumRevision(connection),
    getBootstrapCollections: () => readBootstrapCollections(connection),
    getChanges: (after, watermark, limit) =>
      getChanges(connection, after, watermark, limit),
  };
}

export class MariaDbSyncStore implements SyncStore {
  constructor(private readonly pool: ProtocolPool) {}

  async readConsistent<T>(
    work: (session: SyncReadSession) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
      );
      await connection.query(
        'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',
      );
      transactionStarted = true;
      const result = await work(createSession(connection));
      await connection.commit();
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the consistent read's original failure.
        }
      }
      throw error;
    } finally {
      await connection.release();
    }
  }

  async pruneRetainedChanges(): Promise<number> {
    const connection = await this.pool.getConnection();
    try {
      return await pruneChangeLog(connection);
    } finally {
      await connection.release();
    }
  }
}
