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
import { CoreGatewayState } from './core-gateway-state';
import { CoreMutationCoordinator } from './core-mutation-coordinator';
import { CoreMutationQueue } from './core-mutation-queue';
import { CorePollingCoordinator } from './core-polling';
import type {
  CreateSkuInput,
  NotaDesktopTransferResult,
  OperationsGateway,
  OperationsGatewayCapabilities,
  SyncSnapshot,
} from './operations-gateway-contract';

export type {
  CoreCacheEnvelope,
  CoreGatewayClock,
  CoreGatewayStorage,
  CoreOptimisticChange,
  CoreOutboxItem,
} from './core-cache';
export { CORE_CACHE_VERSION } from './core-cache';
export { mapCoreBootstrapToDemoState } from './core-bootstrap-mapping';

class CoreOperationsGateway implements OperationsGateway {
  readonly capabilities: OperationsGatewayCapabilities = {
    canResetDemoData: false,
    canImportInitialCatalogue: true,
  };

  private readonly state = new CoreGatewayState();
  private readonly polling: CorePollingCoordinator;
  private readonly mutations: CoreMutationCoordinator;

  constructor(
    transport: CoreApiTransport,
    storage: CoreGatewayStorage,
    clock: CoreGatewayClock,
  ) {
    this.polling = new CorePollingCoordinator(
      transport,
      storage,
      clock,
      this.state,
    );
    this.mutations = new CoreMutationCoordinator(
      new CoreMutationQueue(
        transport,
        storage,
        this.state,
        () => this.polling.refreshNow(),
        () => clock.now(),
      ),
    );
  }

  getSnapshot = (): DemoState => this.state.getSnapshot();
  subscribe = (listener: () => void): (() => void) =>
    this.state.subscribe(listener);
  getSyncSnapshot = (): SyncSnapshot => this.state.getSyncSnapshot();
  subscribeSync = (listener: () => void): (() => void) =>
    this.state.subscribeSync(listener);
  initialize = (): Promise<void> => this.polling.initialize();
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
    result: WorkbookImportResult,
    sourceLabel: string,
  ): Promise<void> => this.mutations.replaceFromWorkbook(result, sourceLabel);

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
): OperationsGateway {
  return new CoreOperationsGateway(transport, storage, clock);
}
