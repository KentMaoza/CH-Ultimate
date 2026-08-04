import type {
  DemoState,
  InvoiceTemplate,
  LabelTemplate,
  NotaLine,
  NotaTransaction,
  Sku,
} from '../domain/types';
import type {
  ImagePrefetchSnapshot,
  SyncBlockedOperation,
  SyncConflict,
  SyncSnapshot,
} from './operations-gateway-contract';
import type {
  CoreBootstrap,
  CoreChange,
  CoreMutationAcknowledgement,
} from './core-api-types';
import {
  emptyCoreState,
  mapCoreStockCheckRow,
} from './core-bootstrap-mapping';
import type { CoreDeferredCommand } from './core-local-store';
import {
  cloneCore,
  coreCacheEnvelope,
  type CoreCacheEnvelope,
  type CoreNotaVersionState,
  type CoreOptimisticChange,
  type CoreOutboxItem,
} from './core-cache';
import {
  asCoreJson,
  applyCoreOptimisticChange,
  previewOptimisticOutbox,
} from './core-optimistic-state';
import { applyCoreChange } from './core-change-application';
import {
  coreSkuIdentifierRowSchema,
  coreSkuRowSchema,
  coreStockCheckRowSchema,
  coreTemplateRowSchema,
} from './core-api-types';
import {
  invoiceTemplateSchema,
  labelTemplateSchema,
  notaPageSchema,
  notaTransactionSchema,
} from './core-domain-schemas';

export class CoreGatewayState {
  private state = emptyCoreState();
  private canonicalState = cloneCore(this.state);
  private outbox: CoreOutboxItem[] = [];
  private provisionalNotas: NotaTransaction[] = [];
  private deferredCommands: CoreDeferredCommand[] = [];
  private deferredPendingCount = 0;
  private quarantinedCount = 0;
  private blockedOperations: SyncBlockedOperation[] = [];
  private offlineConflicts: SyncConflict[] = [];
  private outboxVersion = 0;
  private serverRevision = '0';
  private skuVersions = new Map<string, string>();
  private balanceVersions = new Map<string, string>();
  private templateVersions = new Map<'label' | 'invoice', string>();
  private templateVersionKnowledge = new Set<'label' | 'invoice'>();
  private notaFieldVersions = new Map<string, Record<string, string>>();
  private notaStructureVersions = new Map<string, string>();
  private notaLifecycleVersions = new Map<string, string>();
  private notaPageVersions = new Map<string, string>();
  private notaPageLifecycleVersions = new Map<string, string>();
  private notaLineVersions = new Map<string, string>();
  private syncSnapshot: SyncSnapshot = {
    phase: 'connecting',
    serverRevision: '0',
    pendingCount: 0,
    conflictCount: 0,
    quarantinedCount: 0,
    blockedCount: 0,
  };
  private listeners = new Set<() => void>();
  private syncListeners = new Set<() => void>();

  getSnapshot = (): DemoState => cloneCore(this.state);

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSyncSnapshot = (): SyncSnapshot => ({ ...this.syncSnapshot });

  publishImagePrefetch(imagePrefetch: ImagePrefetchSnapshot): void {
    this.syncSnapshot = { ...this.syncSnapshot, imagePrefetch: { ...imagePrefetch } };
    for (const listener of this.syncListeners) listener();
  }

  getConflicts = (): SyncConflict[] => [
    ...this.outbox.flatMap((item) =>
      item.conflict ? [cloneCore(item.conflict)] : [],
    ),
    ...cloneCore(this.offlineConflicts),
  ];

  getBlockedOperations = (): SyncBlockedOperation[] =>
    cloneCore(this.blockedOperations);

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
    this.notaFieldVersions = new Map(
      bootstrap.notas.map((row) => [row.id, { ...row.fieldVersions }]),
    );
    this.notaStructureVersions = new Map(
      bootstrap.notas.map((row) => [row.id, row.structureVersion]),
    );
    this.notaLifecycleVersions = new Map(
      bootstrap.notas.map((row) => [row.id, row.lifecycleVersion]),
    );
    this.notaPageVersions = new Map(
      bootstrap.notaPages.map((row) => [row.id, row.rowVersion]),
    );
    this.notaPageLifecycleVersions = new Map(
      bootstrap.notaPages.map((row) => [row.id, row.lifecycleVersion]),
    );
    this.notaLineVersions = new Map(
      bootstrap.notaLines.map((row) => [row.id, row.rowVersion]),
    );
  }

  getNotaVersions(): Record<string, CoreNotaVersionState> {
    return Object.fromEntries(
      this.canonicalState.notaTransactions.flatMap((nota) => {
        const fieldVersions = this.notaFieldVersions.get(nota.id);
        const structureVersion = this.notaStructureVersions.get(nota.id);
        const lifecycleVersion = this.notaLifecycleVersions.get(nota.id);
        if (!fieldVersions || !structureVersion || !lifecycleVersion) return [];
        const pageIds = new Set(nota.pages.map((page) => page.id));
        const lineIds = new Set(
          nota.pages.flatMap((page) => page.lines.map((line) => line.id)),
        );
        return [[
          nota.id,
          {
            fieldVersions: { ...fieldVersions },
            structureVersion,
            lifecycleVersion,
            pageVersions: Object.fromEntries(
              [...this.notaPageVersions].filter(([id]) => pageIds.has(id)),
            ),
            pageLifecycleVersions: Object.fromEntries(
              [...this.notaPageLifecycleVersions].filter(([id]) =>
                pageIds.has(id),
              ),
            ),
            lineVersions: Object.fromEntries(
              [...this.notaLineVersions].filter(([id]) => lineIds.has(id)),
            ),
          } satisfies CoreNotaVersionState,
        ] as const];
      }),
    );
  }

  replaceCachedNotaVersions(
    versions: Record<string, CoreNotaVersionState>,
  ): void {
    this.notaFieldVersions = new Map();
    this.notaStructureVersions = new Map();
    this.notaLifecycleVersions = new Map();
    this.notaPageVersions = new Map();
    this.notaPageLifecycleVersions = new Map();
    this.notaLineVersions = new Map();
    for (const [notaId, version] of Object.entries(versions)) {
      this.notaFieldVersions.set(notaId, { ...version.fieldVersions });
      this.notaStructureVersions.set(notaId, version.structureVersion);
      this.notaLifecycleVersions.set(notaId, version.lifecycleVersion);
      for (const [pageId, rowVersion] of Object.entries(version.pageVersions)) {
        this.notaPageVersions.set(pageId, rowVersion);
      }
      for (const [pageId, lifecycleVersion] of Object.entries(
        version.pageLifecycleVersions,
      )) {
        this.notaPageLifecycleVersions.set(pageId, lifecycleVersion);
      }
      for (const [lineId, rowVersion] of Object.entries(version.lineVersions)) {
        this.notaLineVersions.set(lineId, rowVersion);
      }
    }
  }

  hasNotaVersionKnowledge(id: string): boolean {
    return (
      this.notaFieldVersions.has(id) &&
      this.notaStructureVersions.has(id) &&
      this.notaLifecycleVersions.has(id)
    );
  }

  hasDeferredNotaConflict(id: string): boolean {
    return this.deferredCommands.some(
      (command) =>
        command.kind === 'nota-mutation' &&
        command.payload.notaId === id &&
        command.status === 'conflict',
    );
  }

  requireNotaHeaderWriteContext(
    id: string,
    patch: Partial<NotaTransaction>,
  ): {
    lifecycleVersion: string;
    fields: Record<
      string,
      { version: string; base: unknown; mine: unknown }
    >;
  } {
    const versions = this.notaFieldVersions.get(id);
    const lifecycleVersion = this.notaLifecycleVersions.get(id);
    const canonical = this.canonicalState.notaTransactions.find(
      (nota) => nota.id === id,
    );
    if (!versions || !lifecycleVersion || !canonical) {
      throw new Error('Versi Nota belum tersedia. Sinkronkan ulang lalu coba lagi.');
    }
    const allowed = new Set([
      'customerName',
      'customerPlace',
      'transactionDate',
      'payment',
    ]);
    const fields: Record<
      string,
      { version: string; base: unknown; mine: unknown }
    > = {};
    for (const [field, mine] of Object.entries(patch)) {
      if (!allowed.has(field) || !versions[field]) {
        throw new Error(`Field Nota ${field} tidak dapat diubah.`);
      }
      fields[field] = {
        version: versions[field],
        base: canonical[field as keyof NotaTransaction],
        mine,
      };
    }
    return { lifecycleVersion, fields };
  }

  requireNotaLineWriteContext(
    notaId: string,
    pageId: string,
    lineId: string,
    patch: Partial<NotaLine>,
  ): {
    lifecycleVersion: string;
    pageVersion: string;
    lineVersion: string;
    base: Record<string, unknown>;
    mine: Record<string, unknown>;
  } {
    const pageVersion = this.notaPageVersions.get(pageId);
    const lifecycleVersion = this.notaLifecycleVersions.get(notaId);
    const lineVersion = this.notaLineVersions.get(lineId);
    const canonicalPage = this.canonicalState.notaTransactions
      .find((nota) => nota.id === notaId)
      ?.pages.find((page) => page.id === pageId);
    const projectedPage = this.state.notaTransactions
      .find((nota) => nota.id === notaId)
      ?.pages.find((page) => page.id === pageId);
    const projected = projectedPage?.lines.find((line) => line.id === lineId);
    const canonical =
      canonicalPage?.lines.find((line) => line.id === lineId) ?? projected;
    if (
      !lifecycleVersion ||
      !pageVersion ||
      !lineVersion ||
      !canonical ||
      !projected
    ) {
      throw new Error('Versi baris Nota belum tersedia. Sinkronkan ulang lalu coba lagi.');
    }
    return {
      lifecycleVersion,
      pageVersion,
      lineVersion,
      base: notaLineMaterial(
        canonical,
        (canonicalPage ?? projectedPage)!.lines.indexOf(canonical),
      ),
      mine: notaLineMaterial(
        { ...projected, ...patch },
        projectedPage!.lines.indexOf(projected),
      ),
    };
  }

  requireNotaDeleteContext(
    notaId: string,
    pageId: string,
    lineId: string,
  ): {
    lifecycleVersion: string;
    pageVersion: string;
    lineVersion: string;
    base: Record<string, unknown>;
  } {
    const context = this.requireNotaLineWriteContext(
      notaId,
      pageId,
      lineId,
      {},
    );
    return {
      lifecycleVersion: context.lifecycleVersion,
      pageVersion: context.pageVersion,
      lineVersion: context.lineVersion,
      base: context.base,
    };
  }

  requireNotaStructureContext(id: string): {
    lifecycleVersion: string;
    structureVersion: string;
  } {
    const structureVersion = this.notaStructureVersions.get(id);
    const lifecycleVersion = this.notaLifecycleVersions.get(id);
    if (!structureVersion || !lifecycleVersion) {
      throw new Error('Versi struktur Nota belum tersedia.');
    }
    return { lifecycleVersion, structureVersion };
  }

  requireNotaPageLifecycleContext(
    id: string,
    pageId: string,
  ): {
    lifecycleVersion: string;
    structureVersion: string;
    pageVersion: string;
  } {
    const pageVersion = this.notaPageLifecycleVersions.get(pageId);
    if (!pageVersion) throw new Error('Versi halaman Nota belum tersedia.');
    return { ...this.requireNotaStructureContext(id), pageVersion };
  }

  requireNotaLifecycleContext(id: string): { lifecycleVersion: string } {
    const lifecycleVersion = this.notaLifecycleVersions.get(id);
    if (!lifecycleVersion) throw new Error('Versi lifecycle Nota belum tersedia.');
    return { lifecycleVersion };
  }

  requireSkuWriteContext(
    id: string,
    patch: Record<string, unknown>,
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

  requireStockCheckContext(id: string): {
    observedQuantityPcs: number;
    baseBalanceVersion: string;
  } {
    const baseBalanceVersion = this.balanceVersions.get(id);
    const sku = this.canonicalState.skus.find((candidate) => candidate.id === id);
    if (!sku || sku.archived) {
      throw new Error('SKU aktif tidak ditemukan. Sinkronkan ulang lalu coba lagi.');
    }
    if (!baseBalanceVersion || !sku.tracked) {
      throw new Error('Versi saldo stok belum tersedia. Sinkronkan ulang lalu coba lagi.');
    }
    return { observedQuantityPcs: sku.stock, baseBalanceVersion };
  }

  getBalanceVersion(id: string): string | undefined {
    return this.balanceVersions.get(id);
  }

  getBalanceVersions(): Record<string, string> {
    return Object.fromEntries(this.balanceVersions);
  }

  replaceCachedBalanceVersions(versions: Record<string, string>): void {
    this.balanceVersions = new Map(Object.entries(versions));
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

  recordChangeVersions(changes: CoreChange[]): void {
    for (const change of changes) {
      const payload =
        change.payload !== null &&
        typeof change.payload === 'object' &&
        !Array.isArray(change.payload)
          ? change.payload
          : undefined;
      if (change.entityType === 'nota') {
        const structureVersion = payload?.structureVersion;
        const lifecycleVersion = payload?.lifecycleVersion;
        const fieldVersions = payload?.fieldVersions;
        if (typeof structureVersion === 'string') {
          this.notaStructureVersions.set(change.entityId, structureVersion);
        }
        if (typeof lifecycleVersion === 'string') {
          this.notaLifecycleVersions.set(change.entityId, lifecycleVersion);
        }
        if (
          fieldVersions &&
          typeof fieldVersions === 'object' &&
          !Array.isArray(fieldVersions)
        ) {
          this.notaFieldVersions.set(
            change.entityId,
            Object.fromEntries(
              Object.entries(fieldVersions)
                .filter((entry): entry is [string, string] =>
                  typeof entry[1] === 'string'),
            ),
          );
        }
        continue;
      }
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
      } else if (change.entityType === 'nota_page') {
        this.notaPageVersions.set(change.entityId, version);
        const lifecycleVersion = payload?.lifecycleVersion;
        if (typeof lifecycleVersion === 'string') {
          this.notaPageLifecycleVersions.set(change.entityId, lifecycleVersion);
        }
      } else if (change.entityType === 'nota_line') {
        this.notaLineVersions.set(change.entityId, version);
      }
    }
  }

  recordMutationAcknowledgement(
    path: string,
    acknowledgement: CoreMutationAcknowledgement,
    requestBody?: CoreOutboxItem['body'],
  ): boolean {
    const version = acknowledgement.entityVersion;
    const registerBarcodeMatch =
      /^\/v1\/skus\/([^/]+)\/package-barcodes$/.exec(path);
    const packageBarcodeMatch =
      /^\/v1\/package-barcodes\/([^/]+)$/.exec(path);
    if (registerBarcodeMatch?.[1] || packageBarcodeMatch?.[1]) {
      const pathId = decodeURIComponent(
        registerBarcodeMatch?.[1] ?? packageBarcodeMatch![1]!,
      );
      if (acknowledgement.entity !== undefined) {
        const entity = coreSkuIdentifierRowSchema.parse(
          acknowledgement.entity,
        );
        if (
          entity.identifierKind !== 'package_barcode' ||
          (registerBarcodeMatch && entity.skuId !== pathId) ||
          (packageBarcodeMatch && entity.id !== pathId)
        ) {
          throw new Error('Respons barcode kemasan CH Core tidak cocok.');
        }
        this.canonicalState = applyCoreChange(this.canonicalState, {
          revision: acknowledgement.serverRevision ?? this.serverRevision,
          entityType: 'sku_identifier',
          entityId: entity.id,
          operation: 'upsert',
          payload: entity,
          createdAt: entity.createdAt,
        });
        return true;
      }
      if (!packageBarcodeMatch) {
        throw new Error('Respons barcode kemasan CH Core tidak valid.');
      }
      this.canonicalState = {
        ...this.canonicalState,
        skus: this.canonicalState.skus.map((sku) => {
          const removed = sku.identifiers.find(
            (identifier) => identifier.id === pathId,
          );
          return removed
            ? {
                ...sku,
                identifiers: sku.identifiers.filter(
                  (identifier) => identifier.id !== pathId,
                ),
                aliases: sku.aliases.filter(
                  (alias) => alias !== removed.value,
                ),
              }
            : sku;
        }),
      };
      return true;
    }
    if (!version) return false;
    const skuMatch = /^\/v1\/skus\/([^/]+)(?:\/image)?$/.exec(path);
    if (skuMatch?.[1]) {
      const skuId = decodeURIComponent(skuMatch[1]);
      const currentVersion = this.skuVersions.get(skuId);
      if (currentVersion && BigInt(version) < BigInt(currentVersion)) {
        return false;
      }
      if (acknowledgement.entity === undefined) {
        this.skuVersions.set(skuId, version);
        return false;
      }
      const entity = coreSkuRowSchema.parse(acknowledgement.entity);
      if (entity.id !== skuId) {
        throw new Error('Respons SKU CH Core tidak cocok.');
      }
      this.skuVersions.set(skuId, version);
      this.canonicalState = applyCoreChange(this.canonicalState, {
        revision: acknowledgement.serverRevision ?? this.serverRevision,
        entityType: 'sku',
        entityId: skuId,
        operation: 'upsert',
        payload: entity,
        createdAt: entity.updatedAt,
      });
      return true;
    }
    const stockMatch =
      /^\/v1\/skus\/([^/]+)\/stock-adjustments$/.exec(path);
    if (stockMatch?.[1]) {
      this.balanceVersions.set(decodeURIComponent(stockMatch[1]), version);
      return false;
    }
    const stockCheckMatch =
      /^\/v1\/skus\/([^/]+)\/stock-checks$/.exec(path);
    if (stockCheckMatch?.[1]) {
      const skuId = decodeURIComponent(stockCheckMatch[1]);
      const currentVersion = this.balanceVersions.get(skuId);
      if (currentVersion && BigInt(version) < BigInt(currentVersion)) {
        return false;
      }
      const entity = coreStockCheckRowSchema.parse(acknowledgement.entity);
      if (entity.skuId !== skuId) {
        throw new Error('Respons cek stok CH Core tidak cocok.');
      }
      const mapped = mapCoreStockCheckRow(entity);
      this.balanceVersions.set(skuId, version);
      this.canonicalState = {
        ...this.canonicalState,
        skus: this.canonicalState.skus.map((sku) =>
          sku.id === skuId
            ? {
                ...sku,
                stock: mapped.countedQuantityPcs,
                lastStockCheckedAt: mapped.countedAt,
              }
            : sku,
        ),
        stockChecks: [
          ...this.canonicalState.stockChecks.filter(
            (stockCheck) => stockCheck.id !== mapped.id,
          ),
          mapped,
        ],
      };
      return true;
    }
    const templateMatch = /^\/v1\/templates\/(label|invoice)$/.exec(path);
    if (templateMatch?.[1] === 'label' || templateMatch?.[1] === 'invoice') {
      const kind = templateMatch[1];
      const currentVersion = this.templateVersions.get(kind);
      if (currentVersion && BigInt(version) < BigInt(currentVersion)) {
        return false;
      }
      if (acknowledgement.entity === undefined) {
        this.templateVersions.set(kind, version);
        return false;
      }
      const entity = coreTemplateRowSchema.parse(acknowledgement.entity);
      if (entity.templateKind !== kind) {
        throw new Error('Respons template CH Core tidak cocok.');
      }
      this.templateVersions.set(kind, version);
      const definition =
        kind === 'label'
          ? labelTemplateSchema.parse(entity.definition)
          : invoiceTemplateSchema.parse(entity.definition);
      this.canonicalState =
        kind === 'label'
          ? {
              ...this.canonicalState,
              labelTemplate: cloneCore(definition as LabelTemplate),
            }
          : {
              ...this.canonicalState,
              invoiceTemplate: cloneCore(definition as InvoiceTemplate),
            };
      return true;
    }
    const entity = acknowledgement.entity;
    if (path === '/v1/notas' && entity !== undefined) {
      const parsed = notaTransactionSchema.safeParse(entity);
      if (parsed.success) {
        this.canonicalState = {
          ...this.canonicalState,
          notaTransactions: [
            ...this.canonicalState.notaTransactions.filter(
              (nota) => nota.id !== parsed.data.id,
            ),
            parsed.data,
          ],
        };
        this.notaFieldVersions.set(parsed.data.id, {
          customerName: '1',
          customerPlace: '1',
          transactionDate: '1',
          payment: '1',
        });
        this.notaStructureVersions.set(parsed.data.id, '1');
        this.notaLifecycleVersions.set(parsed.data.id, version ?? '1');
        for (const page of parsed.data.pages) {
          this.notaPageVersions.set(page.id, '1');
          this.notaPageLifecycleVersions.set(page.id, '1');
          for (const line of page.lines) this.notaLineVersions.set(line.id, '1');
        }
        return true;
      }
    }
    const addPageMatch = /^\/v1\/notas\/([^/]+)\/pages$/.exec(path);
    if (addPageMatch?.[1] && entity !== undefined) {
      const page = notaPageSchema.safeParse(entity);
      const notaId = decodeURIComponent(addPageMatch[1]);
      if (page.success) {
        this.canonicalState = {
          ...this.canonicalState,
          notaTransactions: this.canonicalState.notaTransactions.map((nota) =>
            nota.id === notaId
              ? {
                  ...nota,
                  pages: [
                    ...nota.pages.filter((candidate) => candidate.id !== page.data.id),
                    page.data,
                  ],
                  nextNoteIndex: nota.nextNoteIndex + 1,
                }
              : nota,
          ),
        };
        this.notaPageVersions.set(page.data.id, version ?? '1');
        this.notaPageLifecycleVersions.set(page.data.id, '1');
        for (const line of page.data.lines) this.notaLineVersions.set(line.id, '1');
        const structure = this.notaStructureVersions.get(notaId);
        if (structure) {
          this.notaStructureVersions.set(
            notaId,
            (BigInt(structure) + 1n).toString(),
          );
        }
        return true;
      }
    }
    if (
      (
        /^\/v1\/notas(?:\/|$)/.test(path) ||
        /^\/v1\/conflicts\/[^/]+\/resolve$/.test(path)
      ) &&
      entity !== undefined &&
      entity !== null &&
      typeof entity === 'object' &&
      !Array.isArray(entity)
    ) {
      const parsed = notaTransactionSchema.safeParse(entity);
      if (parsed.success) {
        const prior = this.canonicalState.notaTransactions.find(
          (nota) => nota.id === parsed.data.id,
        );
        this.canonicalState = {
          ...this.canonicalState,
          notaTransactions: prior
            ? this.canonicalState.notaTransactions.map((nota) =>
                nota.id === parsed.data.id ? parsed.data : nota)
            : [...this.canonicalState.notaTransactions, parsed.data],
        };
        const versionState = acknowledgement.versionState;
        if (versionState) {
          if (versionState.notaId !== parsed.data.id) {
            throw new Error('Versi respons Nota CH Core tidak cocok.');
          }
          this.notaFieldVersions.set(
            parsed.data.id,
            { ...versionState.fieldVersions },
          );
          this.notaStructureVersions.set(
            parsed.data.id,
            versionState.structureVersion,
          );
          this.notaLifecycleVersions.set(
            parsed.data.id,
            versionState.lifecycleVersion,
          );
          for (const page of prior?.pages ?? []) {
            this.notaPageVersions.delete(page.id);
            this.notaPageLifecycleVersions.delete(page.id);
            for (const line of page.lines) this.notaLineVersions.delete(line.id);
          }
          for (const [pageId, rowVersion] of Object.entries(
            versionState.pageVersions,
          )) {
            this.notaPageVersions.set(pageId, rowVersion);
          }
          for (const [pageId, lifecycleVersion] of Object.entries(
            versionState.pageLifecycleVersions,
          )) {
            this.notaPageLifecycleVersions.set(pageId, lifecycleVersion);
          }
          for (const [lineId, rowVersion] of Object.entries(
            versionState.lineVersions,
          )) {
            this.notaLineVersions.set(lineId, rowVersion);
          }
        }
        if (
          version &&
          /^\/v1\/notas\/[^/]+\/(complete|reopen|cancel|restore)$/.test(path)
        ) {
          this.notaLifecycleVersions.set(parsed.data.id, version);
        }
        const request =
          requestBody &&
          typeof requestBody === 'object' &&
          !Array.isArray(requestBody)
            ? requestBody
            : undefined;
        const fields =
          request?.fields &&
          typeof request.fields === 'object' &&
          !Array.isArray(request.fields)
            ? request.fields
            : undefined;
        if (fields) {
          const known = {
            ...(this.notaFieldVersions.get(parsed.data.id) ?? {}),
          };
          for (const [field, edit] of Object.entries(fields)) {
            if (
              edit &&
              typeof edit === 'object' &&
              !Array.isArray(edit) &&
              typeof edit.version === 'string'
            ) {
              known[field] = (BigInt(edit.version) + 1n).toString();
            }
          }
          this.notaFieldVersions.set(parsed.data.id, known);
        }
        const lineMatch =
          /^\/v1\/notas\/[^/]+\/pages\/[^/]+\/lines\/([^/]+)$/.exec(path);
        if (lineMatch?.[1] && version) {
          this.notaLineVersions.set(decodeURIComponent(lineMatch[1]), version);
        }
        const pageLifecycleMatch =
          /^\/v1\/notas\/([^/]+)\/pages\/([^/]+)\/(cancel|restore)$/.exec(path);
        if (pageLifecycleMatch?.[1] && pageLifecycleMatch[2] && version) {
          const notaId = decodeURIComponent(pageLifecycleMatch[1]);
          const pageId = decodeURIComponent(pageLifecycleMatch[2]);
          this.notaPageVersions.set(pageId, version);
          this.notaPageLifecycleVersions.set(pageId, version);
          const structureVersion =
            request?.structureVersion &&
            typeof request.structureVersion === 'string'
              ? request.structureVersion
              : this.notaStructureVersions.get(notaId);
          if (structureVersion) {
            this.notaStructureVersions.set(
              notaId,
              (BigInt(structureVersion) + 1n).toString(),
            );
          }
        }
        return true;
      }
    }
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
    return false;
  }

  rebaseNeverSentItem(
    item: CoreOutboxItem,
    acknowledgedPath: string,
  ): CoreOutboxItem {
    if (
      item.body === null ||
      typeof item.body !== 'object' ||
      Array.isArray(item.body)
    ) {
      return item;
    }
    if (
      item.path === acknowledgedPath &&
      item.optimistic?.kind === 'nota-header'
    ) {
      return {
        ...item,
        body: asCoreJson(
          this.requireNotaHeaderWriteContext(
            item.optimistic.notaId,
            item.optimistic.patch,
          ),
        ),
      };
    }
    if (
      item.path === acknowledgedPath &&
      item.optimistic?.kind === 'nota-line'
    ) {
      return {
        ...item,
        body: asCoreJson(
          this.requireNotaLineWriteContext(
            item.optimistic.notaId,
            item.optimistic.pageId,
            item.optimistic.lineId,
            item.optimistic.patch,
          ),
        ),
      };
    }
    const skuMatch = /^\/v1\/skus\/([^/]+)(?:\/image)?$/.exec(item.path);
    const acknowledgedSku =
      /^\/v1\/skus\/([^/]+)(?:\/image)?$/.exec(acknowledgedPath);
    if (
      skuMatch?.[1] &&
      acknowledgedSku?.[1] === skuMatch[1]
    ) {
      const skuId = decodeURIComponent(skuMatch[1]);
      if (item.path.endsWith('/image')) {
        const context = this.requireSkuWriteContext(skuId, {
          imageHash: null,
          sourceImageUrl: null,
        });
        return {
          ...item,
          body: asCoreJson({
            ...item.body,
            rowVersion: context.rowVersion,
            base: context.base,
          }),
        };
      }
      const patch = item.body.patch;
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        return item;
      }
      const context = this.requireSkuWriteContext(
        skuId,
        patch as Partial<Sku>,
      );
      return {
        ...item,
        body: asCoreJson({
          ...item.body,
          rowVersion: context.rowVersion,
          base: context.base,
        }),
      };
    }
    const templateMatch = /^\/v1\/templates\/(label|invoice)$/.exec(item.path);
    if (
      item.path === acknowledgedPath &&
      (templateMatch?.[1] === 'label' || templateMatch?.[1] === 'invoice')
    ) {
      return {
        ...item,
        body: asCoreJson({
          ...item.body,
          ...this.getTemplateWriteContext(templateMatch[1]),
        }),
      };
    }
    return item;
  }

  getOutbox(): CoreOutboxItem[] {
    return cloneCore(this.outbox);
  }

  getOutboxVersion(): number {
    return this.outboxVersion;
  }

  restore(envelope: CoreCacheEnvelope): void {
    this.canonicalState = cloneCore(envelope.state);
    this.replaceCachedNotaVersions(envelope.notaVersions ?? {});
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

  refreshCanonicalProjection(): void {
    this.publishProjectedState();
  }

  setOfflineProjection(
    provisionalNotas: NotaTransaction[],
    deferredCommands: CoreDeferredCommand[],
    deferredPendingCount: number,
    quarantinedCount: number,
    offlineConflicts: SyncConflict[],
    blockedOperations: SyncBlockedOperation[],
  ): void {
    const projectionChanged =
      JSON.stringify(this.provisionalNotas) !==
        JSON.stringify(provisionalNotas) ||
      JSON.stringify(this.deferredCommands) !==
        JSON.stringify(deferredCommands);
    this.provisionalNotas = cloneCore(provisionalNotas);
    this.deferredCommands = cloneCore(deferredCommands);
    this.deferredPendingCount = deferredPendingCount;
    this.quarantinedCount = quarantinedCount;
    this.offlineConflicts = cloneCore(offlineConflicts);
    this.blockedOperations = cloneCore(blockedOperations);
    if (projectionChanged) this.publishProjectedState();
    this.publishSync({});
  }

  envelope(
    state = this.canonicalState,
    revision = this.serverRevision,
    outbox = this.outbox,
  ): CoreCacheEnvelope {
    return coreCacheEnvelope(state, revision, outbox, this.getNotaVersions());
  }

  publishSync(patch: Partial<SyncSnapshot>): void {
    this.syncSnapshot = {
      ...this.syncSnapshot,
      ...patch,
      serverRevision: this.serverRevision,
      pendingCount: this.outbox.length + this.deferredPendingCount,
      conflictCount:
        this.outbox.filter((item) => item.conflict).length +
        this.offlineConflicts.length,
      quarantinedCount: this.quarantinedCount,
      blockedCount: this.blockedOperations.length,
    };
    this.syncListeners.forEach((listener) => listener());
  }

  private publishState(next: DemoState): void {
    this.state = cloneCore(next);
    this.listeners.forEach((listener) => listener());
  }

  private publishProjectedState(): void {
    let projected = previewOptimisticOutbox(
      this.canonicalState,
      this.outbox,
    );
    for (const command of this.deferredCommands) {
      if (
        command.kind === 'nota-mutation' &&
        command.status !== 'conflict' &&
        command.status !== 'quarantined'
      ) {
        projected = applyCoreOptimisticChange(
          projected,
          command.payload.optimistic,
        );
        continue;
      }
      if (command.kind !== 'stock-count' || command.status === 'conflict') {
        continue;
      }
      projected = {
        ...projected,
        skus: projected.skus.map((sku) =>
          sku.id === command.payload.skuId
            ? {
                ...sku,
                stock: command.payload.countedQuantityPcs,
                lastStockCheckedAt: command.payload.countedAt,
              }
            : sku,
        ),
      };
    }
    this.publishState({
      ...projected,
      notaTransactions: [
        ...projected.notaTransactions.filter(
          (nota) =>
            !this.provisionalNotas.some((local) => local.id === nota.id),
        ),
        ...cloneCore(this.provisionalNotas),
      ],
    });
  }
}

function notaLineMaterial(
  line: NotaLine,
  linePosition: number,
): Record<string, unknown> {
  return {
    linePosition,
    skuId: line.skuId ?? null,
    description: line.description,
    kind: line.kind,
    quantity: line.quantity,
    unit: line.unit,
    pcsPrice: line.pcsPrice,
    lsnPrice: line.lsnPrice,
  };
}
