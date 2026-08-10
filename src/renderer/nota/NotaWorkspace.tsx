import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { firstUnpricedNotaLine, lineTotal, noteSuffixFromIndex } from '../../domain/nota';
import { buildNotaDocumentPlan, type NotaPageScope } from '../../domain/output-documents';
import type { NotaCompletionDestination, NotaLine, NotaTransaction, PaymentKind } from '../../domain/types';
import { formatRupiah, formatTitleCaseInput } from '../format';
import { useOperations } from '../operations-context';
import { useOutput } from '../output-context';
import { ConfirmDialog } from './ConfirmDialog';
import { CompleteNotaDialog, type CompletionDialogPhase } from './CompleteNotaDialog';
import { WorkingDrawer } from './NotaDrawers';
import { NewTransactionDialog } from './NewTransactionDialog';
import { NotaGrid, type NotaGridHandle } from './NotaGrid';
import { createNotaVoicePlayer, type NotaVoicePlayer, type NotaVoiceRequest } from './nota-voice';
import { notaPageTheme } from './nota-page-colors';
import { presentSyncStatus } from '../../gateway/sync-presentation';
import { activePage, searchNota, workingTransactions, type NotaSearchResult } from './nota-workspace-utils';
import { useNotaValidation, type InvalidNotaField } from './useNotaValidation';
import './nota-workspace.css';

type Selection = { transactionId: string; pageId: string };
type Confirmation = { transactionId: string; pageId?: string; restoreFocusTo: HTMLElement | null };
type Completion = {
  transactionId: string;
  phase: CompletionDialogPhase;
  destination?: NotaCompletionDestination;
  reason?: string;
  restoreFocusTo: HTMLElement | null;
};
type DrawerKind = 'working' | null;
type TransactionPatch = Partial<Pick<NotaTransaction, 'customerName' | 'customerPlace' | 'transactionDate' | 'payment'>>;
const paymentLabel = (payment: PaymentKind) => ({ unclassified: 'Belum diklasifikasi', cash: 'Kas', transfer: 'Transfer', credit: 'Piutang' })[payment];
const fontScales = [100, 125, 150, 175] as const;

function stepFontScale(value: number, direction: -1 | 1) {
  const index = fontScales.indexOf(value as typeof fontScales[number]);
  return fontScales[Math.max(0, Math.min(fontScales.length - 1, index + direction))] ?? 150;
}

function focusTarget(target: EventTarget | null) {
  return target instanceof HTMLElement ? target : null;
}

export function NotaWorkspace({ coreBacked = false, syncLabel, onBack, initialSelection, onOpenCompletionDestination }: {
  coreBacked?: boolean;
  syncLabel?: string;
  onBack: () => void;
  initialSelection?: Selection;
  onOpenCompletionDestination?: (destination: NotaCompletionDestination) => void;
}) {
  const { state, sync, gateway } = useOperations();
  const coreSyncLabel = syncLabel ?? presentSyncStatus(sync.phase).label;
  const output = useOutput();
  const [selected, setSelected] = useState<Selection>(initialSelection ?? { transactionId: '', pageId: '' });
  const [fontScale, setFontScale] = useState(150);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [message, setMessage] = useState('');
  const [printScope, setPrintScope] = useState<NotaPageScope>('current');
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [drawerRestoreFocus, setDrawerRestoreFocus] = useState<HTMLElement | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newRestoreFocus, setNewRestoreFocus] = useState<HTMLElement | null>(null);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [invalidFocus, setInvalidFocus] = useState<InvalidNotaField | null>(null);
  const busyRef = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchRestoreFocus = useRef<HTMLElement | null>(null);
  const grid = useRef<NotaGridHandle>(null);
  const voicePlayer = useRef<NotaVoicePlayer | null>(null);
  const working = useMemo(() => workingTransactions(state.notaTransactions), [state.notaTransactions]);
  const selectedTransaction = working.find((item) => item.id === selected.transactionId) ?? working[0];
  const page = selectedTransaction && activePage(selectedTransaction, selectedTransaction.id === selected.transactionId ? selected.pageId : undefined);
  const results = useMemo(() => searchNota({ ...state, notaTransactions: working }, query), [state, working, query]);
  const validation = useNotaValidation(state.notaTransactions);

  async function requestDocumentOutput(action: 'print' | 'pdf') {
    if (!selectedTransaction || !page) return;
    setMessage('');
    try {
      const plan = buildNotaDocumentPlan(
        selectedTransaction,
        state.invoiceTemplate,
        { kind: 'nota', scope: printScope, currentPageId: page.id },
      );
      const result = action === 'print'
        ? await output.print(plan)
        : await output.savePdf(plan);
      setMessage(
        result.status === 'cancelled'
          ? 'Penyimpanan PDF dibatalkan.'
          : action === 'print'
            ? 'Dialog print Nota dibuka.'
            : 'PDF Nota tersimpan.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Output Nota gagal dibuat.');
    }
  }

  useEffect(() => {
    if (selectedTransaction && page && (selected.transactionId !== selectedTransaction.id || selected.pageId !== page.id)) setSelected({ transactionId: selectedTransaction.id, pageId: page.id });
    if (!selectedTransaction && (selected.transactionId || selected.pageId)) setSelected({ transactionId: '', pageId: '' });
  }, [page, selected, selectedTransaction]);
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
        setFontScale((value) => event.key === '+' || event.key === '=' ? stepFontScale(value, 1) : event.key === '-' ? stepFontScale(value, -1) : 150);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        void requestDocumentOutput('print');
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [output, page, printScope, selectedTransaction, state.invoiceTemplate]);
  useEffect(() => {
    const player = createNotaVoicePlayer({ onPlaybackError: () => setMessage('Suara nota tidak dapat diputar.') });
    voicePlayer.current = player;
    return () => {
      player.dispose();
      if (voicePlayer.current === player) voicePlayer.current = null;
    };
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
  const saveEdit = (operation: () => Promise<unknown>, fallback = 'Perubahan nota tidak dapat disimpan.') => {
    setMessage('');
    try {
      void operation().catch((error) => {
        setMessage(error instanceof Error && error.message ? error.message : fallback);
      });
    } catch (error) {
      setMessage(error instanceof Error && error.message ? error.message : fallback);
    }
  };
  const choose = (choice: Selection) => { setSelected(choice); setDrawer(null); setQuery(''); setHighlight(0); };
  const selectPage = (choice: Selection) => choose(choice);
  const openDrawer = (kind: Exclude<DrawerKind, null>, target: EventTarget | null) => {
    setDrawerRestoreFocus(focusTarget(target));
    setDrawer(kind);
  };
  const openNew = (target: EventTarget | null) => { setNewRestoreFocus(focusTarget(target)); setNewOpen(true); };
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
  const requestCancel = (transactionId: string, restoreFocusTo: HTMLElement | null, pageId?: string) => setConfirm({ transactionId, pageId, restoreFocusTo });
  const requestComplete = (target: EventTarget | null) => {
    if (!selectedTransaction) return;
    const invalid = validation.firstInvalid(selectedTransaction);
    if (invalid) {
      setMessage('Perbaiki nilai angka: jumlah harus bilangan bulat positif dan harga harus bilangan bulat nol atau lebih.');
      setSelected({ transactionId: invalid.transactionId, pageId: invalid.pageId });
      setInvalidFocus(invalid);
      return;
    }
    const unpriced = firstUnpricedNotaLine(selectedTransaction);
    if (unpriced) {
      setMessage('Harga jual setiap barang harus lebih dari Rp0.');
      setSelected({ transactionId: selectedTransaction.id, pageId: unpriced.pageId });
      setInvalidFocus({
        transactionId: selectedTransaction.id,
        pageId: unpriced.pageId,
        lineId: unpriced.lineId,
        field: unpriced.field,
        rawValue: '0',
      });
      return;
    }
    setCompletion({ transactionId: selectedTransaction.id, phase: 'choice', restoreFocusTo: focusTarget(target) });
  };
  const complete = async (destination: NotaCompletionDestination) => {
    const pending = completion;
    if (!pending || busyRef.current) return;
    const transaction = gateway.getSnapshot().notaTransactions.find((item) => item.id === pending.transactionId);
    if (!transaction) {
      setCompletion({ ...pending, phase: 'error', destination, reason: 'Nota yang dikonfirmasi sudah tidak tersedia. Tidak ada perubahan dibuat.' });
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setMessage('');
    setCompletion({ ...pending, phase: 'saving', destination, reason: undefined });
    try {
      await gateway.flushNota(pending.transactionId);
      await gateway.completeNotaTransaction(pending.transactionId, destination);
      const completed = gateway.getSnapshot().notaTransactions.find((item) => item.id === pending.transactionId);
      if (completed?.status !== 'completed' || (completed.completionDestination ?? 'archive') !== destination) throw new Error('Nota tidak dapat disimpan ke tujuan yang dipilih.');
      setCompletion({ ...pending, phase: 'success', destination });
    } catch (error) {
      setCompletion({ ...pending, phase: 'error', destination, reason: error instanceof Error && error.message ? error.message : 'Nota tidak dapat disimpan.' });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const updateTransaction = (transactionId: string, patch: TransactionPatch) => {
    const transaction = gateway.getSnapshot().notaTransactions.find((item) => item.id === transactionId);
    if (!transaction) return;
    const keys = (Object.keys(patch) as Array<keyof TransactionPatch>).sort();
    if (!keys.some((key) => transaction[key] !== patch[key])) return;
    saveEdit(() => gateway.updateNotaTransaction(transactionId, patch));
  };
  const updateLine = (transactionId: string, pageId: string, lineId: string, patch: Partial<NotaLine>) => {
    const line = gateway.getSnapshot().notaTransactions.find((item) => item.id === transactionId)?.pages.find((item) => item.id === pageId)?.lines.find((item) => item.id === lineId);
    if (!line) return;
    const keys = (Object.keys(patch) as Array<keyof NotaLine>).sort();
    if (!keys.some((key) => line[key] !== patch[key])) return;
    saveEdit(() => gateway.updateNotaLine(transactionId, pageId, lineId, patch));
  };
  const deleteLine = (transactionId: string, pageId: string, lineId: string) => {
    void run(() => gateway.deleteNotaLine(transactionId, pageId, lineId));
  };
  const speakLine = (request: NotaVoiceRequest) => {
    if (voiceEnabled) voicePlayer.current?.speak(request);
  };
  const toggleVoice = () => {
    setVoiceEnabled((enabled) => {
      if (enabled) voicePlayer.current?.cancel();
      return !enabled;
    });
  };
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
    const result = await run(async () => {
      await gateway.flushNota(pending.transactionId);
      await gateway.cancelNotaTransaction(pending.transactionId);
    }, 'Transaksi tidak dapat dibatalkan.');
    const cancelled = gateway.getSnapshot().notaTransactions.find((item) => item.id === pending.transactionId);
    if (result.ok && cancelled?.status !== 'cancelled') setMessage('Transaksi tidak dapat dibatalkan.');
    setConfirm(null);
  };
  const activePages = selectedTransaction?.pages.filter((item) => item.status === 'active') ?? [];
  const total = activePages.flatMap((item) => item.lines).reduce((sum, line) => sum + lineTotal(line), 0);
  const editable = Boolean(selectedTransaction && ['draft', 'reopened'].includes(selectedTransaction.status));
  const lifecycleBlocked = Boolean(
    selectedTransaction &&
    sync.phase === 'offline' &&
    gateway.isNotaLifecycleOnlineOnly(selectedTransaction.id),
  );
  const pageIndex = selectedTransaction && page ? selectedTransaction.pages.findIndex((item) => item.id === page.id) : 0;
  const pageTheme = notaPageTheme(pageIndex);
  const themeStyle = { '--nota-page-color': pageTheme.background, '--nota-page-text': pageTheme.foreground } as CSSProperties;

  return <main className="chu-nota-workspace" data-testid="chu-nota-workspace" aria-busy={busy || undefined} style={{ '--nota-font-scale': fontScale / 100 } as CSSProperties}>
    <header className="chu-nota-workspace__toolbar">
      <button className="chu-nota-workspace__back" onClick={onBack}>Kembali ke CH Ultimate</button>
      <strong className="chu-nota-workspace__wordmark">CHU</strong>
      <button className="chu-nota-workspace__section" onClick={(event) => openDrawer('working', event.currentTarget)}>Nota Dikerjakan</button>
      <div className="chu-nota-workspace__search"><input ref={searchInput} aria-label="Cari nota" role="combobox" aria-expanded={Boolean(query)} aria-controls="nota-search-results" aria-activedescendant={query && results[highlight] ? `nota-search-result-${results[highlight]!.transaction.id}-${results[highlight]!.page.id}` : undefined} value={query} placeholder="Cari nota" onChange={(event) => { setQuery(event.target.value); setHighlight(0); }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((value) => Math.min(Math.max(0, results.length - 1), value + 1)); } else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((value) => Math.max(0, value - 1)); } else if (event.key === 'Enter') { event.preventDefault(); const result = results[highlight]; if (result) openSearchResult(result); } else if (event.key === 'Escape') { event.preventDefault(); clearSearch(true); } }} />{query && <div id="nota-search-results" role="listbox" aria-label="Hasil pencarian nota">{results.map((result, index) => <div id={`nota-search-result-${result.transaction.id}-${result.page.id}`} role="option" aria-selected={highlight === index} key={`${result.transaction.id}-${result.page.id}`} onMouseDown={(event) => event.preventDefault()} onClick={() => openSearchResult(result)}>{result.label}</div>)}{!results.length && <span>Tidak ada nota yang cocok.</span>}</div>}</div>
      <div className="chu-nota-workspace__zoom" aria-label="Ukuran tulisan"><button aria-label="Perkecil tulisan" disabled={fontScale === 100} onClick={() => setFontScale((value) => stepFontScale(value, -1))}>−</button><button aria-label={`Ukuran tulisan ${fontScale}%`} onClick={() => setFontScale(150)}>{fontScale}%</button><button aria-label="Perbesar tulisan" disabled={fontScale === 175} onClick={() => setFontScale((value) => stepFontScale(value, 1))}>+</button></div>
      <div className="chu-nota-workspace__voice-controls"><button aria-pressed={voiceEnabled} onClick={toggleVoice}>{voiceEnabled ? 'Suara aktif' : 'Suara nonaktif'}</button><button disabled={!voiceEnabled} onClick={() => voicePlayer.current?.test()}>Tes suara</button></div>
      <span className="chu-nota-workspace__demo">{coreBacked ? `CH CORE · ${coreSyncLabel.toUpperCase()}` : 'DEMO DATA · SESSION ONLY'}</span>
      <button disabled={busy} className="chu-nota-workspace__new" onClick={(event) => openNew(event.currentTarget)}>Transaksi Baru</button>
    </header>
    {busy && <p className="chu-nota-workspace__notice chu-nota-workspace__busy" role="status" aria-label="Operasi nota sedang diproses">Sedang memproses…</p>}
    {message && <p className="chu-nota-workspace__notice" role="status">{message}</p>}
    {selectedTransaction && page ? <>
      <section className="chu-nota-workspace__page-tabs" aria-label="Halaman aktif">
        {activePages.map((item) => { const theme = notaPageTheme(selectedTransaction.pages.findIndex((candidate) => candidate.id === item.id)); return <button style={{ '--nota-page-color': theme.background, '--nota-page-text': theme.foreground } as CSSProperties} disabled={busy} key={item.id} aria-label={`Halaman ${item.suffix}`} aria-pressed={item.id === page.id} onClick={() => selectPage({ transactionId: selectedTransaction.id, pageId: item.id })}>Nota {item.suffix}</button>; })}
        {editable && <><button aria-label={`Tambah Nota ${noteSuffixFromIndex(selectedTransaction.nextNoteIndex)}`} disabled={busy} onClick={() => void addPage(selectedTransaction.id)}>+ Tambah Nota {noteSuffixFromIndex(selectedTransaction.nextNoteIndex)}</button><button aria-label={`Batalkan halaman ${page.suffix}`} disabled={busy || selectedTransaction.pages.filter((item) => item.status === 'active').length < 2} title={selectedTransaction.pages.filter((item) => item.status === 'active').length < 2 ? 'Minimal satu halaman aktif harus tersisa.' : undefined} onClick={() => void cancelPage({ transactionId: selectedTransaction.id, pageId: page.id })}>Batalkan halaman</button></>}
      </section>
      <section className="chu-nota-workspace__page-totals" aria-label="Total per nota">{activePages.map((item) => { const theme = notaPageTheme(selectedTransaction.pages.findIndex((candidate) => candidate.id === item.id)); return <div key={item.id} data-testid={`nota-page-total-${item.suffix}`} aria-current={item.id === page.id ? 'true' : undefined} style={{ '--nota-page-color': theme.background } as CSSProperties}><span>Total Nota {item.suffix}</span><strong>{formatRupiah(item.lines.reduce((sum, line) => sum + lineTotal(line), 0))}</strong></div>; })}</section>
      <section className="chu-nota-workspace__meta" aria-label="Metadata nota"><div className="chu-nota-workspace__number" style={themeStyle}><span>NOTA DIBUAT</span><strong>{page.suffix}</strong><b>{selectedTransaction.baseNumber}{page.suffix}</b></div><label className="chu-nota-workspace__customer"><span>Pelanggan</span><input disabled={!editable || busy} value={selectedTransaction.customerName} onChange={(event) => updateTransaction(selectedTransaction.id, { customerName: formatTitleCaseInput(event.currentTarget) })} /></label><label className="chu-nota-workspace__customer"><span>Tempat</span><input disabled={!editable || busy} value={selectedTransaction.customerPlace} onChange={(event) => updateTransaction(selectedTransaction.id, { customerPlace: formatTitleCaseInput(event.currentTarget) })} /></label><label><span>Tanggal</span><input disabled={!editable || busy} type="date" value={selectedTransaction.transactionDate} onChange={(event) => updateTransaction(selectedTransaction.id, { transactionDate: event.target.value })} /></label><label><span>Pembayaran</span><select disabled={!editable || busy} value={selectedTransaction.payment} onChange={(event) => updateTransaction(selectedTransaction.id, { payment: event.target.value as PaymentKind })}><option value="unclassified">Belum diklasifikasi</option><option value="cash">Kas</option><option value="transfer">Transfer</option><option value="credit">Piutang</option></select></label><div className="chu-nota-workspace__meta-total"><span>TOTAL SEMUA HALAMAN AKTIF</span><strong data-testid="nota-transaction-total">{formatRupiah(total)}</strong><small>{paymentLabel(selectedTransaction.payment)}</small></div></section>
      <NotaGrid ref={grid} lines={page.lines} suffix={page.suffix} skus={state.skus} editable={editable} busy={busy} invalidValues={validation.valuesForPage(selectedTransaction.id, page.id)} onInvalidChange={(lineId, field, rawValue) => validation.report({ transactionId: selectedTransaction.id, pageId: page.id, lineId, field }, rawValue)} onUpdate={(line, patch) => updateLine(selectedTransaction.id, page.id, line.id, patch)} onDelete={(line) => deleteLine(selectedTransaction.id, page.id, line.id)} onLineCommitted={speakLine} />
      <footer className="chu-nota-workspace__footer"><div><span>TOTAL TRANSAKSI</span><strong>{formatRupiah(total)}</strong></div><label><span>Ruang cetak</span><select aria-label="Ruang cetak Nota" value={printScope} onChange={(event) => setPrintScope(event.target.value as NotaPageScope)}><option value="current">Halaman aktif saat ini</option><option value="all">Semua halaman aktif</option></select></label><button disabled={busy || output.busy} aria-label="Simpan PDF Nota" onClick={() => void requestDocumentOutput('pdf')}>Simpan PDF</button><button disabled={busy || output.busy} aria-label="Print Nota" onClick={() => void requestDocumentOutput('print')}>Print Nota</button>{editable && <div className="chu-nota-workspace__lifecycle"><button disabled={busy || lifecycleBlocked} title={lifecycleBlocked ? 'Hubungkan CH Core untuk mengubah lifecycle transaksi.' : undefined} onClick={(event) => requestCancel(selectedTransaction.id, event.currentTarget, page.id)}>Batalkan transaksi</button><button disabled={busy || lifecycleBlocked} title={lifecycleBlocked ? 'Hubungkan CH Core untuk menyelesaikan transaksi.' : undefined} className="chu-nota-workspace__complete" aria-label="Selesaikan nota" onClick={(event) => requestComplete(event.currentTarget)}>Selesaikan nota</button></div>}</footer>
    </> : <section className="chu-nota-workspace__empty"><p>Belum ada nota yang sedang dikerjakan pada sesi ini.</p><button onClick={(event) => openNew(event.currentTarget)}>Transaksi Baru</button></section>}
    {drawer === 'working' && <WorkingDrawer transactions={state.notaTransactions} selected={selected} onClose={() => setDrawer(null)} onSelect={choose} onAdd={(id) => void addPage(id)} onCancelPage={(choice) => void cancelPage(choice)} onCancelTransaction={(id, target) => requestCancel(id, target)} transactionLifecycleBlocked={(id) => sync.phase === 'offline' && gateway.isNotaLifecycleOnlineOnly(id)} restoreFocusTo={drawerRestoreFocus} busy={busy} />}
    <NewTransactionDialog open={newOpen} onClose={() => setNewOpen(false)} onCreate={(input) => void create(input)} restoreFocusTo={newRestoreFocus} busy={busy} />
    <ConfirmDialog open={confirm !== null} title="Batalkan transaksi?" confirmLabel="Batalkan" onCancel={() => setConfirm(null)} onConfirm={() => void confirmAction()} restoreFocusTo={confirm?.restoreFocusTo ?? null} busy={busy}>Transaksi akan dipindahkan ke Sampah.</ConfirmDialog>
    <CompleteNotaDialog
      open={completion !== null}
      phase={completion?.phase ?? 'choice'}
      destination={completion?.destination}
      reason={completion?.reason}
      restoreFocusTo={completion?.restoreFocusTo ?? null}
      onChoose={(destination) => void complete(destination)}
      onRetry={() => completion?.destination && void complete(completion.destination)}
      onClose={() => setCompletion(null)}
      pendingCentral={gateway.getSyncSnapshot().phase === 'offline'}
      coreBacked={coreBacked}
      onOpenDestination={(destination) => {
        setCompletion(null);
        onOpenCompletionDestination?.(destination);
      }}
    />
  </main>;
}
