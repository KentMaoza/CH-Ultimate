import { randomBytes, randomUUID } from 'node:crypto';

import type {
  CoreApiRequest,
  CoreApiResponse,
} from '../gateway/core-api-transport';
import type {
  CoreCredentialState,
  CoreCredentialStore,
} from './core-credential-store';

export interface OwnerEnrollmentInput {
  mode: 'bootstrap' | 'recovery';
  displayName: string;
  bootstrapSecret?: string;
}

export interface PairingClaimInput {
  code: string;
  displayName: string;
}

export interface CoreIdentityMainDependencies {
  store: CoreCredentialStore;
  send(
    request: CoreApiRequest,
    authorization?: string,
  ): Promise<CoreApiResponse>;
  randomUuid?: () => string;
  randomSecret?: () => string;
  platform: string;
}

function requireDisplayName(displayName: string): string {
  const value = displayName.trim();
  if (value.length === 0 || value.length > 160) {
    throw new Error('Nama perangkat tidak valid.');
  }
  return value;
}

function requireSuccessfulDevice(response: CoreApiResponse): string {
  const device =
    typeof response.body === 'object' && response.body !== null
      ? Reflect.get(response.body, 'device')
      : undefined;
  const deviceId =
    typeof device === 'object' && device !== null
      ? Reflect.get(device, 'id')
      : undefined;
  if (
    response.status < 200 ||
    response.status >= 300 ||
    typeof deviceId !== 'string'
  ) {
    throw new Error('Respons identitas CH Core tidak valid.');
  }
  return deviceId;
}

function requirePendingPairing(response: CoreApiResponse) {
  const pairingId =
    typeof response.body === 'object' && response.body !== null
      ? Reflect.get(response.body, 'pairingId')
      : undefined;
  const status =
    typeof response.body === 'object' && response.body !== null
      ? Reflect.get(response.body, 'status')
      : undefined;
  if (
    response.status !== 202 ||
    typeof pairingId !== 'string' ||
    status !== 'pending'
  ) {
    throw new Error('Respons pemasangan CH Core tidak valid.');
  }
  return { pairingId, status: 'pending' as const };
}

export function createCoreIdentityMain(
  dependencies: CoreIdentityMainDependencies,
) {
  const makeUuid = dependencies.randomUuid ?? randomUUID;
  const makeSecret =
    dependencies.randomSecret ??
    (() => randomBytes(32).toString('base64url'));

  const stateOrNew = async (): Promise<CoreCredentialState> =>
    (await dependencies.store.load()) ?? {
      version: 1,
      installationId: makeUuid(),
    };

  return {
    async enrollOwner(input: OwnerEnrollmentInput) {
      const displayName = requireDisplayName(input.displayName);
      const state = await stateOrNew();
      let pending = state.pendingEnrollment;
      if (
        !pending ||
        pending.mode !== input.mode ||
        pending.displayName !== displayName
      ) {
        if (input.mode === 'recovery' && !state.recoveryCredential) {
          throw new Error('Kredensial pemulihan CH Core tidak tersedia.');
        }
        pending = {
          mode: input.mode,
          deviceToken: makeSecret(),
          recoveryCredential:
            input.mode === 'recovery'
              ? state.recoveryCredential!
              : makeSecret(),
          nextRecoveryCredential:
            input.mode === 'recovery' ? makeSecret() : undefined,
          displayName,
        };
        await dependencies.store.save({
          ...state,
          pendingEnrollment: pending,
        });
      }
      if (input.mode === 'bootstrap' && !input.bootstrapSecret) {
        throw new Error('Kode penyiapan pemilik wajib diisi.');
      }
      const body =
        input.mode === 'bootstrap'
          ? {
              mode: 'bootstrap',
              bootstrapSecret: input.bootstrapSecret,
              deviceToken: pending.deviceToken,
              recoveryCredential: pending.recoveryCredential,
              installationId: state.installationId,
              displayName,
              platform: dependencies.platform,
            }
          : {
              mode: 'recovery',
              recoveryCredential: pending.recoveryCredential,
              nextRecoveryCredential: pending.nextRecoveryCredential,
              deviceToken: pending.deviceToken,
              installationId: state.installationId,
              displayName,
              platform: dependencies.platform,
            };
      const response = await dependencies.send({
        method: 'POST',
        path: '/v1/owner/bootstrap',
        body,
      });
      const deviceId = requireSuccessfulDevice(response);
      await dependencies.store.save({
        ...state,
        current: { deviceId, token: pending.deviceToken },
        recoveryCredential:
          pending.nextRecoveryCredential ?? pending.recoveryCredential,
        pendingEnrollment: undefined,
      });
      return { status: 'paired' as const, deviceId };
    },

    async claimPairing(input: PairingClaimInput) {
      if (!/^\d{8}$/.test(input.code)) {
        throw new Error('Kode pemasangan harus terdiri dari 8 angka.');
      }
      const displayName = requireDisplayName(input.displayName);
      const state = await stateOrNew();
      let pending = state.pendingPairing;
      if (
        !pending ||
        pending.code !== input.code ||
        pending.displayName !== displayName
      ) {
        pending = {
          code: input.code,
          requestId: makeUuid(),
          claimSecret: makeSecret(),
          displayName,
        };
        await dependencies.store.save({ ...state, pendingPairing: pending });
      }
      if (pending.pairingId) {
        return { pairingId: pending.pairingId, status: 'pending' as const };
      }
      const response = await dependencies.send({
        method: 'POST',
        path: '/v1/pairings/redeem',
        body: {
          phase: 'claim',
          code: input.code,
          requestId: pending.requestId,
          claimSecret: pending.claimSecret,
          installationId: state.installationId,
          displayName,
          platform: dependencies.platform,
        },
      });
      const result = requirePendingPairing(response);
      await dependencies.store.save({
        ...state,
        pendingPairing: { ...pending, pairingId: result.pairingId },
      });
      return result;
    },

    async completePairing() {
      const state = await stateOrNew();
      const pending = state.pendingPairing;
      if (!pending?.pairingId) {
        throw new Error('Permintaan pemasangan belum tersedia.');
      }
      const deviceToken = pending.deviceToken ?? makeSecret();
      if (!pending.deviceToken) {
        await dependencies.store.save({
          ...state,
          pendingPairing: { ...pending, deviceToken },
        });
      }
      const response = await dependencies.send({
        method: 'POST',
        path: '/v1/pairings/redeem',
        body: {
          phase: 'complete',
          pairingId: pending.pairingId,
          claimSecret: pending.claimSecret,
          deviceToken,
        },
      });
      const deviceId = requireSuccessfulDevice(response);
      await dependencies.store.save({
        ...state,
        current: { deviceId, token: deviceToken },
        pendingPairing: undefined,
      });
      return { status: 'paired' as const, deviceId };
    },

    async rotateToken() {
      const state = await stateOrNew();
      if (!state.current) throw new Error('Perangkat CH Core belum dipasangkan.');
      const nextToken = state.pendingRotation?.nextToken ?? makeSecret();
      if (!state.pendingRotation) {
        await dependencies.store.save({
          ...state,
          pendingRotation: { nextToken },
        });
      }
      const response = await dependencies.send(
        {
          method: 'POST',
          path: '/v1/auth/token/rotate',
          body: { nextDeviceToken: nextToken },
        },
        `Bearer ${state.current.token}`,
      );
      requireSuccessfulDevice(response);
      await dependencies.store.save({
        ...state,
        current: { ...state.current, token: nextToken },
        previousToken: state.current.token,
        pendingRotation: undefined,
      });
      return { status: 'rotated' as const };
    },
  };
}
