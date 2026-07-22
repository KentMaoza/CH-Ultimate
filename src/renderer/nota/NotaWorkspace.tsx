import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { lineTotal, noteSuffixFromIndex } from '../../domain/nota';
import type { PaymentKind } from '../../domain/types';
import { formatRupiah } from '../format';
import { useOperations } from '../operations-context';
import { ConfirmDialog } from './ConfirmDialog';
import { WorkingDrawer } from './NotaDrawers';
import { NewTransactionDialog } from './NewTransactionDialog';
import { NotaGrid, type NotaGridHandle } from './NotaGrid';
import { notaPageTheme } from './nota-page-colors';
import { activePage, searchNota, workingTransactions, type NotaSearchResult } from './nota-workspace-utils';
import { useNotaValidation, type InvalidNotaField } from './useNotaValidation';
import './nota-workspace.css';

type Selection = { transactionId: string; pageId: string };
type ConfirmKind = 'complete' | 'cancel';
type Confirmation = { kind: ConfirmKind; transactionId: string; pageId?: string; restoreFocusTo: HTMLElement | null };
type DrawerKind = 'working' | null;
const paymentLabel = (payment: PaymentKind) => ({ unclassified: 'Belum diklasifikasi', cash: 'Kas', transfer: 'Transfer', credit: 'Piutang' })[payment];

function focusTarget(target: EventTarget | null) {
  return target instanceof HTMLElement ? target : null;
}

export function NotaWorkspace({ onBack, initialSelection }: { onBack: () => void; initialSelection?: Selection }) {
  const { state, gateway } = useOperations();
  const [selected, setSelected] = useState<Selection>(initialSelection ?? { transactionId: '', pageId: '' });
  const [fontScale, setFontScale] = useState(125);
  const [message, setMessage] = useState('');
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [drawerRestoreFocus, setDrawerRestoreFocus] = useState<HTMLElement | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newRestoreFocus, setNewRestoreFocus] = useState<HTMLElement | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [undo, setUndo] = useState<{ label: string; action: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [invalidFocus, setInvalidFocus] = useState<InvalidNotaField | null>(null);
  const busyRef = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchRestoreFocus = useRef<HTMLElement | null>(null);
  const grid = useRef<NotaGridHandle>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const working = useMemo(() => workingTransactions(state.notaTransactions), [state.notaTransactions]);
  const selectedTransaction = working.find((item) => item.id === selected.transactionId) ?? working[0];
  const page = selectedTransaction && activePage(selectedTransaction, selectedTransaction.id === selected.transactionId ? selected.pageId : undefined);
  const results = useMemo(() => searchNota({ ...state, notaTransactions: working }, query), [state, working, query]);
  const validation = useNotaValidation(state.notaTransactions);

  useEffect(() => {
    if (selectedTransaction && page && (selected.transactionId !== selectedTransaction.id || selected.pageId !== page.id)) setSelected({ transactionId: selectedTransaction.id, pageId: page.id });
    if (!selectedTransaction && (selected.transactionId || selected.pageId)) setSelected({ transactionId: '', pageId: '' });
  }, [page, selected, selectedTransaction]);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  useEffect(() => {
    if (!invalidFocus || page?.id !== invalidFocus.pageId) return;
    grid.current?.focusField(invalidFocus.lineId, invalidFocus.field);
    setInvalidFocus(null);
  }, [invalidFocus, page?.id]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const editing = event.target instanceof Element && event.target.closest('input, textarea, select, [data-grid-editable], [role="dialog"]');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !editing) {
        event.preventDefault();
        if (document.activeElement !== searchInput.current) searchRestoreFocus.current = focusTarget(event.target) ?? focusTarget(document.activeElement);
        searchInput.current?.focus();
      }
      if ((event.ctrlKey || event.metaKey) && ['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault();
        setFontScale((value) => event.key === '+' || event.key === '=' ? value === 100 ? 125 : 150 : event.key === '-' ? value === 150 ? 125 : 100 : 125);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const run = async <T,>(operation: () => Promise<T>, fallback = 'Perubahan nota tidak dapat disimpan.') => {
    if (busyRef.current) return { ok: false as const };
    setMessage('');
    let settled = false;
    let showingBusy = false;
    let promise: Promise<T>;
    try {
      promise = operation();
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : fallback);
      return { ok: false as const };
    }
    void promise.then(() => { settled = true; }, () => { settled = true; });
    queueMicrotask(() => {
      if (settled) return;
      showingBusy = true;
      busyRef.current = true;
      setBusy(true);
    });
    try {
      return { ok: true as const, value: await promise };
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : fallback);
      return { ok: false as const };
    } finally {
      if (showingBusy) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  };
  const choose = (choice: Selection) => { setSelected(choice); setDrawer(null); setQuery(''); setHighlight(0); };
  const selectPage = (choice: Selection) => choose(choice);
  const openDrawer = (kind: Exclude<DrawerKind, null>, target: EventTarget | null) => {
    setDrawerRestoreFocus(focusTarget(target));
    setDrawer(kind);
  };
  const openNew = (target: EventTarget | null) => { setNewRestoreFocus(focusTarget(target)); setNewOpen(true); };
  const showUndo = (label: string, action: () => Promise<void>) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ label, action });
    undoTimer.current = setTimeout(() => setUndo(null), 10_000);
  };
  const restoreUndo = async () => {
    if (!undo) return;
    const result = await run(undo.action, 'Pembatalan tidak dapat dipulihkan.');
    if (!result.ok) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(null);
  };
  const cancelPage = async (choice: Selection) => {
    const transaction = state.notaTransactions.find((item) => item.id === choice.transactionId);
    const pageToCancel = transaction?.pages.find((item) => item.id === choice.pageId);
    if (!pageToCancel) { setMessage('Halaman nota sudah tidak tersedia.'); return; }
    const result = await run(() => gateway.cancelNotaPage(choice.transactionId, choice.pageId), 'Halaman nota tidak dapat dibatalkan.');
    const cancelled = gateway.getSnapshot().notaTransactions.find((item) => item.id === choice.transactionId)?.pages.find((item) => item.id === choice.pageId);
    if (!result.ok || cancelled?.status !== 'cancelled') {
      if (result.ok) setMessage('Halaman nota tidak dapat dibatalkan.');
      return;
    }
    showUndo(`Halaman ${pageToCancel.suffix} dipindahkan ke Sampah.`, () => gateway.restoreNotaPage(choice.transactionId, choice.pageId));
  };
  const addPage = async (transactionId: string) => {
    const result = await run(() => gateway.addNotaPage(transactionId), 'Nota tambahan tidak dapat dibuat.');
    if (!result.ok) return;
    if (!result.value) { setMessage('Nota tambahan tidak dapat dibuat.'); return; }
    choose({ transactionId, pageId: result.value.id });
  };
  const create = async (input: { customerName: string; customerPlace: string; transactionDate: string }) => {
    const result = await run(async () => {
      const transaction = await gateway.createNotaTransaction();
      await gateway.updateNotaTransaction(transaction.id, { ...input, payment: 'unclassified' });
      return transaction;
    }, 'Transaksi baru tidak dapat dibuat.');
    if (!result.ok) return;
    setNewOpen(false);
    choose({ transactionId: result.value.id, pageId: result.value.pages[0]!.id });
    window.setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="Nama barang baris 1"]')?.focus(), 0);
  };
  const requestConfirm = (kind: ConfirmKind, transactionId: string, restoreFocusTo: HTMLElement | null, pageId?: string) => setConfirm({ kind, transactionId, pageId, restoreFocusTo });
  const requestComplete = (target: EventTarget | null) => {
    if (!selectedTransaction) return;
    const invalid = validation.firstInvalid(selectedTransaction);
    if (invalid) {
      setMessage('Perbaiki nilai angka: jumlah harus bilangan bulat positif dan harga harus bilangan bulat nol atau lebih.');
      setSelected({ transactionId: invalid.transactionId, pageId: invalid.pageId });
      setInvalidFocus(invalid);
      return;
    }
    requestConfirm('complete', selectedTransaction.id, focusTarget(target), page?.id);
  };
  const complete = async (transactionId: string) => {
    const result = await run(() => gateway.completeNotaTransaction(transactionId), 'Nota tidak dapat diselesaikan.');
    const transaction = gateway.getSnapshot().notaTransactions.find((item) => item.id === transactionId);
    if (!result.ok || transaction?.status !== 'completed') {
      if (result.ok) setMessage('Nota tidak dapat diselesaikan.');
      return false;
    }
    setMessage('Nota selesai dan stok demo diperbarui.');
    return true;
  };
  const updateTransaction = (transactionId: string, patch: Parameters<typeof gateway.updateNotaTransaction>[1]) => { void run(() => gateway.updateNotaTransaction(transactionId, patch)); };
  const updateLine = (transactionId: string, pageId: string, lineId: string, patch: Parameters<typeof gateway.updateNotaLine>[3]) => { void run(() => gateway.updateNotaLine(transactionId, pageId, lineId, patch)); };
  const deleteLine = (transactionId: string, pageId: string, lineId: string) => { void run(() => gateway.deleteNotaLine(transactionId, pageId, lineId)); };
  const openSearchResult = (result: NotaSearchResult) => {
    choose({ transactionId: result.transaction.id, pageId: result.page.id });
  };
  const clearSearch = (restoreFocus = false) => {
    setQuery('');
    setHighlight(0);
    if (restoreFocus) searchRestoreFocus.current?.focus();
  };
  const confirmAction = async () => {
    const pending = confirm;
    if (!pending) return;
    const transaction = gateway.getSnapshot().notaTransactions.find((item) => item.id === pending.transactionId);
    if (!transaction) {
      setConfirm(null);
      setMessage('Nota yang dikonfirmasi sudah tidak tersedia. Tidak ada perubahan dibuat.');
      return;
    }
    if (pending.kind === 'complete') await complete(pending.transactionId);
    if (pending.kind === 'cancel') {
      const result = await run(() => gateway.cancelNotaTransaction(pending.transactionId), 'Transaksi tidak dapat dibatalkan.');
      const cancelled = gateway.getSnapshot().notaTransactions.find((item) => item.id === pending.transactionId);
      if (result.ok && cancelled?.status === 'cancelled') {
        showUndo('Transaksi dipindahkan ke Sampah.', () => gateway.restoreNotaTransaction(pending.transactionId));
      } else if (result.ok) setMessage('Transaksi tidak dapat dibatalkan.');
    }
    setConfirm(null);
  };
  const total = selectedTransaction ? selectedTransaction.pages.filter((item) => item.status === 'active').flatMap((item) => item.lines).reduce((sum, line) => sum + lineTotal(line), 0) : 0;
  const editable = Boolean(selectedTransaction && ['draft', 'reopened'].includes(selectedTransaction.status));
  const pageIndex = selectedTransaction && page ? selectedTransaction.pages.findIndex((item) => item.id === page.id) : 0;
  const pageTheme = notaPageTheme(pageIndex);
  const themeStyle = { '--nota-page-color': pageTheme.background, '--nota-page-text': pageTheme.foreground } as CSSProperties;
  const confirmTitle = confirm?.kind === 'complete' ? 'Selesaikan nota?' : 'Batalkan transaksi?';

  return <main className="chu-nota-workspace" data-testid="chu-nota-workspace" aria-busy={busy || undefined} style={{ '--nota-font-scale': fontScale / 100 } as CSSProperties}>
    <header className="chu-nota-workspace__toolbar">
      <button className="chu-nota-workspace__back" onClick={onBack}>Kembali ke CH Ultimate</button>
      <strong className="chu-nota-workspace__wordmark">CHU</strong>
      <button className="chu-nota-workspace__section" onClick={(event) => openDrawer('working', event.currentTarget)}>Nota Dikerjakan</button>
      <div className="chu-nota-workspace__search"><input ref={searchInput} aria-label="Cari nota" role="combobox" aria-expanded={Boolean(query)} aria-controls="nota-search-results" aria-activedescendant={query && results[highlight] ? `nota-search-result-${results[highlight]!.transaction.id}-${results[highlight]!.page.id}` : undefined} value={query} placeholder="Cari nota" onChange={(event) => { setQuery(event.target.value); setHighlight(0); }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((value) => Math.min(Math.max(0, results.length - 1), value + 1)); } else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((value) => Math.max(0, value - 1)); } else if (event.key === 'Enter') { event.preventDefault(); const result = results[highlight]; if (result) openSearchResult(result); } else if (event.key === 'Escape') { event.preventDefault(); clearSearch(true); } }} />{query && <div id="nota-search-results" role="listbox" aria-label="Hasil pencarian nota">{results.map((result, index) => <div id={`nota-search-result-${result.transaction.id}-${result.page.id}`} role="option" aria-selected={highlight === index} key={`${result.transaction.id}-${result.page.id}`} onMouseDown={(event) => event.preventDefault()} onClick={() => openSearchResult(result)}>{result.label}</div>)}{!results.length && <span>Tidak ada nota yang cocok.</span>}</div>}</div>
      <div className="chu-nota-workspace__zoom" aria-label="Ukuran tulisan"><button aria-label="Perkecil tulisan" disabled={fontScale === 100} onClick={() => setFontScale((value) => value === 150 ? 125 : 100)}>−</button><button aria-label={`Ukuran tulisan ${fontScale}%`} onClick={() => setFontScale(125)}>{fontScale}%</button><button aria-label="Perbesar tulisan" disabled={fontScale === 150} onClick={() => setFontScale((value) => value === 100 ? 125 : 150)}>+</button></div>
      <span className="chu-nota-workspace__demo">DEMO DATA · SESSION ONLY</span>
      <button disabled={busy} className="chu-nota-workspace__new" onClick={(event) => openNew(event.currentTarget)}>Transaksi Baru</button>
    </header>
    {busy && <p className="chu-nota-workspace__notice chu-nota-workspace__busy" role="status" aria-label="Operasi nota sedang diproses">Sedang memproses…</p>}
    {undo && <p className="chu-nota-workspace__notice" role="status">{undo.label} <button disabled={busy} onClick={() => void restoreUndo()}>Urungkan</button></p>}
    {message && <p className="chu-nota-workspace__notice" role="status">{message}</p>}
    {selectedTransaction && page ? <>
      <section className="chu-nota-workspace__page-tabs" aria-label="Halaman aktif">
        {selectedTransaction.pages.filter((item) => item.status === 'active').map((item) => { const theme = notaPageTheme(selectedTransaction.pages.findIndex((candidate) => candidate.id === item.id)); return <button style={{ '--nota-page-color': theme.background, '--nota-page-text': theme.foreground } as CSSProperties} disabled={busy} key={item.id} aria-label={`Halaman ${item.suffix}`} aria-pressed={item.id === page.id} onClick={() => selectPage({ transactionId: selectedTransaction.id, pageId: item.id })}>Nota {item.suffix}</button>; })}
        {editable && <><button aria-label={`Tambah Nota ${noteSuffixFromIndex(selectedTransaction.nextNoteIndex)}`} disabled={busy} onClick={() => void addPage(selectedTransaction.id)}>+ Tambah Nota {noteSuffixFromIndex(selectedTransaction.nextNoteIndex)}</button><button aria-label={`Batalkan halaman ${page.suffix}`} disabled={busy || selectedTransaction.pages.filter((item) => item.status === 'active').length < 2} title={selectedTransaction.pages.filter((item) => item.status === 'active').length < 2 ? 'Minimal satu halaman aktif harus tersisa.' : undefined} onClick={() => void cancelPage({ transactionId: selectedTransaction.id, pageId: page.id })}>Batalkan halaman</button></>}
      </section>
      <section className="chu-nota-workspace__meta" aria-label="Metadata nota"><div className="chu-nota-workspace__number" style={themeStyle}><span>NOTA DIBUAT</span><strong>{page.suffix}</strong><b>{selectedTransaction.baseNumber}{page.suffix}</b></div><label><span>Pelanggan</span><input disabled={!editable || busy} value={selectedTransaction.customerName} onChange={(event) => updateTransaction(selectedTransaction.id, { customerName: event.target.value })} /></label><label><span>Tempat</span><input disabled={!editable || busy} value={selectedTransaction.customerPlace} onChange={(event) => updateTransaction(selectedTransaction.id, { customerPlace: event.target.value })} /></label><label><span>Tanggal</span><input disabled={!editable || busy} type="date" value={selectedTransaction.transactionDate} onChange={(event) => updateTransaction(selectedTransaction.id, { transactionDate: event.target.value })} /></label><label><span>Pembayaran</span><select disabled={!editable || busy} value={selectedTransaction.payment} onChange={(event) => updateTransaction(selectedTransaction.id, { payment: event.target.value as PaymentKind })}><option value="unclassified">Belum diklasifikasi</option><option value="cash">Kas</option><option value="transfer">Transfer</option><option value="credit">Piutang</option></select></label><div className="chu-nota-workspace__meta-total"><span>TOTAL SEMUA HALAMAN AKTIF</span><strong data-testid="nota-transaction-total">{formatRupiah(total)}</strong><small>{paymentLabel(selectedTransaction.payment)}</small></div></section>
      <NotaGrid ref={grid} lines={page.lines} suffix={page.suffix} skus={state.skus} editable={editable} busy={busy} invalidValues={validation.valuesForPage(selectedTransaction.id, page.id)} onInvalidChange={(lineId, field, rawValue) => validation.report({ transactionId: selectedTransaction.id, pageId: page.id, lineId, field }, rawValue)} onUpdate={(line, patch) => updateLine(selectedTransaction.id, page.id, line.id, patch)} onDelete={(line) => deleteLine(selectedTransaction.id, page.id, line.id)} />
      <footer className="chu-nota-workspace__footer"><div><span>TOTAL TRANSAKSI</span><strong>{formatRupiah(total)}</strong></div><label><span>Ruang cetak</span><select disabled><option>Semua halaman aktif (segera hadir)</option></select></label><p>Printing produksi belum tersedia pada demo sesi ini.</p><button disabled aria-label="Print Nota">Print Nota</button>{editable && <div className="chu-nota-workspace__lifecycle"><button disabled={busy} onClick={(event) => requestConfirm('cancel', selectedTransaction.id, event.currentTarget, page.id)}>Batalkan transaksi</button><button disabled={busy} className="chu-nota-workspace__complete" aria-label="Selesaikan nota" onClick={(event) => requestComplete(event.currentTarget)}>Selesaikan nota</button></div>}</footer>
    </> : <section className="chu-nota-workspace__empty"><p>Belum ada nota yang sedang dikerjakan pada sesi ini.</p><button onClick={(event) => openNew(event.currentTarget)}>Transaksi Baru</button></section>}
    {drawer === 'working' && <WorkingDrawer transactions={state.notaTransactions} selected={selected} onClose={() => setDrawer(null)} onSelect={choose} onAdd={(id) => void addPage(id)} onCancelPage={(choice) => void cancelPage(choice)} onCancelTransaction={(id, target) => requestConfirm('cancel', id, target)} restoreFocusTo={drawerRestoreFocus} busy={busy} />}
    <NewTransactionDialog open={newOpen} onClose={() => setNewOpen(false)} onCreate={(input) => void create(input)} restoreFocusTo={newRestoreFocus} busy={busy} />
    <ConfirmDialog open={confirm !== null} title={confirmTitle} confirmLabel={confirm?.kind === 'complete' ? 'Selesaikan' : 'Batalkan'} onCancel={() => setConfirm(null)} onConfirm={() => void confirmAction()} restoreFocusTo={confirm?.restoreFocusTo ?? null} busy={busy}>{confirm?.kind === 'complete' ? 'Stok demo akan diperbarui berdasarkan baris SKU yang terlacak.' : 'Transaksi akan dipindahkan ke Sampah.'}</ConfirmDialog>
  </main>;
}
