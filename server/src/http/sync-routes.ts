import type { FastifyInstance } from 'fastify';

import { authenticateRequest } from './request-auth.js';
import {
  changesQuery,
  parseRequest,
  requireEmptyQuery,
} from './request-validation.js';
import type { ProtocolServices } from './protocol-types.js';

export function registerSyncRoutes(
  app: FastifyInstance,
  services: ProtocolServices,
): void {
  app.get('/v1/bootstrap', async (request) => {
    requireEmptyQuery(request.query);
    const authenticated = await authenticateRequest(services.identity, request);
    return {
      ...(await services.sync.bootstrap()),
      deviceRole: authenticated.device.role,
    };
  });

  app.get('/v1/changes', async (request) => {
    const query = parseRequest(changesQuery, request.query);
    await authenticateRequest(services.identity, request);
    return services.sync.changes(query);
  });
}
