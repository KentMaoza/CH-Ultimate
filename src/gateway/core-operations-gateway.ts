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
  type CoreGatewayClock,
  type CoreGatewayStorage,
} from './core-cache';
import { CoreEnvelopeCoordinator } from './core-envelope-coordinator';
import { CoreGatewayState } from './core-gateway-state';
import { CoreMutationCoordinator } from './core-mutation-coordinator';
import { CoreMutationQueue } from './core-mutation-queue';
import { CoreDeferredOutbox } from './core-outbox';
import {
  CoreLocalStore,
  type CoreDeferredCommand,
  type CoreLocalEnvelope,
} from './core-local-store';
import { CorePollingCoordinator } from './core-polling';
import type {
  CatalogueCommitReceipt,
  CatalogueValidationResult,
  CreateSkuInput,
  OperationsGateway,
  OperationsGatewayCapabilities,
  SyncSnapshot,
} from './operations-gateway-contract';
import {
  CORE_API_PATHS,
  parseCatalogueCommit,
  parseCatalogueImage,
  parseCatalogueValidation,
  parseCoreApiError,
} from './core-api-types';
import { notaTransactionSchema } from './core-domain-schemas';

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

function parseImageDataUrl(
  value: string | undefined,
): { mimeType: string; bytesBase64: string } | null {
  if (!value?.startsWith('data:')) return null;
  const match =
    /^data:(image\/(?:png|jpeg|gif|webp));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(
      value,
    );
  if (!match?.[1] || !match[2] || match[2].length > 7_000_000) {
    throw new Error('Data gambar tidak valid atau terlalu besar.');
  }
  return { mimeType: match[1], bytesBase64: match[2] };
}

class CoreOperationsGatewayImpl implements CoreOperationsGateway {
  readonly capabilities: OperationsGatewayCapabilities = {
    canResetDemoData: false,
    canImportInitialCatalogue: false,
    canStageInitialCatalogue: false,
  };

  private readonly state = new CoreGatewayState();
  private readonly polling: CorePollingCoordinator;
  private readonly mutations: CoreMutationCoordinator;
  private readonly localStore: CoreLocalStore;
  private readonly deferred: CoreDeferredOutbox;
  private readonly clock: CoreGatewayClock;

  constructor(
    private readonly transport: CoreApiTransport,
    private readonly storage: CoreGatewayStorage,
    clock: CoreGatewayClock,
  ) {
    this.clock = clock;
    this.localStore = new CoreLocalStore(storage);
    this.deferred = new CoreDeferredOutbox(
      this.localStore,
      transport,
      {
        now: () => clock.now(),
        acknowledge: acknowledgeOfflineCommand,
        onRevoked: () => {
          this.state.publishSync({
            phase: 'revoked',
            message: 'Akses perangkat dicabut. Antrean offline dikarantina.',
          });
        },
      },
    );
    const canonicalStorage = this.localStore.canonicalStorage();
    const envelopes = new CoreEnvelopeCoordinator(
      canonicalStorage,
      this.state,
    );
    this.polling = new CorePollingCoordinator(
      transport,
      canonicalStorage,
      clock,
      this.state,
      envelopes,
      (role) => {
        this.capabilities.canStageInitialCatalogue = role === 'owner';
      },
      () => this.onAuthenticatedOnline(),
      () => this.onAuthenticationRevoked(),
    );
    this.mutations = new CoreMutationCoordinator(
      new CoreMutationQueue(
        transport,
        envelopes,
        this.state,
        () => this.polling.refreshNow(),
        () => clock.now(),
      ),
      this.state,
    );
  }

  getSnapshot = (): DemoState => this.state.getSnapshot();
  subscribe = (listener: () => void): (() => void) =>
    this.state.subscribe(listener);
  getSyncSnapshot = (): SyncSnapshot => this.state.getSyncSnapshot();
  getConflicts = () => this.state.getConflicts();
  subscribeSync = (listener: () => void): (() => void) =>
    this.state.subscribeSync(listener);
  initialize = async (): Promise<void> => {
    let envelope: CoreLocalEnvelope;
    try {
      envelope = this.localStore.prime(await this.storage.load());
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      this.state.publishSync({
        phase: 'upgrade-required',
        message: 'Cache aplikasi tidak kompatibel.',
      });
      return;
    }
    this.applyOfflineProjection(envelope, true);
    await this.polling.initialize(true);
  };
  dispose = (): void => this.polling.dispose();
  flushNota = async (id: string): Promise<void> => {
    if (this.isOffline() && (await this.localNota(id))) return;
    await this.mutations.flushNota(id);
  };
  retryPending = async (): Promise<void> => {
    await this.mutations.retryPending();
    if (this.state.getSyncSnapshot().phase === 'online') {
      await this.deferred.pump(true);
      await this.refreshOfflineProjection();
    }
  };
  resolveConflict = (
    id: string,
    choice: 'mine' | 'server',
  ): Promise<void> => {
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
      if (choice === 'mine') {
        if (this.isOffline()) {
          await this.refreshOfflineProjection();
          return;
        }
        await this.deferred.pump(true);
      }
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
    await this.mutations.replaceSkuImage(id, upload);
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
    const response = await this.transport.request({
      method: 'POST',
      path: CORE_API_PATHS.validateCatalogue,
      body: input,
    });
    this.throwForApiError(response.status, response.body);
    return parseCatalogueValidation(response.body);
  }

  async commitInitialCatalogue(
    importId: string,
  ): Promise<CatalogueCommitReceipt> {
    if (this.isOffline()) return this.offlineBlocked();
    const response = await this.transport.request({
      method: 'POST',
      path: CORE_API_PATHS.commitCatalogue(importId),
    });
    this.throwForApiError(response.status, response.body);
    const receipt = parseCatalogueCommit(response.body);
    await this.polling.reloadCanonical();
    return receipt;
  }

  async loadSkuImage(sku: Sku): Promise<string> {
    if (!sku.imageHash) return sku.imageUrl;
    const response = await this.transport.request({
      method: 'GET',
      path: CORE_API_PATHS.image(sku.imageHash),
    });
    this.throwForApiError(response.status, response.body);
    const image = parseCatalogueImage(response.body);
    return `data:${image.mimeType};base64,${image.bytesBase64}`;
  }

  private throwForApiError(status: number, body: unknown): void {
    if (status >= 200 && status < 300) return;
    const error = parseCoreApiError(status, body);
    throw new Error(error.code);
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
    if (!this.isOffline()) return this.mutations.addNotaPage(transactionId);
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
  cancelNotaPage = (
    transactionId: string,
    pageId: string,
  ): Promise<void> => {
    if (!this.isOffline()) {
      return this.mutations.cancelNotaPage(transactionId, pageId);
    }
    return this.updateLocalNota(transactionId, (transaction) => {
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
  restoreNotaPage = (
    transactionId: string,
    pageId: string,
  ): Promise<void> => {
    if (!this.isOffline()) {
      return this.mutations.restoreNotaPage(transactionId, pageId);
    }
    return this.updateLocalNota(transactionId, (transaction) => ({
      ...transaction,
      pages: transaction.pages.map((page) =>
        page.id === pageId ? { ...page, status: 'active' } : page,
      ),
    }));
  };
  updateNotaTransaction = (
    id: string,
    patch: Parameters<OperationsGateway['updateNotaTransaction']>[1],
  ): Promise<void> => {
    if (!this.isOffline()) {
      return this.mutations.updateNotaTransaction(id, patch);
    }
    return this.updateLocalNota(id, (transaction) => {
      this.requireEditableLocalNota(transaction);
      return { ...transaction, ...patch };
    });
  };
  updateNotaLine = (
    transactionId: string,
    pageId: string,
    lineId: string,
    patch: Partial<NotaLine>,
  ): Promise<void> => {
    if (!this.isOffline()) {
      return this.mutations.updateNotaLine(
        transactionId,
        pageId,
        lineId,
        patch,
      );
    }
    return this.updateLocalNota(transactionId, (transaction) => {
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
  deleteNotaLine = (
    transactionId: string,
    pageId: string,
    lineId: string,
  ): Promise<void> => {
    if (!this.isOffline()) {
      return this.mutations.deleteNotaLine(transactionId, pageId, lineId);
    }
    return this.updateLocalNota(transactionId, (transaction) => {
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
  completeNotaTransaction = (
    id: string,
    destination: NotaCompletionDestination = 'archive',
  ): Promise<void> => {
    if (!this.isOffline()) {
      return this.mutations.completeNotaTransaction(id, destination);
    }
    return this.updateLocalNota(
      id,
      (transaction) => completeOfflineNota(transaction, destination, this.clock.now()),
      destination,
    ).then(() => {
      this.state.publishSync({
        message:
          'Menunggu sinkronisasi — stok dan omzet pusat belum berubah.',
      });
    });
  };
  reopenNotaTransaction = (id: string): Promise<void> =>
    this.isOffline()
      ? this.offlineBlocked()
      : this.mutations.reopenNotaTransaction(id);
  cancelNotaTransaction = (id: string): Promise<void> =>
    this.isOffline()
      ? this.offlineBlocked()
      : this.mutations.cancelNotaTransaction(id);
  restoreNotaTransaction = (id: string): Promise<void> =>
    this.isOffline()
      ? this.offlineBlocked()
      : this.mutations.restoreNotaTransaction(id);

  private isOffline(): boolean {
    const phase = this.state.getSyncSnapshot().phase;
    if (phase === 'offline') return true;
    if (phase === 'online' || phase === 'syncing' || phase === 'conflict') {
      return false;
    }
    if (phase === 'revoked') {
      throw new Error(
        'Akses perangkat dicabut. Minta pemilik menyetujui perangkat ini kembali.',
      );
    }
    throw new Error('Status sinkronisasi belum mengizinkan perubahan.');
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
    if (restoreOutbox) {
      this.state.restore({
        cacheVersion: 1,
        state: envelope.state,
        serverRevision: envelope.serverRevision,
        outbox: envelope.outbox,
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
      envelope.deferredOutbox.length,
      envelope.deferredOutbox.filter(
        (command) => command.status === 'quarantined',
      ).length,
      envelope.offlineConflicts.map((item) => item.conflict),
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
    }
  }

  private async localNota(id: string): Promise<NotaTransaction | undefined> {
    return (await this.localStore.load()).provisionalNotas.find(
      (nota) => nota.id === id,
    );
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

  private async onAuthenticatedOnline(): Promise<void> {
    const envelope = await this.localStore.load();
    if (envelope.quarantine.active) {
      await this.deferred.resumeAfterReapproval();
    }
    await this.deferred.pump(true);
    await this.refreshOfflineProjection();
  }

  private async onAuthenticationRevoked(): Promise<void> {
    await this.deferred.quarantineRevoked();
    await this.refreshOfflineProjection();
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
  const body =
    response.body &&
    typeof response.body === 'object' &&
    !Array.isArray(response.body)
      ? response.body
      : {};
  const entity = Reflect.get(body, 'entity');
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
  if (
    !entity ||
    typeof entity !== 'object' ||
    Array.isArray(entity) ||
    Reflect.get(entity, 'skuId') !== command.payload.skuId
  ) {
    throw new Error('Respons stok offline CH Core tidak valid.');
  }
  const quantity = Number(Reflect.get(entity, 'quantityPcs'));
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
    state: {
      ...envelope.state,
      skus: envelope.state.skus.map((sku) =>
        sku.id === current.id ? { ...sku, stock: quantity } : sku,
      ),
      adjustments: [
        ...envelope.state.adjustments,
        {
          id: command.operationId,
          skuId: current.id,
          quantity: command.payload.delta,
          before: current.stock,
          after: quantity,
          createdAt: command.createdAt,
          source: 'manual',
        },
      ],
    },
  };
}

export function createCoreOperationsGateway(
  transport: CoreApiTransport,
  storage: CoreGatewayStorage,
  clock: CoreGatewayClock,
): CoreOperationsGateway {
  return new CoreOperationsGatewayImpl(transport, storage, clock);
}
