import { useState } from 'react';
import { OperationsProvider } from './operations-context';
import { InventoryPage } from './pages/InventoryPage';
import { CreateSkuPage } from './pages/CreateSkuPage';
import { LabelPage } from './pages/LabelPage';
import { NotaPage } from './pages/NotaPage';
import { RevenuePage } from './pages/RevenuePage';
import { EmptyStockPage } from './pages/EmptyStockPage';
import { SettingsPage } from './pages/SettingsPage';

export type ModuleId = 'inventory' | 'create' | 'label' | 'nota' | 'revenue' | 'empty' | 'settings';

const modules: Array<{ id: ModuleId; label: string; glyph: string }> = [
  { id: 'inventory', label: 'SKU Gudang', glyph: '▦' },
  { id: 'create', label: 'Buat SKU', glyph: '+' },
  { id: 'label', label: 'Label', glyph: '▣' },
  { id: 'nota', label: 'Nota', glyph: '▤' },
  { id: 'revenue', label: 'Laporan Omzet', glyph: '↗' },
  { id: 'empty', label: 'Barang Kosong', glyph: '□' },
  { id: 'settings', label: 'Settings', glyph: '⚙' },
];

function AppLayout() {
  const [active, setActive] = useState<ModuleId>('inventory');
  const [collapsed, setCollapsed] = useState(false);
  const current = modules.find((module) => module.id === active)!;

  return (
    <div className={`app-shell${collapsed ? ' rail-collapsed' : ''}`}>
      <aside className="app-rail">
        <div className="brand-row">
          <div className="brand-mark">CHU</div>
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
              onClick={() => setActive(module.id)}
            >
              <span className="nav-glyph">{module.glyph}</span>
              {!collapsed && <span>{module.label}</span>}
            </button>
          ))}
        </nav>
        <div className="demo-badge">{collapsed ? 'DEMO' : 'DEMO DATA · SESSION ONLY'}</div>
      </aside>
      <main className="app-main">
        <header className="page-header">
          <div><span className="eyebrow">CH ULTIMATE / DEMO</span><h1>{current.label}</h1></div>
          <div className="session-pill">Keluar / reload = data hilang</div>
        </header>
        {active === 'inventory' ? <InventoryPage /> : active === 'create' ? <CreateSkuPage /> : active === 'label' ? <LabelPage /> : active === 'nota' ? <NotaPage /> : active === 'revenue' ? <RevenuePage /> : active === 'empty' ? <EmptyStockPage /> : active === 'settings' ? <SettingsPage /> : (
          <section className="page-placeholder"><span className="placeholder-number">0{modules.findIndex((module) => module.id === active) + 1}</span><div><h2>{current.label}</h2><p>Frontend operasional sedang aktif. Data hanya berlaku untuk sesi ini.</p></div></section>
        )}
      </main>
    </div>
  );
}

export function App() { return <OperationsProvider><AppLayout /></OperationsProvider>; }
