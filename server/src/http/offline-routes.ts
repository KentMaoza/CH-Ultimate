import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type {
  OfflineNotaRequest,
  OfflineStockRequest,
} from '../offline/validation.js';
import {
  offlineNotaBody,
  offlineStockBody,
} from '../offline/validation.js';
import { authenticateRequest } from './request-auth.js';
import { parseRequest, requireEmptyQuery } from './request-validation.js';
import type { ProtocolIdentityService } from './protocol-types.js';

const idempotencyHeader = z.string().uuid();

export interface OfflineMutationContext {
  deviceId: string;
  idempotencyKey: string;
}

export interface OfflineHttpService {
  importNota(
    context: OfflineMutationContext,
    input: OfflineNotaRequest,
  ): Promise<unknown>;
  adjustStock(
    context: OfflineMutationContext,
    input: OfflineStockRequest,
  ): Promise<unknown>;
}

async function context(
  identity: ProtocolIdentityService,
  request: FastifyRequest,
): Promise<OfflineMutationContext> {
  const authenticated = await authenticateRequest(identity, request);
  return {
    deviceId: authenticated.device.id,
    idempotencyKey: parseRequest(
      idempotencyHeader,
      request.headers['idempotency-key'],
    ),
  };
}

export function registerOfflineRoutes(
  app: FastifyInstance,
  identity: ProtocolIdentityService,
  service: OfflineHttpService,
): void {
  app.post('/v1/offline/notas', async (request, reply) => {
    requireEmptyQuery(request.query);
    const mutation = await context(identity, request);
    return reply
      .code(201)
      .send(
        await service.importNota(
          mutation,
          parseRequest(offlineNotaBody, request.body),
        ),
      );
  });

  app.post('/v1/offline/stock-adjustments', async (request) => {
    requireEmptyQuery(request.query);
    const mutation = await context(identity, request);
    return service.adjustStock(
      mutation,
      parseRequest(offlineStockBody, request.body),
    );
  });
}
