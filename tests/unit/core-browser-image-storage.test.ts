import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { beforeEach, expect, test } from 'vitest';

import { createCoreGatewayStorage } from '../../src/renderer/core-browser-adapters';

const DATABASE_NAME = 'ch-ultimate-core';
const HASH = 'a'.repeat(64);

function openLegacyDatabase(snapshot: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('gateway');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('gateway', 'readwrite');
      transaction.objectStore('gateway').put(snapshot, 'snapshot');
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'Blob', {
    configurable: true,
    value: NodeBlob,
  });
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: new IDBFactory(),
  });
});

test('IndexedDB v2 migration preserves the gateway snapshot and adds the Blob store', async () => {
  const snapshot = { cacheVersion: 1, serverRevision: '7', outbox: [] };
  await openLegacyDatabase(snapshot);
  const storage = createCoreGatewayStorage();

  await storage.saveImage!(HASH, new Blob(['image-bytes'], { type: 'image/jpeg' }));

  await expect(storage.load()).resolves.toEqual(snapshot);
  const image = await storage.loadImage!(HASH);
  expect(image).toBeInstanceOf(Blob);
  expect(image?.type).toBe('image/jpeg');
  await expect(image?.text()).resolves.toBe('image-bytes');
  await expect(storage.listImageHashes!()).resolves.toEqual([HASH]);
});

test('IndexedDB image storage rejects non-lowercase SHA-256 keys and deletes selected hashes', async () => {
  const storage = createCoreGatewayStorage();
  await expect(storage.saveImage!(HASH.toUpperCase(), new Blob(['x'])))
    .rejects.toThrow('Hash gambar SHA-256 tidak valid');
  await storage.saveImage!(HASH, new Blob(['x']));
  await storage.deleteImages!([HASH]);
  await expect(storage.listImageHashes!()).resolves.toEqual([]);
});
