import type {
  IdentitySession,
  IdentityStore,
} from './identity-types.js';
import { MariaDbDeviceQueries } from './mariadb-device-queries.js';
import { MariaDbPairingQueries } from './mariadb-pairing-queries.js';
import type {
  ProtocolConnection,
  ProtocolPool,
} from '../sync/idempotency.js';

function createSession(connection: ProtocolConnection): IdentitySession {
  const devices = new MariaDbDeviceQueries(connection);
  const pairings = new MariaDbPairingQueries(connection);
  return {
    findOwner: () => devices.findOwner(),
    findRecovery: () => devices.findRecovery(),
    saveRecovery: (recovery) => devices.saveRecovery(recovery),
    findDeviceById: (id) => devices.findDeviceById(id),
    findDeviceByInstallationId: (installationId) =>
      devices.findDeviceByInstallationId(installationId),
    findDeviceByTokenHash: (tokenHash) =>
      devices.findDeviceByTokenHash(tokenHash),
    listDevices: () => devices.listDevices(),
    insertDevice: (device) => devices.insertDevice(device),
    saveDevice: (device) => devices.saveDevice(device),
    revokeOtherOwners: (exceptDeviceId, revokedAt) =>
      devices.revokeOtherOwners(exceptDeviceId, revokedAt),
    findPairingById: (id) => pairings.findPairingById(id),
    findPairingByCodeHash: (codeHash) =>
      pairings.findPairingByCodeHash(codeHash),
    insertPairing: (pairing) => pairings.insertPairing(pairing),
    savePairing: (pairing) => pairings.savePairing(pairing),
  };
}

export class MariaDbIdentityStore implements IdentityStore {
  constructor(private readonly pool: ProtocolPool) {}

  async transaction<T>(
    work: (session: IdentitySession) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const result = await work(createSession(connection));
      await connection.commit();
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the transaction's original failure.
        }
      }
      throw error;
    } finally {
      await connection.release();
    }
  }
}
