import path from 'node:path';

import type {
  CoreApiRequest,
  CoreApiResponse,
} from '../gateway/core-api-transport';

export interface CoreEndpointConfig {
  endpoint: string;
  caFile: string;
}

export interface CoreMainCredentials {
  getCurrentToken(): Promise<string>;
}

export interface CoreMainSendInput {
  endpoint: string;
  ca: Buffer;
  authorization?: string;
  request: CoreApiRequest;
}

export interface CoreApiMainDependencies {
  config: unknown;
  ca: Buffer;
  credentials: CoreMainCredentials;
  send(input: CoreMainSendInput): Promise<CoreApiResponse>;
}

const INVALID_CONFIG = 'Konfigurasi CH Core tidak valid.';
const INVALID_REQUEST = 'Permintaan CH Core tidak valid.';
const UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const SHA256 = '[0-9a-f]{64}';
const APPROVED_ENDPOINT = 'https://192.168.50.14:8443';

const operationRules: ReadonlyArray<{
  methods: ReadonlyArray<CoreApiRequest['method']>;
  path: RegExp;
}> = [
  { methods: ['GET'], path: /^\/v1\/bootstrap$/ },
  {
    methods: ['GET'],
    path: /^\/v1\/changes\?after=(?:0|[1-9]\d*)&limit=500$/,
  },
  { methods: ['POST'], path: /^\/v1\/skus$/ },
  { methods: ['PATCH'], path: new RegExp(`^/v1/skus/${UUID}$`) },
  {
    methods: ['POST'],
    path: new RegExp(`^/v1/skus/${UUID}/stock-adjustments$`),
  },
  { methods: ['POST'], path: /^\/v1\/offline\/notas$/ },
  { methods: ['POST'], path: /^\/v1\/offline\/stock-adjustments$/ },
  { methods: ['POST'], path: /^\/v1\/offline\/stock-checks$/ },
  {
    methods: ['POST'],
    path: new RegExp(`^/v1/skus/${UUID}/stock-checks$`),
  },
  {
    methods: ['POST'],
    path: new RegExp(`^/v1/skus/${UUID}/package-barcodes$`),
  },
  {
    methods: ['PATCH', 'DELETE'],
    path: new RegExp(`^/v1/package-barcodes/${UUID}$`),
  },
  { methods: ['POST'], path: /^\/v1\/imports\/validate$/ },
  {
    methods: ['POST'],
    path: new RegExp(`^/v1/imports/${UUID}/commit$`),
  },
  {
    methods: ['POST'],
    path: new RegExp(`^/v1/skus/${UUID}/image$`),
  },
  { methods: ['GET'], path: new RegExp(`^/v1/images/${SHA256}$`) },
  { methods: ['PATCH'], path: /^\/v1\/templates\/(?:label|invoice)$/ },
  { methods: ['POST'], path: /^\/v1\/notas$/ },
  {
    methods: ['POST'],
    path: new RegExp(`^/v1/notas/${UUID}/pages$`),
  },
  {
    methods: ['POST'],
    path: new RegExp(
      `^/v1/notas/${UUID}/pages/${UUID}/(?:cancel|restore)$`,
    ),
  },
  {
    methods: ['PATCH'],
    path: new RegExp(`^/v1/notas/${UUID}/header$`),
  },
  {
    methods: ['PATCH', 'DELETE'],
    path: new RegExp(
      `^/v1/notas/${UUID}/pages/${UUID}/lines/${UUID}$`,
    ),
  },
  {
    methods: ['POST'],
    path: new RegExp(
      `^/v1/notas/${UUID}/(?:complete|reopen|cancel|restore)$`,
    ),
  },
  {
    methods: ['POST'],
    path: new RegExp(`^/v1/conflicts/${UUID}/resolve$`),
  },
];

export function parseCoreEndpointConfig(input: unknown): CoreEndpointConfig {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== 'caFile,endpoint'
  ) {
    throw new Error(INVALID_CONFIG);
  }
  const endpoint = Reflect.get(input, 'endpoint');
  const caFile = Reflect.get(input, 'caFile');
  if (
    typeof endpoint !== 'string' ||
    typeof caFile !== 'string' ||
    !path.isAbsolute(caFile) ||
    /[\u0000-\u001f\u007f]/.test(caFile)
  ) {
    throw new Error(INVALID_CONFIG);
  }
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== '192.168.50.14' ||
      url.port !== '8443' ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.origin !== endpoint ||
      endpoint !== APPROVED_ENDPOINT
    ) {
      throw new Error(INVALID_CONFIG);
    }
  } catch {
    throw new Error(INVALID_CONFIG);
  }
  return { endpoint, caFile };
}

export function validateCoreOperationRequest(
  request: CoreApiRequest,
): CoreApiRequest {
  const allowedKeys = new Set(['method', 'path', 'body', 'idempotencyKey']);
  if (
    typeof request !== 'object' ||
    request === null ||
    Array.isArray(request) ||
    Object.keys(request).some((key) => !allowedKeys.has(key)) ||
    !['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method) ||
    typeof request.path !== 'string' ||
    (request.idempotencyKey !== undefined &&
      (typeof request.idempotencyKey !== 'string' ||
        !new RegExp(`^${UUID}$`).test(request.idempotencyKey))) ||
    (request.method === 'GET' &&
      (request.body !== undefined || request.idempotencyKey !== undefined)) ||
    !request.path.startsWith('/v1/') ||
    request.path.startsWith('//') ||
    /[\u0000-\u001f\u007f\\#]/.test(request.path)
  ) {
    throw new Error(INVALID_REQUEST);
  }
  const pathOnly = request.path.split('?', 1)[0]!;
  try {
    const decoded = decodeURIComponent(pathOnly);
    if (decoded.includes('..') || decoded.includes('//')) {
      throw new Error(INVALID_REQUEST);
    }
  } catch {
    throw new Error(INVALID_REQUEST);
  }
  const allowed = operationRules.some(
    (rule) => rule.methods.includes(request.method) && rule.path.test(request.path),
  );
  if (!allowed) throw new Error(INVALID_REQUEST);
  return request;
}

export function createCoreApiMain(dependencies: CoreApiMainDependencies) {
  const config = parseCoreEndpointConfig(dependencies.config);
  return {
    async request(request: CoreApiRequest): Promise<CoreApiResponse> {
      const validated = validateCoreOperationRequest(request);
      const token = await dependencies.credentials.getCurrentToken();
      return dependencies.send({
        endpoint: config.endpoint,
        ca: dependencies.ca,
        authorization: `Bearer ${token}`,
        request: validated,
      });
    },
  };
}
