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
import type { CoreApiTransport } from './core-api-transport';
import {
  type CoreGatewayClock,
  type CoreGatewayStorage,
} from './core-cache';
import { CoreEnvelopeCoordinator } from './core-envelope-coordinator';
import { CoreGatewayState } from './core-gateway-state';
import { CoreMutationCoordinator } from './core-mutation-coordinator';
import { CoreMutationQueue } from './core-mutation-queue';
import { CorePollingCoordinator } from './core-polling';
import type {
  CatalogueCommitReceipt,
  CatalogueValidationResult,
  CreateSkuInput,
  NotaDesktopTransferResult,
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

class CoreOperationsGatewayImpl implements CoreOperationsGateway {
  readonly capabilities: OperationsGatewayCapabilities = {
    canResetDemoData: false,
    canImportInitialCatalogue: false,
    canStageInitialCatalogue: false,
  };

  private readonly state = new CoreGatewayState();
  private readonly polling: CorePollingCoordinator;
  private readonly mutations: CoreMutationCoordinator;

  constructor(
    private readonly transport: CoreApiTransport,
    storage: CoreGatewayStorage,
    clock: CoreGatewayClock,
  ) {
    const envelopes = new CoreEnvelopeCoordinator(storage, this.state);
    this.polling = new CorePollingCoordinator(
      transport,
      storage,
      clock,
      this.state,
      envelopes,
      (role) => {
        this.capabilities.canStageInitialCatalogue = role === 'owner';
      },
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
  subscribeSync = (listener: () => void): (() => void) =>
    this.state.subscribeSync(listener);
  initialize = (): Promise<void> => this.polling.initialize();
  dispose = (): void => this.polling.dispose();
  flushNota = (id: string): Promise<void> => this.mutations.flushNota(id);
  retryPending = (): Promise<void> => this.mutations.retryPending();
  resolveConflict = (
    id: string,
    choice: 'mine' | 'server',
  ): Promise<void> => this.mutations.resolveConflict(id, choice);
  createSku = (input: CreateSkuInput): Promise<Sku> =>
    this.mutations.createSku(input);
  updateSku = (id: string, patch: Partial<Sku>): Promise<void> =>
    this.mutations.updateSku(id, patch);
  adjustStock = (id: string, quantity: number): Promise<void> =>
    this.mutations.adjustStock(id, quantity);
  setArchived = (id: string, archived: boolean): Promise<void> =>
    this.mutations.setArchived(id, archived);
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
    this.mutations.setLabelTemplate(template);
  setInvoiceTemplate = (template: InvoiceTemplate): Promise<void> =>
    this.mutations.setInvoiceTemplate(template);
  createNotaTransaction = (): Promise<NotaTransaction> =>
    this.mutations.createNotaTransaction();
  addNotaPage = (transactionId: string): Promise<Nota | undefined> =>
    this.mutations.addNotaPage(transactionId);
  cancelNotaPage = (
    transactionId: string,
    pageId: string,
  ): Promise<void> => this.mutations.cancelNotaPage(transactionId, pageId);
  restoreNotaPage = (
    transactionId: string,
    pageId: string,
  ): Promise<void> => this.mutations.restoreNotaPage(transactionId, pageId);
  updateNotaTransaction = (
    id: string,
    patch: Parameters<OperationsGateway['updateNotaTransaction']>[1],
  ): Promise<void> => this.mutations.updateNotaTransaction(id, patch);
  updateNotaLine = (
    transactionId: string,
    pageId: string,
    lineId: string,
    patch: Partial<NotaLine>,
  ): Promise<void> =>
    this.mutations.updateNotaLine(transactionId, pageId, lineId, patch);
  deleteNotaLine = (
    transactionId: string,
    pageId: string,
    lineId: string,
  ): Promise<void> =>
    this.mutations.deleteNotaLine(transactionId, pageId, lineId);
  completeNotaTransaction = (
    id: string,
    destination: NotaCompletionDestination = 'archive',
  ): Promise<void> => this.mutations.completeNotaTransaction(id, destination);
  transferNotaToDesktop = (
    id: string,
  ): Promise<NotaDesktopTransferResult> =>
    this.mutations.transferNotaToDesktop(id);
  reopenNotaTransaction = (id: string): Promise<void> =>
    this.mutations.reopenNotaTransaction(id);
  cancelNotaTransaction = (id: string): Promise<void> =>
    this.mutations.cancelNotaTransaction(id);
  restoreNotaTransaction = (id: string): Promise<void> =>
    this.mutations.restoreNotaTransaction(id);
}

export function createCoreOperationsGateway(
  transport: CoreApiTransport,
  storage: CoreGatewayStorage,
  clock: CoreGatewayClock,
): CoreOperationsGateway {
  return new CoreOperationsGatewayImpl(transport, storage, clock);
}
