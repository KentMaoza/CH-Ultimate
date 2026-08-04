import type { DemoState } from '../domain/types';
import {
  coreJsonValueSchema,
  type CoreJsonValue,
} from './core-api-types';
import {
  cloneCore,
  type CoreOptimisticChange,
  type CoreOutboxItem,
} from './core-cache';

export function asCoreJson(value: unknown): CoreJsonValue {
  return coreJsonValueSchema.parse(
    value === undefined ? null : JSON.parse(JSON.stringify(value)),
  );
}

export function previewOptimisticOutbox(
  canonical: DemoState,
  outbox: CoreOutboxItem[],
): DemoState {
  let state = canonical;
  for (const item of outbox) {
    if (item.optimistic && item.optimisticActive) {
      state = applyCoreOptimisticChange(state, item.optimistic);
    }
  }
  return state;
}

export function mergeQueuedMutation(
  item: CoreOutboxItem,
  body: unknown,
  optimistic?: CoreOptimisticChange,
): CoreOutboxItem {
  const currentPatch = patchRecord(item.body);
  const nextBody = asCoreJson(body);
  const nextPatch = patchRecord(nextBody);
  const currentFields = recordField(currentPatch ? undefined : item.body, 'fields');
  const nextFields = recordField(nextBody, 'fields');
  const currentMine = recordField(item.body, 'mine');
  const nextMine = recordField(nextBody, 'mine');
  const currentBody = jsonRecord(item.body);
  const mergedOptimistic =
    item.optimistic?.kind === 'nota-header' &&
    optimistic?.kind === 'nota-header'
      ? {
          ...item.optimistic,
          patch: { ...item.optimistic.patch, ...optimistic.patch },
        }
      : item.optimistic?.kind === 'nota-line' &&
          optimistic?.kind === 'nota-line'
        ? {
            ...item.optimistic,
            patch: { ...item.optimistic.patch, ...optimistic.patch },
          }
        : optimistic;
  return {
    ...item,
    body:
      currentFields && nextFields
        ? asCoreJson({
            ...currentBody,
            fields: { ...currentFields, ...nextFields },
          })
        : currentMine && nextMine && currentBody
          ? asCoreJson({ ...currentBody, mine: { ...currentMine, ...nextMine } })
          : currentPatch && nextPatch
        ? asCoreJson({ patch: { ...currentPatch, ...nextPatch } })
        : nextBody,
    ...(mergedOptimistic ? { optimistic: mergedOptimistic } : {}),
    optimisticActive: Boolean(mergedOptimistic),
  };
}

function jsonRecord(
  value: CoreJsonValue | undefined,
): Record<string, CoreJsonValue> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
}

function recordField(
  value: CoreJsonValue | undefined,
  field: string,
): Record<string, CoreJsonValue> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const nested = value[field];
  if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
    return undefined;
  }
  return nested;
}

function patchRecord(
  value: CoreJsonValue | undefined,
): Record<string, CoreJsonValue> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const patch = value.patch;
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    return undefined;
  }
  return patch;
}

export function applyCoreOptimisticChange(
  state: DemoState,
  change: CoreOptimisticChange,
): DemoState {
  if (change.kind === 'label-template') {
    return { ...state, labelTemplate: cloneCore(change.template) };
  }
  if (change.kind === 'invoice-template') {
    return { ...state, invoiceTemplate: cloneCore(change.template) };
  }
  if (change.kind === 'nota-header') {
    return {
      ...state,
      notaTransactions: state.notaTransactions.map((nota) =>
        nota.id === change.notaId ? { ...nota, ...change.patch } : nota,
      ),
    };
  }
  if (change.kind === 'nota-page-add') {
    return {
      ...state,
      notaTransactions: state.notaTransactions.map((nota) =>
        nota.id === change.notaId
          ? {
              ...nota,
              nextNoteIndex: Math.max(
                nota.nextNoteIndex,
                nota.pages.length + 1,
              ),
              pages: [
                ...nota.pages.filter((page) => page.id !== change.page.id),
                cloneCore(change.page),
              ],
            }
          : nota,
      ),
    };
  }
  if (change.kind === 'nota-page-status') {
    return {
      ...state,
      notaTransactions: state.notaTransactions.map((nota) =>
        nota.id === change.notaId
          ? {
              ...nota,
              pages: nota.pages.map((page) =>
                page.id === change.pageId
                  ? { ...page, status: change.status }
                  : page,
              ),
            }
          : nota,
      ),
    };
  }
  return {
    ...state,
    notaTransactions: state.notaTransactions.map((nota) =>
      nota.id !== change.notaId
        ? nota
        : {
            ...nota,
            pages: nota.pages.map((page) =>
              page.id !== change.pageId
                ? page
                : {
                    ...page,
                    lines: page.lines.map((line) =>
                      line.id === change.lineId
                        ? { ...line, ...change.patch }
                        : line,
                    ),
                  },
            ),
          },
    ),
  };
}
