import Fastify, { type FastifyInstance } from 'fastify';

import {
  assertSchemaCompatible,
  type SchemaQueryPool,
} from './db/migrate.js';
import {
  registerProtocolRoutes,
  type ProtocolServices,
} from './http/routes.js';

export interface AppDependencies {
  pool: SchemaQueryPool;
  protocol?: ProtocolServices;
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  // Pairing rate limits use the directly connected peer, never forwarded IPs.
  const app = Fastify({ logger: false, trustProxy: false });

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await assertSchemaCompatible(deps.pool);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  if (deps.protocol) {
    registerProtocolRoutes(app, deps.protocol);
  }

  return app;
}
