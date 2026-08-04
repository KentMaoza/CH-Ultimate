import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

async function repositoryText(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

function markdownSection(
  markdown: string,
  heading: string,
  nextHeading: string,
): string {
  const start = markdown.indexOf(heading);
  const end = markdown.indexOf(nextHeading, start + heading.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return markdown.slice(start, end);
}

describe('v0.2.0 repository-local release preparation', () => {
  it('describes every requested revision and the copied-data pilot boundary', async () => {
    const notes = await repositoryText('docs/releases/pilot-0.2.0.md');

    for (const requiredReleaseFact of [
      'CH-Ultimate-0.2.0-Setup.exe',
      'CHU-Companion-Mobile-0.2.0-release.apk',
      'https://192.168.50.14:8443',
      'pengetikan Nota desktop',
      'sinkronisasi gambar',
      'empat tanggal kalender WITA',
      'SKU Baru',
      'Baru Restock',
      'Cek Stok untuk seluruh SKU aktif',
      'Terakhir cek stok',
      'barcode paket',
      'koreksi jumlah PCS',
      'cetak Nota, invoice, label, dan barcode',
      'PDF',
      'XLSX',
      'SKU_Gudang20260804080716145.xlsx',
      'f1f4675327fac107ef9f78c114b8afe86389d5543b204540ed45e74f9b15e49c',
      'four-day copied-data pilot',
    ]) {
      expect(notes).toContain(requiredReleaseFact);
    }
    expect(notes).toMatch(/bukan produksi/i);
    expect(notes).toMatch(/Android.+permanen/is);
    expect(notes).toMatch(/Windows.+tidak.+Authenticode/is);
    expect(notes).toMatch(/debug APK.+verifikasi.+tidak boleh dipublikasikan/is);
  });

  it('makes the API v2 maintenance and rollback boundary explicit', async () => {
    const runbook = await repositoryText(
      'docs/ch-core-v0.2-maintenance-rollback.md',
    );

    for (const requiredSafetyFact of [
      'apiSchemaVersion: 2',
      'Umumkan jendela pemeliharaan',
      'quiesce',
      '/health/live',
      '/health/ready',
      '--cacert',
      'Hitung tepat semua tabel',
      'dump logis bertimestamp',
      'SHA-256',
      'restore bersih',
      'chu_restore_',
      'schema_migrations',
      'checksum migrasi',
      'klien lama gagal tertutup sebelum menulis',
      'uji baca/tulis terbatas',
      'v2 write',
      'offline-outbox replay',
      'forward-fix',
      'jangan membuat down migration',
    ]) {
      expect(runbook.toLowerCase()).toContain(requiredSafetyFact.toLowerCase());
    }
    expect(runbook).toMatch(
      /rollback biner\/database penuh.+hanya.+sebelum.+v2 write.+offline-outbox replay/is,
    );
    expect(runbook).toMatch(
      /setelah.+v2 write.+offline-outbox replay.+hentikan semua klien.+forward-fix/is,
    );
  });

  it('preserves identity data and limits pilot-data clearing to an explicit table allowlist', async () => {
    const runbook = await repositoryText(
      'docs/ch-core-v0.2-maintenance-rollback.md',
    );
    const identitySection = markdownSection(
      runbook,
      '### Tabel identitas yang wajib dipertahankan',
      '### Allowlist tabel data bisnis pilot',
    );
    const allowlistSection = markdownSection(
      runbook,
      '### Allowlist tabel data bisnis pilot',
      '## Penerapan v0.2',
    );

    for (const identityTable of ['devices', 'pairings', 'owner_recovery']) {
      expect(identitySection).toContain(`\`${identityTable}\``);
      expect(allowlistSection).not.toContain(`\`${identityTable}\``);
    }
    expect(identitySection).toContain('`business_write_lock`');
    expect(allowlistSection).not.toContain('`business_write_lock`');
    for (const businessTable of [
      'skus',
      'sku_identifiers',
      'price_history',
      'notas',
      'nota_pages',
      'nota_lines',
      'nota_postings',
      'nota_daily_sequences',
      'nota_conflicts',
      'revenue_postings',
      'stock_movements',
      'stock_balances',
      'stock_checks',
      'templates',
      'imports',
      'image_assets',
      'image_jobs',
      'idempotency_receipts',
      'audit_events',
      'client_cursor_acknowledgements',
      'change_log',
    ]) {
      expect(allowlistSection).toContain(`\`${businessTable}\``);
    }
    expect(allowlistSection).toMatch(/tidak ada tabel lain/i);
    expect(allowlistSection).toMatch(/persetujuan pemilik/i);
  });

  it('records catalogue and image-progress evidence without claiming physical completion', async () => {
    const evidence = await repositoryText(
      'docs/releases/pilot-0.2.0-evidence.md',
    );

    for (const catalogueFact of [
      'SKU_Gudang20260804080716145.xlsx',
      'f1f4675327fac107ef9f78c114b8afe86389d5543b204540ed45e74f9b15e49c',
      '3,144',
      '6,288',
      '3,988 PCS',
      '2,786',
      '358',
      'Rp276,285,615',
      '1018',
      '1088',
      '1180',
      'Modal Referensi',
    ]) {
      expect(evidence).toContain(catalogueFact);
    }
    for (const imageProgressField of [
      'matched',
      'included',
      'succeeded',
      'failed',
      'retry-visible',
    ]) {
      expect(evidence).toContain(imageProgressField);
    }
    expect(evidence).toMatch(/fisik.+BLOCKED/is);
    expect(evidence).not.toMatch(/fisik.+PASS/is);
  });

  it('separates repository evidence from every unperformed live and physical gate', async () => {
    const [acceptance, deployment] = await Promise.all([
      repositoryText('docs/ch-core-acceptance-status.md'),
      repositoryText('docs/ch-core-nas-deployment.md'),
    ]);
    const currentSection = markdownSection(
      acceptance,
      '### Pilot v0.2.0 — persiapan repository lokal',
      '## Local implementation and regression',
    );

    for (const status of ['PASS', 'READY', 'BLOCKED']) {
      expect(currentSection).toContain(status);
    }
    for (const blockedGate of [
      'Live import workbook',
      'Deploy Core API v2',
      'Artefak signed v0.2.0',
      'Publikasi GitHub',
      'Windows printing fisik',
      'Kamera/share fisik',
      'Penerimaan fisik dua perangkat',
    ]) {
      expect(currentSection).toMatch(
        new RegExp(`\\| ${blockedGate} \\| BLOCKED \\|`),
      );
    }
    expect(currentSection).toContain('four-day copied-data pilot');
    expect(currentSection).not.toContain('24-hour');
    expect(deployment).toContain('four-day copied-data pilot');
    expect(deployment).not.toContain('24-hour copied-data pilot');
    expect(acceptance).toContain('### Client stabilization v0.1.5');
  });

  it('points the repository guide at the current guarded pilot contract', async () => {
    const readme = await repositoryText('README.md');

    for (const currentPilotFact of [
      'CH-Ultimate-0.2.0-Setup.exe',
      'CHU-Companion-Mobile-0.2.0-release.apk',
      'docs/releases/pilot-0.2.0.md',
      'docs/ch-core-v0.2-maintenance-rollback.md',
      'four-day copied-data pilot',
      'permanent Android pilot signer',
    ]) {
      expect(readme).toContain(currentPilotFact);
    }
    expect(readme).not.toContain(
      'CHU-Companion-Mobile-0.1.2-pilot-debug.apk',
    );
    expect(readme).toContain('Physical printing acceptance');
    expect(readme).not.toContain(
      'Production printing, automatic client updates',
    );
  });
});
