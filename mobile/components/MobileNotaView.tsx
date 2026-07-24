import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { lineTotal, noteSuffixFromIndex } from '../../src/domain/nota';
import { findSkuByScanCode } from '../../src/domain/mobile-demo-state';
import type { NotaLine, NotaTransaction, Unit } from '../../src/domain/types';
import type { OperationsGateway } from '../../src/gateway/operations-gateway';
import { createNotaVoicePlayer, type NotaVoicePlayer } from '../../src/renderer/nota/nota-voice';
import { notaPageTheme } from '../../src/renderer/nota/nota-page-colors';
import { formatRupiah } from '../format';
import type { BarcodeScannerPort } from '../ports';
import { ScanIcon } from './Icons';

type ManualDraft = { description: string; kind: string; quantity: string; unit: Unit; price: string };
const emptyManual: ManualDraft = { description: '', kind: '', quantity: '1', unit: 'pcs', price: '' };

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

export function MobileNotaView({ gateway, scanner, transactionId }: { gateway: OperationsGateway; scanner: BarcodeScannerPort; transactionId?: string }) {
  const snapshot = useSyncExternalStore(gateway.subscribe, gateway.getSnapshot, gateway.getSnapshot);
  const transaction = workingTransaction(snapshot.notaTransactions, transactionId);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
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

  useEffect(() => {
    if (transaction || creating.current || completionStarted.current) return;
    creating.current = true;
    void gateway.createNotaTransaction().finally(() => { creating.current = false; });
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

  async function findSlot(current: NotaTransaction) {
    const existing = availableSlot(current, selectedPage?.id);
    if (existing) return existing;
    const page = await gateway.addNotaPage(current.id);
    const line = page?.lines[0];
    return page && line ? { page, line } : null;
  }

  async function addSkuCode(rawCode: string) {
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
    setSelectedPageId(slot.page.id);
    setNoticeKind('status');
    setNotice(`${sku.name} ditambahkan dari barcode.`);
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
    const price = Number(manual.price);
    if (!current || !manual.description.trim()) {
      setNoticeKind('alert');
      setNotice('Nama barang wajib diisi.');
      return;
    }
    if (!Number.isInteger(quantity) || quantity <= 0 || !Number.isInteger(price) || price < 0) {
      setNoticeKind('alert');
      setNotice('Jumlah harus bilangan bulat positif dan harga tidak boleh negatif.');
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
      pcsPrice: manual.unit === 'pcs' ? price : Math.round(price / 12),
      lsnPrice: manual.unit === 'lsn' ? price : price * 12,
    });
    voicePlayer.current?.speak({
      rowNumber: slot.page.lines.findIndex((line) => line.id === slot.line.id) + 1,
      suffix: slot.page.suffix,
      quantity,
      unit: manual.unit,
      price,
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

  async function complete(sendToDesktop: boolean) {
    if (!transaction) return;
    completionStarted.current = true;
    setBusy(true);
    try {
      await gateway.completeNotaTransaction(transaction.id, 'archive');
      const completed = gateway.getSnapshot().notaTransactions.find((item) => item.id === transaction.id);
      if (completed?.status !== 'completed') throw new Error('Nota tidak dapat disimpan.');
      setCompletionOpen(false);
      setNoticeKind('status');
      setNotice(`Nota tersimpan di Arsip sebagai data demo${sendToDesktop ? ', tetapi' : ' dan'} belum terkirim ke desktop karena CH Core API belum tersedia.`);
    } catch (error) {
      completionStarted.current = false;
      setNoticeKind('alert');
      setNotice(error instanceof Error ? error.message : 'Nota tidak dapat disimpan.');
    } finally {
      setBusy(false);
    }
  }

  const theme = notaPageTheme(Math.max(0, transaction?.pages.findIndex((page) => page.id === selectedPage?.id) ?? 0));
  const themeStyle = { '--mobile-nota-accent': theme.background, '--mobile-nota-accent-text': theme.foreground } as CSSProperties;
  const nextSlot = transaction ? availableSlot(transaction, selectedPage?.id) : null;
  const nextManualLabel = transaction
    ? nextSlot
      ? `${nextSlot.page.lines.findIndex((line) => line.id === nextSlot.line.id) + 1}${nextSlot.page.suffix}`
      : `1${noteSuffixFromIndex(transaction.nextNoteIndex)}`
    : '';

  return <section className="mobile-nota-view" aria-busy={busy || undefined}>
    <header className="mobile-header mobile-nota-header">
      <div><span className="eyebrow">FRONTEND DEMO · SESSION ONLY</span><h1 data-page-heading tabIndex={-1}>Nota Barang</h1></div>
      <strong>{formatRupiah(transactionTotal)}</strong>
    </header>
    {notice && <p className={`mobile-nota-notice mobile-nota-notice--${noticeKind}`} role={noticeKind}>{notice}</p>}
    {transaction && selectedPage ? <>
      <section className="mobile-nota-meta" aria-label="Data nota mobile">
        <label><span>Pelanggan</span><input value={transaction.customerName} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { customerName: event.target.value })} /></label>
        <label><span>Tempat</span><input value={transaction.customerPlace} onChange={(event) => void gateway.updateNotaTransaction(transaction.id, { customerPlace: event.target.value })} /></label>
      </section>
      <div className="mobile-nota-actions">
        <button className="primary-action" disabled={busy} onClick={() => void scan()}><ScanIcon />Scan barcode</button>
        <button className="secondary-action" disabled={busy} onClick={() => setManualOpen((open) => !open)}>Tambah barang tanpa barcode</button>
      </div>
      {manualOpen && <section className="mobile-nota-manual" aria-label="Barang tanpa barcode" style={themeStyle}>
        <div className="mobile-nota-manual__name"><strong aria-label={`Nomor barang ${nextManualLabel}`}>{nextManualLabel}</strong><label><span>Nama barang</span><input aria-label="Nama barang manual" value={manual.description} onChange={(event) => setManual({ ...manual, description: event.target.value })} /></label></div>
        <label><span>Jenis</span><input aria-label="Jenis barang manual" value={manual.kind} onChange={(event) => setManual({ ...manual, kind: event.target.value })} /></label>
        <div><label><span>Jumlah</span><input aria-label="Jumlah barang manual" inputMode="numeric" value={manual.quantity} onChange={(event) => setManual({ ...manual, quantity: event.target.value })} /></label><label><span>Unit</span><select aria-label="Unit barang manual" value={manual.unit} onChange={(event) => setManual({ ...manual, unit: event.target.value as Unit })}><option value="pcs">PCS</option><option value="lsn">LSN</option></select></label></div>
        <label><span>Harga</span><input aria-label="Harga barang manual" inputMode="numeric" value={manual.price} onChange={(event) => setManual({ ...manual, price: event.target.value })} /></label>
        <button className="primary-action" onClick={() => void addManual()}>Simpan barang</button>
      </section>}
      <div className="mobile-nota-pages" aria-label="Bagian nota">{activePages.map((page) => {
        const index = transaction.pages.findIndex((candidate) => candidate.id === page.id);
        const pageTheme = notaPageTheme(index);
        return <button key={page.id} aria-label={`Bagian ${page.suffix}`} aria-pressed={page.id === selectedPage.id} style={{ '--mobile-nota-accent': pageTheme.background, '--mobile-nota-accent-text': pageTheme.foreground } as CSSProperties} onClick={() => setSelectedPageId(page.id)}>{page.suffix}</button>;
      })}<button className="mobile-nota-pages__add" onClick={() => void addPage()}>Tambah Bagian {noteSuffixFromIndex(transaction.nextNoteIndex)}</button></div>
      <section className="mobile-nota-section" style={themeStyle} aria-label={`Isi Bagian ${selectedPage.suffix}`}>
        <header><div><span>BAGIAN</span><strong>{selectedPage.suffix}</strong></div><p>Maksimal 15 nomor</p><b>{formatRupiah(pageTotal)}</b></header>
        <div className="mobile-nota-lines">{selectedPage.lines.map((line, index) => {
          if (!populated(line)) return null;
          const label = `${index + 1}${selectedPage.suffix}`;
          return <article className="mobile-nota-line" key={line.id} role="region" aria-label={`Barang ${label}: ${line.description}`}>
            <span className="mobile-nota-line__number">{label}</span>
            <label><span>Nama barang</span><input aria-label={`Nama barang ${label}`} value={line.description} onChange={(event) => void updateLine(line, { description: event.target.value, skuId: undefined })} /></label>
            <label><span>Jenis</span><input aria-label={`Jenis barang ${label}`} value={line.kind} onChange={(event) => void updateLine(line, { kind: event.target.value })} /></label>
            <div className="mobile-nota-line__numbers"><label><span>Jumlah</span><input aria-label={`Jumlah barang ${label}`} inputMode="numeric" type="number" min="1" value={line.quantity} onChange={(event) => void updateLine(line, { quantity: Number(event.target.value) })} /></label><label><span>Unit</span><select aria-label={`Unit barang ${label}`} value={line.unit} onChange={(event) => void updateLine(line, { unit: event.target.value as Unit })}><option value="pcs">PCS</option><option value="lsn">LSN</option></select></label><label><span>Harga</span><input aria-label={`Harga barang ${label}`} inputMode="numeric" type="number" min="0" value={rowPrice(line)} onChange={(event) => void updateLine(line, line.unit === 'pcs' ? { pcsPrice: Number(event.target.value) } : { lsnPrice: Number(event.target.value) })} /></label></div>
            <footer><strong>{formatRupiah(lineTotal(line))}</strong><button aria-label={`Hapus barang ${label}`} onClick={() => transaction && void gateway.deleteNotaLine(transaction.id, selectedPage.id, line.id)}>Hapus</button></footer>
          </article>;
        })}{!selectedPage.lines.some(populated) && <p className="mobile-nota-empty">Belum ada barang di Bagian {selectedPage.suffix}.</p>}</div>
      </section>
      <footer className="mobile-nota-finish"><div><span>Total transaksi</span><strong>{formatRupiah(transactionTotal)}</strong></div><button className="primary-action" disabled={busy} onClick={() => setCompletionOpen(true)}>Selesaikan nota</button></footer>
    </> : !notice && <p className="mobile-nota-empty">Menyiapkan nota baru…</p>}
    {completionOpen && <div className="mobile-nota-dialog-backdrop"><section role="dialog" aria-modal="true" aria-label="Selesaikan nota mobile?" className="mobile-nota-dialog"><h2>Selesaikan nota mobile?</h2><p>Nota akan disimpan ke Arsip mobile sebagai data demo sesi ini.</p><button className="primary-action" disabled={busy} onClick={() => void complete(false)}>Simpan ke Arsip</button><button className="secondary-action" disabled={busy} onClick={() => void complete(true)}>Simpan dan kirim ke desktop</button><button disabled={busy} onClick={() => setCompletionOpen(false)}>Batal</button></section></div>}
  </section>;
}
