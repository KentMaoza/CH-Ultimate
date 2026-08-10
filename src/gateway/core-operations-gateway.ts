import type {
  DemoState,
  InvoiceTemplate,
  LabelTemplate,
  Nota,
  NotaCompletionDestination,
  NotaLine,
  NotaTransaction,
  Sku,
  WorkbookImportResult,
} from '../domain/types';
import { ZodError } from 'zod';
import { noteSuffixFromIndex } from '../domain/nota';
import type { CoreApiTransport } from './core-api-transport';
import {
  parseCoreCache,
  type CoreGatewayClock,
  type CoreGatewayStorage,
} from './core-cache';
import { CoreEnvelopeCoordinator } from './core-envelope-coordinator';
import { CoreGatewayState } from './core-gateway-state';
import { CoreMutationCoordinator } from './core-mutation-coordinator';
import { CoreMutationQueue } from './core-mutation-queue';
import { CoreDeferredOutbox } from './core-outbox';
import {
  asOfflineJson,
  CoreLocalOwnershipError,
  CoreLocalStore,
  type CoreDeferredCommand,
  type CoreLocalEnvelope,
} from './core-local-store';
import {
  CorePollingCoordinator,
  type CorePollingDiagnosticSink,
} from './core-polling';
import {
  CoreSchemaIncompatibilityHandler,
  type CoreSchemaIncompatibilitySource,
} from './core-schema-incompatibility';
import type {
  CatalogueCommitReceipt,
  CatalogueValidationResult,
  CreateSkuInput,
  OperationsGateway,
  OperationsGatewayCapabilities,
  SyncBlockedOperation,
  SyncSnapshot,
} from './operations-gateway-contract';
import {
  CORE_API_PATHS,
  CoreApiUpgradeRequiredError,
  parseCatalogueCommit,
  parseCatalogueImage,
  parseCatalogueValidation,
  parseCoreApiError,
  parseCoreMutationAcknowledgement,
  coreBalanceRowSchema,
  coreStockCheckRowSchema,
} from './core-api-types';
import { CORE_UPGRADE_REQUIRED_MESSAGE } from './sync-presentation';
import { notaTransactionSchema } from './core-domain-schemas';
import {
  integerFromDecimal,
  mapCoreStockCheckRow,
} from './core-bootstrap-mapping';
import { applyCoreOptimisticChange } from './core-optimistic-state';
import {
  CoreImageCacheCoordinator,
  imageBlobFromBase64,
  imageBlobToDataUrl,
} from './core-image-cache';
import { safeRemoteImageUrl } from './safe-image-url';

export type {
  CoreCacheEnvelope,
  CoreGatewayClock,
  CoreGatewayStorage,
  CoreOptimisticChange,
  CoreOutboxItem,
} from './core-cache';
export { CORE_CACHE_VERSION } from './core-cache';
export { mapCoreBootstrapToDemoState } from './core-bootstrap-mapping';

export interface CoreOperationsGateway extends OperationsGateway {
  dispose(): void;
}

export class CoreGatewayNetworkBlockedError extends Error {
  readonly code = 'UPGRADE_REQUIRED';

  constructor() {
    super(CORE_UPGRADE_REQUIRED_MESSAGE);
    this.name = 'CoreGatewayNetworkBlockedError';
  }
}

function parseImageDataUrl(
  value: string | undefined,
): { mimeType: string; bytesBase64: string; blob: Blob } | null {
  if (!value?.startsWith('data:')) return null;
  const separator = value.indexOf(',');
  const mimeMatch = /^data:(image\/(?:png|jpeg|gif|webp));base64$/.exec(
    value.slice(0, separator),
  );
  const bytesBase64 = separator >= 0 ? value.slice(separator + 1) : '';
  const padding = bytesBase64.endsWith('==') ? 2 : bytesBase64.endsWith('=') ? 1 : 0;
  const decodedBytes = Math.floor((bytesBase64.length * 3) / 4) - padding;
  if (
    !mimeMatch?.[1] || !bytesBase64 || decodedBytes > 5 * 1024 * 1024 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(bytesBase64)
  ) {
    throw new Error('Data gambar tidak valid atau terlalu besar.');
  }
  return {
    mimeType: mimeMatch[1],
    bytesBase64,
    blob: imageBlobFromBase64(mimeMatch[1], bytesBase64),
  };
}

class CoreOperationsGatewayImpl implements CoreOperationsGateway {
  readonly capabilities: OperationsGatewayCapabilities = {
    canResetDemoData: false,
    canImportInitialCatalogue: false,
    canStageInitialCatalogue: false,
    canManagePackageBarcodes: false,
  };

  private readonly state = new CoreGatewayState();
  private readonly polling: CorePollingCoordinator;
  private readonly mutations: CoreMutationCoordinator;
  private readonly envelopes: CoreEnvelopeCoordinator;
  private readonly localStore: CoreLocalStore;
  private readonly deferred: CoreDeferredOutbox;
  private readonly images: CoreImageCacheCoordinator;
  private readonly schemaIncompatibility: CoreSchemaIncompatibilityHandler;
  private readonly clock: CoreGatewayClock;
  private provisionalNotaIds = new Set<string>();

  constructor(
    private readonly transport: CoreApiTransport,
    private readonly storage: CoreGatewayStorage,
    clock: CoreGatewayClock,
    diagnosticSink: CorePollingDiagnosticSink = () => {},
  ) {
    this.clock = clock;
    this.localStore = new CoreLocalStore(storage);
    this.schemaIncompatibility = new CoreSchemaIncompatibilityHandler(
      this.state,
      diagnosticSink,
    );
    this.images = new CoreImageCacheCoordinator(
      transport,
      storage,
      clock,
      this.state,
      () => this.state.getSnapshot().skus,
      this.schemaIncompatibility,
    );
    this.deferred = new CoreDeferredOutbox(
      this.localStore,
      transport,
      {
        now: () => clock.now(),
        acknowledge: acknowledgeOfflineCommand,
        onRevoked: () => this.onPersistedAuthenticationRevoked(),
        schemaIncompatibility: this.schemaIncompatibility,
      },
    );
    const canonicalStorage = this.localStore.canonicalStorage();
    const envelopes = new CoreEnvelopeCoordinator(
      canonicalStorage,
      this.state,
    );
    this.envelopes = envelopes;
    this.polling = new CorePollingCoordinator(
      transport,
      canonicalStorage,
      clock,
      this.state,
      envelopes,
      this.schemaIncompatibility,
      (role) => this.applyDeviceRole(role),
      () => this.markTrustedBootstrap(),
      (authoritativeBootstrap) => this.onAuthenticatedOnline(authoritativeBootstrap),
      () => this.onAuthenticationRevoked(),
    );
    this.mutations = new CoreMutationCoordinator(
      new CoreMutationQueue(
        transport,
        envelopes,
        this.state,
        () => this.polling.refreshNow(),
        () => clock.now(),
        () => this.onAuthenticationRevoked(),
        this.schemaIncompatibility,
      ),
      this.state,
    );
  }

  getSnapshot = (): DemoState => this.state.getSnapshot();
  subscribe = (listener: () => void): (() => void) =>
    this.state.subscribe(listener);
  getSyncSnapshot = (): SyncSnapshot => this.state.getSyncSnapshot();
  getConflicts = () => this.state.getConflicts();
  getBlockedOperations = (): SyncBlockedOperation[] =>
    this.state.getBlockedOperations();
  subscribeSync = (listener: () => void): (() => void) =>
    this.state.subscribeSync(listener);
  isNotaLifecycleOnlineOnly = (id: string): boolean => !this.hasLocalNota(id);
  initialize = async (): Promise<void> => {
    let envelope: CoreLocalEnvelope;
    let legacyCacheRestored = false;
    try {
      const cached = await this.storage.load();
      if (
        cached &&
        typeof cached === 'object' &&
        Reflect.get(cached, 'cacheVersion') === 1
      ) {
        this.state.restore(parseCoreCache(cached));
        this.state.publishSync({ phase: 'connecting', message: undefined });
        legacyCacheRestored = true;
      }
      const installationId = await this.transport.installationId();
      envelope = this.localStore.prime(
        cached,
        installationId,
      );
    } catch (error) {
      if (
        !(error instanceof ZodError) &&
        !(error instanceof CoreLocalOwnershipError)
      ) {
        throw error;
      }
      this.state.publishSync({
        phase: 'upgrade-required',
        message: 'Cache aplikasi tidak kompatibel.',
      });
      return;
    }
    this.state.publishSync({
      trustedV2Bootstrap: envelope.trustedV2Bootstrap === true,
    });
    this.applyOfflineProjection(envelope, !legacyCacheRestored);
    await this.polling.initialize(true);
  };
  dispose = (): void => {
    this.polling.dispose();
    this.images.dispose();
  };
  flushNota = async (id: string): Promise<void> => {
    if (this.hasLocalNota(id)) return;
    this.requireNetworkAllowed();
    if (this.isOffline()) return this.offlineBlocked();
    await this.deferred.pump(true);
    await this.refreshOfflineProjection();
    await this.requireNotaDeferredReady(id);
    await this.mutations.flushNota(id);
  };
  retryPending = async (): Promise<void> => {
    const phase = this.state.getSyncSnapshot().phase;
    this.requireNetworkAllowed();
    if (phase === 'revoked') {
      await this.polling.retryPending();
      return;
    }
    await this.mutations.retryPending();
    if (
      this.state.getSyncSnapshot().phase === 'online' ||
      this.state.getSyncSnapshot().phase === 'conflict'
    ) {
      await this.deferred.pump(true);
      await this.refreshOfflineProjection();
    }
  };
  retryBlockedOperation = async (id: string): Promise<void> => {
    this.requireNetworkAllowed();
    if (this.isOffline()) return this.offlineBlocked();
    if (!(await this.deferred.retryBlocked(id))) return;
    await this.deferred.pump(true);
    await this.refreshOfflineProjection();
  };
  discardBlockedOperation = async (id: string): Promise<void> => {
    this.requireNetworkAllowed();
    if (!(await this.deferred.discardBlocked(id))) return;
    await this.refreshOfflineProjection();
  };
  resolveConflict = (
    id: string,
    choice: 'mine' | 'server',
  ): Promise<void> => {
    this.requireNetworkAllowed();
    if (
      this.state.getOutbox().some(
        (item) => item.conflict?.id === id,
      )
    ) {
      if (this.isOffline()) return this.offlineBlocked();
      return this.mutations.resolveConflict(id, choice);
    }
    return this.resolveDeferredConflict(id, choice);
  };

  private async resolveDeferredConflict(
    id: string,
    choice: 'mine' | 'server',
  ): Promise<void> {
    const resolvedOffline = await this.deferred.resolveConflict(id, choice);
    if (resolvedOffline) {
      if (this.isOffline()) {
        await this.refreshOfflineProjection();
        return;
      }
      await this.deferred.pump(true);
      await this.refreshOfflineProjection();
      if (
        this.state.getSyncSnapshot().phase === 'conflict' &&
        this.state.getSyncSnapshot().conflictCount === 0
      ) {
        this.state.publishSync({ phase: 'online', message: undefined });
      }
      return;
    }
    if (this.isOffline()) return this.offlineBlocked();
    return this.mutations.resolveConflict(id, choice);
  }
  createSku = (input: CreateSkuInput): Promise<Sku> =>
    this.isOffline()
      ? this.offlineBlocked()
      : this.mutations.createSku(input);
  updateSku = async (id: string, patch: Partial<Sku>): Promise<void> => {
    let contextError: unknown;
    try {
      this.state.requireSkuWriteContext(id, patch);
    } catch (error) {
      contextError = error;
    }
    if (this.state.getSyncSnapshot().phase === 'offline') {
      return this.offlineBlocked(contextError);
    }
    if (contextError) throw contextError;
    if (this.isOffline()) return this.offlineBlocked();
    const upload = parseImageDataUrl(patch.imageUrl);
    if (!upload) {
      await this.mutations.updateSku(id, patch);
      return;
    }
    const path = CORE_API_PATHS.skuImage(id);
    const body = asOfflineJson({
      ...this.state.requireSkuWriteContext(id, {
        imageHash: null,
        sourceImageUrl: null,
      }),
      mimeType: upload.mimeType,
      bytesBase64: upload.bytesBase64,
    });
    await this.runSchemaGuard('sku-image', async () => {
      const response = await this.transport.request({
        method: 'POST',
        path,
        idempotencyKey: crypto.randomUUID(),
        body,
      });
      this.throwForApiError(response.status, response.body);
      const acknowledgement = parseCoreMutationAcknowledgement(response.body);
      const hasAuthoritativeEntity = this.state.recordMutationAcknowledgement(
        path,
        acknowledgement,
        body,
      );
      if (!hasAuthoritativeEntity) {
        throw new Error('Respons gambar CH Core tidak valid.');
      }
      await this.envelopes.persistCurrent();
      this.state.refreshCanonicalProjection();
      const updated = this.state.getSnapshot().skus.find((sku) => sku.id === id);
      if (!updated?.imageHash) {
        throw new Error('Hash gambar CH Core tidak tersedia.');
      }
      await this.images.seed(updated.imageHash, upload.blob);
      await this.polling.refreshNow();
    });
  };
  adjustStock = async (
    id: string,
    quantity: number,
    reason?: string,
  ): Promise<void> => {
    if (!this.isOffline()) {
      await this.mutations.adjustStock(id, quantity);
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity === 0) {
      throw new Error('Delta stok offline harus bilangan bulat aman dan tidak nol.');
    }
    const boundedReason = reason?.trim() ?? '';
    if (!boundedReason) {
      throw new Error('Alasan perubahan stok offline wajib diisi.');
    }
    if (boundedReason.length > 512) {
      throw new Error('Alasan perubahan stok offline maksimal 512 karakter.');
    }
    const sku = this.state.getSnapshot().skus.find(
      (candidate) => candidate.id === id,
    );
    if (!sku) throw new Error('SKU tidak ditemukan di snapshot lokal.');
    await this.deferred.deferStock({
      skuId: sku.id,
      skuIdentifier: sku.skuNumber,
      skuName: sku.name,
      referencePrice: sku.referencePrice,
      delta: quantity,
      reason: boundedReason,
    });
    await this.refreshOfflineProjection();
  };
  checkStock = async (
    id: string,
    countedQuantityPcs: number,
    note?: string,
  ): Promise<void> => {
    if (!Number.isSafeInteger(countedQuantityPcs)) {
      throw new Error('Jumlah cek stok harus berupa bilangan bulat aman.');
    }
    const boundedNote = note?.trim() ?? '';
    if (boundedNote.length > 512) {
      throw new Error('Catatan cek stok maksimal 512 karakter.');
    }
    const countedAt = this.clock.now().toISOString();
    if (!this.isOffline()) {
      const context = this.state.requireStockCheckContext(id);
      await this.mutations.checkStock(id, {
        ...context,
        countedQuantityPcs,
        countedAt,
        ...(boundedNote ? { note: boundedNote } : {}),
      });
      return;
    }
    const sku = this.state.getSnapshot().skus.find(
      (candidate) => candidate.id === id,
    );
    if (!sku || sku.archived || !sku.tracked) {
      throw new Error('SKU aktif dengan saldo stok tidak ditemukan.');
    }
    const baseBalanceVersion = this.state.getBalanceVersion(id);
    await this.deferred.deferStockCount({
      skuId: id,
      observedQuantityPcs: sku.stock,
      countedQuantityPcs,
      ...(baseBalanceVersion ? { baseBalanceVersion } : {}),
      countedAt,
      ...(boundedNote ? { note: boundedNote } : {}),
    });
    await this.refreshOfflineProjection();
  };
  registerPackageBarcode = async (
    id: string,
    rawIdentifierValue: string,
  ): Promise<void> => {
    if (this.isOffline()) return this.offlineBlocked();
    const identifierValue = rawIdentifierValue.trim();
    if (!identifierValue || identifierValue.length > 512) {
      throw new Error('Barcode kemasan wajib diisi dan maksimal 512 karakter.');
    }
    await this.mutations.registerPackageBarcode(id, identifierValue);
  };
  removePackageBarcode = async (identifierId: string): Promise<void> => {
    if (this.isOffline()) return this.offlineBlocked();
    await this.mutations.removePackageBarcode(identifierId);
  };
  reassignPackageBarcode = async (
    identifierId: string,
    skuId: string,
  ): Promise<void> => {
    if (this.isOffline()) return this.offlineBlocked();
    await this.mutations.reassignPackageBarcode(identifierId, skuId);
  };
  setArchived = (id: string, archived: boolean): Promise<void> =>
    this.isOffline()
      ? this.offlineBlocked()
      : this.mutations.setArchived(id, archived);
  replaceFromWorkbook = (
    _result: WorkbookImportResult,
    _sourceLabel: string,
  ): Promise<void> =>
    Promise.reject(
      new Error('Gunakan validasi dan komit import bertahap di CH Core.'),
    );

  async validateInitialCatalogue(input: {
    fileName: string;
    workbookBase64: string;
  }): Promise<CatalogueValidationResult> {
    if (this.isOffline()) return this.offlineBlocked();
    return this.runSchemaGuard('catalogue-validation', async () => {
      const response = await this.transport.request({
        method: 'POST',
        path: CORE_API_PATHS.validateCatalogue,
        body: input,
      });
      this.throwForApiError(response.status, response.body);
      return parseCatalogueValidation(response.body);
    });
  }

  async commitInitialCatalogue(
    importId: string,
  ): Promise<CatalogueCommitReceipt> {
    if (this.isOffline()) return this.offlineBlocked();
    return this.runSchemaGuard('catalogue-commit', async () => {
      const response = await this.transport.request({
        method: 'POST',
        path: CORE_API_PATHS.commitCatalogue(importId),
      });
      this.throwForApiError(response.status, response.body);
      const receipt = parseCatalogueCommit(response.body);
      await this.polling.reloadCanonical();
      return receipt;
    });
  }

  async loadSkuImage(sku: Sku): Promise<string> {
    const fallback = safeRemoteImageUrl(sku.sourceImageUrl);
    if (!sku.imageHash) return sku.imageUrl || fallback;
    try {
      if (this.images.isEnabled()) {
        return imageBlobToDataUrl(await this.images.load(
          sku.imageHash,
          () => this.requireNetworkAllowed(),
        ));
      }
      this.requireNetworkAllowed();
      return await this.runSchemaGuard('catalogue-image', async () => {
        const response = await this.transport.request({
          method: 'GET',
          path: CORE_API_PATHS.image(sku.imageHash!),
        });
        this.throwForApiError(response.status, response.body);
        const image = parseCatalogueImage(response.body);
        return `data:${image.mimeType};base64,${image.bytesBase64}`;
      });
    } catch (error) {
      if (
        fallback &&
        typeof error === 'object' &&
        error !== null &&
        'kind' in error &&
        error.kind === 'source'
      ) return fallback;
      throw error;
    }
  }

  pauseImagePrefetch = (): void => this.images.pause();
  retryImagePrefetch = (): void => this.images.retry();

  private throwForApiError(status: number, body: unknown): void {
    if (status >= 200 && status < 300) return;
    const error = parseCoreApiError(status, body);
    if (error.code === 'UPGRADE_REQUIRED') {
      throw new CoreApiUpgradeRequiredError();
    }
    throw new Error(error.code);
  }

  private async runSchemaGuard<T>(
    source: CoreSchemaIncompatibilitySource,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (this.schemaIncompatibility.handle(error, source)) {
        throw new CoreGatewayNetworkBlockedError();
      }
      throw error;
    }
  }

  async reset(): Promise<void> {
    throw new Error('Reset data demo tidak tersedia di CH Core.');
  }

  setLabelTemplate = (template: LabelTemplate): Promise<void> =>
    this.isOffline()
      ? this.offlineTemplateBlocked('label')
      : this.mutations.setLabelTemplate(template);
  setInvoiceTemplate = (template: InvoiceTemplate): Promise<void> =>
    this.isOffline()
      ? this.offlineTemplateBlocked('invoice')
      : this.mutations.setInvoiceTemplate(template);
  createNotaTransaction = async (): Promise<NotaTransaction> => {
    if (!this.isOffline()) return this.mutations.createNotaTransaction();
    const transaction = createOfflineNota(this.clock.now());
    await this.deferred.deferNota(transaction);
    await this.refreshOfflineProjection();
    return transaction;
  };
  addNotaPage = async (
    transactionId: string,
  ): Promise<Nota | undefined> => {
    if (!this.hasLocalNota(transactionId)) {
      if (this.isOffline()) {
        this.requireNotaUnconflicted(transactionId);
        const transaction = this.requireEditableSyncedNota(transactionId);
        const context = this.state.requireNotaStructureContext(transactionId);
        const page = createOfflinePage(transaction.nextNoteIndex);
        await this.deferred.deferNotaMutation({
          notaId: transactionId,
          targetKey: `nota:${transactionId}:page-add:${page.id}`,
          method: 'POST',
          path: CORE_API_PATHS.notaPages(transactionId),
          body: asOfflineJson({
            ...context,
            clientPageId: page.id,
            clientLineIds: page.lines.map((line) => line.id),
          }),
          dependsOn: [],
          optimistic: { kind: 'nota-page-add', notaId: transactionId, page },
        });
        await this.refreshOfflineProjection();
        return page;
      }
      this.requireNotaUnconflicted(transactionId);
      return this.mutations.addNotaPage(transactionId);
    }
    const transaction = await this.requireLocalNota(transactionId);
    this.requireEditableLocalNota(transaction);
    const page = createOfflinePage(transaction.nextNoteIndex);
    await this.persistLocalNota({
      ...transaction,
      nextNoteIndex: transaction.nextNoteIndex + 1,
      pages: [...transaction.pages, page],
    });
    return page;
  };
  cancelNotaPage = async (
    transactionId: string,
    pageId: string,
  ): Promise<void> => {
    if (!this.hasLocalNota(transactionId)) {
      if (this.isOffline()) {
        this.requireNotaUnconflicted(transactionId);
        const transaction = this.requireEditableSyncedNota(transactionId);
        if (transaction.pages.filter((page) => page.status === 'active').length < 2) {
          throw new Error('Nota harus memiliki setidaknya satu halaman aktif.');
        }
        const context = this.state.requireNotaPageLifecycleContext(
          transactionId,
          pageId,
        );
        await this.deferred.deferNotaMutation({
          notaId: transactionId,
          targetKey: `nota:${transactionId}:page:${pageId}:cancel`,
          method: 'POST',
          path: `${CORE_API_PATHS.notaPage(transactionId, pageId)}/cancel`,
          body: asOfflineJson(context),
          dependsOn: await this.pageDependencies(transactionId, pageId),
          optimistic: {
            kind: 'nota-page-status',
            notaId: transactionId,
            pageId,
            status: 'cancelled',
          },
        });
        await this.refreshOfflineProjection();
        return;
      }
      this.requireNotaUnconflicted(transactionId);
      await this.mutations.cancelNotaPage(transactionId, pageId);
      return;
    }
    await this.updateLocalNota(transactionId, (transaction) => {
      this.requireEditableLocalNota(transaction);
      if (transaction.pages.filter((page) => page.status === 'active').length < 2) {
        throw new Error('Nota harus memiliki setidaknya satu halaman aktif.');
      }
      return {
        ...transaction,
        pages: transaction.pages.map((page) =>
          page.id === pageId ? { ...page, status: 'cancelled' } : page,
        ),
      };
    });
  };
  restoreNotaPage = async (
    transactionId: string,
    pageId: string,
  ): Promise<void> => {
    if (!this.hasLocalNota(transactionId)) {
      if (this.isOffline()) {
        this.requireNotaUnconflicted(transactionId);
        this.requireEditableSyncedNota(transactionId);
        const context = this.state.requireNotaPageLifecycleContext(
          transactionId,
          pageId,
        );
        await this.deferred.deferNotaMutation({
          notaId: transactionId,
          targetKey: `nota:${transactionId}:page:${pageId}:restore`,
          method: 'POST',
          path: `${CORE_API_PATHS.notaPage(transactionId, pageId)}/restore`,
          body: asOfflineJson(context),
          dependsOn: await this.pageDependencies(transactionId, pageId),
          optimistic: {
            kind: 'nota-page-status',
            notaId: transactionId,
            pageId,
            status: 'active',
          },
        });
        await this.refreshOfflineProjection();
        return;
      }
      this.requireNotaUnconflicted(transactionId);
      await this.mutations.restoreNotaPage(transactionId, pageId);
      return;
    }
    await this.updateLocalNota(transactionId, (transaction) => {
      this.requireEditableLocalNota(transaction);
      return {
        ...transaction,
        pages: transaction.pages.map((page) =>
          page.id === pageId ? { ...page, status: 'active' } : page,
        ),
      };
    });
  };
  updateNotaTransaction = async (
    id: string,
    patch: Parameters<OperationsGateway['updateNotaTransaction']>[1],
  ): Promise<void> => {
    if (!this.hasLocalNota(id)) {
      if (this.isOffline()) {
        this.requireNotaUnconflicted(id);
        this.requireEditableSyncedNota(id);
        for (const field of Object.keys(patch) as Array<keyof typeof patch>) {
          const mine = patch[field];
          if (mine === undefined) continue;
          const fieldPatch = { [field]: mine } as typeof patch;
          const context = this.state.requireNotaHeaderWriteContext(
            id,
            fieldPatch,
          );
          await this.deferred.deferNotaMutation({
            notaId: id,
            targetKey: `nota:${id}:header:${field}`,
            method: 'PATCH',
            path: CORE_API_PATHS.notaHeader(id),
            body: asOfflineJson(context),
            dependsOn: [],
            optimistic: {
              kind: 'nota-header',
              notaId: id,
              patch: fieldPatch,
            },
          });
        }
        await this.refreshOfflineProjection();
        return;
      }
      this.requireNotaUnconflicted(id);
      await this.mutations.updateNotaTransaction(id, patch);
      return;
    }
    await this.updateLocalNota(id, (transaction) => {
      this.requireEditableLocalNota(transaction);
      return { ...transaction, ...patch };
    });
  };
  updateNotaLine = async (
    transactionId: string,
    pageId: string,
    lineId: string,
    patch: Partial<NotaLine>,
  ): Promise<void> => {
    if (!this.hasLocalNota(transactionId)) {
      if (this.isOffline()) {
        this.requireNotaUnconflicted(transactionId);
        this.requireEditableSyncedNota(transactionId);
        const context = this.state.requireNotaLineWriteContext(
          transactionId,
          pageId,
          lineId,
          patch,
        );
        await this.deferred.deferNotaMutation({
          notaId: transactionId,
          targetKey: `nota:${transactionId}:line:${lineId}`,
          method: 'PATCH',
          path: CORE_API_PATHS.notaLine(transactionId, pageId, lineId),
          body: asOfflineJson(context),
          dependsOn: await this.pageDependencies(transactionId, pageId),
          optimistic: {
            kind: 'nota-line',
            notaId: transactionId,
            pageId,
            lineId,
            patch,
          },
        });
        await this.refreshOfflineProjection();
        return;
      }
      this.requireNotaUnconflicted(transactionId);
      await this.mutations.updateNotaLine(
        transactionId,
        pageId,
        lineId,
        patch,
      );
      return;
    }
    await this.updateLocalNota(transactionId, (transaction) => {
      this.requireEditableLocalNota(transaction);
      return {
        ...transaction,
        pages: transaction.pages.map((page) =>
          page.id === pageId
            ? {
                ...page,
                lines: page.lines.map((line) =>
                  line.id === lineId ? { ...line, ...patch } : line,
                ),
              }
            : page,
        ),
      };
    });
  };
  deleteNotaLine = async (
    transactionId: string,
    pageId: string,
    lineId: string,
  ): Promise<void> => {
    if (!this.hasLocalNota(transactionId)) {
      if (this.isOffline()) {
        this.requireNotaUnconflicted(transactionId);
        this.requireEditableSyncedNota(transactionId);
        const context = this.state.requireNotaDeleteContext(
          transactionId,
          pageId,
          lineId,
        );
        await this.deferred.deferNotaMutation({
          notaId: transactionId,
          targetKey: `nota:${transactionId}:line:${lineId}`,
          method: 'DELETE',
          path: CORE_API_PATHS.notaLine(transactionId, pageId, lineId),
          body: asOfflineJson(context),
          dependsOn: await this.pageDependencies(transactionId, pageId),
          optimistic: {
            kind: 'nota-line',
            notaId: transactionId,
            pageId,
            lineId,
            patch: { ...emptyOfflineLine(lineId), skuId: undefined },
          },
        });
        await this.refreshOfflineProjection();
        return;
      }
      this.requireNotaUnconflicted(transactionId);
      await this.mutations.deleteNotaLine(transactionId, pageId, lineId);
      return;
    }
    await this.updateLocalNota(transactionId, (transaction) => {
      this.requireEditableLocalNota(transaction);
      return {
        ...transaction,
        pages: transaction.pages.map((page) =>
          page.id === pageId
            ? {
                ...page,
                lines: page.lines.map((line) =>
                  line.id === lineId
                    ? emptyOfflineLine(line.id)
                    : line,
                ),
              }
            : page,
        ),
      };
    });
  };
  completeNotaTransaction = async (
    id: string,
    destination: NotaCompletionDestination = 'archive',
  ): Promise<void> => {
    if (!this.hasLocalNota(id)) {
      await this.flushNota(id);
      await this.mutations.completeNotaTransaction(id, destination);
      return;
    }
    await this.updateLocalNota(
      id,
      (transaction) => completeOfflineNota(transaction, destination, this.clock.now()),
      destination,
    );
    this.state.publishSync({
      message:
        'Menunggu sinkronisasi — stok dan omzet pusat belum berubah.',
    });
  };
  reopenNotaTransaction = async (id: string): Promise<void> => {
    if (this.hasLocalNota(id)) return this.rejectLocalNotaLifecycle(id);
    await this.flushNota(id);
    await this.mutations.reopenNotaTransaction(id);
  };
  cancelNotaTransaction = async (id: string): Promise<void> => {
    if (this.hasLocalNota(id)) return this.rejectLocalNotaLifecycle(id);
    await this.flushNota(id);
    await this.mutations.cancelNotaTransaction(id);
  };
  restoreNotaTransaction = async (id: string): Promise<void> => {
    if (this.hasLocalNota(id)) return this.rejectLocalNotaLifecycle(id);
    await this.flushNota(id);
    await this.mutations.restoreNotaTransaction(id);
  };

  private isOffline(): boolean {
    const phase = this.state.getSyncSnapshot().phase;
    if (phase === 'revoked') {
      throw new Error(
        'Akses perangkat dicabut. Minta pemilik menyetujui perangkat ini kembali.',
      );
    }
    this.requireNetworkAllowed();
    if (phase === 'offline') return true;
    if (phase === 'online' || phase === 'syncing' || phase === 'conflict') {
      return false;
    }
    throw new Error('Status sinkronisasi belum mengizinkan perubahan.');
  }

  private requireNetworkAllowed(): void {
    const sync = this.state.getSyncSnapshot();
    if (sync.phase === 'upgrade-required') {
      throw new CoreGatewayNetworkBlockedError();
    }
    if (!sync.trustedV2Bootstrap) {
      throw new Error(
        'Data CH Core belum siap. Hubungkan kembali untuk memuat data yang terverifikasi.',
      );
    }
  }

  private offlineBlocked<T>(detail?: unknown): Promise<T> {
    const suffix =
      detail instanceof Error ? ` ${detail.message}` : '';
    return Promise.reject(
      new Error(
        `Mode offline: data bersama hanya dapat dibaca. Sinkronkan kembali untuk mengubahnya.${suffix}`,
      ),
    );
  }

  private offlineTemplateBlocked<T>(
    kind: 'label' | 'invoice',
  ): Promise<T> {
    try {
      this.state.getTemplateWriteContext(kind);
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      return Promise.reject(
        new Error(
          `Mode offline: data bersama hanya dapat dibaca. Sinkronkan kembali untuk mengubahnya.${detail}`,
        ),
      );
    }
    return this.offlineBlocked();
  }

  private async refreshOfflineProjection(): Promise<void> {
    const envelope = await this.localStore.load();
    this.applyOfflineProjection(envelope);
  }

  private applyOfflineProjection(
    envelope: CoreLocalEnvelope,
    restoreOutbox = false,
  ): void {
    this.state.replaceCachedBalanceVersions(envelope.balanceVersions);
    this.state.replaceCachedNotaVersions(envelope.notaVersions);
    this.provisionalNotaIds = new Set(
      envelope.provisionalNotas.map((nota) => nota.id),
    );
    if (restoreOutbox) {
      this.state.restore({
        cacheVersion: 1,
        state: envelope.state,
        serverRevision: envelope.serverRevision,
        outbox: envelope.outbox,
        notaVersions: envelope.notaVersions,
      });
    } else {
      const canonicalChanged =
        this.state.getServerRevision() !== envelope.serverRevision ||
        JSON.stringify(this.state.getCanonicalState()) !==
          JSON.stringify(envelope.state);
      if (canonicalChanged) {
        this.state.commitCanonical(
          envelope.state,
          envelope.serverRevision,
        );
      }
    }
    this.state.setOfflineProjection(
      envelope.provisionalNotas,
      envelope.deferredOutbox,
      envelope.deferredOutbox.length + envelope.quarantinedOutbox.length,
      envelope.deferredOutbox.filter(
        (command) => command.status === 'quarantined',
      ).length + envelope.quarantinedOutbox.length,
      envelope.offlineConflicts.map((item) => item.conflict),
      envelope.deferredOutbox.flatMap((command) =>
        command.status === 'blocked'
          ? [{
              id: command.operationId,
              kind:
                command.kind === 'offline-nota' ||
                command.kind === 'nota-mutation'
                  ? 'Nota' as const
                  : 'Stok' as const,
              errorCode: command.lastError ?? 'HTTP_ERROR',
            }]
          : [],
      ),
    );
    const phase = this.state.getSyncSnapshot().phase;
    if (
      envelope.offlineConflicts.length > 0 &&
      (phase === 'online' || phase === 'syncing' || phase === 'conflict')
    ) {
      this.state.publishSync({
        phase: 'conflict',
        message: 'Perubahan offline memerlukan penyelesaian konflik.',
      });
    } else if (envelope.deferredOutbox.some((command) => command.status === 'blocked')) {
      const count = envelope.deferredOutbox.filter(
        (command) => command.status === 'blocked',
      ).length;
      this.state.publishSync({
        message: `${count} perubahan ditolak CH Core. Coba lagi atau buang perubahan setelah diperiksa.`,
      });
    } else if (this.state.getSyncSnapshot().message?.includes('perubahan ditolak CH Core')) {
      this.state.publishSync({ message: undefined });
    }
  }

  private async localNota(id: string): Promise<NotaTransaction | undefined> {
    return (await this.localStore.load()).provisionalNotas.find(
      (nota) => nota.id === id,
    );
  }

  private hasLocalNota(id: string): boolean {
    return this.provisionalNotaIds.has(id);
  }

  private async requireLocalNota(id: string): Promise<NotaTransaction> {
    const transaction = await this.localNota(id);
    if (!transaction) return this.offlineBlocked();
    return transaction;
  }

  private requireEditableLocalNota(transaction: NotaTransaction): void {
    if (transaction.status !== 'draft') {
      throw new Error('Nota offline yang selesai tidak dapat diubah.');
    }
  }

  private requireEditableSyncedNota(id: string): NotaTransaction {
    const transaction = this.state
      .getSnapshot()
      .notaTransactions.find((nota) => nota.id === id);
    if (!transaction) {
      throw new Error('Nota tidak ditemukan di snapshot lokal.');
    }
    if (!['draft', 'reopened'].includes(transaction.status)) {
      throw new Error('Nota offline yang selesai tidak dapat diubah.');
    }
    if (!this.state.hasNotaVersionKnowledge(id)) {
      throw new Error(
        'Mode offline: data bersama hanya dapat dibaca. Versi Nota belum tersedia. Sinkronkan ulang lalu coba lagi.',
      );
    }
    return transaction;
  }

  private async pageDependencies(
    notaId: string,
    pageId: string,
  ): Promise<string[]> {
    const envelope = await this.localStore.load();
    return envelope.deferredOutbox.flatMap((command) =>
      command.kind === 'nota-mutation' &&
      command.payload.notaId === notaId &&
      command.payload.optimistic.kind === 'nota-page-add' &&
      command.payload.optimistic.page.id === pageId
        ? [command.operationId]
        : [],
    );
  }

  private requireNotaUnconflicted(notaId: string): void {
    const normalConflict = this.state.getOutbox().some(
      (item) => item.notaId === notaId && item.conflict,
    );
    const conflicted = this.state.hasDeferredNotaConflict(notaId);
    if (normalConflict || conflicted) {
      throw new Error(
        'Nota memiliki konflik. Pilih Versi saya atau Versi server sebelum melanjutkan.',
      );
    }
  }

  private async requireNotaDeferredReady(notaId: string): Promise<void> {
    this.requireNotaUnconflicted(notaId);
    const envelope = await this.localStore.load();
    const pending = envelope.deferredOutbox.some(
      (command) =>
        command.kind === 'nota-mutation' &&
        command.payload.notaId === notaId,
    );
    if (pending) {
      throw new Error(
        'Perubahan Nota belum tersinkronisasi. Coba lagi setelah koneksi stabil.',
      );
    }
  }

  private async rejectLocalNotaLifecycle(id: string): Promise<void> {
    const envelope = await this.localStore.load();
    const command = envelope.deferredOutbox.find(
      (candidate) =>
        candidate.kind === 'offline-nota' &&
        candidate.payload.provisionalId === id,
    );
    if (command?.firstSentAt) {
      throw new Error('Sedang sinkronisasi. Tunggu konfirmasi CH Core.');
    }
    return this.offlineBlocked();
  }

  private async updateLocalNota(
    id: string,
    update: (transaction: NotaTransaction) => NotaTransaction,
    destination: NotaCompletionDestination = 'archive',
  ): Promise<void> {
    const transaction = await this.requireLocalNota(id);
    await this.persistLocalNota(update(transaction), destination);
  }

  private async persistLocalNota(
    transaction: NotaTransaction,
    destination: NotaCompletionDestination = 'archive',
  ): Promise<void> {
    this.requireNetworkAllowed();
    const skus = this.state.getSnapshot().skus;
    const skuSnapshots = [
      ...new Set(
        transaction.pages.flatMap((page) =>
          page.lines.flatMap((line) => (line.skuId ? [line.skuId] : [])),
        ),
      ),
    ].flatMap((skuId) => {
      const sku = skus.find((candidate) => candidate.id === skuId);
      return sku
        ? [
            {
              skuId,
              identifier: sku.skuNumber,
              name: sku.name,
              referencePrice: sku.referencePrice,
            },
          ]
        : [];
    });
    await this.deferred.deferNota(
      transaction,
      destination,
      skuSnapshots,
    );
    await this.refreshOfflineProjection();
  }

  private async onAuthenticatedOnline(
    authoritativeBootstrap: boolean,
  ): Promise<void> {
    const envelope = await this.localStore.update((current) => ({
      ...current,
      balanceVersions: this.state.getBalanceVersions(),
      notaVersions: this.state.getNotaVersions(),
    }));
    if (envelope.quarantine.active) {
      const resumed = await this.deferred.resumeAfterReapproval(
        await this.transport.installationId(),
      );
      if (!resumed) {
        this.applyDeviceRole();
        this.polling.authenticationRevoked();
        this.state.publishSync({
          phase: 'revoked',
          message:
            'Antrean dikarantina untuk instalasi perangkat yang berbeda.',
        });
        return;
      }
      const restored = await this.localStore.load();
      this.applyOfflineProjection(restored, true);
      if (restored.outbox.length > 0) {
        await this.mutations.retryPending();
      }
    }
    await this.deferred.pump(true);
    await this.refreshOfflineProjection();
    void this.images.refresh(authoritativeBootstrap, true);
  }

  private async markTrustedBootstrap(): Promise<void> {
    await this.localStore.update((current) =>
      current.trustedV2Bootstrap
        ? current
        : { ...current, trustedV2Bootstrap: true },
    );
    this.state.publishSync({ trustedV2Bootstrap: true });
  }

  private async onAuthenticationRevoked(): Promise<void> {
    this.applyDeviceRole();
    await this.deferred.quarantineRevoked();
  }

  private async onPersistedAuthenticationRevoked(): Promise<void> {
    this.applyDeviceRole();
    this.polling.authenticationRevoked();
    this.state.publishSync({
      phase: 'revoked',
      message: 'Akses perangkat dicabut. Antrean lokal dikarantina.',
    });
    this.applyOfflineProjection(await this.localStore.load(), true);
  }

  private applyDeviceRole(role?: 'owner' | 'client'): void {
    const owner = role === 'owner';
    this.capabilities.canStageInitialCatalogue = owner;
    this.capabilities.canManagePackageBarcodes = owner;
  }
}

function createOfflineNota(now: Date): NotaTransaction {
  const id = crypto.randomUUID();
  const transactionDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return {
    id,
    baseNumber: `OFFLINE-${id.slice(0, 8).toUpperCase()}`,
    customerName: '',
    customerPlace: '',
    transactionDate,
    payment: 'unclassified',
    status: 'draft',
    nextNoteIndex: 1,
    pages: [createOfflinePage(0)],
    postedLines: [],
    postedStockEffects: {},
    postedTrackedLineIds: {},
  };
}

function createOfflinePage(index: number): Nota {
  return {
    id: crypto.randomUUID(),
    suffix: noteSuffixFromIndex(index),
    status: 'active',
    lines: Array.from({ length: 15 }, () =>
      emptyOfflineLine(crypto.randomUUID()),
    ),
  };
}

function emptyOfflineLine(id: string): NotaLine {
  return {
    id,
    description: '',
    kind: '',
    quantity: 0,
    unit: 'pcs',
    pcsPrice: 0,
    lsnPrice: 0,
  };
}

function completeOfflineNota(
  transaction: NotaTransaction,
  destination: NotaCompletionDestination,
  now: Date,
): NotaTransaction {
  if (transaction.status !== 'draft') {
    throw new Error('Nota offline tidak dapat diselesaikan lagi.');
  }
  const populated = transaction.pages
    .filter((page) => page.status === 'active')
    .flatMap((page) => page.lines)
    .filter(
      (line) =>
        Boolean(line.skuId) ||
        Boolean(line.description.trim()) ||
        line.quantity !== 0 ||
        line.pcsPrice !== 0 ||
        line.lsnPrice !== 0,
    );
  if (populated.length === 0) {
    throw new Error('Nota harus memiliki setidaknya satu baris.');
  }
  for (const line of populated) {
    if (!line.description.trim()) throw new Error('Nama barang wajib diisi.');
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new Error('Jumlah harus bilangan bulat positif.');
    }
    if (
      !Number.isSafeInteger(line.pcsPrice) ||
      line.pcsPrice < 0 ||
      !Number.isSafeInteger(line.lsnPrice) ||
      line.lsnPrice < 0
    ) {
      throw new Error('Harga harus bilangan bulat nol atau lebih.');
    }
  }
  return {
    ...transaction,
    status: 'completed',
    completionDestination: destination,
    completedAt: now.toISOString(),
    // Central posting state is intentionally unchanged until acknowledgement.
    postedLines: [],
    postedStockEffects: {},
    postedTrackedLineIds: {},
  };
}

function acknowledgeOfflineCommand(
  envelope: CoreLocalEnvelope,
  command: CoreDeferredCommand,
  response: { body: unknown },
): CoreLocalEnvelope {
  const acknowledgement = parseCoreMutationAcknowledgement(response.body);
  const entity = acknowledgement.entity;
  if (command.kind === 'offline-nota') {
    const parsed = notaTransactionSchema.parse(entity);
    return {
      ...envelope,
      state: {
        ...envelope.state,
        notaTransactions: [
          ...envelope.state.notaTransactions.filter(
            (nota) =>
              nota.id !== command.payload.provisionalId &&
              nota.id !== parsed.id,
          ),
          parsed,
        ],
      },
      provisionalNotas: envelope.provisionalNotas.filter(
        (nota) => nota.id !== command.payload.provisionalId,
      ),
    };
  }
  if (command.kind === 'stock-count') {
    const parsed = coreStockCheckRowSchema.parse(entity);
    if (parsed.skuId !== command.payload.skuId) {
      throw new Error('Respons cek stok offline CH Core tidak cocok.');
    }
    const stockCheck = mapCoreStockCheckRow(parsed);
    if (!envelope.state.skus.some((sku) => sku.id === stockCheck.skuId)) {
      throw new Error('SKU hasil cek stok tidak ditemukan.');
    }
    const cachedBalanceVersion = envelope.balanceVersions[stockCheck.skuId];
    const acknowledgementIsStale =
      acknowledgement.entityVersion !== undefined &&
      cachedBalanceVersion !== undefined &&
      BigInt(acknowledgement.entityVersion) < BigInt(cachedBalanceVersion);
    return {
      ...envelope,
      balanceVersions:
        acknowledgement.entityVersion && !acknowledgementIsStale
          ? {
              ...envelope.balanceVersions,
              [stockCheck.skuId]: acknowledgement.entityVersion,
            }
          : envelope.balanceVersions,
      state: {
        ...envelope.state,
        skus: acknowledgementIsStale
          ? envelope.state.skus
          : envelope.state.skus.map((sku) =>
              sku.id === stockCheck.skuId
                ? {
                    ...sku,
                    stock: stockCheck.countedQuantityPcs,
                    lastStockCheckedAt: stockCheck.countedAt,
                  }
                : sku,
            ),
        stockChecks: [
          ...envelope.state.stockChecks.filter(
            (candidate) => candidate.id !== stockCheck.id,
          ),
          stockCheck,
        ],
      },
    };
  }
  if (command.kind === 'nota-mutation') {
    const parsed = notaTransactionSchema.safeParse(entity);
    const nextState = parsed.success
      ? {
          ...envelope.state,
          notaTransactions: envelope.state.notaTransactions.some(
            (nota) => nota.id === parsed.data.id,
          )
            ? envelope.state.notaTransactions.map((nota) =>
                nota.id === parsed.data.id ? parsed.data : nota,
              )
            : [...envelope.state.notaTransactions, parsed.data],
        }
      : applyCoreOptimisticChange(
          envelope.state,
          command.payload.optimistic,
        );
    const versionState = acknowledgement.versionState;
    const acknowledged: CoreLocalEnvelope = {
      ...envelope,
      state: nextState,
      notaVersions:
        versionState && versionState.notaId === command.payload.notaId
          ? {
              ...envelope.notaVersions,
              [versionState.notaId]: {
                fieldVersions: { ...versionState.fieldVersions },
                structureVersion: versionState.structureVersion,
                lifecycleVersion: versionState.lifecycleVersion,
                pageVersions: { ...versionState.pageVersions },
                pageLifecycleVersions: {
                  ...versionState.pageLifecycleVersions,
                },
                lineVersions: { ...versionState.lineVersions },
              },
            }
          : envelope.notaVersions,
    };
    return {
      ...acknowledged,
      deferredOutbox: acknowledged.deferredOutbox.map((candidate) =>
        candidate.kind === 'nota-mutation' &&
        candidate.payload.notaId === command.payload.notaId &&
        candidate.sequence > command.sequence &&
        !candidate.firstSentAt
          ? rebaseOfflineNotaMutation(candidate, acknowledged)
          : candidate,
      ),
    };
  }
  const balance = coreBalanceRowSchema.parse(entity);
  if (balance.skuId !== command.payload.skuId) {
    throw new Error('Respons stok offline CH Core tidak valid.');
  }
  const quantity = integerFromDecimal(balance.quantityPcs, 'quantityPcs');
  if (!Number.isSafeInteger(quantity)) {
    throw new Error('Respons saldo stok offline CH Core tidak valid.');
  }
  const current = envelope.state.skus.find(
    (sku) => sku.id === command.payload.skuId,
  );
  if (!current) {
    throw new Error('SKU hasil sinkronisasi stok tidak ditemukan.');
  }
  return {
    ...envelope,
    balanceVersions: acknowledgement.entityVersion
      ? {
          ...envelope.balanceVersions,
          [command.payload.skuId]: acknowledgement.entityVersion,
        }
      : envelope.balanceVersions,
    state: {
      ...envelope.state,
      skus: envelope.state.skus.map((sku) =>
        sku.id === current.id ? { ...sku, stock: quantity } : sku,
      ),
    },
  };
}

function rebaseOfflineNotaMutation(
  command: Extract<CoreDeferredCommand, { kind: 'nota-mutation' }>,
  envelope: CoreLocalEnvelope,
): Extract<CoreDeferredCommand, { kind: 'nota-mutation' }> {
  const version = envelope.notaVersions[command.payload.notaId];
  const nota = envelope.state.notaTransactions.find(
    (candidate) => candidate.id === command.payload.notaId,
  );
  if (!version || !nota) return command;
  const optimistic = command.payload.optimistic;
  if (optimistic.kind === 'nota-header') {
    const field = Object.keys(optimistic.patch)[0] as keyof NotaTransaction;
    const fieldVersion = version.fieldVersions[String(field)];
    if (!fieldVersion) return command;
    return {
      ...command,
      payload: {
        ...command.payload,
        body: asOfflineJson({
          lifecycleVersion: version.lifecycleVersion,
          fields: {
            [field]: {
              version: fieldVersion,
              base: nota[field],
              mine: optimistic.patch[field],
            },
          },
        }),
      },
    };
  }
  if (optimistic.kind === 'nota-line') {
    const page = nota.pages.find((candidate) => candidate.id === optimistic.pageId);
    const line = page?.lines.find((candidate) => candidate.id === optimistic.lineId);
    const pageVersion = version.pageVersions[optimistic.pageId];
    const lineVersion = version.lineVersions[optimistic.lineId];
    if (!page || !line || !pageVersion || !lineVersion) return command;
    const position = page.lines.indexOf(line);
    return {
      ...command,
      payload: {
        ...command.payload,
        body: asOfflineJson({
          lifecycleVersion: version.lifecycleVersion,
          pageVersion,
          lineVersion,
          base: offlineNotaLineMaterial(line, position),
          mine: offlineNotaLineMaterial(
            { ...line, ...optimistic.patch },
            position,
          ),
        }),
      },
    };
  }
  if (optimistic.kind === 'nota-page-status') {
    const pageVersion =
      version.pageLifecycleVersions[optimistic.pageId];
    if (!pageVersion) return command;
    return {
      ...command,
      payload: {
        ...command.payload,
        body: asOfflineJson({
          lifecycleVersion: version.lifecycleVersion,
          structureVersion: version.structureVersion,
          pageVersion,
        }),
      },
    };
  }
  if (optimistic.kind !== 'nota-page-add') return command;
  return {
    ...command,
    payload: {
      ...command.payload,
      body: asOfflineJson({
        lifecycleVersion: version.lifecycleVersion,
        structureVersion: version.structureVersion,
        clientPageId: optimistic.page.id,
        clientLineIds: optimistic.page.lines.map((line) => line.id),
      }),
    },
  };
}

function offlineNotaLineMaterial(
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

export function createCoreOperationsGateway(
  transport: CoreApiTransport,
  storage: CoreGatewayStorage,
  clock: CoreGatewayClock,
  diagnosticSink?: CorePollingDiagnosticSink,
): CoreOperationsGateway {
  return new CoreOperationsGatewayImpl(
    transport,
    storage,
    clock,
    diagnosticSink,
  );
}
