import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type {
  CatalogueCommitResult,
  CatalogueDevice,
  CatalogueValidationResult,
} from '../catalogue/service.js';
import { MAX_XLSX_BYTES } from '../catalogue/xlsx-archive.js';
import { authenticateRequest, requireOwner } from './request-auth.js';
import {
  parseRequest,
  requireEmptyQuery,
  requireNoBody,
} from './request-validation.js';
import type { ProtocolIdentityService } from './protocol-types.js';

const MAX_BASE64_BYTES = Math.ceil(MAX_XLSX_BYTES / 3) * 4;
const validateBody = z
  .object({
    fileName: z.string().min(1).max(255),
    workbookBase64: z
      .string()
      .min(1)
      .max(MAX_BASE64_BYTES)
      .refine((value) => {
        try {
          return Buffer.from(value, 'base64').toString('base64') === value;
        } catch {
          return false;
        }
      }),
  })
  .strict();
const importPath = z
  .object({
    id: z
      .string()
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
  })
  .strict();
const imagePath = z
  .object({ hash: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict();

export interface CatalogueHttpServices {
  imports: {
    validate(
      device: CatalogueDevice,
      input: { fileName: string; bytes: Buffer },
    ): Promise<CatalogueValidationResult>;
    commit(
      device: CatalogueDevice,
      importId: string,
    ): Promise<CatalogueCommitResult>;
  };
  images: {
    read(hash: string): Promise<{ bytes: Buffer; mimeType: string }>;
  };
}

export function registerCatalogueRoutes(
  app: FastifyInstance,
  identity: ProtocolIdentityService,
  services: CatalogueHttpServices,
): void {
  app.post(
    '/v1/imports/validate',
    { bodyLimit: MAX_BASE64_BYTES + 1024 },
    async (request) => {
      requireEmptyQuery(request.query);
      const authenticated = await authenticateRequest(identity, request);
      requireOwner(authenticated.device);
      const body = parseRequest(validateBody, request.body);
      const bytes = Buffer.from(body.workbookBase64, 'base64');
      if (bytes.length > MAX_XLSX_BYTES) {
        const error = new Error('XLSX too large');
        Object.assign(error, { statusCode: 413 });
        throw error;
      }
      return services.imports.validate(authenticated.device, {
        fileName: body.fileName,
        bytes,
      });
    },
  );

  app.post('/v1/imports/:id/commit', async (request) => {
    requireEmptyQuery(request.query);
    requireNoBody(request.body);
    const authenticated = await authenticateRequest(identity, request);
    requireOwner(authenticated.device);
    const params = parseRequest(importPath, request.params);
    return services.imports.commit(authenticated.device, params.id);
  });

  app.get('/v1/images/:hash', async (request, reply) => {
    requireEmptyQuery(request.query);
    await authenticateRequest(identity, request);
    const params = parseRequest(imagePath, request.params);
    const image = await services.images.read(params.hash);
    const response = reply
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff');
    return request.headers.accept
      ?.toLowerCase()
      .split(',')
      .some((value) => value.trim().startsWith('application/json'))
      ? response.send({
          mimeType: image.mimeType,
          bytesBase64: image.bytes.toString('base64'),
        })
      : response.type(image.mimeType).send(image.bytes);
  });
}
