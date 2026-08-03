import { describe, expect, it } from 'vitest';

import { IdentityError } from '../src/auth/identity.js';
import {
  bootstrapTestOwner,
  clientInstallationId,
  createIdentityHarness,
  opaqueSecret,
} from './support/identity-harness.js';

describe('pairing', () => {
  it('shows the owner only the public lifecycle and claimed device identity', async () => {
    const { service } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapTestOwner(service);
    const pairing = await service.createPairing(owner.device.id);

    await expect(
      service.inspectPairing(owner.device.id, pairing.pairingId),
    ).resolves.toEqual({
      pairingId: pairing.pairingId,
      state: 'available',
      expiresAt: pairing.expiresAt,
    });

    const claimSecret = opaqueSecret(35);
    await service.claimPairing('198.51.100.35', {
      code: pairing.code,
      requestId: '35353535-3535-4535-8535-353535353535',
      claimSecret,
      installationId: clientInstallationId,
      displayName: 'HP Gudang',
      platform: 'android',
    });
    await expect(
      service.inspectPairing(owner.device.id, pairing.pairingId),
    ).resolves.toEqual({
      pairingId: pairing.pairingId,
      state: 'pending',
      expiresAt: pairing.expiresAt,
      requestedDevice: { displayName: 'HP Gudang', platform: 'android' },
    });

    await service.approvePairing(owner.device.id, pairing.pairingId);
    await expect(
      service.inspectPairing(owner.device.id, pairing.pairingId),
    ).resolves.toEqual({
      pairingId: pairing.pairingId,
      state: 'approved',
      expiresAt: pairing.expiresAt,
      requestedDevice: { displayName: 'HP Gudang', platform: 'android' },
    });

    await service.completePairing({
      pairingId: pairing.pairingId,
      claimSecret,
      deviceToken: opaqueSecret(36),
    });
    await expect(
      service.inspectPairing(owner.device.id, pairing.pairingId),
    ).resolves.toEqual({
      pairingId: pairing.pairingId,
      state: 'consumed',
      expiresAt: pairing.expiresAt,
      requestedDevice: { displayName: 'HP Gudang', platform: 'android' },
    });
  });

  it('reports expiry and rejects non-owner, missing, or malformed inspection', async () => {
    const { service, setNow } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapTestOwner(service);
    const pairing = await service.createPairing(owner.device.id);

    setNow('2026-07-29T00:10:00.001Z');
    await expect(
      service.inspectPairing(owner.device.id, pairing.pairingId),
    ).resolves.toEqual({
      pairingId: pairing.pairingId,
      state: 'expired',
      expiresAt: pairing.expiresAt,
    });
    await expect(
      service.inspectPairing('not-the-owner', pairing.pairingId),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    await expect(
      service.inspectPairing(
        owner.device.id,
        '99999999-9999-4999-8999-999999999999',
      ),
    ).rejects.toMatchObject({ code: 'PAIRING_REJECTED', statusCode: 400 });
    await expect(
      service.inspectPairing(owner.device.id, 'not-a-uuid'),
    ).rejects.toMatchObject({ code: 'PAIRING_REJECTED', statusCode: 400 });
  });

  it('uses an eight-digit one-use code and gives no detail for expired or reused codes', async () => {
    const { service, setNow } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapTestOwner(service);
    const expired = await service.createPairing(owner.device.id);
    expect(expired.code).toMatch(/^\d{8}$/);

    setNow('2026-07-29T00:10:00.001Z');
    await expect(
      service.claimPairing('198.51.100.1', {
        code: expired.code,
        requestId: '44444444-4444-4444-8444-444444444444',
        claimSecret: opaqueSecret(40),
        installationId: clientInstallationId,
        displayName: 'Client Phone',
        platform: 'android',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'PAIRING_REJECTED',
        message: 'Pairing request rejected',
      }),
    );

    const active = await service.createPairing(owner.device.id);
    await service.claimPairing('198.51.100.2', {
      code: active.code,
      requestId: '55555555-5555-4555-8555-555555555555',
      claimSecret: opaqueSecret(41),
      installationId: clientInstallationId,
      displayName: 'Client Phone',
      platform: 'android',
    });

    await expect(
      service.claimPairing('198.51.100.3', {
        code: active.code,
        requestId: '66666666-6666-4666-8666-666666666666',
        claimSecret: opaqueSecret(42),
        installationId: clientInstallationId,
        displayName: 'Client Phone',
        platform: 'android',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'PAIRING_REJECTED',
        message: 'Pairing request rejected',
      }),
    );
  });

  it('requires explicit approval and rejects a consumed claim with another token', async () => {
    const { service, store } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapTestOwner(service);
    const pairing = await service.createPairing(owner.device.id);
    const claimSecret = opaqueSecret(43);
    const claim = await service.claimPairing('198.51.100.4', {
      code: pairing.code,
      requestId: '77777777-7777-4777-8777-777777777777',
      claimSecret,
      installationId: clientInstallationId,
      displayName: 'Client Phone',
      platform: 'android',
    });

    await expect(
      service.completePairing({
        pairingId: claim.pairingId,
        claimSecret,
        deviceToken: opaqueSecret(44),
      }),
    ).rejects.toMatchObject({ code: 'PAIRING_REJECTED' });

    await expect(
      service.approvePairing(owner.device.id, claim.pairingId),
    ).resolves.toEqual({ status: 'approved' });
    const deviceToken = opaqueSecret(45);
    const completed = await service.completePairing({
      pairingId: claim.pairingId,
      claimSecret,
      deviceToken,
    });

    expect(completed.device.role).toBe('client');
    expect(
      [...store.devices.values()].find(
        (device) => device.id === completed.device.id,
      )?.tokenHash.toString('base64url'),
    ).not.toBe(deviceToken);
    await expect(
      service.completePairing({
        pairingId: claim.pairingId,
        claimSecret,
        deviceToken: opaqueSecret(46),
      }),
    ).rejects.toMatchObject({ code: 'PAIRING_REJECTED' });
  });

  it('limits initial redemption to five attempts per source in ten minutes', async () => {
    const { service } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const input = {
      code: '99999999',
      requestId: '88888888-8888-4888-8888-888888888888',
      claimSecret: opaqueSecret(47),
      installationId: clientInstallationId,
      displayName: 'Client Phone',
      platform: 'android',
    };

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        service.claimPairing('198.51.100.5', input),
      ).rejects.toMatchObject({ code: 'PAIRING_REJECTED' });
    }
    await expect(
      service.claimPairing('198.51.100.5', input),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      statusCode: 429,
    });
  });
});

describe('device authentication', () => {
  it('accepts the current token and the previous token for exactly seven days', async () => {
    const { service, setNow } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapTestOwner(service);
    const rotatedToken = opaqueSecret(50);

    await service.rotateDeviceToken(
      owner.device.id,
      owner.deviceToken,
      rotatedToken,
    );
    await expect(service.authenticate(rotatedToken)).resolves.toMatchObject({
      id: owner.device.id,
      tokenKind: 'current',
    });
    await expect(service.authenticate(owner.deviceToken)).resolves.toMatchObject({
      id: owner.device.id,
      tokenKind: 'previous',
    });

    setNow('2026-08-05T00:00:00.001Z');
    await expect(service.authenticate(owner.deviceToken)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      statusCode: 401,
    });
    await expect(service.authenticate(rotatedToken)).resolves.toMatchObject({
      id: owner.device.id,
    });
  });

  it('revokes current and previous tokens immediately', async () => {
    const { service } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapTestOwner(service);
    const rotatedToken = opaqueSecret(51);
    await service.rotateDeviceToken(
      owner.device.id,
      owner.deviceToken,
      rotatedToken,
    );

    await service.revokeDevice(owner.device.id, owner.device.id);

    for (const token of [owner.deviceToken, rotatedToken]) {
      await expect(service.authenticate(token)).rejects.toBeInstanceOf(
        IdentityError,
      );
      await expect(service.authenticate(token)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        statusCode: 401,
      });
    }
  });
});
