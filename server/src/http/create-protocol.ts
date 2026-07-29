import { IdentityService } from '../auth/identity.js';
import { MariaDbIdentityStore } from '../auth/mariadb-identity-store.js';
import { SlidingWindowRateLimiter } from '../auth/rate-limit.js';
import type { ProtocolPool } from '../sync/idempotency.js';
import { MariaDbSyncStore } from '../sync/mariadb-sync-store.js';
import { SyncService } from '../sync/service.js';
import type { ProtocolServices } from './protocol-types.js';

export function createProtocolServices(
  pool: ProtocolPool,
  ownerBootstrapSecret?: string,
): ProtocolServices {
  return {
    identity: new IdentityService({
      store: new MariaDbIdentityStore(pool),
      ...(ownerBootstrapSecret === undefined
        ? {}
        : { bootstrapSecret: ownerBootstrapSecret }),
      redeemLimiter: new SlidingWindowRateLimiter({
        limit: 5,
        windowMs: 10 * 60 * 1_000,
      }),
    }),
    sync: new SyncService(new MariaDbSyncStore(pool)),
  };
}
