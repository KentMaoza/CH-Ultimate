import { describe, expect, it } from 'vitest';

import {
  bootstrapTestOwner,
  clientInstallationId,
  createIdentityHarness,
  opaqueSecret,
} from './support/identity-harness.js';

describe('caller-retained pairing credentials', () => {
  it('replays the same pending claim after a dropped response', async () => {
    const { service, store } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapTestOwner(service);
    const pairing = await service.createPairing(owner.device.id);
    const input = {
      code: pairing.code,
      requestId: '55555555-5555-4555-8555-555555555555',
      claimSecret: opaqueSecret(41),
      installationId: clientInstallationId,
      displayName: 'Client Phone',
      platform: 'android',
    };

    const claim = await service.claimPairing('198.51.100.2', input);
    const replay = await service.claimPairing('198.51.100.2', input);

    expect(replay).toEqual(claim);
    expect(claim).toEqual({
      pairingId: expect.any(String),
      status: 'pending',
    });
    const storedClaim = store.pairings.get(claim.pairingId);
    expect(storedClaim?.claimHash).toHaveLength(32);
    expect(storedClaim?.claimHash?.toString('base64url')).not.toBe(
      input.claimSecret,
    );
    expect(store.audits.filter((event) => event.action === 'pairing.claim')).toHaveLength(1);
  });

  it('replays completion with the same caller device token', async () => {
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
    await service.approvePairing(owner.device.id, claim.pairingId);
    const deviceToken = opaqueSecret(45);
    const input = { pairingId: claim.pairingId, claimSecret, deviceToken };

    const completed = await service.completePairing(input);
    const replay = await service.completePairing(input);

    expect(replay).toEqual(completed);
    expect(completed).not.toHaveProperty('deviceToken');
    expect(
      [...store.devices.values()].find(
        (device) => device.id === completed.device.id,
      )?.tokenHash.toString('base64url'),
    ).not.toBe(deviceToken);
    expect(
      store.audits.filter((event) => event.action === 'pairing.complete'),
    ).toHaveLength(1);
  });

  it('writes non-secret audit and change events for every identity mutation', async () => {
    const { service, store } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapTestOwner(service);
    const pairing = await service.createPairing(owner.device.id);
    const claimSecret = opaqueSecret(60);
    const claim = await service.claimPairing('198.51.100.9', {
      code: pairing.code,
      requestId: '99999999-9999-4999-8999-999999999999',
      claimSecret,
      installationId: clientInstallationId,
      displayName: 'Client Phone',
      platform: 'android',
    });
    await service.approvePairing(owner.device.id, claim.pairingId);
    const clientToken = opaqueSecret(61);
    const completed = await service.completePairing({
      pairingId: claim.pairingId,
      claimSecret,
      deviceToken: clientToken,
    });
    await service.rotateDeviceToken(
      owner.device.id,
      owner.deviceToken,
      opaqueSecret(62),
    );
    await service.revokeDevice(owner.device.id, completed.device.id);

    expect(store.audits.map((event) => event.action)).toEqual([
      'owner.bootstrap',
      'pairing.create',
      'pairing.claim',
      'pairing.approve',
      'pairing.complete',
      'device.token.rotate',
      'device.revoke',
    ]);
    expect(store.changes.map((event) => event.entityType)).toEqual([
      'device',
      'pairing',
      'pairing',
      'pairing',
      'device',
      'pairing',
      'device',
      'device',
    ]);
    const serialized = JSON.stringify({
      audits: store.audits,
      changes: store.changes,
    });
    for (const secret of [
      owner.deviceToken,
      owner.recoveryCredential,
      pairing.code,
      claimSecret,
      clientToken,
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('caller-retained token rotation', () => {
  it('replays the same next token while the previous token overlaps', async () => {
    const { service } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const owner = await bootstrapTestOwner(service);
    const nextToken = opaqueSecret(50);

    const rotated = await service.rotateDeviceToken(
      owner.device.id,
      owner.deviceToken,
      nextToken,
    );
    const replay = await service.rotateDeviceToken(
      owner.device.id,
      owner.deviceToken,
      nextToken,
    );

    expect(replay).toEqual(rotated);
    expect(rotated).not.toHaveProperty('deviceToken');
    await expect(service.authenticate(nextToken)).resolves.toMatchObject({
      id: owner.device.id,
      tokenKind: 'current',
    });
    await expect(service.authenticate(owner.deviceToken)).resolves.toMatchObject({
      id: owner.device.id,
      tokenKind: 'previous',
    });
  });
});
