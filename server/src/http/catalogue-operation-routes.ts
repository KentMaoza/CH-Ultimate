import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type {
  CreateSkuRequest,
  ReplaceSkuImageRequest,
  StockAdjustmentRequest,
  TemplateUpdateRequest,
  UpdateSkuRequest,
} from '../catalogue/operations-validation.js';
import {
  createSkuBody,
  replaceSkuImageBody,
  stockAdjustmentBody,
  templateBody,
  templateKindPath,
  updateSkuBody,
} from '../catalogue/operations-validation.js';
import { authenticateRequest } from './request-auth.js';
import { parseRequest, requireEmptyQuery, uuidPath } from './request-validation.js';
import type { ProtocolIdentityService } from './protocol-types.js';

const idempotencyHeader = z.string().uuid();

export interface CatalogueMutationContext {
  deviceId: string;
  idempotencyKey: string;
}

export interface CatalogueOperationHttpService {
  createSku(
    context: CatalogueMutationContext,
    input: CreateSkuRequest,
  ): Promise<unknown>;
  updateSku(
    context: CatalogueMutationContext,
    id: string,
    input: UpdateSkuRequest,
  ): Promise<unknown>;
  adjustStock(
    context: CatalogueMutationContext,
    id: string,
    input: StockAdjustmentRequest,
  ): Promise<unknown>;
  updateTemplate(
    context: CatalogueMutationContext,
    kind: 'label' | 'invoice',
    input: TemplateUpdateRequest,
  ): Promise<unknown>;
  replaceSkuImage(
    context: CatalogueMutationContext,
    id: string,
    input: ReplaceSkuImageRequest,
  ): Promise<unknown>;
}

async function mutationContext(
  identity: ProtocolIdentityService,
  request: FastifyRequest,
): Promise<CatalogueMutationContext> {
  const authenticated = await authenticateRequest(identity, request);
  return {
    deviceId: authenticated.device.id,
    idempotencyKey: parseRequest(
      idempotencyHeader,
      request.headers['idempotency-key'],
    ),
  };
}

export function registerCatalogueOperationRoutes(
  app: FastifyInstance,
  identity: ProtocolIdentityService,
  service: CatalogueOperationHttpService,
): void {
  app.post('/v1/skus', async (request, reply) => {
    requireEmptyQuery(request.query);
    const context = await mutationContext(identity, request);
    const input = parseRequest(createSkuBody, request.body);
    return reply.code(201).send(await service.createSku(context, input));
  });

  app.patch<{ Params: { id: string } }>('/v1/skus/:id', async (request) => {
    requireEmptyQuery(request.query);
    const context = await mutationContext(identity, request);
    const { id } = parseRequest(uuidPath, request.params);
    return service.updateSku(context, id, parseRequest(updateSkuBody, request.body));
  });

  app.post<{ Params: { id: string } }>(
    '/v1/skus/:id/stock-adjustments',
    async (request) => {
      requireEmptyQuery(request.query);
      const context = await mutationContext(identity, request);
      const { id } = parseRequest(uuidPath, request.params);
      return service.adjustStock(
        context,
        id,
        parseRequest(stockAdjustmentBody, request.body),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    '/v1/skus/:id/image',
    { bodyLimit: 7_100_000 },
    async (request) => {
      requireEmptyQuery(request.query);
      const context = await mutationContext(identity, request);
      const { id } = parseRequest(uuidPath, request.params);
      return service.replaceSkuImage(
        context,
        id,
        parseRequest(replaceSkuImageBody, request.body),
      );
    },
  );

  app.patch<{ Params: { kind: string } }>(
    '/v1/templates/:kind',
    async (request) => {
      requireEmptyQuery(request.query);
      const context = await mutationContext(identity, request);
      const { kind } = parseRequest(templateKindPath, request.params);
      return service.updateTemplate(
        context,
        kind,
        parseRequest(templateBody(kind), request.body) as TemplateUpdateRequest,
      );
    },
  );
}
