import type {
  DeviceRecord,
  DeviceRole,
  RecoveryRecord,
  TokenMatch,
} from './identity-types.js';
import {
  databaseDate,
  hexToUuid,
  isDuplicateEntry,
  nullableDatabaseDate,
  nullableHexToUuid,
} from './mariadb-row-utils.js';
import type { ProtocolConnection } from '../sync/idempotency.js';

interface DeviceRow {
  id_hex: unknown;
  installation_id_hex: unknown;
  role: unknown;
  display_name: unknown;
  platform: unknown;
  token_hash: unknown;
  token_expires_at: unknown;
  previous_token_hash: unknown;
  previous_token_expires_at: unknown;
  approved_at: unknown;
  revoked_at: unknown;
  created_at: unknown;
}

interface RecoveryRow {
  credential_hash: unknown;
  credential_version: unknown;
  created_at: unknown;
  rotated_at: unknown;
}

const DEVICE_COLUMNS = `
  HEX(id) AS id_hex,
  HEX(installation_id) AS installation_id_hex,
  role,
  display_name,
  platform,
  token_hash,
  token_expires_at,
  previous_token_hash,
  previous_token_expires_at,
  approved_at,
  revoked_at,
  created_at
`;

function mapDevice(row: DeviceRow): DeviceRecord {
  if (row.role !== 'owner' && row.role !== 'client') {
    throw new Error('Database returned an invalid device role');
  }
  const installationId = nullableHexToUuid(row.installation_id_hex);
  if (!installationId) {
    throw new Error('Database returned a device without an installation id');
  }
  return {
    id: hexToUuid(row.id_hex),
    installationId,
    role: row.role as DeviceRole,
    displayName: String(row.display_name),
    platform: String(row.platform),
    tokenHash: Buffer.from(row.token_hash as Uint8Array),
    tokenExpiresAt: databaseDate(row.token_expires_at),
    previousTokenHash:
      row.previous_token_hash === null
        ? null
        : Buffer.from(row.previous_token_hash as Uint8Array),
    previousTokenExpiresAt: nullableDatabaseDate(
      row.previous_token_expires_at,
    ),
    approvedAt: databaseDate(row.approved_at),
    revokedAt: nullableDatabaseDate(row.revoked_at),
    createdAt: databaseDate(row.created_at),
  };
}

export class MariaDbDeviceQueries {
  constructor(private readonly connection: ProtocolConnection) {}

  async findOwner(): Promise<DeviceRecord | null> {
    const rows = await this.connection.query<DeviceRow[]>(
      `SELECT ${DEVICE_COLUMNS}
       FROM devices
       WHERE role = 'owner'
       ORDER BY created_at
       LIMIT 1
       FOR UPDATE`,
    );
    return rows[0] ? mapDevice(rows[0]) : null;
  }

  async findRecovery(): Promise<RecoveryRecord | null> {
    const rows = await this.connection.query<RecoveryRow[]>(
      `SELECT credential_hash, credential_version, created_at, rotated_at
       FROM owner_recovery
       WHERE singleton_id = 1
       FOR UPDATE`,
    );
    const row = rows[0];
    return row
      ? {
          credentialHash: Buffer.from(row.credential_hash as Uint8Array),
          credentialVersion: BigInt(String(row.credential_version)),
          createdAt: databaseDate(row.created_at),
          rotatedAt: nullableDatabaseDate(row.rotated_at),
        }
      : null;
  }

  async saveRecovery(recovery: RecoveryRecord): Promise<void> {
    await this.connection.query(
      `INSERT INTO owner_recovery
         (singleton_id, credential_hash, credential_version, created_at,
          rotated_at)
       VALUES (1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         credential_hash = VALUES(credential_hash),
         credential_version = VALUES(credential_version),
         rotated_at = VALUES(rotated_at)`,
      [
        recovery.credentialHash,
        recovery.credentialVersion.toString(),
        recovery.createdAt,
        recovery.rotatedAt,
      ],
    );
  }

  findDeviceById(id: string): Promise<DeviceRecord | null> {
    return this.findOne(
      `SELECT ${DEVICE_COLUMNS}
       FROM devices
       WHERE id = UNHEX(REPLACE(?, '-', ''))
       LIMIT 1
       FOR UPDATE`,
      [id],
    );
  }

  findDeviceByInstallationId(
    installationId: string,
  ): Promise<DeviceRecord | null> {
    return this.findOne(
      `SELECT ${DEVICE_COLUMNS}
       FROM devices
       WHERE installation_id = UNHEX(REPLACE(?, '-', ''))
       LIMIT 1
       FOR UPDATE`,
      [installationId],
    );
  }

  async findDeviceByTokenHash(tokenHash: Buffer): Promise<TokenMatch | null> {
    const device = await this.findOne(
      `SELECT ${DEVICE_COLUMNS}
       FROM devices
       WHERE token_hash = ? OR previous_token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [tokenHash, tokenHash],
    );
    if (!device) {
      return null;
    }
    return {
      device,
      tokenKind: device.tokenHash.equals(tokenHash) ? 'current' : 'previous',
    };
  }

  async listDevices(): Promise<DeviceRecord[]> {
    const rows = await this.connection.query<DeviceRow[]>(
      `SELECT ${DEVICE_COLUMNS}
       FROM devices
       ORDER BY created_at, id`,
    );
    return rows.map(mapDevice);
  }

  async insertDevice(device: DeviceRecord): Promise<boolean> {
    try {
      await this.connection.query(
        `INSERT INTO devices
           (id, role, installation_id, display_name, platform, token_hash,
            token_expires_at, previous_token_hash,
            previous_token_expires_at, approved_at, revoked_at, created_at)
         VALUES
           (UNHEX(REPLACE(?, '-', '')), ?, UNHEX(REPLACE(?, '-', '')), ?, ?,
            ?, ?, ?, ?, ?, ?, ?)`,
        this.deviceValues(device),
      );
      return true;
    } catch (error) {
      if (isDuplicateEntry(error)) {
        return false;
      }
      throw error;
    }
  }

  async saveDevice(device: DeviceRecord): Promise<void> {
    await this.connection.query(
      `UPDATE devices
       SET role = ?,
           installation_id = UNHEX(REPLACE(?, '-', '')),
           display_name = ?,
           platform = ?,
           token_hash = ?,
           token_expires_at = ?,
           previous_token_hash = ?,
           previous_token_expires_at = ?,
           approved_at = ?,
           revoked_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [
        device.role,
        device.installationId,
        device.displayName,
        device.platform,
        device.tokenHash,
        device.tokenExpiresAt,
        device.previousTokenHash,
        device.previousTokenExpiresAt,
        device.approvedAt,
        device.revokedAt,
        device.id,
      ],
    );
  }

  async revokeOtherOwners(
    exceptDeviceId: string,
    revokedAt: Date,
  ): Promise<void> {
    await this.connection.query(
      `UPDATE devices
       SET revoked_at = ?
       WHERE role = 'owner'
         AND id <> UNHEX(REPLACE(?, '-', ''))
         AND revoked_at IS NULL`,
      [revokedAt, exceptDeviceId],
    );
  }

  private async findOne(
    sql: string,
    values: readonly unknown[],
  ): Promise<DeviceRecord | null> {
    const rows = await this.connection.query<DeviceRow[]>(sql, values);
    return rows[0] ? mapDevice(rows[0]) : null;
  }

  private deviceValues(device: DeviceRecord): readonly unknown[] {
    return [
      device.id,
      device.role,
      device.installationId,
      device.displayName,
      device.platform,
      device.tokenHash,
      device.tokenExpiresAt,
      device.previousTokenHash,
      device.previousTokenExpiresAt,
      device.approvedAt,
      device.revokedAt,
      device.createdAt,
    ];
  }
}
