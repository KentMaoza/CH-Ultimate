import { useState } from 'react';
import type { NotaCompletionDestination } from '../domain/types';
import type { OperationsGateway } from '../gateway/operations-gateway';
import { OperationsProvider } from './operations-context';
import { InventoryPage } from './pages/InventoryPage';
import { SkuChangesPage } from './pages/SkuChangesPage';
import { CreateSkuPage } from './pages/CreateSkuPage';
import { LabelPage } from './pages/LabelPage';
import { NotaWorkspace } from './nota/NotaWorkspace';
import { RevenuePage } from './pages/RevenuePage';
import { EmptyStockPage } from './pages/EmptyStockPage';
import { SettingsPage } from './pages/SettingsPage';
import { ArchiveNotaPage, initialArchiveNotaView, type ArchiveNotaViewState } from './pages/ArchiveNotaPage';
import { ShareRecommendationsPage } from './pages/ShareRecommendationsPage';
import { RevenueAccessProvider } from './revenue-access';
import { OperationsSyncStatus } from './OperationsSyncStatus';
import { StockCheckView } from './stock-check/StockCheckView';

export type ModuleId = 'inventory' | 'stockCheck' | 'skuChanges' | 'shareRecommendations' | 'create' | 'label' | 'nota' | 'notaArchive' | 'revenue' | 'empty' | 'settings';
type NavIconName = 'warehouse' | 'stock' | 'history' | 'share' | 'add' | 'template' | 'nota' | 'archive' | 'revenue' | 'empty' | 'settings';

const modules: Array<{ id: ModuleId; label: string; icon: NavIconName }> = [
  { id: 'inventory', label: 'SKU Gudang', icon: 'warehouse' },
  { id: 'stockCheck', label: 'Cek Stok', icon: 'stock' },
  { id: 'skuChanges', label: 'Perubahan SKU', icon: 'history' },
  { id: 'shareRecommendations', label: 'Rekomendasi Share', icon: 'share' },
  { id: 'create', label: 'Buat SKU', icon: 'add' },
  { id: 'label', label: 'Template Label & Invoice', icon: 'template' },
  { id: 'nota', label: 'Nota', icon: 'nota' },
  { id: 'notaArchive', label: 'Arsip Nota', icon: 'archive' },
  { id: 'revenue', label: 'Laporan Omzet', icon: 'revenue' },
  { id: 'empty', label: 'Barang Kosong', icon: 'empty' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

function NavIcon({ name }: { name: NavIconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.8 };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>
    {name === 'warehouse' && <><path d="M3 10 12 4l9 6v10H3Z" /><path d="M7 20v-7h10v7M7 16h10" /></>}
    {name === 'stock' && <><path d="M4 7h16v13H4Z" /><path d="m4 7 8-4 8 4-8 4Z" /><path d="M8 15h8M12 11v8" /></>}
    {name === 'history' && <><path d="M4 6h12M4 12h12M4 18h8" /><circle cx="19" cy="17" r="3" /><path d="M19 15.5V17l1 1" /></>}
    {name === 'share' && <><circle cx="6" cy="12" r="2" /><circle cx="17" cy="6" r="2" /><circle cx="17" cy="18" r="2" /><path d="m8 11 7-4M8 13l7 4" /></>}
    {name === 'add' && <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M12 8v8M8 12h8" /></>}
    {name === 'template' && <><path d="M5 3h11l3 3v15H5Z" /><path d="M15 3v4h4M8 11h8M8 15h5" /></>}
    {name === 'nota' && <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" /><path d="M9 8h6M9 12h6M9 16h4" /></>}
    {name === 'archive' && <><path d="M4 7h16v13H4Z" /><path d="M3 4h18v4H3ZM9 12h6" /></>}
    {name === 'revenue' && <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 2 5-6M15 7h4v4" /></>}
    {name === 'empty' && <><path d="m4 7 8-4 8 4-8 4Z" /><path d="M4 7v10l8 4 8-4V7M12 11v10" /></>}
    {name === 'settings' && <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>}
  </svg>;
}

function AppLayout({
  gateway,
  coreBacked,
}: {
  gateway: OperationsGateway;
  coreBacked: boolean;
}) {
  const [active, setActive] = useState<ModuleId>('inventory');
  const [collapsed, setCollapsed] = useState(false);
  const [archiveView, setArchiveView] = useState<ArchiveNotaViewState>(initialArchiveNotaView);
  const [notaSelection, setNotaSelection] = useState<{ transactionId: string; pageId: string } | undefined>();
  const [notaReturnsToArchive, setNotaReturnsToArchive] = useState(false);
  const current = modules.find((module) => module.id === active)!;

  const openCompletionDestination = (destination: NotaCompletionDestination) => {
    setArchiveView((view) => ({ ...view, tab: destination === 'finished' ? 'finished' : 'archive', page: 0, transactionId: '', pageId: '' }));
    setActive('notaArchive');
  };

  if (active === 'nota') return <NotaWorkspace coreBacked={coreBacked} initialSelection={notaSelection} onBack={() => setActive(notaReturnsToArchive ? 'notaArchive' : 'inventory')} onOpenCompletionDestination={openCompletionDestination} />;

  const openNota = (selection: { transactionId: string; pageId: string }, returnToArchive: boolean) => { setNotaSelection(selection); setNotaReturnsToArchive(returnToArchive); setActive('nota'); };
  const selectModule = (module: ModuleId) => {
    if (module === 'nota') { setNotaSelection(undefined); setNotaReturnsToArchive(false); }
    setActive(module);
  };

  return (
    <div className={`app-shell${collapsed ? ' rail-collapsed' : ''}`}>
      <aside className="app-rail">
        <div className="brand-row">
          <img className="brand-mark" src="/brand/ch-ultimate-mark.svg" alt="CH Ultimate" />
          {!collapsed && <div><strong>CH Ultimate</strong><span>OPERATIONAL</span></div>}
        </div>
        <button className="rail-collapse" aria-label={collapsed ? 'Besarkan navigasi' : 'Kecilkan navigasi'} onClick={() => setCollapsed((value) => !value)}>
          {collapsed ? '›' : '‹'}
        </button>
        <nav aria-label="Modul CH Ultimate">
          {modules.map((module) => (
            <button
              key={module.id}
              aria-label={module.label}
              aria-current={active === module.id ? 'page' : undefined}
              className={active === module.id ? 'active' : ''}
              onClick={() => selectModule(module.id)}
            >
              <span className="nav-glyph"><NavIcon name={module.icon} /></span>
              {!collapsed && <span>{module.label}</span>}
            </button>
          ))}
        </nav>
        {!coreBacked && (
          <div className="demo-badge">
            {collapsed ? 'DEMO' : 'DEMO DATA · SESSION ONLY'}
          </div>
        )}
      </aside>
      <main className="app-main">
        <header className="page-header">
          <div>
            <span className="eyebrow">
              {coreBacked ? 'CH ULTIMATE / CH CORE' : 'CH ULTIMATE / DEMO'}
            </span>
            <h1>{current.label}</h1>
          </div>
          {coreBacked ? (
            <OperationsSyncStatus gateway={gateway} />
          ) : (
            <div className="session-pill">Keluar / reload = data hilang</div>
          )}
        </header>
        {active === 'inventory' ? <InventoryPage /> : active === 'stockCheck' ? <StockCheckView gateway={gateway} mode="desktop" /> : active === 'skuChanges' ? <SkuChangesPage coreBacked={coreBacked} /> : active === 'shareRecommendations' ? <ShareRecommendationsPage /> : active === 'create' ? <CreateSkuPage coreBacked={coreBacked} /> : active === 'label' ? <LabelPage coreBacked={coreBacked} /> : active === 'notaArchive' ? <ArchiveNotaPage view={archiveView} onViewChange={setArchiveView} onOpenNota={openNota} /> : active === 'revenue' ? <RevenuePage coreBacked={coreBacked} onOpenSettings={() => setActive('settings')} /> : active === 'empty' ? <EmptyStockPage coreBacked={coreBacked} /> : active === 'settings' ? <SettingsPage coreBacked={coreBacked} /> : (
          <section className="page-placeholder"><span className="placeholder-number">0{modules.findIndex((module) => module.id === active) + 1}</span><div><h2>{current.label}</h2><p>Frontend operasional sedang aktif. Data hanya berlaku untuk sesi ini.</p></div></section>
        )}
      </main>
    </div>
  );
}

export function App({
  gateway,
  coreBacked = false,
}: {
  gateway: OperationsGateway;
  coreBacked?: boolean;
}) {
  return <OperationsProvider gateway={gateway}><RevenueAccessProvider><AppLayout gateway={gateway} coreBacked={coreBacked} /></RevenueAccessProvider></OperationsProvider>;
}
