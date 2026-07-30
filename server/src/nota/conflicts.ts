import { canonicalizeJson } from '../sync/idempotency.js';
import type { UpdateHeaderRequest } from './validation.js';

type Header = Record<string, unknown>;
type Versions = Record<string, string>;

type MergeResult =
  | { kind: 'merged'; header: Header; versions: Versions }
  | {
      kind: 'conflict';
      field: string;
      base: unknown;
      mine: unknown;
      server: unknown;
    };

function same(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

export function parseNotaStoredJson(value: unknown): unknown {
  return typeof value === 'string'
    ? JSON.parse(value)
    : Buffer.isBuffer(value)
      ? JSON.parse(value.toString('utf8'))
      : value;
}

export function mergeHeaderFields(
  currentHeader: Header,
  currentVersions: Versions,
  fields: UpdateHeaderRequest['fields'],
): MergeResult {
  const header = { ...currentHeader };
  const versions = { ...currentVersions };
  for (const [field, edit] of Object.entries(fields)) {
    if (!edit) continue;
    const server = currentHeader[field] ?? '';
    const currentVersion = currentVersions[field] ?? '1';
    if (
      edit.version !== currentVersion ||
      !same(edit.base, server)
    ) {
      if (same(edit.mine, server)) continue;
      return {
        kind: 'conflict',
        field,
        base: edit.base,
        mine: edit.mine,
        server,
      };
    }
    header[field] = edit.mine;
    versions[field] = (BigInt(currentVersion) + 1n).toString();
  }
  return { kind: 'merged', header, versions };
}

export function decideLineMutation<T>(
  currentVersion: string | null,
  current: T | null,
  baseVersion: string | null,
  base: T | null,
  mine: T | null,
):
  | { kind: 'apply' }
  | { kind: 'already-applied' }
  | { kind: 'conflict'; base: T | null; mine: T | null; server: T | null } {
  if (
    currentVersion === baseVersion &&
    same(current, base)
  ) {
    return { kind: 'apply' };
  }
  if (same(current, mine)) return { kind: 'already-applied' };
  return { kind: 'conflict', base, mine, server: current };
}

export function versionConflict<TBase, TMine, TServer>(
  currentVersion: string,
  baseVersion: string,
  base: TBase,
  mine: TMine,
  server: TServer,
):
  | { kind: 'apply' }
  | {
      kind: 'conflict';
      base: TBase;
      mine: TMine;
      server: TServer;
    } {
  return currentVersion === baseVersion
    ? { kind: 'apply' }
    : { kind: 'conflict', base, mine, server };
}

export function lifecycleEditConflict(
  status: string,
  currentVersion: string,
  requestedVersion: string,
  action: string,
):
  | null
  | {
      base: { lifecycleVersion: string };
      mine: { action: string };
      server: { status: string; lifecycleVersion: string };
    } {
  if (
    currentVersion === requestedVersion &&
    ['draft', 'reopened'].includes(status)
  ) {
    return null;
  }
  return {
    base: { lifecycleVersion: requestedVersion },
    mine: { action },
    server: { status, lifecycleVersion: currentVersion },
  };
}

export type EditableOverrideAction =
  | 'restore'
  | 'reopen'
  | 'complete'
  | 'cancel';

export function planEditableConflictOverride(input: {
  status: string;
  cancelledFromStatus: unknown;
  completionDestination: unknown;
}): {
  before: EditableOverrideAction[];
  after: EditableOverrideAction[];
  completionDestination: 'archive' | 'finished';
} {
  const completionDestination =
    input.completionDestination === 'finished' ? 'finished' : 'archive';
  if (input.status === 'completed') {
    return {
      before: ['reopen'],
      after: ['complete'],
      completionDestination,
    };
  }
  if (input.status === 'cancelled') {
    const cancelledFromStatus = ['completed', 'reopened'].includes(
      String(input.cancelledFromStatus),
    )
      ? String(input.cancelledFromStatus)
      : 'draft';
    return {
      before:
        cancelledFromStatus === 'completed'
          ? ['restore', 'reopen']
          : ['restore'],
      after:
        cancelledFromStatus === 'completed'
          ? ['complete', 'cancel']
          : ['cancel'],
      completionDestination,
    };
  }
  return { before: [], after: [], completionDestination };
}

export function planReopenConflictOverride(input: {
  status: string;
  cancelledFromStatus: unknown;
}): EditableOverrideAction[] | null {
  if (input.status === 'reopened') return [];
  if (input.status === 'completed') return ['reopen'];
  if (input.status !== 'cancelled') return null;
  if (input.cancelledFromStatus === 'completed') {
    return ['restore', 'reopen'];
  }
  if (input.cancelledFromStatus === 'reopened') return ['restore'];
  return null;
}
