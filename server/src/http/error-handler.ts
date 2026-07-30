import type { FastifyInstance } from 'fastify';

import { IdentityError } from '../auth/identity.js';
import { CatalogueError } from '../catalogue/service.js';
import { CatalogueValidationError } from '../catalogue/xlsx-archive.js';
import { ImageDownloadError } from '../catalogue/image-download.js';
import {
  CatalogueConflictError,
  CatalogueOperationError,
} from '../catalogue/mariadb-sku-operations-repository.js';
import { IdempotencyError } from '../sync/idempotency.js';
import { SyncError } from '../sync/service.js';

export function installProtocolErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SyncError) {
      return reply.code(error.statusCode).send(
        error.code === 'CURSOR_AHEAD' && error.bootstrapRequired
          ? { code: error.code, bootstrapRequired: true }
          : { code: error.code },
      );
    }
    if (
      error instanceof IdentityError ||
      error instanceof IdempotencyError ||
      error instanceof CatalogueError
    ) {
      return reply.code(error.statusCode).send({ code: error.code });
    }
    if (
      error instanceof CatalogueValidationError ||
      error instanceof ImageDownloadError
    ) {
      return reply.code(422).send({ code: error.code });
    }
    if (error instanceof CatalogueConflictError) {
      return reply.code(409).send({
        code: 'CONFLICT',
        conflict: error.conflict,
      });
    }
    if (error instanceof CatalogueOperationError) {
      return reply.code(error.statusCode).send({ code: error.code });
    }
    const errorStatusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const statusCode = errorStatusCode < 500 ? errorStatusCode : 500;
    return reply
      .code(statusCode)
      .send({ code: statusCode === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST' });
  });
}
