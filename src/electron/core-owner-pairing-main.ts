import { z } from 'zod';

import type {
  CoreApiRequest,
  CoreApiResponse,
} from '../gateway/core-api-transport';
import type { CoreCredentialStore } from './core-credential-store';

export interface OwnerPairing {
  pairingId: string;
  code: string;
  expiresAt: string;
}

export type OwnerPairingState =
  | 'available'
  | 'pending'
  | 'approved'
  | 'consumed'
  | 'expired';

export interface OwnerPairingStatus {
  pairingId: string;
  state: OwnerPairingState;
  expiresAt: string;
  requestedDevice?: {
    displayName: string;
    platform: string;
  };
}

export interface CoreOwnerPairingMainDependencies {
  store: CoreCredentialStore;
  send(
    request: CoreApiRequest,
    authorization?: string,
  ): Promise<CoreApiResponse>;
}

const invalidRequest = 'Permintaan pemasangan CH Core tidak valid.';
const invalidResponse = 'Respons pemasangan CH Core tidak valid.';
const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const ownerPairingSchema = z
  .object({
    pairingId: uuidSchema,
    code: z.string().regex(/^\d{8}$/),
    expiresAt: timestampSchema,
  })
  .strict();
const requestedDeviceSchema = z
  .object({
    displayName: z.string().trim().min(1).max(160),
    platform: z.string().trim().min(1).max(32),
  })
  .strict();
const ownerPairingStatusSchema = z
  .object({
    pairingId: uuidSchema,
    state: z.enum([
      'available',
      'pending',
      'approved',
      'consumed',
      'expired',
    ]),
    expiresAt: timestampSchema,
    requestedDevice: requestedDeviceSchema.optional(),
  })
  .strict();
const approvalSchema = z.object({ status: z.literal('approved') }).strict();

function requirePairingId(pairingId: string): string {
  const result = uuidSchema.safeParse(pairingId);
  if (!result.success) throw new Error(invalidRequest);
  return result.data;
}

function parseResponse<T>(
  response: CoreApiResponse,
  status: number,
  schema: z.ZodType<T>,
): T {
  if (response.status !== status) throw new Error(invalidResponse);
  const result = schema.safeParse(response.body);
  if (!result.success) throw new Error(invalidResponse);
  return result.data;
}

export function createCoreOwnerPairingMain(
  dependencies: CoreOwnerPairingMainDependencies,
) {
  const sendAuthenticated = async (request: CoreApiRequest) => {
    const token = await dependencies.store.getCurrentToken();
    return dependencies.send(request, `Bearer ${token}`);
  };

  return {
    async createOwnerPairing(): Promise<OwnerPairing> {
      const response = await sendAuthenticated({
        method: 'POST',
        path: '/v1/pairings',
      });
      return parseResponse(response, 201, ownerPairingSchema);
    },

    async getOwnerPairing(pairingId: string): Promise<OwnerPairingStatus> {
      const id = requirePairingId(pairingId);
      const response = await sendAuthenticated({
        method: 'GET',
        path: `/v1/pairings/${id}`,
      });
      return parseResponse(response, 200, ownerPairingStatusSchema);
    },

    async approveOwnerPairing(
      pairingId: string,
    ): Promise<{ status: 'approved' }> {
      const id = requirePairingId(pairingId);
      const response = await sendAuthenticated({
        method: 'POST',
        path: `/v1/pairings/${id}/approve`,
      });
      return parseResponse(response, 200, approvalSchema);
    },
  };
}
