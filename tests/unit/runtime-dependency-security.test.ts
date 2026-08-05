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

  it('does not expose uuid as an application dependency', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };

    expect(manifest.dependencies).not.toHaveProperty('uuid');
    expect(manifest.dependencies.exceljs).toBe('4.4.0');
  });
});
