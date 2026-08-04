import { z } from 'zod';

import type {
  InvoiceTemplate,
  LabelTemplate,
  Nota,
  NotaCompletionDestination,
  NotaLine,
  NotaTransaction,
  Sku,
} from '../domain/types';
import { CORE_API_PATHS } from './core-api-types';
import {
  notaPageSchema,
  notaTransactionSchema,
  skuSchema,
} from './core-domain-schemas';
import {
  CoreMutationQueue,
  type CoreMutationSpec,
} from './core-mutation-queue';
import { CoreGatewayState } from './core-gateway-state';
import type {
  CreateSkuInput,
  OperationsGateway,
} from './operations-gateway-contract';

function entityOrThrow<T>(
  schema: z.ZodType<T>,
  entity: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(entity);
  if (!parsed.success) {
    throw new Error(`Respons ${label} CH Core tidak valid.`);
  }
  return parsed.data;
}

export class CoreMutationCoordinator {
  constructor(
    private readonly queue: CoreMutationQueue,
    private readonly state: CoreGatewayState,
  ) {}

  flushNota(id: string): Promise<void> {
    return this.queue.flushNota(id);
  }

  retryPending(): Promise<void> {
    return this.queue.retryPending();
  }

  resolveConflict(id: string, choice: 'mine' | 'server'): Promise<void> {
    return this.queue.resolveConflict(id, choice);
  }

  async createSku(input: CreateSkuInput): Promise<Sku> {
    const result = await this.command({
      method: 'POST',
      path: CORE_API_PATHS.skus,
      body: input,
    });
    return entityOrThrow(skuSchema, result.entity, 'SKU');
  }

  async updateSku(id: string, patch: Partial<Sku>): Promise<void> {
    const context = this.state.requireSkuWriteContext(id, patch);
    await this.command({
      method: 'PATCH',
      path: CORE_API_PATHS.sku(id),
      body: { ...context, patch },
    });
  }

  adjustStock(id: string, quantity: number): Promise<void> {
    return this.command({
      method: 'POST',
      path: CORE_API_PATHS.stockAdjustments(id),
      body: { delta: quantity },
    }).then(() => undefined);
  }

  checkStock(
    id: string,
    input: {
      observedQuantityPcs: number;
      countedQuantityPcs: number;
      baseBalanceVersion: string;
      countedAt: string;
      note?: string;
    },
  ): Promise<void> {
    return this.command({
      method: 'POST',
      path: CORE_API_PATHS.stockChecks(id),
      body: input,
    }).then(() => undefined);
  }

  registerPackageBarcode(
    id: string,
    identifierValue: string,
  ): Promise<void> {
    return this.command({
      method: 'POST',
      path: CORE_API_PATHS.packageBarcodes(id),
      body: { identifierValue },
    }).then(() => undefined);
  }

  removePackageBarcode(identifierId: string): Promise<void> {
    return this.command({
      method: 'DELETE',
      path: CORE_API_PATHS.packageBarcode(identifierId),
    }).then(() => undefined);
  }

  reassignPackageBarcode(
    identifierId: string,
    skuId: string,
  ): Promise<void> {
    return this.command({
      method: 'PATCH',
      path: CORE_API_PATHS.packageBarcode(identifierId),
      body: { skuId },
    }).then(() => undefined);
  }

  setArchived(id: string, archived: boolean): Promise<void> {
    return this.updateSku(id, { archived });
  }

  async setLabelTemplate(template: LabelTemplate): Promise<void> {
    const context = this.state.getTemplateWriteContext('label');
    await this.command({
      method: 'PATCH',
      path: CORE_API_PATHS.template('label'),
      body: {
        ...context,
        definition: template,
      },
      coalesceKey: 'template:label',
      optimistic: { kind: 'label-template', template },
    });
  }

  async setInvoiceTemplate(template: InvoiceTemplate): Promise<void> {
    const context = this.state.getTemplateWriteContext('invoice');
    await this.command({
      method: 'PATCH',
      path: CORE_API_PATHS.template('invoice'),
      body: {
        ...context,
        definition: template,
      },
      coalesceKey: 'template:invoice',
      optimistic: { kind: 'invoice-template', template },
    });
  }

  async createNotaTransaction(): Promise<NotaTransaction> {
    const result = await this.command({
      method: 'POST',
      path: CORE_API_PATHS.notas,
      body: {},
    });
    return entityOrThrow(notaTransactionSchema, result.entity, 'Nota');
  }

  async addNotaPage(transactionId: string): Promise<Nota | undefined> {
    await this.flushNota(transactionId);
    const context = this.state.requireNotaStructureContext(transactionId);
    const result = await this.command({
      method: 'POST',
      path: CORE_API_PATHS.notaPages(transactionId),
      body: context,
      notaId: transactionId,
    });
    return entityOrThrow(notaPageSchema, result.entity, 'halaman Nota');
  }

  async cancelNotaPage(transactionId: string, pageId: string): Promise<void> {
    await this.flushNota(transactionId);
    const context = this.state.requireNotaPageLifecycleContext(
      transactionId,
      pageId,
    );
    await this.command({
      method: 'POST',
      path: `${CORE_API_PATHS.notaPage(transactionId, pageId)}/cancel`,
      body: context,
      notaId: transactionId,
    });
  }

  async restoreNotaPage(transactionId: string, pageId: string): Promise<void> {
    await this.flushNota(transactionId);
    const context = this.state.requireNotaPageLifecycleContext(
      transactionId,
      pageId,
    );
    await this.command({
      method: 'POST',
      path: `${CORE_API_PATHS.notaPage(transactionId, pageId)}/restore`,
      body: context,
      notaId: transactionId,
    });
  }

  updateNotaTransaction(
    id: string,
    patch: Parameters<OperationsGateway['updateNotaTransaction']>[1],
  ): Promise<void> {
    const context = this.state.requireNotaHeaderWriteContext(id, patch);
    return this.command({
      method: 'PATCH',
      path: CORE_API_PATHS.notaHeader(id),
      body: context,
      notaId: id,
      coalesceKey: `nota:${id}:header`,
      optimistic: { kind: 'nota-header', notaId: id, patch },
    }).then(() => undefined);
  }

  updateNotaLine(
    transactionId: string,
    pageId: string,
    lineId: string,
    patch: Partial<NotaLine>,
  ): Promise<void> {
    const context = this.state.requireNotaLineWriteContext(
      transactionId,
      pageId,
      lineId,
      patch,
    );
    return this.command({
      method: 'PATCH',
      path: CORE_API_PATHS.notaLine(transactionId, pageId, lineId),
      body: context,
      notaId: transactionId,
      coalesceKey: `nota:${transactionId}:line:${lineId}`,
      optimistic: {
        kind: 'nota-line',
        notaId: transactionId,
        pageId,
        lineId,
        patch,
      },
    }).then(() => undefined);
  }

  async deleteNotaLine(
    transactionId: string,
    pageId: string,
    lineId: string,
  ): Promise<void> {
    await this.flushNota(transactionId);
    const context = this.state.requireNotaDeleteContext(
      transactionId,
      pageId,
      lineId,
    );
    await this.command({
      method: 'DELETE',
      path: CORE_API_PATHS.notaLine(transactionId, pageId, lineId),
      body: context,
      notaId: transactionId,
      optimistic: {
        kind: 'nota-line',
        notaId: transactionId,
        pageId,
        lineId,
        patch: {
          skuId: undefined,
          description: '',
          kind: '',
          quantity: 0,
          unit: 'pcs',
          pcsPrice: 0,
          lsnPrice: 0,
        },
      },
    });
  }

  completeNotaTransaction(
    id: string,
    destination: NotaCompletionDestination = 'archive',
  ): Promise<void> {
    return this.afterFlush(id, CORE_API_PATHS.notaComplete(id), {
      ...this.state.requireNotaLifecycleContext(id),
      destination,
    });
  }

  reopenNotaTransaction(id: string): Promise<void> {
    return this.afterFlush(
      id,
      CORE_API_PATHS.notaReopen(id),
      this.state.requireNotaLifecycleContext(id),
    );
  }

  cancelNotaTransaction(id: string): Promise<void> {
    return this.afterFlush(
      id,
      CORE_API_PATHS.notaCancel(id),
      this.state.requireNotaLifecycleContext(id),
    );
  }

  restoreNotaTransaction(id: string): Promise<void> {
    return this.afterFlush(
      id,
      CORE_API_PATHS.notaRestore(id),
      this.state.requireNotaLifecycleContext(id),
    );
  }

  private async afterFlush(
    id: string,
    path: string,
    body: unknown = {},
  ): Promise<void> {
    await this.flushNota(id);
    await this.command({ method: 'POST', path, body, notaId: id });
  }

  private command(spec: CoreMutationSpec) {
    return this.queue.enqueue(spec);
  }
}
