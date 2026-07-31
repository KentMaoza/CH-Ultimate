import type { FastifyRequest } from 'fastify';

import {
  IdentityError,
  type AuthenticatedDevice,
} from '../auth/identity.js';
import type { ProtocolIdentityService } from './protocol-types.js';

export interface AuthenticatedRequest {
  device: AuthenticatedDevice;
  token: string;
}

export async function authenticateRequest(
  identity: ProtocolIdentityService,
  request: FastifyRequest,
): Promise<AuthenticatedRequest> {
  const authorization = request.headers.authorization;
  const match =
    typeof authorization === 'string'
      ? /^Bearer ([A-Za-z0-9_-]+)$/.exec(authorization)
      : null;
  if (!match?.[1]) {
    throw new IdentityError('UNAUTHORIZED', 401, 'Unauthorized');
  }
  return {
    device: await identity.authenticate(match[1]),
    token: match[1],
  };
}

export function requireOwner(device: AuthenticatedDevice): void {
  if (device.role !== 'owner') {
    throw new IdentityError('FORBIDDEN', 403, 'Owner access required');
  }
}
