import type {
  CoreGatewayClock,
  CoreGatewayStorage,
} from '../gateway/core-operations-gateway';

const DATABASE_NAME = 'ch-ultimate-core';
const STORE_NAME = 'gateway';
const SNAPSHOT_KEY = 'snapshot';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Cache CH Core tidak tersedia.'));
  });
}

export function createCoreGatewayStorage(): CoreGatewayStorage {
  return {
    async load(): Promise<unknown> {
      const database = await openDatabase();
      try {
        return await new Promise((resolve, reject) => {
          const request = database
            .transaction(STORE_NAME, 'readonly')
            .objectStore(STORE_NAME)
            .get(SNAPSHOT_KEY);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(new Error('Cache CH Core tidak dapat dibuka.'));
        });
      } finally {
        database.close();
      }
    },

    async save(envelope): Promise<void> {
      const database = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(
            STORE_NAME,
            'readwrite',
          );
          transaction.objectStore(STORE_NAME).put(envelope, SNAPSHOT_KEY);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () =>
            reject(new Error('Cache CH Core tidak dapat disimpan.'));
          transaction.onabort = () =>
            reject(new Error('Cache CH Core tidak dapat disimpan.'));
        });
      } finally {
        database.close();
      }
    },
  };
}

export function createCoreGatewayClock(): CoreGatewayClock {
  return {
    now: () => new Date(),
    isForeground: () => document.visibilityState === 'visible',
    schedule: (callback, delayMs) => {
      const timer = window.setTimeout(() => void callback(), delayMs);
      return () => window.clearTimeout(timer);
    },
    subscribeResume: (listener) => {
      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') void listener();
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      return () =>
        document.removeEventListener('visibilitychange', onVisibilityChange);
    },
  };
}
