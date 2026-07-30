import type { ServerConfig } from '../config.js';
import type { SchemaQueryPool } from '../db/migrate.js';
import type { CatalogueHttpServices } from '../http/catalogue-routes.js';
import type { MaintenanceLifecycle } from '../maintenance.js';
import type { ProtocolPool } from '../sync/idempotency.js';
import { FileCatalogueStorage } from './file-storage.js';
import { CatalogueMaintenance } from './catalogue-maintenance.js';
import { CatalogueImageDownloader } from './image-download.js';
import { CatalogueImageWorker } from './image-worker.js';
import { MariaDbCatalogueImageRepository } from './mariadb-image-repository.js';
import { MariaDbCatalogueRepository } from './mariadb-repository.js';
import { CatalogueService } from './service.js';

export interface CatalogueRuntimePool
  extends ProtocolPool, SchemaQueryPool {}

export interface CatalogueRuntime {
  services: CatalogueHttpServices;
  maintenance: MaintenanceLifecycle;
}

export function createCatalogueRuntime(
  pool: CatalogueRuntimePool,
  config: ServerConfig,
): CatalogueRuntime {
  const storage = new FileCatalogueStorage(config.privateStorageRoot);
  const imageRepository = new MariaDbCatalogueImageRepository(pool, storage);
  const imports = new CatalogueService({
    repository: new MariaDbCatalogueRepository(pool),
    storage,
    expectedWorkbookSha256: config.initialCatalogueSha256,
  });
  return {
    services: {
      imports,
      images: imageRepository,
    },
    maintenance: new CatalogueMaintenance(
      new CatalogueImageWorker(
        imageRepository,
        new CatalogueImageDownloader(),
        storage,
      ),
      imports,
    ),
  };
}
