import type { FastifyInstance } from 'fastify';

import {
  authenticateRequest,
  requireOwner,
} from './request-auth.js';
import {
  ownerBootstrapBody,
  pairingRedeemBody,
  parseRequest,
  requireEmptyQuery,
  requireNoBody,
  rotateTokenBody,
  uuidPath,
} from './request-validation.js';
import type { ProtocolIdentityService } from './protocol-types.js';

export function registerIdentityRoutes(
  app: FastifyInstance,
  identity: ProtocolIdentityService,
): void {
  app.post('/v1/owner/bootstrap', async (request, reply) => {
    requireEmptyQuery(request.query);
    const input = parseRequest(ownerBootstrapBody, request.body);
    const result = await identity.bootstrapOwner(input);
    return reply.code(201).send(result);
  });

  app.post('/v1/pairings', async (request, reply) => {
    requireNoBody(request.body);
    requireEmptyQuery(request.query);
    const authenticated = await authenticateRequest(identity, request);
    requireOwner(authenticated.device);
    const result = await identity.createPairing(authenticated.device.id);
    return reply.code(201).send(result);
  });

  app.post('/v1/pairings/redeem', async (request, reply) => {
    requireEmptyQuery(request.query);
    const input = parseRequest(pairingRedeemBody, request.body);
    if (input.phase === 'claim') {
      const result = await identity.claimPairing(request.ip, {
        code: input.code,
        requestId: input.requestId,
        claimSecret: input.claimSecret,
        installationId: input.installationId,
        displayName: input.displayName,
        platform: input.platform,
      });
      return reply.code(202).send(result);
    }
    return identity.completePairing({
      pairingId: input.pairingId,
      claimSecret: input.claimSecret,
      deviceToken: input.deviceToken,
    });
  });

  app.post<{ Params: { id: string } }>(
    '/v1/pairings/:id/approve',
    async (request) => {
      requireNoBody(request.body);
      requireEmptyQuery(request.query);
      const { id } = parseRequest(uuidPath, request.params);
      const authenticated = await authenticateRequest(identity, request);
      requireOwner(authenticated.device);
      return identity.approvePairing(authenticated.device.id, id);
    },
  );

  app.get('/v1/devices', async (request) => {
    requireEmptyQuery(request.query);
    const authenticated = await authenticateRequest(identity, request);
    requireOwner(authenticated.device);
    return {
      devices: await identity.listDevices(authenticated.device.id),
    };
  });

  app.post<{ Params: { id: string } }>(
    '/v1/devices/:id/revoke',
    async (request) => {
      requireNoBody(request.body);
      requireEmptyQuery(request.query);
      const { id } = parseRequest(uuidPath, request.params);
      const authenticated = await authenticateRequest(identity, request);
      requireOwner(authenticated.device);
      return identity.revokeDevice(authenticated.device.id, id);
    },
  );

  app.post('/v1/auth/token/rotate', async (request) => {
    requireEmptyQuery(request.query);
    const { nextDeviceToken } = parseRequest(
      rotateTokenBody,
      request.body,
    );
    const authenticated = await authenticateRequest(identity, request);
    return identity.rotateDeviceToken(
      authenticated.device.id,
      authenticated.token,
      nextDeviceToken,
    );
  });
}
