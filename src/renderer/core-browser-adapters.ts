import type {
  CoreGatewayClock,
  CoreGatewayStorage,
} from '../gateway/core-operations-gateway';

const DATABASE_NAME = 'ch-ultimate-core';
const STORE_NAME = 'gateway';
const IMAGE_STORE_NAME = 'images';
const SNAPSHOT_KEY = 'snapshot';
const SHA256 = /^[0-9a-f]{64}$/;

function requireImageHash(hash: string): string {
  if (!SHA256.test(hash)) throw new Error('Hash gambar SHA-256 tidak valid.');
  return hash;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        request.result.createObjectStore(IMAGE_STORE_NAME);
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

    async loadImage(hash): Promise<Blob | undefined> {
      const database = await openDatabase();
      try {
        return await new Promise((resolve, reject) => {
          const request = database
            .transaction(IMAGE_STORE_NAME, 'readonly')
            .objectStore(IMAGE_STORE_NAME)
            .get(requireImageHash(hash));
          request.onsuccess = () => resolve(request.result as Blob | undefined);
          request.onerror = () =>
            reject(new Error('Cache gambar CH Core tidak dapat dibuka.'));
        });
      } finally {
        database.close();
      }
    },

    async saveImage(hash, image): Promise<void> {
      const database = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(IMAGE_STORE_NAME, 'readwrite');
          transaction.objectStore(IMAGE_STORE_NAME).put(image, requireImageHash(hash));
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(
            transaction.error ?? new Error('Cache gambar CH Core tidak dapat disimpan.'),
          );
          transaction.onabort = () => reject(
            transaction.error ?? new Error('Cache gambar CH Core tidak dapat disimpan.'),
          );
        });
      } finally {
        database.close();
      }
    },

    async listImageHashes(): Promise<string[]> {
      const database = await openDatabase();
      try {
        return await new Promise((resolve, reject) => {
          const request = database
            .transaction(IMAGE_STORE_NAME, 'readonly')
            .objectStore(IMAGE_STORE_NAME)
            .getAllKeys();
          request.onsuccess = () => resolve(
            request.result.filter((key): key is string => typeof key === 'string'),
          );
          request.onerror = () =>
            reject(new Error('Daftar cache gambar CH Core tidak dapat dibuka.'));
        });
      } finally {
        database.close();
      }
    },

    async deleteImages(hashes): Promise<void> {
      if (hashes.length === 0) return;
      const validated = hashes.map(requireImageHash);
      const database = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction(IMAGE_STORE_NAME, 'readwrite');
          const store = transaction.objectStore(IMAGE_STORE_NAME);
          validated.forEach((hash) => store.delete(hash));
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(
            transaction.error ?? new Error('Cache gambar CH Core tidak dapat dibersihkan.'),
          );
          transaction.onabort = () => reject(
            transaction.error ?? new Error('Cache gambar CH Core tidak dapat dibersihkan.'),
          );
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
