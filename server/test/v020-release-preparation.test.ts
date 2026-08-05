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

describe('v0.2.0 historical repository-local release preparation', () => {
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

  it('retains historical repository evidence without treating it as current release guidance', async () => {
    const [acceptance, deployment, businessLan] = await Promise.all([
      repositoryText('docs/ch-core-acceptance-status.md'),
      repositoryText('docs/ch-core-nas-deployment.md'),
      repositoryText('docs/ch-core-business-lan.md'),
    ]);
    const historicalSection = markdownSection(
      acceptance,
      '### Historical pilot v0.2.0 — persiapan repository lokal',
      '### Pilot v0.2.1 — current repository release contract',
    );
    const localEvidence = markdownSection(
      acceptance,
      '## Local implementation and regression',
      '## Client release artifacts',
    );
    const workbookReview = markdownSection(
      acceptance,
      '## Workbook owner review',
      '## NAS preflight and deployment gates',
    );

    for (const status of ['PASS', 'READY', 'BLOCKED']) {
      expect(historicalSection).toContain(status);
    }
    for (const blockedGate of [
      'Live import workbook',
      'Deploy Core API v2',
      'Windows printing fisik',
      'Kamera/share fisik',
      'Penerimaan fisik dua perangkat',
      'Pilot copied-data empat hari',
    ]) {
      expect(historicalSection).toMatch(
        new RegExp(`\\| ${blockedGate} \\| BLOCKED \\|`),
      );
    }
    expect(historicalSection).toMatch(
      /\| Artefak signed v0\.2\.0 \| PASS \|[^\n]*CH-Ultimate-0\.2\.0-Setup\.exe[^\n]*149265920[^\n]*1d927dae1b945f37066c03940407f9aa785ff648de71f7f8ff86a6164d3368f2[^\n]*CHU-Companion-Mobile-0\.2\.0-release\.apk[^\n]*43101247[^\n]*f55a55204a0c6b0169fc8376a096801b1d4556d57f94e686d4b370774b880c20[^\n]*SHA256SUMS\.txt/,
    );
    expect(historicalSection).toMatch(
      /\| Publikasi GitHub \| PASS \|[^\n]*pilot-v0\.2\.0[^\n]*2026-08-05T03:20:20Z[^\n]*11:20:20 WITA[^\n]*da2ee77db5c9369f00508966f2d7972050acb1d1[^\n]*30970910259[^\n]*success[^\n]*releases\/tag\/pilot-v0\.2\.0/,
    );
    expect(historicalSection).toContain('four-day copied-data pilot');
    expect(historicalSection).not.toContain('24-hour');
    expect(deployment).toContain('four-day copied-data pilot');
    expect(deployment).not.toContain('24-hour copied-data pilot');
    expect(businessLan).toMatch(/four-day\s+copied-data pilot/);
    expect(businessLan).not.toContain('24 hours');

    for (const currentWorkbookFact of [
      'SKU_Gudang20260804080716145.xlsx',
      'f1f4675327fac107ef9f78c114b8afe86389d5543b204540ed45e74f9b15e49c',
      '3,144 SKU',
      '6,288 identifiers',
      '2,786 refs',
      '358 missing',
      '3 Modal selections',
      'Rp276,285,615',
      '3,988 PCS',
    ]) {
      expect(localEvidence).toContain(currentWorkbookFact);
    }
    expect(acceptance).not.toContain('Rp276,267,011');
    expect(acceptance).not.toContain('4,115 PCS');
    expect(acceptance).not.toContain(
      'The fixed selection rule uses a positive `Harga Jual Referensi`',
    );
    expect(workbookReview).toContain('Modal Referensi');
    for (const reviewedRow of ['1018', '1088', '1180']) {
      expect(workbookReview).toMatch(
        new RegExp(`\\| ${reviewedRow} \\| Modal Referensi \\|`),
      );
    }

    for (const historicalReleaseHeading of [
      '### Client stabilization v0.1.5',
      '### Private pilot release receipt v0.1.3',
      '### Private pilot release receipt v0.1.2',
      '### Historical private pilot release receipt v0.1.1',
    ]) {
      expect(acceptance).toContain(historicalReleaseHeading);
    }
  });

  it('points the repository guide and acceptance ledger at the current guarded v0.2.1 contract', async () => {
    const [readme, acceptance] = await Promise.all([
      repositoryText('README.md'),
      repositoryText('docs/ch-core-acceptance-status.md'),
    ]);

    for (const currentPilotFact of [
      'CH-Ultimate-0.2.1-Setup.exe',
      'CHU-Companion-Mobile-0.2.1-release.apk',
      'docs/releases/pilot-0.2.1.md',
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

    const currentSection = markdownSection(
      acceptance,
      '### Pilot v0.2.1 — current repository release contract',
      '## Local implementation and regression',
    );
    for (const currentReleaseFact of [
      'versionName 0.2.1',
      'versionCode 8',
      'pilot-v0.2.1',
      'docs/releases/pilot-0.2.1.md',
      'BELUM DIVERIFIKASI',
    ]) {
      expect(currentSection).toContain(currentReleaseFact);
    }
    for (const currentBlockedRow of [
      '| Publikasi GitHub | BLOCKED |',
      '| Deploy CH Core v2 | BLOCKED |',
      '| Windows terpasang | BLOCKED |',
      '| Android fisik | BLOCKED |',
      '| Cetak fisik | BLOCKED |',
      '| Pilot copied-data empat hari | BLOCKED |',
    ]) {
      expect(currentSection).toContain(currentBlockedRow);
    }
  });
});
