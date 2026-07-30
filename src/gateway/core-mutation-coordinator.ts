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
  NotaDesktopTransferResult,
  OperationsGateway,
} from './operations-gateway-contract';

const transferResultSchema = z
  .object({ sent: z.boolean(), reason: z.string().optional() })
  .strict();

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

  updateSkuImage(id: string, imageHash: string): Promise<void> {
    return this.updateSku(id, {
      imageHash,
      sourceImageUrl: null,
    });
  }

  adjustStock(id: string, quantity: number): Promise<void> {
    return this.command({
      method: 'POST',
      path: CORE_API_PATHS.stockAdjustments(id),
      body: { delta: quantity },
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
    const result = await this.command({
      method: 'POST',
      path: CORE_API_PATHS.notaPages(transactionId),
      body: {},
      notaId: transactionId,
    });
    return entityOrThrow(notaPageSchema, result.entity, 'halaman Nota');
  }

  async cancelNotaPage(transactionId: string, pageId: string): Promise<void> {
    await this.flushNota(transactionId);
    await this.command({
      method: 'POST',
      path: `${CORE_API_PATHS.notaPage(transactionId, pageId)}/cancel`,
      body: {},
      notaId: transactionId,
    });
  }

  async restoreNotaPage(transactionId: string, pageId: string): Promise<void> {
    await this.flushNota(transactionId);
    await this.command({
      method: 'POST',
      path: `${CORE_API_PATHS.notaPage(transactionId, pageId)}/restore`,
      body: {},
      notaId: transactionId,
    });
  }

  updateNotaTransaction(
    id: string,
    patch: Parameters<OperationsGateway['updateNotaTransaction']>[1],
  ): Promise<void> {
    return this.command({
      method: 'PATCH',
      path: CORE_API_PATHS.notaHeader(id),
      body: { patch },
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
    return this.command({
      method: 'PATCH',
      path: CORE_API_PATHS.notaLine(transactionId, pageId, lineId),
      body: { patch },
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
    await this.command({
      method: 'DELETE',
      path: CORE_API_PATHS.notaLine(transactionId, pageId, lineId),
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
    return this.afterFlush(id, CORE_API_PATHS.notaComplete(id), { destination });
  }

  async transferNotaToDesktop(id: string): Promise<NotaDesktopTransferResult> {
    await this.flushNota(id);
    const result = await this.command({
      method: 'POST',
      path: CORE_API_PATHS.notaTransfer(id),
      body: {},
      notaId: id,
    });
    return entityOrThrow(transferResultSchema, result.entity, 'transfer Nota');
  }

  reopenNotaTransaction(id: string): Promise<void> {
    return this.afterFlush(id, CORE_API_PATHS.notaReopen(id));
  }

  cancelNotaTransaction(id: string): Promise<void> {
    return this.afterFlush(id, CORE_API_PATHS.notaCancel(id));
  }

  restoreNotaTransaction(id: string): Promise<void> {
    return this.afterFlush(id, CORE_API_PATHS.notaRestore(id));
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
