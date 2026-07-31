import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readBoundedFile } from './bounded-file-read';
import { parseCoreEndpointConfig } from './core-api-main';

export interface PackagedCoreDeploymentInput {
  resourcesPath: string;
  userDataPath: string;
}

const DEPLOYMENT_MAX_BYTES = 4 * 1024;
const CA_MAX_BYTES = 256 * 1024;
const INVALID_DEPLOYMENT = 'Konfigurasi deployment CH Core tidak valid.';

function isAlreadyPresent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === 'EEXIST'
  );
}

async function writeExclusive(filePath: string, bytes: string | Buffer) {
  try {
    await writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!isAlreadyPresent(error)) throw error;
  }
}

export async function ensurePackagedCoreDeployment(
  input: PackagedCoreDeploymentInput,
): Promise<string> {
  const deploymentBytes = await readBoundedFile(
    join(input.resourcesPath, 'ch-core-deployment.json'),
    DEPLOYMENT_MAX_BYTES,
  );
  const ca = await readBoundedFile(
    join(input.resourcesPath, 'ch-core-ca.pem'),
    CA_MAX_BYTES,
  );
  let deployment: unknown;
  try {
    deployment = JSON.parse(deploymentBytes.toString('utf8'));
  } catch {
    throw new Error(INVALID_DEPLOYMENT);
  }
  if (
    typeof deployment !== 'object' ||
    deployment === null ||
    Array.isArray(deployment) ||
    Object.keys(deployment).join(',') !== 'endpoint' ||
    typeof Reflect.get(deployment, 'endpoint') !== 'string'
  ) {
    throw new Error(INVALID_DEPLOYMENT);
  }

  const caFile = join(input.userDataPath, 'ch-core-ca.pem');
  const configPath = join(input.userDataPath, 'ch-core-config.json');
  const config = parseCoreEndpointConfig({
    endpoint: Reflect.get(deployment, 'endpoint'),
    caFile,
  });

  await mkdir(input.userDataPath, { recursive: true });
  await writeExclusive(caFile, ca);
  await writeExclusive(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}
