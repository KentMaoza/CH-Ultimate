import type { FastifyInstance } from 'fastify';

import { installProtocolErrorHandler } from './error-handler.js';
import { registerIdentityRoutes } from './identity-routes.js';
import type { ProtocolServices } from './protocol-types.js';
import { registerSyncRoutes } from './sync-routes.js';

export function registerProtocolRoutes(
  app: FastifyInstance,
  services: ProtocolServices,
): void {
  installProtocolErrorHandler(app);
  registerIdentityRoutes(app, services.identity);
  registerSyncRoutes(app, services);
}

export type { ProtocolServices } from './protocol-types.js';
