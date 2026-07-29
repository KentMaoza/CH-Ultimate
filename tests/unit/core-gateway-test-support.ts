import type {
  CoreApiRequest,
  CoreApiResponse,
  CoreApiTransport,
} from '../../src/gateway/core-api-transport';
import type {
  CoreCacheEnvelope,
  CoreGatewayClock,
  CoreGatewayStorage,
} from '../../src/gateway/core-operations-gateway';

export const SKU_ID = '11111111-1111-4111-8111-111111111111';
export const IDENTIFIER_ID = '22222222-2222-4222-8222-222222222222';
export const NOTA_ID = '33333333-3333-4333-8333-333333333333';
export const PAGE_ID = '44444444-4444-4444-8444-444444444444';
export const LINE_ID = '55555555-5555-4555-8555-555555555555';
export const DEVICE_ID = '66666666-6666-4666-8666-666666666666';
export const TEMPLATE_ID = '77777777-7777-4777-8777-777777777777';

interface TestBootstrapBody {
  serverRevision: string;
  skuIdentifiers: Array<Record<string, unknown>>;
  skus: Array<Record<string, unknown>>;
  balances: Array<Record<string, unknown>>;
  notas: Array<Record<string, unknown>>;
  notaPages: Array<Record<string, unknown>>;
  notaLines: Array<Record<string, unknown>>;
  templates: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export function bootstrapBody(
  serverRevision = '1',
  overrides: Partial<TestBootstrapBody> = {},
): TestBootstrapBody {
  return {
    serverRevision,
    skuIdentifiers: [],
    skus: [],
    balances: [],
    notas: [],
    notaPages: [],
    notaLines: [],
    templates: [],
    ...overrides,
  };
}

export function populatedBootstrap(
  serverRevision = '1',
  overrides: Partial<TestBootstrapBody> = {},
): TestBootstrapBody {
  return bootstrapBody(serverRevision, {
    skuIdentifiers: [
      {
        id: IDENTIFIER_ID,
        skuId: SKU_ID,
        identifierValue: 'SCAN-001',
        identifierKind: 'product-code',
        createdAt: '2026-07-29T00:00:00.000Z',
      },
    ],
    skus: [
      {
        id: SKU_ID,
        primaryIdentifier: 'SKU-001',
        name: 'Produk Core',
        priceRupiah: '25000',
        rowVersion: '1',
        archivedAt: null,
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ],
    balances: [
      {
        skuId: SKU_ID,
        quantityPcs: '12',
        rowVersion: '1',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ],
    notas: [
      {
        id: NOTA_ID,
        notaNumber: 'CHU-20260729-0001',
        businessDate: '2026-07-29',
        status: 'draft',
        header: {
          customerName: 'Amelia',
          customerPlace: 'Saibah',
          payment: 'cash',
        },
        fieldVersions: {
          customerName: '1',
          customerPlace: '1',
          payment: '1',
        },
        structureVersion: '1',
        lifecycleVersion: '1',
        subtotalRupiah: '25000',
        totalRupiah: '25000',
        createdByDeviceId: DEVICE_ID,
        completedAt: null,
        cancelledAt: null,
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ],
    notaPages: [
      {
        id: PAGE_ID,
        notaId: NOTA_ID,
        pagePosition: 0,
        rowVersion: '1',
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ],
    notaLines: [
      {
        id: LINE_ID,
        notaId: NOTA_ID,
        pageId: PAGE_ID,
        skuId: SKU_ID,
        linePosition: 0,
        skuIdentifierSnapshot: 'SKU-001',
        skuNameSnapshot: 'Produk Core',
        quantityPcs: '1',
        unitPriceRupiah: '25000',
        lineTotalRupiah: '25000',
        rowVersion: '1',
        deletedAt: null,
        createdAt: '2026-07-29T00:00:00.000Z',
        updatedAt: '2026-07-29T00:00:00.000Z',
      },
    ],
    ...overrides,
  });
}

export class MemoryStorage implements CoreGatewayStorage {
  value: unknown;
  saves: CoreCacheEnvelope[] = [];
  failNextSave = false;

  constructor(value?: unknown) {
    this.value = value;
  }

  async load(): Promise<unknown> {
    return structuredClone(this.value);
  }

  async save(value: CoreCacheEnvelope): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('cache unavailable');
    }
    const copy = structuredClone(value);
    this.value = copy;
    this.saves.push(copy);
  }
}

interface Timer {
  callback: () => void | Promise<void>;
  delayMs: number;
  cancelled: boolean;
}

export class TestClock implements CoreGatewayClock {
  foreground = true;
  current = new Date('2026-07-29T01:00:00.000Z');
  timers: Timer[] = [];
  private resumeListeners = new Set<() => void | Promise<void>>();

  now(): Date {
    return new Date(this.current);
  }

  isForeground(): boolean {
    return this.foreground;
  }

  schedule(
    callback: () => void | Promise<void>,
    delayMs: number,
  ): () => void {
    const timer = { callback, delayMs, cancelled: false };
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  subscribeResume(listener: () => void | Promise<void>): () => void {
    this.resumeListeners.add(listener);
    return () => this.resumeListeners.delete(listener);
  }

  pendingDelays(): number[] {
    return this.timers
      .filter((timer) => !timer.cancelled)
      .map((timer) => timer.delayMs);
  }

  async runNext(): Promise<void> {
    const timer = this.timers.find((candidate) => !candidate.cancelled);
    if (!timer) throw new Error('No pending timer');
    timer.cancelled = true;
    await timer.callback();
  }

  async resume(): Promise<void> {
    this.foreground = true;
    await Promise.all([...this.resumeListeners].map((listener) => listener()));
  }
}

export class ScriptedTransport implements CoreApiTransport {
  requests: CoreApiRequest[] = [];
  handlers: Array<
    (
      request: CoreApiRequest,
    ) => CoreApiResponse | Promise<CoreApiResponse>
  > = [];

  enqueue(
    response:
      | CoreApiResponse
      | Error
      | ((
          request: CoreApiRequest,
        ) => CoreApiResponse | Promise<CoreApiResponse>),
  ): void {
    if (response instanceof Error) {
      this.handlers.push(async () => {
        throw response;
      });
      return;
    }
    this.handlers.push(
      typeof response === 'function' ? response : async () => response,
    );
  }

  async request(request: CoreApiRequest): Promise<CoreApiResponse> {
    this.requests.push(structuredClone(request));
    const handler = this.handlers.shift();
    if (!handler) throw new Error(`No response queued for ${request.path}`);
    return handler(request);
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
