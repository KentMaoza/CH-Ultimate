import type { CoreMutationAcknowledgement } from './core-api-types';
import {
  cloneCore,
  type CoreOptimisticChange,
  type CoreOutboxItem,
} from './core-cache';
import type { CoreApiMethod } from './core-api-transport';
import { asCoreJson } from './core-optimistic-state';

export interface CoreMutationSpec {
  method: Exclude<CoreApiMethod, 'GET'>;
  path: string;
  body?: unknown;
  notaId?: string;
  coalesceKey?: string;
  resolvesConflictId?: string;
  optimistic?: CoreOptimisticChange;
}

export interface MutationDeferred {
  promise: Promise<CoreMutationAcknowledgement>;
  resolve(value: CoreMutationAcknowledgement): void;
  reject(reason: unknown): void;
}

export function mutationDeferred(): MutationDeferred {
  let resolve!: MutationDeferred['resolve'];
  let reject!: MutationDeferred['reject'];
  const promise = new Promise<CoreMutationAcknowledgement>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function createOutboxItem(
  spec: CoreMutationSpec,
  now: Date,
): CoreOutboxItem {
  return {
    id: crypto.randomUUID(),
    idempotencyKey: crypto.randomUUID(),
    method: spec.method,
    path: spec.path,
    ...(spec.body === undefined ? {} : { body: asCoreJson(spec.body) }),
    createdAt: now.toISOString(),
    ...(spec.notaId ? { notaId: spec.notaId } : {}),
    ...(spec.coalesceKey ? { coalesceKey: spec.coalesceKey } : {}),
    ...(spec.resolvesConflictId
      ? { resolvesConflictId: spec.resolvesConflictId }
      : {}),
    ...(spec.optimistic ? { optimistic: cloneCore(spec.optimistic) } : {}),
    ...(spec.optimistic ? { optimisticActive: true } : {}),
  };
}

export function mutationFingerprint(item: CoreOutboxItem): string {
  return JSON.stringify([
    item.idempotencyKey,
    item.method,
    item.path,
    item.body,
  ]);
}
