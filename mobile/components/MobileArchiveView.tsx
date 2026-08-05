import { useMemo, useState, type CSSProperties } from 'react';
import { lineTotal } from '../../src/domain/nota';
import type { OperationsGateway } from '../../src/gateway/operations-gateway';
import { notaPageTheme } from '../../src/renderer/nota/nota-page-colors';
import {
  useOperationsSnapshot,
  useOperationsSyncSnapshot,
} from '../../src/renderer/use-operations-snapshot';
import { formatRupiah } from '../format';
import { presentSyncStatus } from '../../src/gateway/sync-presentation';

export function MobileArchiveView({ coreBacked = false, gateway, onEdit, syncLabel }: { coreBacked?: boolean; gateway: OperationsGateway; onEdit: (transactionId: string) => void; syncLabel?: string }) {
  const snapshot = useOperationsSnapshot(gateway);
  const sync = useOperationsSyncSnapshot(gateway);
  const coreSyncLabel = syncLabel ?? presentSyncStatus(sync.phase).label;
  const archived = useMemo(() => snapshot.notaTransactions
    .filter((transaction) => transaction.status === 'completed' && (transaction.completionDestination ?? 'archive') === 'archive')
    .sort((a, b) => Date.parse(b.completedAt ?? '') - Date.parse(a.completedAt ?? '')), [snapshot.notaTransactions]);
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState('');
  const selected = archived.find((transaction) => transaction.id === selectedId);

  async function editSelected() {
    if (!selected || editing) return;
    setEditing(true);
    setEditError('');
    try {
      await gateway.reopenNotaTransaction(selected.id);
      const reopened = gateway.getSnapshot().notaTransactions.find((transaction) => transaction.id === selected.id);
      if (reopened?.status !== 'reopened') throw new Error('Nota tidak dapat dibuka untuk diedit.');
      onEdit(selected.id);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Nota tidak dapat dibuka untuk diedit.');
    } finally {
      setEditing(false);
    }
  }

  return <section className="mobile-archive-view">
    <header className="mobile-header"><div><span className="eyebrow">{coreBacked ? 'ARSIP CH CORE' : 'ARSIP SAJA · SESSION ONLY'}</span><h1 data-page-heading tabIndex={-1}>Arsip Nota</h1></div></header>
    <p className="mobile-archive-badge">{coreBacked ? `Status CH Core · ${coreSyncLabel}` : 'Arsip hanya tersedia pada sesi demo lokal ini'}</p>
    {editError && <p className="mobile-nota-notice mobile-nota-notice--alert" role="alert">{editError}</p>}
    {!archived.length ? <p className="mobile-nota-empty">Arsip mobile belum memiliki nota.</p> : <>
      <div className="mobile-archive-list" aria-label="Daftar arsip nota">{archived.map((transaction) => {
        const total = transaction.pages.filter((page) => page.status === 'active').flatMap((page) => page.lines).reduce((sum, line) => sum + lineTotal(line), 0);
        const expanded = transaction.id === selected?.id;
        const detailId = `mobile-archive-detail-${transaction.id}`;
        return <article className="mobile-archive-item" key={transaction.id}>
          <button
            aria-controls={detailId}
            aria-expanded={expanded}
            className="mobile-archive-summary"
            onClick={() => setSelectedId((current) => current === transaction.id ? '' : transaction.id)}
          >
            <strong>{transaction.customerName || 'Tanpa pelanggan'}</strong>
            <span>{transaction.customerPlace || 'Tanpa tempat'} · {transaction.transactionDate}</span>
            <b>{formatRupiah(total)}</b>
          </button>
          {expanded && <section className="mobile-archive-detail" id={detailId} aria-label={`Nota arsip ${transaction.baseNumber}`}>
            <header><span>{transaction.baseNumber}</span><button className="secondary-action" disabled={editing || (sync.phase === 'offline' && gateway.isNotaLifecycleOnlineOnly(transaction.id))} onClick={() => void editSelected()}>Edit nota</button></header>
            {transaction.pages.filter((page) => page.status === 'active').map((page) => {
              const pageIndex = transaction.pages.findIndex((candidate) => candidate.id === page.id);
              const theme = notaPageTheme(pageIndex);
              const lines = page.lines.map((line, index) => ({ line, index })).filter(({ line }) => line.description.trim() || line.quantity || line.pcsPrice || line.lsnPrice);
              return <section key={page.id} className="mobile-archive-page" style={{ '--mobile-nota-accent': theme.background, '--mobile-nota-accent-text': theme.foreground } as CSSProperties}>
                <header><strong>Bagian {page.suffix}</strong><b>{formatRupiah(lines.reduce((sum, item) => sum + lineTotal(item.line), 0))}</b></header>
                {lines.map(({ line, index }) => <article key={line.id}><span>{index + 1}{page.suffix}</span><div><strong>{line.description}</strong><small>{line.quantity} {line.unit.toUpperCase()} · {formatRupiah(line.unit === 'lsn' ? line.lsnPrice : line.pcsPrice)}</small></div><b>{formatRupiah(lineTotal(line))}</b></article>)}
              </section>;
            })}
          </section>}
        </article>;
      })}</div>
    </>}
  </section>;
}
