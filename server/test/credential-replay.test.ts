import { describe, expect, it } from 'vitest';

import {
  bootstrapTestOwner,
  createIdentityHarness,
  opaqueSecret,
  ownerInstallationId,
} from './support/identity-harness.js';

describe('caller-retained owner credentials', () => {
  it('fails closed when no minimum-length bootstrap secret is configured', async () => {
    const { service } = createIdentityHarness();

    await expect(bootstrapTestOwner(service)).rejects.toMatchObject({
      code: 'BOOTSTRAP_DISABLED',
      statusCode: 403,
    });
  });

  it('replays a dropped bootstrap response without returning plaintext', async () => {
    const { service, store } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const deviceToken = opaqueSecret(92);
    const recoveryCredential = opaqueSecret(93);
    const input = {
      mode: 'bootstrap' as const,
      bootstrapSecret: 's'.repeat(32),
      installationId: ownerInstallationId,
      displayName: 'Owner Mac',
      platform: 'macos',
      deviceToken,
      recoveryCredential,
    };

    const result = await service.bootstrapOwner(input);
    const replay = await service.bootstrapOwner(input);
    const [device] = [...store.devices.values()];

    expect(replay).toEqual(result);
    expect(result).not.toHaveProperty('deviceToken');
    expect(result).not.toHaveProperty('recoveryCredential');
    expect(result.device.tokenExpiresAt).toBe('2027-01-25T00:00:00.000Z');
    expect(device?.tokenHash).toHaveLength(32);
    expect(device?.tokenHash.toString('base64url')).not.toBe(deviceToken);
    expect(store.recovery?.credentialHash).toHaveLength(32);
    expect(store.recovery?.credentialHash.toString('base64url')).not.toBe(
      recoveryCredential,
    );
    expect(store.devices).toHaveLength(1);
    expect(store.audits.map((event) => event.action)).toEqual([
      'owner.bootstrap',
    ]);
  });

  it('replays recovery with the same next credentials after commit', async () => {
    const { service, store } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    const initial = await bootstrapTestOwner(service);
    const replacementInstallationId =
      '33333333-3333-4333-8333-333333333333';
    const input = {
      mode: 'recovery' as const,
      recoveryCredential: initial.recoveryCredential,
      nextRecoveryCredential: opaqueSecret(94),
      deviceToken: opaqueSecret(95),
      installationId: replacementInstallationId,
      displayName: 'Replacement Mac',
      platform: 'macos',
    };

    const recovered = await service.bootstrapOwner(input);
    const replay = await service.bootstrapOwner(input);

    expect(replay).toEqual(recovered);
    expect(recovered).not.toHaveProperty('deviceToken');
    expect(recovered).not.toHaveProperty('recoveryCredential');
    expect(store.recovery?.credentialVersion).toBe(2n);
    expect(
      [...store.devices.values()].find(
        (device) => device.installationId === ownerInstallationId,
      )?.revokedAt,
    ).not.toBeNull();
    expect(
      [...store.devices.values()].find(
        (device) => device.installationId === replacementInstallationId,
      )?.role,
    ).toBe('owner');
    expect(store.audits.map((event) => event.action)).toEqual([
      'owner.bootstrap',
      'owner.recover',
    ]);
  });

  it('rolls back owner state when its same-transaction audit fails', async () => {
    const { service, store } = createIdentityHarness({
      bootstrapSecret: 's'.repeat(32),
    });
    store.failAudit = true;

    await expect(bootstrapTestOwner(service)).rejects.toThrow(
      'deliberate audit failure',
    );

    expect(store.devices).toHaveLength(0);
    expect(store.recovery).toBeNull();
    expect(store.audits).toEqual([]);
    expect(store.changes).toEqual([]);
  });
});
