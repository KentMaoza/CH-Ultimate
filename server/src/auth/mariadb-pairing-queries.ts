import type { PairingRecord } from './identity-types.js';
import {
  databaseDate,
  hexToUuid,
  isDuplicateEntry,
  nullableDatabaseDate,
  nullableHexToUuid,
} from './mariadb-row-utils.js';
import type { ProtocolConnection } from '../sync/idempotency.js';

interface PairingRow {
  id_hex: unknown;
  code_hash: unknown;
  request_id_hex: unknown;
  requested_display_name: unknown;
  requested_platform: unknown;
  requested_installation_id_hex: unknown;
  claim_hash: unknown;
  expires_at: unknown;
  redeemed_at: unknown;
  approved_at: unknown;
  approved_by_device_id_hex: unknown;
  paired_device_id_hex: unknown;
  consumed_at: unknown;
  created_at: unknown;
}

const PAIRING_COLUMNS = `
  HEX(id) AS id_hex,
  code_hash,
  HEX(request_id) AS request_id_hex,
  requested_display_name,
  requested_platform,
  HEX(requested_installation_id) AS requested_installation_id_hex,
  claim_hash,
  expires_at,
  redeemed_at,
  approved_at,
  HEX(approved_by_device_id) AS approved_by_device_id_hex,
  HEX(paired_device_id) AS paired_device_id_hex,
  consumed_at,
  created_at
`;

function mapPairing(row: PairingRow): PairingRecord {
  return {
    id: hexToUuid(row.id_hex),
    codeHash: Buffer.from(row.code_hash as Uint8Array),
    requestId: nullableHexToUuid(row.request_id_hex),
    requestedDisplayName:
      row.requested_display_name === null
        ? null
        : String(row.requested_display_name),
    requestedPlatform:
      row.requested_platform === null
        ? null
        : String(row.requested_platform),
    requestedInstallationId: nullableHexToUuid(
      row.requested_installation_id_hex,
    ),
    claimHash:
      row.claim_hash === null
        ? null
        : Buffer.from(row.claim_hash as Uint8Array),
    expiresAt: databaseDate(row.expires_at),
    redeemedAt: nullableDatabaseDate(row.redeemed_at),
    approvedAt: nullableDatabaseDate(row.approved_at),
    approvedByDeviceId: nullableHexToUuid(row.approved_by_device_id_hex),
    pairedDeviceId: nullableHexToUuid(row.paired_device_id_hex),
    consumedAt: nullableDatabaseDate(row.consumed_at),
    createdAt: databaseDate(row.created_at),
  };
}

export class MariaDbPairingQueries {
  constructor(private readonly connection: ProtocolConnection) {}

  findPairingById(id: string): Promise<PairingRecord | null> {
    return this.findOne(
      `SELECT ${PAIRING_COLUMNS}
       FROM pairings
       WHERE id = UNHEX(REPLACE(?, '-', ''))
       LIMIT 1
       FOR UPDATE`,
      [id],
    );
  }

  findPairingByCodeHash(codeHash: Buffer): Promise<PairingRecord | null> {
    return this.findOne(
      `SELECT ${PAIRING_COLUMNS}
       FROM pairings
       WHERE code_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [codeHash],
    );
  }

  async insertPairing(pairing: PairingRecord): Promise<boolean> {
    try {
      await this.connection.query(
        `INSERT INTO pairings
           (id, code_hash, request_id, requested_installation_id, claim_hash,
            requested_display_name, requested_platform, expires_at,
            redeemed_at, approved_at, approved_by_device_id,
            paired_device_id, consumed_at, created_at)
         VALUES
           (UNHEX(REPLACE(?, '-', '')), ?,
            CASE WHEN ? IS NULL THEN NULL ELSE UNHEX(REPLACE(?, '-', '')) END,
            CASE WHEN ? IS NULL THEN NULL ELSE UNHEX(REPLACE(?, '-', '')) END,
            ?, ?, ?, ?, ?, ?,
            CASE WHEN ? IS NULL THEN NULL ELSE UNHEX(REPLACE(?, '-', '')) END,
            CASE WHEN ? IS NULL THEN NULL ELSE UNHEX(REPLACE(?, '-', '')) END,
            ?, ?)`,
        [
          pairing.id,
          pairing.codeHash,
          pairing.requestId,
          pairing.requestId,
          pairing.requestedInstallationId,
          pairing.requestedInstallationId,
          pairing.claimHash,
          pairing.requestedDisplayName,
          pairing.requestedPlatform,
          pairing.expiresAt,
          pairing.redeemedAt,
          pairing.approvedAt,
          pairing.approvedByDeviceId,
          pairing.approvedByDeviceId,
          pairing.pairedDeviceId,
          pairing.pairedDeviceId,
          pairing.consumedAt,
          pairing.createdAt,
        ],
      );
      return true;
    } catch (error) {
      if (isDuplicateEntry(error)) {
        return false;
      }
      throw error;
    }
  }

  async savePairing(pairing: PairingRecord): Promise<void> {
    await this.connection.query(
      `UPDATE pairings
       SET request_id =
             CASE WHEN ? IS NULL THEN NULL
                  ELSE UNHEX(REPLACE(?, '-', '')) END,
           requested_installation_id =
             CASE WHEN ? IS NULL THEN NULL
                  ELSE UNHEX(REPLACE(?, '-', '')) END,
           claim_hash = ?,
           requested_display_name = ?,
           requested_platform = ?,
           expires_at = ?,
           redeemed_at = ?,
           approved_at = ?,
           approved_by_device_id =
             CASE WHEN ? IS NULL THEN NULL
                  ELSE UNHEX(REPLACE(?, '-', '')) END,
           paired_device_id =
             CASE WHEN ? IS NULL THEN NULL
                  ELSE UNHEX(REPLACE(?, '-', '')) END,
           consumed_at = ?
       WHERE id = UNHEX(REPLACE(?, '-', ''))`,
      [
        pairing.requestId,
        pairing.requestId,
        pairing.requestedInstallationId,
        pairing.requestedInstallationId,
        pairing.claimHash,
        pairing.requestedDisplayName,
        pairing.requestedPlatform,
        pairing.expiresAt,
        pairing.redeemedAt,
        pairing.approvedAt,
        pairing.approvedByDeviceId,
        pairing.approvedByDeviceId,
        pairing.pairedDeviceId,
        pairing.pairedDeviceId,
        pairing.consumedAt,
        pairing.id,
      ],
    );
  }

  private async findOne(
    sql: string,
    values: readonly unknown[],
  ): Promise<PairingRecord | null> {
    const rows = await this.connection.query<PairingRow[]>(sql, values);
    return rows[0] ? mapPairing(rows[0]) : null;
  }
}
