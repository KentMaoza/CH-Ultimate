import Fastify, { type FastifyInstance } from 'fastify';

import {
  assertSchemaCompatible,
  type SchemaQueryPool,
} from './db/migrate.js';

export interface AppDependencies {
  pool: SchemaQueryPool;
}

export function buildApp(deps: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health/live', async () => ({ status: 'ok' }));

  app.get('/health/ready', async (_request, reply) => {
    try {
      await assertSchemaCompatible(deps.pool);
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

  return app;
}
