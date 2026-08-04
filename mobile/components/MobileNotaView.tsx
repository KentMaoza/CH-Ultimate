import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { lineTotal, noteSuffixFromIndex } from '../../src/domain/nota';
import { findSkuByScanCode, searchMobileSkus } from '../../src/domain/mobile-demo-state';
import type { NotaLine, NotaTransaction, Unit } from '../../src/domain/types';
import type { OperationsGateway } from '../../src/gateway/operations-gateway';
import { createNotaVoicePlayer, type NotaVoicePlayer } from '../../src/renderer/nota/nota-voice';
import { notaPageTheme } from '../../src/renderer/nota/nota-page-colors';
import {
  useOperationsSnapshot,
  useOperationsSyncSnapshot,
} from '../../src/renderer/use-operations-snapshot';
import { formatRupiah } from '../format';
import type { BarcodeScannerPort } from '../ports';
import { ScanIcon } from './Icons';

type ManualDraft = { description: string; kind: string; quantity: string; unit: Unit; pcsPrice: string; lsnPrice: string };
const emptyManual: ManualDraft = { description: '', kind: '', quantity: '1', unit: 'pcs', pcsPrice: '', lsnPrice: '' };

function populated(line: NotaLine) {
  return Boolean(line.skuId || line.description.trim() || line.kind.trim() || line.quantity || line.pcsPrice || line.lsnPrice);
}

function workingTransaction(transactions: NotaTransaction[], transactionId?: string) {
  const working = transactions.filter((transaction) => transaction.status === 'draft' || transaction.status === 'reopened');
  return transactionId ? working.find((transaction) => transaction.id === transactionId) : working[0];
}

function rowPrice(line: NotaLine) {
  return line.unit === 'lsn' ? line.lsnPrice : line.pcsPrice;
}

function availableSlot(transaction: NotaTransaction, preferredPageId?: string) {
  const active = transaction.pages.filter((page) => page.status === 'active');
  const preferredIndex = active.findIndex((page) => page.id === preferredPageId);
  for (let index = Math.max(0, preferredIndex); index < active.length; index += 1) {
    const page = active[index]!;
    const line = page.lines.find((candidate) => !populated(candidate));
    if (line) return { page, line };
  }
  return null;
}

export function MobileNotaView({ coreBacked = false, gateway, scanner, transactionId }: { coreBacked?: boolean; gateway: OperationsGateway; scanner: BarcodeScannerPort; transactionId?: string }) {
  const snapshot = useOperationsSnapshot(gateway);
  const sync = useOperationsSyncSnapshot(gateway);
  const transaction = workingTransaction(snapshot.notaTransactions, transactionId);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [skuPickerOpen, setSkuPickerOpen] = useState(false);
  const [skuQuery, setSkuQuery] = useState('');
  const [manual, setManual] = useState<ManualDraft>(emptyManual);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'status' | 'alert'>('status');
  const [completionOpen, setCompletionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const creating = useRef(false);
  const completionStarted = useRef(false);
  const voicePlayer = useRef<NotaVoicePlayer | null>(null);
  const activePages = transaction?.pages.filter((page) => page.status === 'active') ?? [];
  const selectedPage = activePages.find((page) => page.id === selectedPageId) ?? activePages[0];
  const lifecycleBlocked = Boolean(
    transaction &&
    sync.phase === 'offline' &&
    gateway.isNotaLifecycleOnlineOnly(transaction.id),
  );

  useEffect(() => {
    if (transaction || creating.current || completionStarted.current) return;
    creating.current = true;
    void gateway.createNotaTransaction()
      .catch((error) => {
        setNoticeKind('alert');
        setNotice(error instanceof Error && error.message ? error.message : 'Nota baru tidak dapat dibuat.');
      })
      .finally(() => { creating.current = false; });
  }, [gateway, transaction]);

  useEffect(() => {
    if (selectedPage && selectedPage.id !== selectedPageId) setSelectedPageId(selectedPage.id);
  }, [selectedPage, selectedPageId]);

  useEffect(() => {
    const player = createNotaVoicePlayer({ onPlaybackError: () => {
      setNoticeKind('alert');
      setNotice('Suara nota tidak dapat diputar.');
    } });
    voicePlayer.current = player;
    return () => {
      player.dispose();
      if (voicePlayer.current === player) voicePlayer.current = null;
    };
  }, []);

  const transactionTotal = useMemo(() => activePages
    .flatMap((page) => page.lines)
    .reduce((total, line) => total + lineTotal(line), 0), [activePages]);
  const pageTotal = selectedPage?.lines.reduce((total, line) => total + lineTotal(line), 0) ?? 0;
  const skuResults = useMemo(
    () => searchMobileSkus(snapshot.skus, skuQuery),
    [snapshot.skus, skuQuery],
  );

  function reportError(error: unknown, fallback: string) {
    setNoticeKind('alert');
    setNotice(error instanceof Error && error.message ? error.message : fallback);
  }

  function saveEdit(operation: () => Promise<unknown>, fallback = 'Perubahan nota tidak dapat disimpan.') {
    setNotice('');
    try {
      void operation().catch((error) => reportError(error, fallback));
    } catch (error) {
      reportError(error, fallback);
    }
  }

  async function findSlot(current: NotaTransaction) {
    const existing = availableSlot(current, selectedPage?.id);
    if (existing) return existing;
    const page = await gateway.addNotaPage(current.id);
    const line = page?.lines[0];
    return page && line ? { page, line } : null;
  }

  async function addSkuCode(rawCode: string, source: 'barcode' | 'catalogue' = 'barcode') {
    const current = workingTransaction(gateway.getSnapshot().notaTransactions, transactionId);
    if (!current) return;
    const sku = findSkuByScanCode(gateway.getSnapshot().skus, rawCode);
    if (!sku) {
      setNoticeKind('alert');
      setNotice(`Kode tidak dikenal: ${rawCode.trim() || 'kode kosong'}.`);
      return;
    }
    if (sku.archived) {
      setNoticeKind('alert');
      setNotice(`SKU sudah diarsipkan: ${sku.skuNumber}. Barang tidak ditambahkan.`);
      return;
    }
    const duplicate = current.pages.flatMap((page) => page.lines.map((line) => ({ page, line })))
      .find(({ page, line }) => page.status === 'active' && line.skuId === sku.id);
    if (duplicate) {
      await gateway.updateNotaLine(current.id, duplicate.page.id, duplicate.line.id, { quantity: duplicate.line.quantity + 1 });
      voicePlayer.current?.speak({
        rowNumber: duplicate.page.lines.findIndex((line) => line.id === duplicate.line.id) + 1,
        suffix: duplicate.page.suffix,
        quantity: duplicate.line.quantity + 1,
        unit: duplicate.line.unit,
        price: rowPrice(duplicate.line),
      });
      setSelectedPageId(duplicate.page.id);
      setNoticeKind('status');
      setNotice(`${sku.name} ditambah menjadi ${duplicate.line.quantity + 1}.`);
      return;
    }
    const slot = await findSlot(current);
    if (!slot) {
      setNoticeKind('alert');
      setNotice('Bagian baru tidak dapat dibuat.');
      return;
    }
    await gateway.updateNotaLine(current.id, slot.page.id, slot.line.id, {
      skuId: sku.id,
      description: sku.name,
      kind: 'SKU Gudang',
      quantity: 1,
      unit: 'pcs',
      pcsPrice: sku.referencePrice,
      lsnPrice: sku.referencePrice * 12,
    });
    voicePlayer.current?.speak({
      rowNumber: slot.page.lines.findIndex((line) => line.id === slot.line.id) + 1,
      suffix: slot.page.suffix,
      quantity: 1,
      unit: 'pcs',
      price: sku.referencePrice,
    });
    setSelectedPageId(slot.page.id);
    setNoticeKind('status');
    setNotice(`${sku.name} ditambahkan dari ${source === 'catalogue' ? 'SKU Gudang' : 'barcode'}.`);
  }

  async function addSkuFromPicker(skuNumber: string) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    try {
      await addSkuCode(skuNumber, 'catalogue');
    } catch (error) {
      reportError(error, 'Barang dari SKU tidak dapat ditambahkan.');
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    setBusy(true);
    setNotice('');
    try {
      const result = await scanner.scan();
      if (!result) {
        setNoticeKind('alert');
        setNotice('Pemindaian dibatalkan atau kamera tidak tersedia.');
        return;
      }
      await addSkuCode(result.rawValue);
    } catch {
      setNoticeKind('alert');
      setNotice('Pemindai tidak tersedia. Tambahkan barang tanpa barcode.');
    } finally {
      setBusy(false);
    }
  }

  async function addManual() {
    const current = workingTransaction(gateway.getSnapshot().notaTransactions, transactionId);
    const quantity = Number(manual.quantity);
    const pcsPrice = Number(manual.pcsPrice);
    const lsnPrice = Number(manual.lsnPrice);
    if (!current || !manual.description.trim()) {
      setNoticeKind('alert');
      setNotice('Nama barang wajib diisi.');
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setNoticeKind('alert');
      setNotice('Jumlah harus bilangan bulat positif.');
      return;
    }
    if (!Number.isInteger(pcsPrice) || pcsPrice < 0 || !Number.isInteger(lsnPrice) || lsnPrice < 0) {
      setNoticeKind('alert');
      setNotice('Harga PCS dan Lusin harus bilangan bulat nol atau lebih.');
      return;
    }
    const slot = await findSlot(current);
    if (!slot) return;
    await gateway.updateNotaLine(current.id, slot.page.id, slot.line.id, {
      skuId: undefined,
      description: manual.description.trim(),
      kind: manual.kind.trim(),
      quantity,
      unit: manual.unit,
      pcsPrice,
      lsnPrice,
    });
    voicePlayer.current?.speak({
      rowNumber: slot.page.lines.findIndex((line) => line.id === slot.line.id) + 1,
      suffix: slot.page.suffix,
      quantity,
      unit: manual.unit,
      price: manual.unit === 'pcs' ? pcsPrice : lsnPrice,
    });
    setSelectedPageId(slot.page.id);
    setManual(emptyManual);
    setManualOpen(false);
    setNoticeKind('status');
    setNotice(`${manual.description.trim()} ditambahkan.`);
  }

  async function addPage() {
    if (!transaction) return;
    const page = await gateway.addNotaPage(transaction.id);
    if (page) setSelectedPageId(page.id);
  }

  async function updateLine(line: NotaLine, patch: Partial<NotaLine>) {
    if (!transaction || !selectedPage) return;
    await gateway.updateNotaLine(transaction.id, selectedPage.id, line.id, patch);
  }

  async function complete() {
    if (!transaction) return;
    completionStarted.current = true;
    setBusy(true);
    try {
      await gateway.completeNotaTransaction(transaction.id, 'archive');
      const completed = gateway.getSnapshot().notaTransactions.find((item) => item.id === transaction.id);
      if (completed?.status !== 'completed') throw new Error('Nota tidak dapat disimpan.');
      setCompletionOpen(false);
      setNoticeKind('status');
      setNotice(
        !coreBacked
          ? 'Nota tersimpan di Arsip sesi demo lokal.'
          : gateway.getSyncSnapshot().phase === 'offline'
          ? 'Menunggu sinkronisasi — stok dan omzet pusat belum berubah.'
          : 'Nota tersimpan di Arsip dan tersedia di semua perangkat.',
      );
    } catch (error) {
      setNoticeKind('alert');
      completionStarted.current = false;
      setNotice(error instanceof Error ? error.message : 'Nota tidak dapat disimpan.');
    } finally {
      setBusy(false);
    }
  }

  const theme = notaPageTheme(Math.max(0, transaction?.pages.findIndex((page) => page.id === selectedPage?.id) ?? 0));
  const themeStyle = { '--mobile-nota-accent': theme.background, '--mobile-nota-accent-text': theme.foreground } as CSSProperties;
  const nextSlot = transaction ? availableSlot(transaction, selectedPage?.id) : null;
  const nextItemLabel = transaction
    ? nextSlot
      ? `${nextSlot.page.lines.findIndex((line) => line.id === nextSlot.line.id) + 1}${nextSlot.page.suffix}`
      : `1${noteSuffixFromIndex(transaction.nextNoteIndex)}`
    : '';

  return <section className="mobile-nota-view" aria-busy={busy || undefined}>
    <header className="mobile-header mobile-nota-header">
      <div><span className="eyebrow">{coreBacked ? 'CH CORE · NOTA TERSINKRONISASI' : 'FRONTEND DEMO · SESSION ONLY'}</span><h1 data-page-heading tabIndex={-1}>Nota Barang</h1></div>
      <strong>{formatRupiah(transactionTotal)}</strong>
    </header>
    {notice && <p className={`mobile-nota-notice mobile-nota-notice--${noticeKind}`} role={noticeKind}>{notice}</p>}
    {transaction && selectedPage ? <>
      <section className="mobile-nota-meta" aria-label="Data nota mobile">
        <label><span>Pelanggan</span><input value={transaction.customerName} onChange={(event) => saveEdit(() => gateway.updateNotaTransaction(transaction.id, { customerName: event.target.value }))} /></label>
        <label><span>Tempat</span><input value={transaction.customerPlace} onChange={(event) => saveEdit(() => gateway.updateNotaTransaction(transaction.id, { customerPlace: event.target.value }))} /></label>
      </section>
      <div className="mobile-nota-actions">
        <button className="primary-action mobile-nota-actions__scan" disabled={busy} onClick={() => void scan()}>
          <ScanIcon />Scan barcode
        </button>
        <button
          className="secondary-action"
          aria-expanded={skuPickerOpen}
          disabled={busy}
          onClick={() => {
            setSkuPickerOpen((open) => !open);
            setManualOpen(false);
          }}
        >
          Tambah barang dengan SKU
        </button>
        <button
          className="secondary-action"
          disabled={busy}
          onClick={() => {
            setManualOpen((open) => !open);
            setSkuPickerOpen(false);
          }}
        >
          Tambah barang tanpa barcode
        </button>
      </div>
      {skuPickerOpen && <section className="mobile-nota-sku-picker" aria-label="Tambah barang dengan SKU">
        <header>
          <div>
            <strong>SKU GUDANG</strong>
            <span>Target nomor {nextItemLabel}</span>
          </div>
          <button aria-label="Lipat daftar SKU" onClick={() => setSkuPickerOpen(false)}>Lipat</button>
        </header>
        <label className="mobile-nota-sku-search">
          <span>Cari SKU</span>
          <input
            aria-label="Cari SKU untuk nota"
            role="searchbox"
            placeholder="Cari nama / nomor SKU / alias"
            value={skuQuery}
            onChange={(event) => setSkuQuery(event.currentTarget.value)}
          />
        </label>
        <p>{skuResults.length} SKU aktif</p>
        <div className="mobile-nota-sku-results">
          {skuResults.map((sku) => <button
            key={sku.id}
            className="mobile-nota-sku-card"
            aria-label={`Tambah ${sku.name} (${sku.skuNumber})`}
            disabled={busy}
            onClick={() => void addSkuFromPicker(sku.skuNumber)}
          >
            <span className="mobile-nota-sku-mark">CHU</span>
            <span className="mobile-nota-sku-identity"><strong>{sku.skuNumber}</strong><span>{sku.name}</span></span>
            <span className="mobile-nota-sku-value"><b>PCS · {formatRupiah(sku.referencePrice)}</b><span>{sku.tracked ? `Stok ${sku.stock}` : 'Stok tidak dilacak'}</span></span>
          </button>)}
          {!skuResults.length && <p className="mobile-nota-empty">Tidak ada SKU aktif yang cocok.</p>}
        </div>
      </section>}
      {manualOpen && <section className="mobile-nota-manual" aria-label="Barang tanpa barcode" style={themeStyle}>
        <div className="mobile-nota-manual__name"><strong aria-label={`Nomor barang ${nextItemLabel}`}>{nextItemLabel}</strong><label><span>Nama barang</span><input aria-label="Nama barang manual" value={manual.description} onChange={(event) => setManual({ ...manual, description: event.target.value })} /></label></div>
        <label><span>Jenis</span><input aria-label="Jenis barang manual" value={manual.kind} onChange={(event) => setManual({ ...manual, kind: event.target.value })} /></label>
        <div><label><span>Jumlah</span><input aria-label="Jumlah barang manual" inputMode="numeric" value={manual.quantity} onChange={(event) => setManual({ ...manual, quantity: event.target.value })} /></label><label><span>Unit</span><select aria-label="Unit barang manual" value={manual.unit} onChange={(event) => setManual({ ...manual, unit: event.target.value as Unit })}><option value="pcs">PCS</option><option value="lsn">LSN</option></select></label></div>
        <div><label><span>Harga PCS</span><input aria-label="Harga PCS barang manual" inputMode="numeric" value={manual.pcsPrice} onChange={(event) => setManual({ ...manual, pcsPrice: event.target.value })} /></label><label><span>Harga Lusin</span><input aria-label="Harga Lusin barang manual" inputMode="numeric" value={manual.lsnPrice} onChange={(event) => setManual({ ...manual, lsnPrice: event.target.value })} /></label></div>
        <button className="primary-action" onClick={() => saveEdit(addManual, 'Barang tidak dapat ditambahkan.')}>Simpan barang</button>
      </section>}
      <div className="mobile-nota-pages" aria-label="Bagian nota">{activePages.map((page) => {
        const index = transaction.pages.findIndex((candidate) => candidate.id === page.id);
        const pageTheme = notaPageTheme(index);
        return <button key={page.id} aria-label={`Bagian ${page.suffix}`} aria-pressed={page.id === selectedPage.id} style={{ '--mobile-nota-accent': pageTheme.background, '--mobile-nota-accent-text': pageTheme.foreground } as CSSProperties} onClick={() => setSelectedPageId(page.id)}>{page.suffix}</button>;
      })}<button className="mobile-nota-pages__add" onClick={() => saveEdit(addPage, 'Bagian baru tidak dapat dibuat.')}>Tambah Bagian {noteSuffixFromIndex(transaction.nextNoteIndex)}</button></div>
      <section className="mobile-nota-section" style={themeStyle} aria-label={`Isi Bagian ${selectedPage.suffix}`}>
        <header><div><span>BAGIAN</span><strong>{selectedPage.suffix}</strong></div><p>Maksimal 15 nomor</p><b>{formatRupiah(pageTotal)}</b></header>
        <div className="mobile-nota-lines">{selectedPage.lines.map((line, index) => {
          if (!populated(line)) return null;
          const label = `${index + 1}${selectedPage.suffix}`;
          return <article className="mobile-nota-line" key={line.id} role="region" aria-label={`Barang ${label}: ${line.description}`}>
            <span className="mobile-nota-line__number">{label}</span>
            <label><span>Nama barang</span><input aria-label={`Nama barang ${label}`} value={line.description} onChange={(event) => saveEdit(() => updateLine(line, { description: event.target.value, skuId: undefined }))} /></label>
            <label><span>Jenis</span><input aria-label={`Jenis barang ${label}`} value={line.kind} onChange={(event) => saveEdit(() => updateLine(line, { kind: event.target.value }))} /></label>
            <div className="mobile-nota-line__numbers"><label><span>Jumlah</span><input aria-label={`Jumlah barang ${label}`} inputMode="numeric" type="number" min="1" value={line.quantity} onChange={(event) => saveEdit(() => updateLine(line, { quantity: Number(event.target.value) }))} /></label><label><span>Unit</span><select aria-label={`Unit barang ${label}`} value={line.unit} onChange={(event) => saveEdit(() => updateLine(line, { unit: event.target.value as Unit }))}><option value="pcs">PCS</option><option value="lsn">LSN</option></select></label><label><span>Harga</span><input aria-label={`Harga barang ${label}`} inputMode="numeric" type="number" min="0" value={rowPrice(line)} onChange={(event) => saveEdit(() => updateLine(line, line.unit === 'pcs' ? { pcsPrice: Number(event.target.value) } : { lsnPrice: Number(event.target.value) }))} /></label></div>
            <footer><strong>{formatRupiah(lineTotal(line))}</strong><button aria-label={`Hapus barang ${label}`} onClick={() => transaction && saveEdit(() => gateway.deleteNotaLine(transaction.id, selectedPage.id, line.id), 'Barang tidak dapat dihapus.')}>Hapus</button></footer>
          </article>;
        })}{!selectedPage.lines.some(populated) && <p className="mobile-nota-empty">Belum ada barang di Bagian {selectedPage.suffix}.</p>}</div>
      </section>
      <footer className="mobile-nota-finish"><div><span>Total transaksi</span><strong>{formatRupiah(transactionTotal)}</strong></div><button className="primary-action" disabled={busy || lifecycleBlocked} title={lifecycleBlocked ? 'Hubungkan CH Core untuk menyelesaikan transaksi.' : undefined} onClick={() => setCompletionOpen(true)}>Selesaikan nota</button></footer>
    </> : !notice && <p className="mobile-nota-empty">Menyiapkan nota baru…</p>}
    {completionOpen && <div className="mobile-nota-dialog-backdrop"><section role="dialog" aria-modal="true" aria-label="Selesaikan nota mobile?" className="mobile-nota-dialog"><h2>Selesaikan nota mobile?</h2><p>{coreBacked ? 'Nota disimpan ke Arsip dan tersedia di semua perangkat setelah sinkronisasi.' : 'Nota disimpan ke Arsip pada sesi demo lokal ini.'}</p><button className="primary-action" disabled={busy} onClick={() => void complete()}>Simpan ke Arsip</button><button disabled={busy} onClick={() => setCompletionOpen(false)}>Batal</button></section></div>}
  </section>;
}
