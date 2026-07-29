export type CoreApiMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface CoreApiRequest {
  method: CoreApiMethod;
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

export interface CoreApiResponse {
  status: number;
  body: unknown;
}

/**
 * Native Electron and Android adapters implement this seam in later slices.
 * Authentication credentials intentionally do not appear in this contract.
 */
export interface CoreApiTransport {
  request(request: CoreApiRequest): Promise<CoreApiResponse>;
}
