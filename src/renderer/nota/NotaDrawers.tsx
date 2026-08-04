import { useMemo, useState } from 'react';
import type { NotaTransaction } from '../../domain/types';
import { workingPage } from './nota-workspace-utils';
import { useAccessibleModal } from './useAccessibleModal';

type Selection = { transactionId: string; pageId: string };

function Drawer({ label, onClose, children, restoreFocusTo, busy }: { label: string; onClose: () => void; children: React.ReactNode; restoreFocusTo: HTMLElement | null; busy: boolean }) {
  const modal = useAccessibleModal<HTMLElement>(true, onClose, restoreFocusTo, !busy);
  return <div className="chu-nota-workspace__drawer-backdrop" onMouseDown={modal.onBackdropMouseDown}><aside ref={modal.dialogRef} tabIndex={-1} className="chu-nota-workspace__drawer" role="dialog" aria-modal="true" aria-label={label} onKeyDown={modal.onKeyDown}><header><h2>{label}</h2><button data-modal-initial-focus disabled={busy} aria-label={`Tutup ${label}`} onClick={modal.close}>×</button></header>{children}</aside></div>;
}

export function WorkingDrawer({ transactions, selected, onClose, onSelect, onAdd, onCancelPage, onCancelTransaction, transactionLifecycleBlocked = () => false, restoreFocusTo, busy = false }: {
  transactions: NotaTransaction[]; selected: Selection; onClose: () => void; onSelect: (selection: Selection) => void; onAdd: (transactionId: string) => void; onCancelPage: (selection: Selection) => void; onCancelTransaction: (transactionId: string, target: HTMLElement) => void; transactionLifecycleBlocked?: (transactionId: string) => boolean; restoreFocusTo: HTMLElement | null; busy?: boolean;
}) {
  const [filters, setFilters] = useState({ customer: '', from: '', to: '' });
  const [page, setPage] = useState(0);
  const result = workingPage(transactions, filters, page);
  const groups = useMemo(() => result.items.reduce<Record<string, NotaTransaction[]>>((grouped, transaction) => {
    const key = transaction.customerName.trim() || 'Tanpa pelanggan'; (grouped[key] ??= []).push(transaction); return grouped;
  }, {}), [result.items]);
  const changeFilter = (patch: Partial<typeof filters>) => { setFilters({ ...filters, ...patch }); setPage(0); };
  return <Drawer label="Nota Dikerjakan" onClose={onClose} restoreFocusTo={restoreFocusTo} busy={busy}><div className="chu-nota-workspace__filters"><input disabled={busy} aria-label="Filter pelanggan dikerjakan" value={filters.customer} onChange={(event) => changeFilter({ customer: event.target.value })} placeholder="Pelanggan" /><input disabled={busy} aria-label="Dari tanggal dikerjakan" type="date" value={filters.from} onChange={(event) => changeFilter({ from: event.target.value })} /><input disabled={busy} aria-label="Sampai tanggal dikerjakan" type="date" value={filters.to} onChange={(event) => changeFilter({ to: event.target.value })} /></div>{Object.entries(groups).length ? Object.entries(groups).map(([customer, items]) => <section key={customer} className="chu-nota-workspace__drawer-group"><h3>{customer}</h3>{items.map((transaction) => {
    const active = transaction.pages.filter((page) => page.status === 'active');
    return <div key={transaction.id} className="chu-nota-workspace__drawer-transaction"><p><strong>{transaction.baseNumber}</strong><br />{transaction.customerPlace || 'Tanpa tempat'} · {transaction.status === 'reopened' ? 'Dibuka kembali' : 'Draf'}</p><div>{active.map((page) => <button disabled={busy} key={page.id} aria-label={`Halaman ${page.suffix}`} aria-pressed={selected.transactionId === transaction.id && selected.pageId === page.id} onClick={() => onSelect({ transactionId: transaction.id, pageId: page.id })}>{page.suffix}</button>)}</div><div><button disabled={busy} onClick={() => onAdd(transaction.id)}>Tambah Nota</button><button disabled={busy || transactionLifecycleBlocked(transaction.id)} onClick={(event) => onCancelTransaction(transaction.id, event.currentTarget)}>Batalkan transaksi</button>{active.map((page) => <button key={page.id} aria-label={`Batalkan halaman ${page.suffix}`} disabled={busy || active.length < 2} title={active.length < 2 ? 'Minimal satu halaman aktif harus tersisa.' : undefined} onClick={() => onCancelPage({ transactionId: transaction.id, pageId: page.id })}>Batalkan {page.suffix}</button>)}</div>{active.length < 2 && <small>Minimal satu halaman aktif harus tersisa.</small>}</div>;
  })}</section>) : <p className="chu-nota-workspace__empty-message">Tidak ada nota yang sedang dikerjakan.</p>}<div className="chu-nota-workspace__pagination"><span>{result.total} nota</span><button disabled={busy || page === 0} onClick={() => setPage(page - 1)}>Sebelumnya</button><span>{page + 1}/{result.pages}</span><button disabled={busy || page + 1 >= result.pages} onClick={() => setPage(page + 1)}>Berikutnya</button></div></Drawer>;
}
