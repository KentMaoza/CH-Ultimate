import type { FastifyInstance } from 'fastify';

import type { OwnerBootstrapInput } from '../auth/identity.js';
import {
  authenticateRequest,
  requireOwner,
} from './request-auth.js';
import type { ProtocolIdentityService } from './protocol-types.js';

function bodyObject(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)
    : {};
}

export function registerIdentityRoutes(
  app: FastifyInstance,
  identity: ProtocolIdentityService,
): void {
  app.post('/v1/owner/bootstrap', async (request, reply) => {
    const body = bodyObject(request.body);
    const installation = {
      installationId: String(body.installationId ?? ''),
      displayName: String(body.displayName ?? ''),
      platform: String(body.platform ?? ''),
    };
    const input: OwnerBootstrapInput =
      typeof body.recoveryCredential === 'string'
        ? {
            ...installation,
            mode: 'recovery',
            recoveryCredential: body.recoveryCredential,
          }
        : {
            ...installation,
            mode: 'bootstrap',
            bootstrapSecret: String(body.bootstrapSecret ?? ''),
          };
    const result = await identity.bootstrapOwner(input);
    return reply.code(201).send(result);
  });

  app.post('/v1/pairings', async (request, reply) => {
    const authenticated = await authenticateRequest(identity, request);
    requireOwner(authenticated.device);
    const result = await identity.createPairing(authenticated.device.id);
    return reply.code(201).send(result);
  });

  app.post('/v1/pairings/redeem', async (request, reply) => {
    const body = bodyObject(request.body);
    if (typeof body.code === 'string') {
      const result = await identity.claimPairing(request.ip, {
        code: body.code,
        installationId: String(body.installationId ?? ''),
        displayName: String(body.displayName ?? ''),
        platform: String(body.platform ?? ''),
      });
      return reply.code(202).send(result);
    }
    const result = await identity.completePairing({
      pairingId: String(body.pairingId ?? ''),
      claimSecret: String(body.claimSecret ?? ''),
    });
    return reply.send(result);
  });

  app.post<{ Params: { id: string } }>(
    '/v1/pairings/:id/approve',
    async (request) => {
      const authenticated = await authenticateRequest(identity, request);
      requireOwner(authenticated.device);
      return identity.approvePairing(
        authenticated.device.id,
        request.params.id,
      );
    },
  );

  app.get('/v1/devices', async (request) => {
    const authenticated = await authenticateRequest(identity, request);
    requireOwner(authenticated.device);
    return {
      devices: await identity.listDevices(authenticated.device.id),
    };
  });

  app.post<{ Params: { id: string } }>(
    '/v1/devices/:id/revoke',
    async (request) => {
      const authenticated = await authenticateRequest(identity, request);
      requireOwner(authenticated.device);
      return identity.revokeDevice(
        authenticated.device.id,
        request.params.id,
      );
    },
  );

  app.post('/v1/auth/token/rotate', async (request) => {
    const authenticated = await authenticateRequest(identity, request);
    return identity.rotateDeviceToken(
      authenticated.device.id,
      authenticated.token,
    );
  });
}
