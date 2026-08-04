import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { PackageBarcodeHttpService } from '../package-barcode/service.js';
import {
  packageBarcodeBody,
  reassignPackageBarcodeBody,
} from '../package-barcode/validation.js';
import type {
  StockCheckHttpService,
  StockCheckMutationContext,
} from '../stock-check/service.js';
import {
  offlineStockCheckBody,
  onlineStockCheckBody,
} from '../stock-check/validation.js';
import { authenticateRequest, requireOwner } from './request-auth.js';
import { parseRequest, requireEmptyQuery, uuidPath } from './request-validation.js';
import type { ProtocolIdentityService } from './protocol-types.js';

const idempotencyHeader = z.string().uuid();

async function mutationContext(
  identity: ProtocolIdentityService,
  request: FastifyRequest,
): Promise<StockCheckMutationContext> {
  const authenticated = await authenticateRequest(identity, request);
  return {
    deviceId: authenticated.device.id,
    deviceDisplayName: authenticated.device.displayName,
    idempotencyKey: parseRequest(
      idempotencyHeader,
      request.headers['idempotency-key'],
    ),
  };
}

export function registerStockApiRoutes(
  app: FastifyInstance,
  identity: ProtocolIdentityService,
  stockChecks: StockCheckHttpService,
  packageBarcodes: PackageBarcodeHttpService,
): void {
  app.post<{ Params: { id: string } }>(
    '/v1/skus/:id/stock-checks',
    async (request) => {
      requireEmptyQuery(request.query);
      const context = await mutationContext(identity, request);
      const { id } = parseRequest(uuidPath, request.params);
      return stockChecks.checkOnline(
        context,
        id,
        parseRequest(onlineStockCheckBody, request.body),
      );
    },
  );

  app.post('/v1/offline/stock-checks', async (request) => {
    requireEmptyQuery(request.query);
    const context = await mutationContext(identity, request);
    return stockChecks.checkOffline(
      context,
      parseRequest(offlineStockCheckBody, request.body),
    );
  });

  app.post<{ Params: { id: string } }>(
    '/v1/skus/:id/package-barcodes',
    async (request) => {
      requireEmptyQuery(request.query);
      const context = await mutationContext(identity, request);
      const { id } = parseRequest(uuidPath, request.params);
      const input = parseRequest(packageBarcodeBody, request.body);
      return packageBarcodes.register(
        { deviceId: context.deviceId, idempotencyKey: context.idempotencyKey },
        id,
        input.identifierValue,
      );
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/v1/package-barcodes/:id',
    async (request) => {
      requireEmptyQuery(request.query);
      const authenticated = await authenticateRequest(identity, request);
      requireOwner(authenticated.device);
      const idempotencyKey = parseRequest(
        idempotencyHeader,
        request.headers['idempotency-key'],
      );
      const { id } = parseRequest(uuidPath, request.params);
      return packageBarcodes.remove(
        { deviceId: authenticated.device.id, idempotencyKey },
        id,
      );
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/v1/package-barcodes/:id',
    async (request) => {
      requireEmptyQuery(request.query);
      const authenticated = await authenticateRequest(identity, request);
      requireOwner(authenticated.device);
      const idempotencyKey = parseRequest(
        idempotencyHeader,
        request.headers['idempotency-key'],
      );
      const { id } = parseRequest(uuidPath, request.params);
      const input = parseRequest(reassignPackageBarcodeBody, request.body);
      return packageBarcodes.reassign(
        { deviceId: authenticated.device.id, idempotencyKey },
        id,
        input.skuId,
      );
    },
  );
}
