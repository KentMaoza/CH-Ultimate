import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { expect, test } from 'vitest';

const workspace = resolve(import.meta.dirname, '../..');

function resolveLocalImport(importer: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const target = resolve(dirname(importer), specifier);
  const candidates = extname(target)
    ? [target]
    : [`${target}.ts`, `${target}.tsx`, resolve(target, 'index.ts'), resolve(target, 'index.tsx')];
  return candidates.find((candidate) => existsSync(candidate));
}

function mobileModuleGraph() {
  const pending = [resolve(workspace, 'mobile/main.tsx')];
  const files = new Set<string>();
  const packages = new Set<string>();
  const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

  while (pending.length > 0) {
    const file = pending.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1] ?? match[2]!;
      const local = resolveLocalImport(file, specifier);
      if (local && !local.endsWith('.css')) pending.push(local);
      else if (!specifier.startsWith('.')) packages.add(specifier.split('/')[0]!);
    }
  }
  return { files, packages };
}

test('mobile PDF graph excludes the desktop-only ExcelJS workbook builder', () => {
  const graph = mobileModuleGraph();
  expect([...graph.files]).not.toContain(resolve(workspace, 'src/domain/operational-workbook.ts'));
  expect([...graph.files].some((file) => file.endsWith('/src/domain/workbook.ts'))).toBe(false);
  expect(graph.packages).not.toContain('exceljs');
  expect(graph.files).toContain(resolve(workspace, 'src/domain/operational-exports.ts'));
});
