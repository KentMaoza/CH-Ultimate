import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { IdentityError } from '../src/auth/identity.js';
import { CatalogueError } from '../src/catalogue/service.js';

const owner = {
  id: '11111111-1111-4111-8111-111111111111',
  installationId: '22222222-2222-4222-8222-222222222222',
  role: 'owner' as const,
  displayName: 'Owner Mac',
  platform: 'macos',
  tokenExpiresAt: '2027-01-25T00:00:00.000Z',
  approvedAt: '2026-07-29T00:00:00.000Z',
  revokedAt: null,
  tokenKind: 'current' as const,
};

function png(width = 32, height = 24): Buffer {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function harness() {
  const validate = vi.fn(async () => ({
    importId: '33333333-3333-4333-8333-333333333333',
    workbookSha256: 'a'.repeat(64),
    sourceFileName: 'catalogue.xlsx',
    status: 'staged' as const,
    preview: {
      rowCount: 1,
      imageJobCount: 1,
      missingImageCount: 0,
      priceMismatchCount: 0,
      selectedPriceTotal: 100,
      stockTotal: 1,
      maximumCellTextLength: 20,
      warnings: [],
      priceMismatches: [],
    },
    expiresAt: '2026-07-31T00:00:00.000Z',
    committedAt: null,
  }));
  const commit = vi.fn(async () => ({
    importId: '33333333-3333-4333-8333-333333333333',
    workbookSha256: 'a'.repeat(64),
    rowCount: 1,
    imageJobCount: 1,
    committedAt: '2026-07-30T00:00:00.000Z',
    replayed: false,
  }));
  const read = vi.fn(async () => ({
    bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    mimeType: 'image/png',
  }));
  const identity = {
    bootstrapOwner: vi.fn(),
    authenticate: vi.fn(async (token: string) => {
      if (token === 'owner-token') return owner;
      if (token === 'client-token') {
        return { ...owner, role: 'client' as const };
      }
      throw new IdentityError('UNAUTHORIZED', 401, 'Unauthorized');
    }),
    createPairing: vi.fn(),
    inspectPairing: vi.fn(),
    claimPairing: vi.fn(),
    approvePairing: vi.fn(),
    completePairing: vi.fn(),
    listDevices: vi.fn(),
    revokeDevice: vi.fn(),
    rotateDeviceToken: vi.fn(),
  };
  const app = buildApp({
    pool: { query: async <T>() => [{ version: 7 }] as T },
    protocol: {
      identity,
      sync: { bootstrap: vi.fn(), changes: vi.fn() },
    },
    catalogue: {
      imports: { validate, commit },
      images: { read },
    },
  });
  return { app, commit, read, validate };
}

describe('catalogue HTTP boundary', () => {
  it('accepts owner-only validate and commit requests with bounded base64 input', async () => {
    const { app, commit, validate } = harness();
    const client = await app.inject({
      method: 'POST',
      url: '/v1/imports/validate',
      headers: { authorization: 'Bearer client-token' },
      payload: {
        fileName: 'catalogue.xlsx',
        workbookBase64: Buffer.from('xlsx').toString('base64'),
      },
    });
    expect(client.statusCode).toBe(403);
    expect(validate).not.toHaveBeenCalled();

    const validated = await app.inject({
      method: 'POST',
      url: '/v1/imports/validate',
      headers: { authorization: 'Bearer owner-token' },
      payload: {
        fileName: 'catalogue.xlsx',
        workbookBase64: Buffer.from('xlsx').toString('base64'),
      },
    });
    expect(validated.statusCode).toBe(200);
    expect(validate).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({
        fileName: 'catalogue.xlsx',
        bytes: Buffer.from('xlsx'),
      }),
    );

    const committed = await app.inject({
      method: 'POST',
      url: '/v1/imports/33333333-3333-4333-8333-333333333333/commit',
      headers: { authorization: 'Bearer owner-token' },
    });
    expect(committed.statusCode).toBe(200);
    expect(commit).toHaveBeenCalledWith(
      owner,
      '33333333-3333-4333-8333-333333333333',
    );
    await app.close();
  });

  it('serves only authenticated hash-addressed image bytes as private media', async () => {
    const { app, read } = harness();
    const hash = 'b'.repeat(64);

    const unauthenticated = await app.inject({
      method: 'GET',
      url: `/v1/images/${hash}`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/images/${hash}`,
      headers: { authorization: 'Bearer client-token' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.rawPayload).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(read).toHaveBeenCalledWith(hash);

    const invalidHash = await app.inject({
      method: 'GET',
      url: `/v1/images/${'z'.repeat(64)}`,
      headers: { authorization: 'Bearer client-token' },
    });
    expect(invalidHash.statusCode).toBe(400);
    const traversal = await app.inject({
      method: 'GET',
      url: '/v1/images/%2e%2e',
      headers: { authorization: 'Bearer client-token' },
    });
    expect(traversal.statusCode).toBe(404);
    expect(read).toHaveBeenCalledOnce();
    await app.close();
  });

  it('returns an authenticated JSON image envelope to native transports', async () => {
    const { app } = harness();
    const hash = 'b'.repeat(64);

    const response = await app.inject({
      method: 'GET',
      url: `/v1/images/${hash}`,
      headers: {
        authorization: 'Bearer client-token',
        accept: 'application/json',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      mimeType: 'image/png',
      bytesBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
    });
    expect(response.headers['cache-control']).toContain('private');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('does not expose an unaudited direct image mutation route', async () => {
    const { app } = harness();
    const bytes = png();
    const payload = {
      mimeType: 'image/png',
      bytesBase64: bytes.toString('base64'),
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/images',
      headers: { authorization: 'Bearer client-token' },
      payload,
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('preserves catalogue error codes at the HTTP boundary', async () => {
    const { app, validate } = harness();
    validate.mockRejectedValueOnce(
      new CatalogueError(
        'UNEXPECTED_WORKBOOK_HASH',
        422,
        'Workbook tidak disetujui.',
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/v1/imports/validate',
      headers: { authorization: 'Bearer owner-token' },
      payload: {
        fileName: 'catalogue.xlsx',
        workbookBase64: Buffer.from('xlsx').toString('base64'),
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ code: 'UNEXPECTED_WORKBOOK_HASH' });
    await app.close();
  });
});
