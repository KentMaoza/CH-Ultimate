import type { FastifyInstance } from 'fastify';

import { authenticateRequest } from './request-auth.js';
import type { ProtocolServices } from './protocol-types.js';

export function registerSyncRoutes(
  app: FastifyInstance,
  services: ProtocolServices,
): void {
  app.get('/v1/bootstrap', async (request) => {
    await authenticateRequest(services.identity, request);
    return services.sync.bootstrap();
  });

  app.get<{
    Querystring: { after?: string; limit?: string };
  }>('/v1/changes', async (request) => {
    await authenticateRequest(services.identity, request);
    return services.sync.changes({
      after: request.query.after ?? '',
      limit:
        request.query.limit === undefined
          ? 100
          : Number(request.query.limit),
    });
  });
}
