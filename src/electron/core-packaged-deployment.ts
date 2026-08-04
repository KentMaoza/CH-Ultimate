import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { readBoundedFile } from './bounded-file-read';
import { parseCoreEndpointConfig } from './core-api-main';

export interface PackagedCoreDeploymentInput {
  resourcesPath: string;
  userDataPath: string;
}

const DEPLOYMENT_MAX_BYTES = 4 * 1024;
const CA_MAX_BYTES = 256 * 1024;
const INVALID_DEPLOYMENT = 'Konfigurasi deployment CH Core tidak valid.';
const LEGACY_ENDPOINT = 'https://192.168.1.14:8443';

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

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    Reflect.get(error, 'code') === 'ENOENT'
  );
}

function isExactLegacyConfig(input: unknown, caFile: string): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    Object.keys(input).sort().join(',') === 'caFile,endpoint' &&
    Reflect.get(input, 'endpoint') === LEGACY_ENDPOINT &&
    Reflect.get(input, 'caFile') === caFile
  );
}

async function replaceAtomically(filePath: string, bytes: string): Promise<void> {
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
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
  const configBytes = `${JSON.stringify(config, null, 2)}\n`;
  let existingConfig: Buffer | undefined;
  try {
    existingConfig = await readBoundedFile(configPath, DEPLOYMENT_MAX_BYTES);
  } catch (error) {
    if (isNotFound(error)) {
      await writeExclusive(caFile, ca);
      await writeExclusive(configPath, configBytes);
      return configPath;
    }
    return configPath;
  }

  let currentConfig: unknown;
  try {
    currentConfig = JSON.parse(existingConfig.toString('utf8'));
  } catch {
    return configPath;
  }
  if (isExactLegacyConfig(currentConfig, caFile)) {
    await replaceAtomically(configPath, configBytes);
  }
  return configPath;
}
