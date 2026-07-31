import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type {
  AddPageRequest,
  CompleteNotaRequest,
  CreateNotaRequest,
  DeleteLineRequest,
  NotaLifecycleRequest,
  PageLifecycleRequest,
  ResolveConflictRequest,
  UpdateHeaderRequest,
  UpdateLineRequest,
} from '../nota/validation.js';
import {
  addPageBody,
  completeNotaBody,
  createNotaBody,
  deleteLineBody,
  notaAndPagePath,
  notaLifecycleBody,
  notaLinePath,
  pageLifecycleBody,
  resolveConflictBody,
  updateHeaderBody,
  updateLineBody,
} from '../nota/validation.js';
import { authenticateRequest } from './request-auth.js';
import { parseRequest, requireEmptyQuery, uuidPath } from './request-validation.js';
import type { ProtocolIdentityService } from './protocol-types.js';

const idempotencyHeader = z.string().uuid();

export interface NotaMutationContext {
  deviceId: string;
  idempotencyKey: string;
}

export interface NotaHttpService {
  create(context: NotaMutationContext, input: CreateNotaRequest): Promise<unknown>;
  addPage(context: NotaMutationContext, id: string, input: AddPageRequest): Promise<unknown>;
  cancelPage(context: NotaMutationContext, id: string, pageId: string, input: PageLifecycleRequest): Promise<unknown>;
  restorePage(context: NotaMutationContext, id: string, pageId: string, input: PageLifecycleRequest): Promise<unknown>;
  updateHeader(context: NotaMutationContext, id: string, input: UpdateHeaderRequest): Promise<unknown>;
  updateLine(context: NotaMutationContext, id: string, pageId: string, lineId: string, input: UpdateLineRequest): Promise<unknown>;
  deleteLine(context: NotaMutationContext, id: string, pageId: string, lineId: string, input: DeleteLineRequest): Promise<unknown>;
  complete(context: NotaMutationContext, id: string, input: CompleteNotaRequest): Promise<unknown>;
  reopen(context: NotaMutationContext, id: string, input: NotaLifecycleRequest): Promise<unknown>;
  cancel(context: NotaMutationContext, id: string, input: NotaLifecycleRequest): Promise<unknown>;
  restore(context: NotaMutationContext, id: string, input: NotaLifecycleRequest): Promise<unknown>;
  resolveConflict(context: NotaMutationContext, id: string, input: ResolveConflictRequest): Promise<unknown>;
}

async function context(
  identity: ProtocolIdentityService,
  request: FastifyRequest,
): Promise<NotaMutationContext> {
  const authenticated = await authenticateRequest(identity, request);
  return {
    deviceId: authenticated.device.id,
    idempotencyKey: parseRequest(
      idempotencyHeader,
      request.headers['idempotency-key'],
    ),
  };
}

export function registerNotaRoutes(
  app: FastifyInstance,
  identity: ProtocolIdentityService,
  service: NotaHttpService,
): void {
  app.post('/v1/notas', async (request, reply) => {
    requireEmptyQuery(request.query);
    const mutation = await context(identity, request);
    return reply
      .code(201)
      .send(await service.create(mutation, parseRequest(createNotaBody, request.body)));
  });

  app.post<{ Params: { id: string } }>('/v1/notas/:id/pages', async (request) => {
    requireEmptyQuery(request.query);
    const mutation = await context(identity, request);
    const { id } = parseRequest(uuidPath, request.params);
    return service.addPage(mutation, id, parseRequest(addPageBody, request.body));
  });

  for (const action of ['cancel', 'restore'] as const) {
    app.post<{ Params: { id: string; pageId: string } }>(
      `/v1/notas/:id/pages/:pageId/${action}`,
      async (request) => {
        requireEmptyQuery(request.query);
        const mutation = await context(identity, request);
        const { id, pageId } = parseRequest(notaAndPagePath, request.params);
        const input = parseRequest(pageLifecycleBody, request.body);
        return action === 'cancel'
          ? service.cancelPage(mutation, id, pageId, input)
          : service.restorePage(mutation, id, pageId, input);
      },
    );
  }

  app.patch<{ Params: { id: string } }>('/v1/notas/:id/header', async (request) => {
    requireEmptyQuery(request.query);
    const mutation = await context(identity, request);
    const { id } = parseRequest(uuidPath, request.params);
    return service.updateHeader(
      mutation,
      id,
      parseRequest(updateHeaderBody, request.body),
    );
  });

  app.patch<{ Params: { id: string; pageId: string; lineId: string } }>(
    '/v1/notas/:id/pages/:pageId/lines/:lineId',
    async (request) => {
      requireEmptyQuery(request.query);
      const mutation = await context(identity, request);
      const { id, pageId, lineId } = parseRequest(notaLinePath, request.params);
      return service.updateLine(
        mutation,
        id,
        pageId,
        lineId,
        parseRequest(updateLineBody, request.body),
      );
    },
  );

  app.delete<{ Params: { id: string; pageId: string; lineId: string } }>(
    '/v1/notas/:id/pages/:pageId/lines/:lineId',
    async (request) => {
      requireEmptyQuery(request.query);
      const mutation = await context(identity, request);
      const { id, pageId, lineId } = parseRequest(notaLinePath, request.params);
      return service.deleteLine(
        mutation,
        id,
        pageId,
        lineId,
        parseRequest(deleteLineBody, request.body),
      );
    },
  );

  app.post<{ Params: { id: string } }>('/v1/notas/:id/complete', async (request) => {
    requireEmptyQuery(request.query);
    const mutation = await context(identity, request);
    const { id } = parseRequest(uuidPath, request.params);
    return service.complete(
      mutation,
      id,
      parseRequest(completeNotaBody, request.body),
    );
  });

  for (const action of ['reopen', 'cancel', 'restore'] as const) {
    app.post<{ Params: { id: string } }>(
      `/v1/notas/:id/${action}`,
      async (request) => {
        requireEmptyQuery(request.query);
        const mutation = await context(identity, request);
        const { id } = parseRequest(uuidPath, request.params);
        const input = parseRequest(notaLifecycleBody, request.body);
        return service[action](mutation, id, input);
      },
    );
  }

  app.post<{ Params: { id: string } }>(
    '/v1/conflicts/:id/resolve',
    async (request) => {
      requireEmptyQuery(request.query);
      const mutation = await context(identity, request);
      const { id } = parseRequest(uuidPath, request.params);
      return service.resolveConflict(
        mutation,
        id,
        parseRequest(resolveConflictBody, request.body),
      );
    },
  );
}
