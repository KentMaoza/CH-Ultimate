import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { lineTotal } from '../../domain/nota';
import type { NotaTransaction } from '../../domain/types';
import { formatRupiah } from '../format';
import { NotaGrid } from '../nota/NotaGrid';
import { ConfirmDialog } from '../nota/ConfirmDialog';
import { notaPageTheme } from '../nota/nota-page-colors';
import { archivePage, finishedPage, trashPage } from '../nota/nota-workspace-utils';
import { useOperations } from '../operations-context';

export interface ArchiveNotaViewState {
  tab: 'archive' | 'finished' | 'trash'; query: string; place: string; from: string; to: string; page: number;
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
  const [previewOpen, setPreviewOpen] = useState(true);
  const filters = { query: view.query, place: view.place, from: view.from, to: view.to };
  const archive = useMemo(() => archivePage(state.notaTransactions, filters, view.page), [state.notaTransactions, view.query, view.place, view.from, view.to, view.page]);
  const finished = useMemo(() => finishedPage(state.notaTransactions, filters, view.page), [state.notaTransactions, view.query, view.place, view.from, view.to, view.page]);
  const trash = useMemo(() => trashPage(state.notaTransactions, filters, view.page), [state.notaTransactions, view.query, view.place, view.from, view.to, view.page]);
  const completed = view.tab === 'finished' ? finished : archive;
  const selectedTransaction = completed.items.find((item) => item.id === view.transactionId) ?? completed.items[0];
  const selectedPage = selectedTransaction?.pages.find((item) => item.id === view.pageId && item.status === 'active') ?? selectedTransaction?.pages.find((item) => item.status === 'active');

  useEffect(() => {
    if (view.tab === 'trash' || !selectedTransaction || !selectedPage) return;
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
    if (restored.status === 'completed') patch({ tab: restored.completionDestination === 'finished' ? 'finished' : 'archive', transactionId: restored.id, pageId: page?.id ?? '' });
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
  const result = view.tab === 'trash' ? trash : completed;
  const showPreview = view.tab !== 'trash' && previewOpen;

  return <div className={`feature-page archive-nota${showPreview ? '' : ' archive-nota--preview-collapsed'}`}>
    <section className="archive-nota__filters card">
      <div role="tablist" aria-label="Bagian arsip nota"><button role="tab" aria-selected={view.tab === 'archive'} onClick={() => patch({ tab: 'archive', page: 0, transactionId: '', pageId: '' })}>Arsip</button><button role="tab" aria-selected={view.tab === 'finished'} onClick={() => patch({ tab: 'finished', page: 0, transactionId: '', pageId: '' })}>Selesai</button><button role="tab" aria-selected={view.tab === 'trash'} onClick={() => patch({ tab: 'trash', page: 0, transactionId: '', pageId: '' })}>Sampah</button></div>
      <label><span>Cari nomor / pelanggan</span><input aria-label="Cari arsip nota" value={view.query} onChange={(event) => patch({ query: event.target.value }, true)} /></label>
      <label><span>Tempat</span><input aria-label="Filter tempat arsip" value={view.place} onChange={(event) => patch({ place: event.target.value }, true)} /></label>
      <div className="archive-nota__dates"><label><span>Dari tanggal</span><input aria-label="Dari tanggal arsip" type="date" value={view.from} onChange={(event) => patch({ from: event.target.value }, true)} /></label><label><span>Sampai tanggal</span><input aria-label="Sampai tanggal arsip" type="date" value={view.to} onChange={(event) => patch({ to: event.target.value }, true)} /></label></div>
      <p>{result.total} transaksi / halaman</p>
      {view.tab !== 'trash' && <button type="button" className="button secondary archive-nota__preview-toggle" aria-controls="archive-nota-preview" aria-expanded={previewOpen} aria-label={previewOpen ? 'Lipat preview nota' : 'Buka preview nota'} onClick={() => setPreviewOpen((current) => !current)}>{previewOpen ? 'Lipat preview' : 'Buka preview'}</button>}
      <div className="archive-nota__list">{view.tab !== 'trash' ? completed.items.map((transaction) => <article key={transaction.id} className={transaction.id === selectedTransaction?.id ? 'active' : ''}><button className="archive-nota__transaction" onClick={() => patch({ transactionId: transaction.id, pageId: transaction.pages.find((item) => item.status === 'active')?.id ?? '' })}><strong className="archive-nota__customer-name">{transaction.customerName || 'Tanpa pelanggan'}</strong><span className="archive-nota__customer-place">{transaction.customerPlace || 'Tanpa tempat'}</span><small>{transaction.transactionDate}</small></button><div className="archive-nota__pages" aria-label={`Halaman ${transaction.customerName || transaction.baseNumber}`}>{transaction.pages.filter((item) => item.status === 'active').map((page) => {
        const theme = notaPageTheme(transaction.pages.findIndex((candidate) => candidate.id === page.id));
        return <button key={page.id} style={{ '--nota-page-color': theme.background, '--nota-page-text': theme.foreground } as CSSProperties} aria-label={`Preview halaman ${page.suffix}`} aria-pressed={transaction.id === selectedTransaction?.id && page.id === selectedPage?.id} onClick={() => patch({ transactionId: transaction.id, pageId: page.id })}>{page.suffix}</button>;
      })}</div></article>) : trash.items.map((item) => <article key={item.kind === 'transaction' ? item.transaction.id : item.page.id}><div><strong>{item.transaction.baseNumber}{item.kind === 'page' ? item.page.suffix : ''}</strong><span>{item.transaction.customerName || 'Tanpa pelanggan'} · {item.kind === 'page' ? 'Halaman dibatalkan' : 'Transaksi dibatalkan'}</span></div><button onClick={() => item.kind === 'transaction' ? void restoreTransaction(item.transaction) : void restorePage(item.transaction.id, item.page.id)}>Pulihkan</button></article>)}</div>
      {!result.items.length && <p className="empty-state">{view.tab === 'archive' ? 'Arsip belum memiliki nota.' : view.tab === 'finished' ? 'Belum ada nota dengan barang dikirim sekarang.' : 'Sampah kosong.'}</p>}
      <div className="archive-nota__pagination"><button disabled={view.page === 0} onClick={() => patch({ page: view.page - 1 })}>Sebelumnya</button><span>{view.page + 1}/{result.pages}</span><button disabled={view.page + 1 >= result.pages} onClick={() => patch({ page: view.page + 1 })}>Berikutnya</button></div>
    </section>
    {showPreview && <section id="archive-nota-preview" className="archive-nota__preview" aria-label={view.tab === 'finished' ? 'Preview selesai nota' : 'Preview arsip nota'}>{selectedTransaction && selectedPage ? <><header><div><span>{view.tab === 'finished' ? 'SELESAI · BARANG DIKIRIM SEKARANG' : 'ARSIP · BARANG DIKIRIM NANTI'}</span><strong className="archive-nota__preview-customer">{selectedTransaction.customerName || 'Tanpa pelanggan'}</strong><b className="archive-nota__preview-place">{selectedTransaction.customerPlace || 'Tanpa tempat'}</b><small className="archive-nota__preview-number">{selectedTransaction.baseNumber}{selectedPage.suffix}</small><small className="archive-nota__preview-date">{selectedTransaction.transactionDate}</small></div><button className="button primary" onClick={() => setReopen(selectedTransaction)}>Buka kembali untuk edit</button></header><div className="archive-nota__page-total">Total halaman <strong>{formatRupiah(selectedPage.lines.reduce((sum, line) => sum + lineTotal(line), 0))}</strong></div><div className="chu-nota-workspace"><NotaGrid lines={selectedPage.lines} suffix={selectedPage.suffix} skus={state.skus} editable={false} busy={false} invalidValues={{}} onInvalidChange={() => {}} onUpdate={() => {}} onDelete={() => {}} /></div></> : <p className="empty-state">Pilih transaksi untuk melihat preview.</p>}</section>}
    <ConfirmDialog open={Boolean(reopen)} title="Buka kembali nota?" confirmLabel="Buka kembali" onCancel={() => setReopen(null)} onConfirm={() => void confirmReopen()} restoreFocusTo={null}>Nota akan dipindahkan ke Nota Dikerjakan untuk diedit.</ConfirmDialog>
  </div>;
}
