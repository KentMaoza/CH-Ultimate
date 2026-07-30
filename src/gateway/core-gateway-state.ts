import type {
  DemoState,
  InvoiceTemplate,
  LabelTemplate,
  Sku,
} from '../domain/types';
import type { SyncSnapshot } from './operations-gateway-contract';
import type {
  CoreBootstrap,
  CoreChange,
  CoreMutationAcknowledgement,
} from './core-api-types';
import { emptyCoreState } from './core-bootstrap-mapping';
import {
  cloneCore,
  coreCacheEnvelope,
  type CoreCacheEnvelope,
  type CoreOptimisticChange,
  type CoreOutboxItem,
} from './core-cache';
import {
  asCoreJson,
  previewOptimisticOutbox,
} from './core-optimistic-state';

export class CoreGatewayState {
  private state = emptyCoreState();
  private canonicalState = cloneCore(this.state);
  private outbox: CoreOutboxItem[] = [];
  private outboxVersion = 0;
  private serverRevision = '0';
  private skuVersions = new Map<string, string>();
  private balanceVersions = new Map<string, string>();
  private templateVersions = new Map<'label' | 'invoice', string>();
  private templateVersionKnowledge = new Set<'label' | 'invoice'>();
  private syncSnapshot: SyncSnapshot = {
    phase: 'connecting',
    serverRevision: '0',
    pendingCount: 0,
    conflictCount: 0,
  };
  private listeners = new Set<() => void>();
  private syncListeners = new Set<() => void>();

  getSnapshot = (): DemoState => cloneCore(this.state);

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSyncSnapshot = (): SyncSnapshot => ({ ...this.syncSnapshot });

  subscribeSync = (listener: () => void): (() => void) => {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  };

  getCanonicalState(): DemoState {
    return cloneCore(this.canonicalState);
  }

  getServerRevision(): string {
    return this.serverRevision;
  }

  replaceRowVersions(bootstrap: CoreBootstrap): void {
    this.skuVersions = new Map(
      bootstrap.skus.map((row) => [row.id, row.rowVersion]),
    );
    this.balanceVersions = new Map(
      bootstrap.balances.map((row) => [row.skuId, row.rowVersion]),
    );
    this.templateVersions = new Map();
    this.templateVersionKnowledge = new Set(['label', 'invoice']);
    for (const row of bootstrap.templates) {
      if (
        row.archivedAt === null &&
        (row.templateKind === 'label' || row.templateKind === 'invoice')
      ) {
        this.templateVersions.set(row.templateKind, row.rowVersion);
      }
    }
  }

  requireSkuWriteContext(
    id: string,
    patch: Partial<Sku>,
  ): { rowVersion: string; base: Record<string, unknown> } {
    const version = this.skuVersions.get(id);
    if (!version) {
      throw new Error(
        'Versi SKU belum tersedia. Sinkronkan ulang lalu coba lagi.',
      );
    }
    const sku = this.canonicalState.skus.find((candidate) => candidate.id === id);
    if (!sku) {
      throw new Error('SKU tidak ditemukan. Sinkronkan ulang lalu coba lagi.');
    }
    const allowed = new Set([
      'skuNumber',
      'name',
      'referencePrice',
      'note',
      'imageUrl',
      'imageHash',
      'sourceImageUrl',
      'archived',
    ]);
    const base: Record<string, unknown> = {};
    for (const field of Object.keys(patch)) {
      if (!allowed.has(field)) {
        throw new Error(`Field SKU ${field} tidak dapat diubah.`);
      }
      base[field] =
        field === 'imageHash'
          ? sku.imageHash ?? null
          : field === 'sourceImageUrl'
            ? sku.sourceImageUrl ?? null
            : sku[field as keyof Sku];
    }
    return { rowVersion: version, base };
  }

  getTemplateWriteContext(
    kind: 'label' | 'invoice',
  ): {
    rowVersion: string | null;
    base: LabelTemplate | InvoiceTemplate | null;
  } {
    if (!this.templateVersionKnowledge.has(kind)) {
      throw new Error(
        'Versi template belum tersedia. Sinkronkan ulang lalu coba lagi.',
      );
    }
    const rowVersion = this.templateVersions.get(kind) ?? null;
    return {
      rowVersion,
      base:
        rowVersion === null
          ? null
          : cloneCore(
              kind === 'label'
                ? this.canonicalState.labelTemplate
                : this.canonicalState.invoiceTemplate,
            ),
    };
  }

  rebaseVersionedOutbox(outbox: CoreOutboxItem[]): CoreOutboxItem[] {
    let changed = false;
    const rebased = outbox.map((item) => {
      const match = /^\/v1\/templates\/(label|invoice)$/.exec(item.path);
      const kind = match?.[1];
      if (
        (kind !== 'label' && kind !== 'invoice') ||
        item.body === null ||
        typeof item.body !== 'object' ||
        Array.isArray(item.body)
      ) {
        return item;
      }
      changed = true;
      return {
        ...item,
        body: asCoreJson({
          ...item.body,
          ...this.getTemplateWriteContext(kind),
        }),
      };
    });
    return changed ? rebased : outbox;
  }

  recordChangeVersions(changes: CoreChange[]): void {
    for (const change of changes) {
      const payload =
        change.payload !== null &&
        typeof change.payload === 'object' &&
        !Array.isArray(change.payload)
          ? change.payload
          : undefined;
      const version = payload?.rowVersion;
      if (typeof version !== 'string') continue;
      if (change.entityType === 'sku') {
        this.skuVersions.set(change.entityId, version);
      } else if (
        change.entityType === 'stock_balance' ||
        change.entityType === 'balance'
      ) {
        const skuId = payload?.skuId;
        if (typeof skuId === 'string') {
          this.balanceVersions.set(skuId, version);
        }
      } else if (change.entityType === 'template') {
        const kind = payload?.templateKind;
        if (kind === 'label' || kind === 'invoice') {
          this.templateVersions.set(kind, version);
        }
      }
    }
  }

  recordMutationVersion(
    path: string,
    acknowledgement: CoreMutationAcknowledgement,
    optimistic?: CoreOptimisticChange,
  ): void {
    const version = acknowledgement.entityVersion;
    if (!version) return;
    const skuMatch = /^\/v1\/skus\/([^/]+)$/.exec(path);
    if (skuMatch?.[1]) {
      this.skuVersions.set(decodeURIComponent(skuMatch[1]), version);
      return;
    }
    const stockMatch =
      /^\/v1\/skus\/([^/]+)\/stock-adjustments$/.exec(path);
    if (stockMatch?.[1]) {
      this.balanceVersions.set(decodeURIComponent(stockMatch[1]), version);
      return;
    }
    const templateMatch = /^\/v1\/templates\/(label|invoice)$/.exec(path);
    if (templateMatch?.[1] === 'label' || templateMatch?.[1] === 'invoice') {
      this.templateVersions.set(templateMatch[1], version);
      if (
        templateMatch[1] === 'label' &&
        optimistic?.kind === 'label-template'
      ) {
        this.canonicalState = {
          ...this.canonicalState,
          labelTemplate: cloneCore(optimistic.template),
        };
      } else if (
        templateMatch[1] === 'invoice' &&
        optimistic?.kind === 'invoice-template'
      ) {
        this.canonicalState = {
          ...this.canonicalState,
          invoiceTemplate: cloneCore(optimistic.template),
        };
      }
      return;
    }
    const entity = acknowledgement.entity;
    if (
      path === '/v1/skus' &&
      entity !== undefined &&
      entity !== null &&
      typeof entity === 'object' &&
      !Array.isArray(entity) &&
      typeof entity.id === 'string'
    ) {
      this.skuVersions.set(entity.id, version);
    }
  }

  getOutbox(): CoreOutboxItem[] {
    return cloneCore(this.outbox);
  }

  getOutboxVersion(): number {
    return this.outboxVersion;
  }

  restore(envelope: CoreCacheEnvelope): void {
    this.canonicalState = cloneCore(envelope.state);
    this.outbox = cloneCore(envelope.outbox);
    this.outboxVersion += 1;
    this.serverRevision = envelope.serverRevision;
    this.publishProjectedState();
  }

  preview(next: DemoState): void {
    this.publishState(next);
  }

  commitCanonical(next: DemoState, revision: string): void {
    this.canonicalState = cloneCore(next);
    this.serverRevision = revision;
    this.publishProjectedState();
  }

  replaceOutbox(outbox: CoreOutboxItem[]): void {
    this.outbox = cloneCore(outbox);
    this.outboxVersion += 1;
    this.publishProjectedState();
    this.publishSync({});
  }

  envelope(
    state = this.canonicalState,
    revision = this.serverRevision,
    outbox = this.outbox,
  ): CoreCacheEnvelope {
    return coreCacheEnvelope(state, revision, outbox);
  }

  publishSync(patch: Partial<SyncSnapshot>): void {
    this.syncSnapshot = {
      ...this.syncSnapshot,
      ...patch,
      serverRevision: this.serverRevision,
      pendingCount: this.outbox.length,
      conflictCount: this.outbox.filter((item) => item.conflict).length,
    };
    this.syncListeners.forEach((listener) => listener());
  }

  private publishState(next: DemoState): void {
    this.state = cloneCore(next);
    this.listeners.forEach((listener) => listener());
  }

  private publishProjectedState(): void {
    this.publishState(
      previewOptimisticOutbox(this.canonicalState, this.outbox),
    );
  }
}
