import { useEffect, useMemo, useRef, useState } from 'react';
import { lineTotal } from '../../domain/nota';
import type { PaymentKind } from '../../domain/types';
import { formatRupiah } from '../format';
import { useOperations } from '../operations-context';
import { ConfirmDialog } from './ConfirmDialog';
import { ListDrawer, WorkingDrawer } from './NotaDrawers';
import { NewTransactionDialog } from './NewTransactionDialog';
import { NotaGrid, type NotaGridHandle } from './NotaGrid';
import { activePage, searchNota, workingTransactions } from './nota-workspace-utils';
import './nota-workspace.css';

type Selection = { transactionId: string; pageId: string };
type ConfirmAction = 'complete' | 'reopen' | 'cancel' | null;
const paymentLabel = (payment: PaymentKind) => ({ unclassified: 'Belum diklasifikasi', cash: 'Kas', transfer: 'Transfer', credit: 'Piutang' })[payment];

export function NotaWorkspace({ onBack }: { onBack: () => void }) {
  const { state, gateway } = useOperations();
  const [selected, setSelected] = useState<Selection>({ transactionId: '', pageId: '' });
  const [zoom, setZoom] = useState(100);
  const [message, setMessage] = useState('');
  const [drawer, setDrawer] = useState<'working' | 'list' | null>(null);
  const [listTab, setListTab] = useState<'archive' | 'trash'>('archive');
  const [newOpen, setNewOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmAction>(null);
  const [confirmTransactionId, setConfirmTransactionId] = useState('');
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [undo, setUndo] = useState<{ label: string; action: () => Promise<void> } | null>(null);
  const completeTrigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const grid = useRef<NotaGridHandle>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const working = useMemo(() => workingTransactions(state.notaTransactions), [state.notaTransactions]);
  const selectedTransaction = working.find((item) => item.id === selected.transactionId) ?? working[0];
  const page = selectedTransaction && activePage(selectedTransaction, selectedTransaction.id === selected.transactionId ? selected.pageId : undefined);
  const results = useMemo(() => searchNota(state, query), [state, query]);

  useEffect(() => {
    if (selectedTransaction && page && (selected.transactionId !== selectedTransaction.id || selected.pageId !== page.id)) setSelected({ transactionId: selectedTransaction.id, pageId: page.id });
    if (!selectedTransaction && (selected.transactionId || selected.pageId)) setSelected({ transactionId: '', pageId: '' });
  }, [page, selected, selectedTransaction]);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const editing = target instanceof Element && target.closest('input, textarea, select, [role="dialog"]');
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !editing) { event.preventDefault(); searchInput.current?.focus(); }
      if ((event.ctrlKey || event.metaKey) && !editing && ['+', '-', '0'].includes(event.key)) { event.preventDefault(); setZoom((value) => event.key === '+' ? Math.min(110, value + 10) : event.key === '-' ? Math.max(90, value - 10) : 100); }
    };
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const choose = (choice: Selection) => { setSelected(choice); setDrawer(null); setQuery(''); setHighlight(0); };
  const showUndo = (label: string, action: () => Promise<void>) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ label, action });
    undoTimer.current = setTimeout(() => setUndo(null), 10_000);
  };
  const cancelPage = async (choice: Selection) => {
    const transaction = state.notaTransactions.find((item) => item.id === choice.transactionId);
    const pageToCancel = transaction?.pages.find((item) => item.id === choice.pageId);
    await gateway.cancelNotaPage(choice.transactionId, choice.pageId);
    if (pageToCancel) { setMessage(''); showUndo(`Halaman ${pageToCancel.suffix} dipindahkan ke Sampah.`, () => gateway.restoreNotaPage(choice.transactionId, choice.pageId)); }
  };
  const addPage = async (transactionId: string) => { const added = await gateway.addNotaPage(transactionId); if (added) choose({ transactionId, pageId: added.id }); };
  const create = async (input: { customerName: string; customerPlace: string; transactionDate: string }) => {
    const transaction = await gateway.createNotaTransaction();
    await gateway.updateNotaTransaction(transaction.id, { ...input, payment: 'unclassified' });
    setNewOpen(false); choose({ transactionId: transaction.id, pageId: transaction.pages[0]!.id });
    window.setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="Nama barang baris 1"]')?.focus(), 0);
  };
  const requestComplete = () => { if (!grid.current?.validateAndFocus()) { setMessage('Perbaiki nilai angka: jumlah harus bilangan bulat positif dan harga harus bilangan bulat nol atau lebih.'); return; } setConfirmTransactionId(selectedTransaction?.id ?? ''); setConfirm('complete'); };
  const complete = async () => { if (!selectedTransaction) return; try { await gateway.completeNotaTransaction(selectedTransaction.id); setMessage('Nota selesai dan stok demo diperbarui.'); setConfirm(null); setDrawer('list'); } catch (error) { setConfirm(null); setMessage(error instanceof Error ? error.message : 'Nota tidak dapat diselesaikan.'); } };
  const openSearchResult = () => {
    const result = results[highlight]; if (!result) return;
    if (result.transaction.status === 'cancelled' || result.page.status === 'cancelled') { setQuery(''); setListTab('trash'); setDrawer('list'); return; }
    if (result.transaction.status === 'completed') { setSelected({ transactionId: result.transaction.id, pageId: result.page.id }); setConfirmTransactionId(result.transaction.id); setConfirm('reopen'); return; }
    choose({ transactionId: result.transaction.id, pageId: result.page.id });
  };
  const total = selectedTransaction ? selectedTransaction.pages.filter((item) => item.status === 'active').flatMap((item) => item.lines).reduce((sum, line) => sum + lineTotal(line), 0) : 0;
  const editable = Boolean(selectedTransaction && ['draft', 'reopened'].includes(selectedTransaction.status));
  const confirmTitle = confirm === 'complete' ? 'Selesaikan nota?' : confirm === 'reopen' ? 'Buka kembali nota?' : 'Batalkan transaksi?';
  const confirmAction = async () => {
    const transaction = state.notaTransactions.find((item) => item.id === confirmTransactionId) ?? selectedTransaction;
    if (!transaction) return;
    if (confirm === 'complete') return complete();
    if (confirm === 'reopen') { await gateway.reopenNotaTransaction(transaction.id); choose({ transactionId: transaction.id, pageId: selected.pageId || transaction.pages[0]!.id }); setConfirm(null); return; }
    await gateway.cancelNotaTransaction(transaction.id); showUndo('Transaksi dipindahkan ke Sampah.', () => gateway.restoreNotaTransaction(transaction.id)); setConfirm(null); setDrawer('list');
  };

  return <main className="chu-nota-workspace" data-testid="chu-nota-workspace" style={{ zoom: zoom / 100 }}>
    <header className="chu-nota-workspace__toolbar"><button className="chu-nota-workspace__back" onClick={onBack}>Kembali ke CH Ultimate</button><strong className="chu-nota-workspace__wordmark">CHU</strong><button className="chu-nota-workspace__section" onClick={() => setDrawer('working')}>Nota Dikerjakan</button><button onClick={() => { setListTab('archive'); setDrawer('list'); }}>Daftar Nota</button><div className="chu-nota-workspace__search"><input ref={searchInput} aria-label="Cari nota" role="combobox" aria-expanded={Boolean(query && results.length)} aria-controls="nota-search-results" value={query} placeholder="Cari nota" onChange={(event) => { setQuery(event.target.value); setHighlight(0); }} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setHighlight((value) => Math.min(results.length - 1, value + 1)); } else if (event.key === 'ArrowUp') { event.preventDefault(); setHighlight((value) => Math.max(0, value - 1)); } else if (event.key === 'Enter') { event.preventDefault(); openSearchResult(); } else if (event.key === 'Escape') { event.preventDefault(); setQuery(''); completeTrigger.current?.focus(); } }} />{query && <div id="nota-search-results" role="listbox">{results.map((result, index) => <button role="option" aria-selected={highlight === index} key={`${result.transaction.id}-${result.page.id}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { setHighlight(index); openSearchResult(); }}>{result.label}</button>)}{!results.length && <span>Tidak ada nota yang cocok.</span>}</div>}</div><div className="chu-nota-workspace__zoom" aria-label="Zoom sesi"><button aria-label="Perkecil zoom" disabled={zoom <= 90} onClick={() => setZoom((value) => Math.max(90, value - 10))}>−</button><span>{zoom}%</span><button aria-label="Perbesar zoom" disabled={zoom >= 110} onClick={() => setZoom((value) => Math.min(110, value + 10))}>+</button></div><span className="chu-nota-workspace__demo">DEMO DATA · SESSION ONLY</span><button className="chu-nota-workspace__new" onClick={() => setNewOpen(true)}>Transaksi Baru</button></header>
    {undo && <p className="chu-nota-workspace__notice" role="status">{undo.label} <button onClick={async () => { const action = undo.action; setUndo(null); if (undoTimer.current) clearTimeout(undoTimer.current); await action(); }}>Urungkan</button></p>}
    {message && <p className="chu-nota-workspace__notice" role="status">{message}</p>}
    {selectedTransaction && page ? <><section className="chu-nota-workspace__page-tabs" aria-label="Halaman aktif">{selectedTransaction.pages.filter((item) => item.status === 'active').map((item) => <button key={item.id} aria-label={`Halaman ${item.suffix}`} aria-pressed={item.id === page.id} onClick={() => choose({ transactionId: selectedTransaction.id, pageId: item.id })}>{item.suffix}</button>)}<button onClick={() => void addPage(selectedTransaction.id)}>Tambah Nota</button><button aria-label={`Batalkan halaman ${page.suffix}`} disabled={selectedTransaction.pages.filter((item) => item.status === 'active').length < 2} title={selectedTransaction.pages.filter((item) => item.status === 'active').length < 2 ? 'Minimal satu halaman aktif harus tersisa.' : undefined} onClick={() => void cancelPage({ transactionId: selectedTransaction.id, pageId: page.id })}>Batalkan halaman</button></section><section className="chu-nota-workspace__meta" aria-label="Metadata nota"><div className="chu-nota-workspace__number"><span>NOTA DIBUAT</span><strong>{page.suffix}</strong><b>{selectedTransaction.baseNumber}{page.suffix}</b></div><label><span>Pelanggan</span><input disabled={!editable} value={selectedTransaction.customerName} onChange={(event) => void gateway.updateNotaTransaction(selectedTransaction.id, { customerName: event.target.value })} /></label><label><span>Tempat</span><input disabled={!editable} value={selectedTransaction.customerPlace} onChange={(event) => void gateway.updateNotaTransaction(selectedTransaction.id, { customerPlace: event.target.value })} /></label><label><span>Tanggal</span><input disabled={!editable} type="date" value={selectedTransaction.transactionDate} onChange={(event) => void gateway.updateNotaTransaction(selectedTransaction.id, { transactionDate: event.target.value })} /></label><label><span>Pembayaran</span><select disabled={!editable} value={selectedTransaction.payment} onChange={(event) => void gateway.updateNotaTransaction(selectedTransaction.id, { payment: event.target.value as PaymentKind })}><option value="unclassified">Belum diklasifikasi</option><option value="cash">Kas</option><option value="transfer">Transfer</option><option value="credit">Piutang</option></select></label><div className="chu-nota-workspace__meta-total"><span>TOTAL SEMUA HALAMAN AKTIF</span><strong data-testid="nota-transaction-total">{formatRupiah(total)}</strong><small>{paymentLabel(selectedTransaction.payment)}</small></div></section><NotaGrid ref={grid} lines={page.lines} suffix={page.suffix} skus={state.skus} editable={editable} onUpdate={(line, patch) => void gateway.updateNotaLine(selectedTransaction.id, page.id, line.id, patch)} onDelete={(line) => void gateway.deleteNotaLine(selectedTransaction.id, page.id, line.id)} /><footer className="chu-nota-workspace__footer"><div><span>TOTAL TRANSAKSI</span><strong>{formatRupiah(total)}</strong></div><label><span>Ruang cetak</span><select disabled><option>Semua halaman aktif (segera hadir)</option></select></label><p>Printing produksi belum tersedia pada demo sesi ini.</p><button disabled aria-label="Print Nota">Print Nota</button><div className="chu-nota-workspace__lifecycle"><button onClick={() => { setConfirmTransactionId(selectedTransaction.id); setConfirm('cancel'); }}>Batalkan transaksi</button>{editable && <button ref={completeTrigger} className="chu-nota-workspace__complete" aria-label="Selesaikan nota" onClick={requestComplete}>Selesaikan nota</button>}</div></footer></> : <section className="chu-nota-workspace__empty"><p>Belum ada nota yang sedang dikerjakan pada sesi ini.</p><button onClick={() => setNewOpen(true)}>Transaksi Baru</button><button onClick={() => setDrawer('list')}>Buka Arsip</button></section>}
    {drawer === 'working' && <WorkingDrawer transactions={state.notaTransactions} selected={selected} onClose={() => setDrawer(null)} onSelect={choose} onAdd={(id) => void addPage(id)} onCancelPage={(choice) => void cancelPage(choice)} onCancelTransaction={(id) => { setSelected({ transactionId: id, pageId: activePage(state.notaTransactions.find((item) => item.id === id)!)!.id }); setConfirmTransactionId(id); setConfirm('cancel'); }} />}
    {drawer === 'list' && <ListDrawer transactions={state.notaTransactions} selected={selected} initialTab={listTab} onClose={() => setDrawer(null)} onSelect={setSelected} onOpenArchive={(id) => { const transaction = state.notaTransactions.find((item) => item.id === id)!; setSelected({ transactionId: id, pageId: transaction.pages[0]!.id }); setConfirmTransactionId(id); setConfirm('reopen'); }} onRestoreTransaction={async (id) => { const transaction = state.notaTransactions.find((item) => item.id === id); await gateway.restoreNotaTransaction(id); if (transaction?.cancelledFromStatus === 'draft' || transaction?.cancelledFromStatus === 'reopened') { setListTab('archive'); choose({ transactionId: id, pageId: transaction.pages[0]!.id }); setDrawer('working'); } }} onRestorePage={(choice) => void gateway.restoreNotaPage(choice.transactionId, choice.pageId)} />}
    <NewTransactionDialog open={newOpen} onClose={() => setNewOpen(false)} onCreate={(input) => void create(input)} />
    <ConfirmDialog open={confirm !== null} title={confirmTitle} confirmLabel={confirm === 'complete' ? 'Selesaikan' : confirm === 'reopen' ? 'Buka kembali' : 'Batalkan'} onCancel={() => setConfirm(null)} onConfirm={() => void confirmAction()} restoreFocusTo={completeTrigger.current}>{confirm === 'complete' ? 'Stok demo akan diperbarui berdasarkan baris SKU yang terlacak.' : confirm === 'reopen' ? 'Nota akan kembali ke Nota Dikerjakan untuk diedit.' : 'Transaksi akan dipindahkan ke Sampah.'}</ConfirmDialog>
  </main>;
}
