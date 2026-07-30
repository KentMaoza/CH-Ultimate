import Fastify, { type FastifyInstance } from 'fastify';

import {
  assertSchemaCompatible,
  type SchemaQueryPool,
} from './db/migrate.js';
import {
  registerProtocolRoutes,
  type ProtocolServices,
} from './http/routes.js';
import {
  registerCatalogueRoutes,
  type CatalogueHttpServices,
} from './http/catalogue-routes.js';
import {
  registerCatalogueOperationRoutes,
  type CatalogueOperationHttpService,
} from './http/catalogue-operation-routes.js';
import { registerNotaRoutes, type NotaHttpService } from './http/nota-routes.js';
import {
  registerOfflineRoutes,
  type OfflineHttpService,
} from './http/offline-routes.js';

export interface AppDependencies {
  pool: SchemaQueryPool;
  protocol?: ProtocolServices;
  catalogue?: CatalogueHttpServices;
  operations?: CatalogueOperationHttpService;
  nota?: NotaHttpService;
  offline?: OfflineHttpService;
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
    if (deps.catalogue) {
      registerCatalogueRoutes(app, deps.protocol.identity, deps.catalogue);
    }
    if (deps.operations) {
      registerCatalogueOperationRoutes(
        app,
        deps.protocol.identity,
        deps.operations,
      );
    }
    if (deps.nota) {
      registerNotaRoutes(app, deps.protocol.identity, deps.nota);
    }
    if (deps.offline) {
      registerOfflineRoutes(app, deps.protocol.identity, deps.offline);
    }
  }

  return app;
}
