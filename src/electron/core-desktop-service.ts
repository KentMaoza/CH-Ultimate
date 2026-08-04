import type { CoreApiRequest } from '../gateway/core-api-transport';
import { readBoundedFile } from './bounded-file-read';
import {
  createCoreApiMain,
  parseCoreEndpointConfig,
  validateCoreOperationRequest,
  type CoreEndpointConfig,
} from './core-api-main';
import type {
  ChCoreBridge,
  CoreCredentialStatus,
} from './core-bridge-contract';
import type { CoreCredentialStore } from './core-credential-store';
import {
  createCoreHttpsClient,
  type CoreHttpsClientOptions,
} from './core-https-client';
import { createCoreIdentityMain } from './core-identity-main';
import { createCoreOwnerPairingMain } from './core-owner-pairing-main';

export interface CoreDesktopServiceOptions {
  configPath: string;
  production: boolean;
  store: CoreCredentialStore;
  platform: string;
  readFile?: (filePath: string, maxBytes: number) => Promise<Buffer>;
  requestImpl?: CoreHttpsClientOptions['requestImpl'];
}

type ConfigResult =
  | { status: 'ready'; config: CoreEndpointConfig; ca: Buffer }
  | { status: 'missing' | 'invalid'; message: string };

const CONFIG_MAX_BYTES = 16 * 1024;
const CA_MAX_BYTES = 256 * 1024;

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === 'ENOENT'
  );
}

async function loadConfig(
  options: CoreDesktopServiceOptions,
): Promise<ConfigResult> {
  const readFile = options.readFile ?? readBoundedFile;
  let encoded: Buffer;
  try {
    encoded = await readFile(options.configPath, CONFIG_MAX_BYTES);
    if (encoded.length > CONFIG_MAX_BYTES) throw new Error();
  } catch (error) {
    return isMissingFile(error)
      ? {
          status: 'missing',
          message: 'Konfigurasi CH Core belum tersedia.',
        }
      : { status: 'invalid', message: 'Konfigurasi CH Core tidak dapat dibuka.' };
  }
  let config: CoreEndpointConfig;
  try {
    config = parseCoreEndpointConfig(JSON.parse(encoded.toString('utf8')));
  } catch {
    return { status: 'invalid', message: 'Konfigurasi CH Core tidak valid.' };
  }
  try {
    const ca = await readFile(config.caFile, CA_MAX_BYTES);
    if (ca.length === 0 || ca.length > CA_MAX_BYTES) throw new Error();
    return { status: 'ready', config, ca };
  } catch {
    return {
      status: 'invalid',
      message: 'Sertifikat CH Core tidak dapat dibuka.',
    };
  }
}

async function publicCredentialStatus(
  store: CoreCredentialStore,
  production: boolean,
  configuration: CoreCredentialStatus['configuration'],
  message?: string,
): Promise<CoreCredentialStatus> {
  try {
    const state = await store.load();
    if (state?.current) {
      return {
        production,
        configuration,
        credential: 'paired',
        deviceId: state.current.deviceId,
        ...(message ? { message } : {}),
      };
    }
    if (state?.pendingPairing || state?.pendingEnrollment) {
      return {
        production,
        configuration,
        credential: 'pending',
        ...(state.pendingPairing?.pairingId
          ? { pairingId: state.pendingPairing.pairingId }
          : {}),
        ...(message ? { message } : {}),
      };
    }
    return {
      production,
      configuration,
      credential: 'unpaired',
      ...(message ? { message } : {}),
    };
  } catch {
    return {
      production,
      configuration,
      credential: 'unpaired',
      message: 'Kredensial CH Core tidak dapat dibuka.',
    };
  }
}

async function installationId(
  store: CoreCredentialStore,
): Promise<string> {
  const state = await store.load();
  if (!state) throw new Error('Perangkat CH Core belum memiliki identitas.');
  return state.installationId;
}

function unavailableService(
  options: CoreDesktopServiceOptions,
  config: Exclude<ConfigResult, { status: 'ready' }>,
): ChCoreBridge {
  const unavailable = async (): Promise<never> => {
    throw new Error('CH Core belum dikonfigurasi.');
  };
  return {
    request: async (request: CoreApiRequest) => {
      validateCoreOperationRequest(request);
      return unavailable();
    },
    installationId: () => installationId(options.store),
    credentialStatus: () =>
      publicCredentialStatus(
        options.store,
        options.production,
        config.status,
        config.message,
      ),
    enrollOwner: unavailable,
    claimPairing: unavailable,
    completePairing: unavailable,
    createOwnerPairing: unavailable,
    getOwnerPairing: unavailable,
    approveOwnerPairing: unavailable,
    rotateToken: unavailable,
  };
}

export async function createCoreDesktopService(
  options: CoreDesktopServiceOptions,
): Promise<ChCoreBridge> {
  const loaded = await loadConfig(options);
  if (loaded.status !== 'ready') return unavailableService(options, loaded);

  const https = createCoreHttpsClient({ requestImpl: options.requestImpl });
  const send = (request: CoreApiRequest, authorization?: string) =>
    https.send({
      endpoint: loaded.config.endpoint,
      ca: loaded.ca,
      authorization,
      request,
    });
  const api = createCoreApiMain({
    config: loaded.config,
    ca: loaded.ca,
    credentials: options.store,
    send: https.send,
  });
  const identity = createCoreIdentityMain({
    store: options.store,
    send,
    platform: options.platform,
  });
  const ownerPairing = createCoreOwnerPairingMain({
    store: options.store,
    send,
  });

  return {
    request: api.request,
    installationId: () => installationId(options.store),
    credentialStatus: () =>
      publicCredentialStatus(
        options.store,
        options.production,
        'ready',
      ),
    enrollOwner: identity.enrollOwner,
    claimPairing: identity.claimPairing,
    completePairing: identity.completePairing,
    createOwnerPairing: ownerPairing.createOwnerPairing,
    getOwnerPairing: ownerPairing.getOwnerPairing,
    approveOwnerPairing: ownerPairing.approveOwnerPairing,
    rotateToken: identity.rotateToken,
  };
}
