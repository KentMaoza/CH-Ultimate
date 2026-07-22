import { useEffect, useMemo, useState } from 'react';
import { lineTotal } from '../../domain/nota';
import type { NotaTransaction } from '../../domain/types';
import { formatRupiah } from '../format';
import { NotaGrid } from '../nota/NotaGrid';
import { ConfirmDialog } from '../nota/ConfirmDialog';
import { archivePage, trashPage } from '../nota/nota-workspace-utils';
import { useOperations } from '../operations-context';

export interface ArchiveNotaViewState {
  tab: 'archive' | 'trash'; query: string; place: string; from: string; to: string; page: number;
  transactionId: string; pageId: string;
}

export const initialArchiveNotaView: ArchiveNotaViewState = { tab: 'archive', query: '', place: '', from: '', to: '', page: 0, transactionId: '', pageId: '' };

type Selection = { transactionId: string; pageId: string };

export function ArchiveNotaPage({ view, onViewChange, onOpenNota }: {
  view: ArchiveNotaViewState;
  onViewChange: (next: ArchiveNotaViewState) => void;
  onOpenNota: (selection: Selection, returnToArchive: boolean) => void;
}) {
  const { state, gateway } = useOperations();
  const [reopen, setReopen] = useState<NotaTransaction | null>(null);
  const filters = { query: view.query, place: view.place, from: view.from, to: view.to };
  const archive = useMemo(() => archivePage(state.notaTransactions, filters, view.page), [state.notaTransactions, view.query, view.place, view.from, view.to, view.page]);
  const trash = useMemo(() => trashPage(state.notaTransactions, filters, view.page), [state.notaTransactions, view.query, view.place, view.from, view.to, view.page]);
  const selectedTransaction = archive.items.find((item) => item.id === view.transactionId) ?? archive.items[0];
  const selectedPage = selectedTransaction?.pages.find((item) => item.id === view.pageId && item.status === 'active') ?? selectedTransaction?.pages.find((item) => item.status === 'active');

  useEffect(() => {
    if (view.tab !== 'archive' || !selectedTransaction || !selectedPage) return;
    const nextTransactionId = selectedTransaction.id;
    const nextPageId = selectedPage.id;
    if (nextTransactionId !== view.transactionId || nextPageId !== view.pageId) onViewChange({ ...view, transactionId: nextTransactionId, pageId: nextPageId });
  }, [selectedPage?.id, selectedTransaction?.id, view, onViewChange]);

  const patch = (next: Partial<ArchiveNotaViewState>, resetPage = false) => onViewChange({ ...view, ...next, page: resetPage ? 0 : (next.page ?? view.page) });
  const restoreTransaction = async (transaction: NotaTransaction) => {
    await gateway.restoreNotaTransaction(transaction.id);
    const restored = gateway.getSnapshot().notaTransactions.find((item) => item.id === transaction.id);
    if (!restored) return;
    const page = restored.pages.find((item) => item.status === 'active');
    if (restored.status === 'completed') patch({ tab: 'archive', transactionId: restored.id, pageId: page?.id ?? '' });
    else if (page) onOpenNota({ transactionId: restored.id, pageId: page.id }, false);
  };
  const restorePage = async (transactionId: string, pageId: string) => {
    await gateway.restoreNotaPage(transactionId, pageId);
    onOpenNota({ transactionId, pageId }, false);
  };
  const confirmReopen = async () => {
    if (!reopen) return;
    await gateway.reopenNotaTransaction(reopen.id);
    const page = reopen.pages.find((item) => item.id === view.pageId && item.status === 'active') ?? reopen.pages.find((item) => item.status === 'active');
    setReopen(null);
    if (page) onOpenNota({ transactionId: reopen.id, pageId: page.id }, true);
  };
  const result = view.tab === 'archive' ? archive : trash;

  return <div className="feature-page archive-nota">
    <section className="archive-nota__filters card">
      <div role="tablist" aria-label="Bagian arsip nota"><button role="tab" aria-selected={view.tab === 'archive'} onClick={() => patch({ tab: 'archive', page: 0 })}>Arsip</button><button role="tab" aria-selected={view.tab === 'trash'} onClick={() => patch({ tab: 'trash', page: 0 })}>Sampah</button></div>
      <label><span>Cari nomor / pelanggan</span><input aria-label="Cari arsip nota" value={view.query} onChange={(event) => patch({ query: event.target.value }, true)} /></label>
      <label><span>Tempat</span><input aria-label="Filter tempat arsip" value={view.place} onChange={(event) => patch({ place: event.target.value }, true)} /></label>
      <div className="archive-nota__dates"><label><span>Dari tanggal</span><input aria-label="Dari tanggal arsip" type="date" value={view.from} onChange={(event) => patch({ from: event.target.value }, true)} /></label><label><span>Sampai tanggal</span><input aria-label="Sampai tanggal arsip" type="date" value={view.to} onChange={(event) => patch({ to: event.target.value }, true)} /></label></div>
      <p>{result.total} transaksi / halaman</p>
      <div className="archive-nota__list">{view.tab === 'archive' ? archive.items.map((transaction) => <article key={transaction.id} className={transaction.id === selectedTransaction?.id ? 'active' : ''}><button className="archive-nota__transaction" onClick={() => patch({ transactionId: transaction.id, pageId: transaction.pages.find((item) => item.status === 'active')?.id ?? '' })}><strong>{transaction.baseNumber}</strong><span>{transaction.customerName || 'Tanpa pelanggan'} · {transaction.customerPlace || 'Tanpa tempat'}</span><small>{transaction.transactionDate}</small></button><div>{transaction.pages.filter((item) => item.status === 'active').map((page) => <button key={page.id} aria-label={`Preview halaman ${page.suffix}`} aria-pressed={transaction.id === selectedTransaction?.id && page.id === selectedPage?.id} onClick={() => patch({ transactionId: transaction.id, pageId: page.id })}>{page.suffix}</button>)}</div></article>) : trash.items.map((item) => <article key={item.kind === 'transaction' ? item.transaction.id : item.page.id}><div><strong>{item.transaction.baseNumber}{item.kind === 'page' ? item.page.suffix : ''}</strong><span>{item.transaction.customerName || 'Tanpa pelanggan'} · {item.kind === 'page' ? 'Halaman dibatalkan' : 'Transaksi dibatalkan'}</span></div><button onClick={() => item.kind === 'transaction' ? void restoreTransaction(item.transaction) : void restorePage(item.transaction.id, item.page.id)}>Pulihkan</button></article>)}</div>
      {!result.items.length && <p className="empty-state">{view.tab === 'archive' ? 'Arsip belum memiliki nota.' : 'Sampah kosong.'}</p>}
      <div className="archive-nota__pagination"><button disabled={view.page === 0} onClick={() => patch({ page: view.page - 1 })}>Sebelumnya</button><span>{view.page + 1}/{result.pages}</span><button disabled={view.page + 1 >= result.pages} onClick={() => patch({ page: view.page + 1 })}>Berikutnya</button></div>
    </section>
    <section className="archive-nota__preview" aria-label="Preview arsip nota">{view.tab === 'archive' && selectedTransaction && selectedPage ? <><header><div><span>SELESAI · HANYA LIHAT</span><h2>{selectedTransaction.baseNumber}{selectedPage.suffix}</h2><p>{selectedTransaction.customerName || 'Tanpa pelanggan'} · {selectedTransaction.customerPlace || 'Tanpa tempat'} · {selectedTransaction.transactionDate}</p></div><button className="button primary" onClick={() => setReopen(selectedTransaction)}>Buka kembali untuk edit</button></header><div className="archive-nota__page-total">Total halaman <strong>{formatRupiah(selectedPage.lines.reduce((sum, line) => sum + lineTotal(line), 0))}</strong></div><div className="chu-nota-workspace"><NotaGrid lines={selectedPage.lines} suffix={selectedPage.suffix} skus={state.skus} editable={false} busy={false} invalidValues={{}} onInvalidChange={() => {}} onUpdate={() => {}} onDelete={() => {}} /></div></> : <p className="empty-state">Pilih transaksi untuk melihat preview.</p>}</section>
    <ConfirmDialog open={Boolean(reopen)} title="Buka kembali nota?" confirmLabel="Buka kembali" onCancel={() => setReopen(null)} onConfirm={() => void confirmReopen()} restoreFocusTo={null}>Nota akan dipindahkan ke Nota Dikerjakan untuk diedit.</ConfirmDialog>
  </div>;
}
