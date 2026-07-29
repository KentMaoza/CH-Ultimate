import type { RedeemRateLimiter } from './rate-limit.js';

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DeviceRole = 'owner' | 'client';
export type TokenKind = 'current' | 'previous';

export interface DeviceRecord {
  id: string;
  installationId: string;
  role: DeviceRole;
  displayName: string;
  platform: string;
  tokenHash: Buffer;
  tokenExpiresAt: Date;
  previousTokenHash: Buffer | null;
  previousTokenExpiresAt: Date | null;
  approvedAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface PairingRecord {
  id: string;
  codeHash: Buffer;
  requestedDisplayName: string | null;
  requestedPlatform: string | null;
  requestedInstallationId: string | null;
  claimHash: Buffer | null;
  expiresAt: Date;
  redeemedAt: Date | null;
  approvedAt: Date | null;
  approvedByDeviceId: string | null;
  pairedDeviceId: string | null;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface RecoveryRecord {
  credentialHash: Buffer;
  credentialVersion: bigint;
  createdAt: Date;
  rotatedAt: Date | null;
}

export interface TokenMatch {
  device: DeviceRecord;
  tokenKind: TokenKind;
}

export interface IdentitySession {
  findOwner(): Promise<DeviceRecord | null>;
  findRecovery(): Promise<RecoveryRecord | null>;
  saveRecovery(recovery: RecoveryRecord): Promise<void>;
  findDeviceById(id: string): Promise<DeviceRecord | null>;
  findDeviceByInstallationId(
    installationId: string,
  ): Promise<DeviceRecord | null>;
  findDeviceByTokenHash(tokenHash: Buffer): Promise<TokenMatch | null>;
  listDevices(): Promise<DeviceRecord[]>;
  insertDevice(device: DeviceRecord): Promise<boolean>;
  saveDevice(device: DeviceRecord): Promise<void>;
  revokeOtherOwners(exceptDeviceId: string, revokedAt: Date): Promise<void>;
  findPairingById(id: string): Promise<PairingRecord | null>;
  findPairingByCodeHash(codeHash: Buffer): Promise<PairingRecord | null>;
  insertPairing(pairing: PairingRecord): Promise<boolean>;
  savePairing(pairing: PairingRecord): Promise<void>;
}

export interface IdentityStore {
  transaction<T>(
    work: (session: IdentitySession) => Promise<T>,
  ): Promise<T>;
}

export class IdentityError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'IdentityError';
  }
}

export interface IdentityServiceOptions {
  store: IdentityStore;
  bootstrapSecret?: string;
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
  randomInt?: (maximum: number) => number;
  randomUuid?: () => string;
  redeemLimiter: RedeemRateLimiter;
}

export interface IdentityRuntime {
  store: IdentityStore;
  bootstrapSecret: string | undefined;
  now: () => Date;
  randomBytes: (size: number) => Buffer;
  randomInt: (maximum: number) => number;
  randomUuid: () => string;
  redeemLimiter: RedeemRateLimiter;
}

export interface InstallationInput {
  installationId: string;
  displayName: string;
  platform: string;
}

export type OwnerBootstrapInput =
  | (InstallationInput & {
      mode: 'bootstrap';
      bootstrapSecret: string;
    })
  | (InstallationInput & {
      mode: 'recovery';
      recoveryCredential: string;
    });

export interface PublicDevice {
  id: string;
  installationId: string;
  role: DeviceRole;
  displayName: string;
  platform: string;
  tokenExpiresAt: string;
  approvedAt: string;
  revokedAt: string | null;
}

export interface IssuedDevice {
  device: PublicDevice;
  deviceToken: string;
}

export interface AuthenticatedDevice extends PublicDevice {
  tokenKind: TokenKind;
}

export function requireInstallation(input: InstallationInput): void {
  if (
    !UUID_PATTERN.test(input.installationId) ||
    input.displayName.trim().length === 0 ||
    input.displayName.length > 160 ||
    input.platform.trim().length === 0 ||
    input.platform.length > 32
  ) {
    throw new IdentityError('INVALID_REQUEST', 400, 'Invalid request');
  }
}

export function publicDevice(device: DeviceRecord): PublicDevice {
  return {
    id: device.id,
    installationId: device.installationId,
    role: device.role,
    displayName: device.displayName,
    platform: device.platform,
    tokenExpiresAt: device.tokenExpiresAt.toISOString(),
    approvedAt: device.approvedAt.toISOString(),
    revokedAt: device.revokedAt?.toISOString() ?? null,
  };
}

export async function requireOwner(
  session: IdentitySession,
  deviceId: string,
): Promise<DeviceRecord> {
  const device = await session.findDeviceById(deviceId);
  if (!device || device.role !== 'owner' || device.revokedAt !== null) {
    throw new IdentityError('FORBIDDEN', 403, 'Owner access required');
  }
  return device;
}
