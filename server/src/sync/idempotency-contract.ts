export interface ProtocolConnection {
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void | Promise<void>;
  query<T = unknown>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<T>;
}

export interface ProtocolPool {
  getConnection(): Promise<ProtocolConnection>;
}

export interface AuditWrite {
  action: string;
  entityType: string;
  entityId: string | null;
  detail: unknown;
}

export interface ChangeWrite {
  entityType: string;
  entityId: string;
  operation: string;
  payload: unknown;
}

export interface IdempotentMutation<T> {
  statusCode: number;
  body: T;
  audits: AuditWrite[];
  changes: ChangeWrite[];
}

export interface IdempotencyRequest {
  deviceId: string;
  idempotencyKey: string;
  payload: unknown;
}

export interface IdempotencyResult<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

export class IdempotencyError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'IdempotencyError';
  }
}
