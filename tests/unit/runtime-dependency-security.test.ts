import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

type LockPackage = {
  version?: string;
};

type PackageLock = {
  packages: Record<string, LockPackage>;
};

function versionsFor(lock: PackageLock, packageName: string): string[] {
  const rootPath = `node_modules/${packageName}`;
  return Object.entries(lock.packages)
    .filter(
      ([path]) => path === rootPath || path.endsWith(`/${rootPath}`),
    )
    .map(([, metadata]) => metadata.version ?? '')
    .sort();
}

describe('runtime dependency security contract', () => {
  it('overrides jsPDF optional DOMPurify past the known XSS advisory', async () => {
    const [manifestText, lockText] = await Promise.all([
      readFile('package.json', 'utf8'),
      readFile('package-lock.json', 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as {
      overrides?: Record<string, string>;
    };
    const lock = JSON.parse(lockText) as PackageLock;

    expect(manifest.overrides?.dompurify).toBe('3.4.13');
    expect(versionsFor(lock, 'dompurify')).toEqual(['3.4.13']);
  });

  it('pins jsPDF past all advisories known at the v0.2.2 release gate', async () => {
    const [manifestText, lockText] = await Promise.all([
      readFile('package.json', 'utf8'),
      readFile('package-lock.json', 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as {
      dependencies: Record<string, string>;
    };
    const lock = JSON.parse(lockText) as PackageLock;

    expect(manifest.dependencies.jspdf).toBe('4.2.1');
    expect(versionsFor(lock, 'jspdf')).toEqual(['4.2.1']);
  });

  it('contains no vulnerable fast-uri or brace-expansion lock entries', async () => {
    const lock = JSON.parse(
      await readFile('package-lock.json', 'utf8'),
    ) as PackageLock;

    expect(versionsFor(lock, 'fast-uri')).toEqual(['3.1.5', '4.1.2']);
    expect(versionsFor(lock, 'brace-expansion')).toEqual([
      '1.1.18',
      '2.1.4',
      '2.1.4',
      '2.1.4',
      '2.1.4',
      '5.0.9',
    ]);
  });

  it('keeps uuid transitive and overrides ExcelJS past its buffer advisory', async () => {
    const [manifestText, lockText] = await Promise.all([
      readFile('package.json', 'utf8'),
      readFile('package-lock.json', 'utf8'),
    ]);
    const manifest = JSON.parse(manifestText) as {
      dependencies: Record<string, string>;
      overrides?: Record<string, string>;
    };
    const lock = JSON.parse(lockText) as PackageLock;

    expect(manifest.dependencies).not.toHaveProperty('uuid');
    expect(manifest.dependencies.exceljs).toBe('4.4.0');
    expect(manifest.overrides?.uuid).toBe('11.1.1');
    expect(versionsFor(lock, 'uuid')).toEqual(['11.1.1']);
  });
});
