import type { ChCoreBridge } from './core-bridge-contract';
import { CH_CORE_IPC_CHANNELS } from './core-bridge-contract';

interface IpcMainPort {
  handle(
    channel: string,
    listener: (event: unknown, input?: unknown) => unknown,
  ): void;
  removeHandler?(channel: string): void;
}

interface TrustedWebContents {
  mainFrame?: {
    url?: string;
  };
}

interface IpcInvokeEvent {
  sender?: unknown;
  senderFrame?: {
    url?: string;
  };
}

const invalidRequest = (): never => {
  throw new Error('Permintaan CH Core tidak valid.');
};

function exactKeys(input: object, expected: string[]): boolean {
  return Object.keys(input).sort().join(',') === expected.sort().join(',');
}

function requireEnrollmentInput(
  input: unknown,
): Parameters<ChCoreBridge['enrollOwner']>[0] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return invalidRequest();
  }
  const mode = Reflect.get(input, 'mode');
  const displayName = Reflect.get(input, 'displayName');
  const bootstrapSecret = Reflect.get(input, 'bootstrapSecret');
  const validDisplayName =
    typeof displayName === 'string' &&
    displayName.trim().length > 0 &&
    displayName.length <= 160;
  if (
    !validDisplayName ||
    (mode === 'bootstrap' &&
      (!exactKeys(input, ['mode', 'displayName', 'bootstrapSecret']) ||
        typeof bootstrapSecret !== 'string' ||
        bootstrapSecret.length === 0)) ||
    (mode === 'recovery' && !exactKeys(input, ['mode', 'displayName'])) ||
    (mode !== 'bootstrap' && mode !== 'recovery')
  ) {
    return invalidRequest();
  }
  return input as Parameters<ChCoreBridge['enrollOwner']>[0];
}

function requirePairingInput(
  input: unknown,
): Parameters<ChCoreBridge['claimPairing']>[0] {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    !exactKeys(input, ['code', 'displayName'])
  ) {
    return invalidRequest();
  }
  const code = Reflect.get(input, 'code');
  const displayName = Reflect.get(input, 'displayName');
  if (
    typeof code !== 'string' ||
    !/^\d{8}$/.test(code) ||
    typeof displayName !== 'string' ||
    displayName.trim().length === 0 ||
    displayName.length > 160
  ) {
    return invalidRequest();
  }
  return input as Parameters<ChCoreBridge['claimPairing']>[0];
}

export function registerCoreIpcHandlers(
  ipcMain: IpcMainPort,
  service: ChCoreBridge,
  trustedSender: TrustedWebContents,
  expectedRendererUrl: string,
): () => void {
  const authorized =
    <T>(handler: (input?: unknown) => T) =>
    async (event: unknown, input?: unknown): Promise<T> => {
      const invokeEvent = event as IpcInvokeEvent;
      const trustedFrame = trustedSender.mainFrame;
      if (
        invokeEvent.sender !== trustedSender ||
        trustedFrame === undefined ||
        invokeEvent.senderFrame !== trustedFrame ||
        invokeEvent.senderFrame.url !== expectedRendererUrl
      ) {
        throw new Error('Akses CH Core tidak diizinkan.');
      }
      return handler(input);
    };

  ipcMain.handle(
    CH_CORE_IPC_CHANNELS.request,
    authorized((input) =>
      service.request(input as Parameters<ChCoreBridge['request']>[0]),
    ),
  );
  ipcMain.handle(
    CH_CORE_IPC_CHANNELS.credentialStatus,
    authorized(() => service.credentialStatus()),
  );
  ipcMain.handle(
    CH_CORE_IPC_CHANNELS.enrollOwner,
    authorized((input) =>
      service.enrollOwner(requireEnrollmentInput(input)),
    ),
  );
  ipcMain.handle(
    CH_CORE_IPC_CHANNELS.claimPairing,
    authorized((input) =>
      service.claimPairing(requirePairingInput(input)),
    ),
  );
  ipcMain.handle(
    CH_CORE_IPC_CHANNELS.completePairing,
    authorized(() => service.completePairing()),
  );
  ipcMain.handle(
    CH_CORE_IPC_CHANNELS.rotateToken,
    authorized(() => service.rotateToken()),
  );

  return () => {
    for (const channel of Object.values(CH_CORE_IPC_CHANNELS)) {
      ipcMain.removeHandler?.(channel);
    }
  };
}
