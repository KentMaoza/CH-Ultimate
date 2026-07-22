import { useEffect, useState, useSyncExternalStore } from 'react';
import type { OperationsGateway } from '../src/gateway/operations-gateway';
import type { Sku } from '../src/domain/types';
import { findSkuByScanCode } from '../src/domain/mobile-demo-state';
import type { BarcodeScannerPort, LocalNotificationPort } from './ports';
import { BoxIcon, ClockIcon, HomeIcon } from './components/Icons';
import { DashboardView } from './components/DashboardView';
import { SkuCatalog } from './components/SkuCatalog';
import { ScanSurface } from './components/ScanSurface';
import { SkuDetail } from './components/SkuDetail';
import { PriceFeedView } from './components/PriceFeedView';
import { formatRupiah } from './format';

type MainView = 'home' | 'skus' | 'prices';
type PriceMode = 'all' | 'unread';

export function MobileApp({ gateway, scanner, notifications }: {
  gateway: OperationsGateway;
  scanner: BarcodeScannerPort;
  notifications: LocalNotificationPort;
}) {
  const snapshot = useSyncExternalStore(gateway.subscribe, gateway.getSnapshot, gateway.getSnapshot);
  const [view, setView] = useState<MainView>('home');
  const [focusSearch, setFocusSearch] = useState(false);
  const [selectedSku, setSelectedSku] = useState<Sku | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [scanError, setScanError] = useState('');
  const [priceMode, setPriceMode] = useState<PriceMode>('all');
  const [readChangeIds, setReadChangeIds] = useState<Set<string>>(() => new Set());
  const [unreadFeedIds, setUnreadFeedIds] = useState<string[]>([]);
  const [simulationStatus, setSimulationStatus] = useState('');
  const sortedChanges = [...snapshot.priceChanges].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const unreadCount = snapshot.priceChanges.filter((change) => !readChangeIds.has(change.id)).length;
  const visiblePriceChanges = priceMode === 'all'
    ? sortedChanges
    : sortedChanges.filter((change) => unreadFeedIds.includes(change.id));

  useEffect(() => {
    if (view !== 'prices' || priceMode !== 'unread' || unreadFeedIds.length === 0) return;
    setReadChangeIds((current) => {
      const next = new Set(current);
      unreadFeedIds.forEach((id) => next.add(id));
      return next;
    });
  }, [priceMode, unreadFeedIds, view]);

  function navigate(next: MainView, shouldFocusSearch = false) {
    setSelectedSku(null);
    setScanOpen(false);
    setFocusSearch(shouldFocusSearch);
    if (next === 'prices') setPriceMode('all');
    setView(next);
  }

  function openUnreadPrices() {
    setSelectedSku(null);
    setScanOpen(false);
    setPriceMode('unread');
    setUnreadFeedIds(sortedChanges.filter((change) => !readChangeIds.has(change.id)).map((change) => change.id));
    setView('prices');
  }

  function openSku(sku: Sku) {
    setScanOpen(false);
    setSelectedSku(sku);
  }

  async function beginScan() {
    setScanCode('');
    setScanError('');
    try {
      const result = await scanner.scan();
      if (!result) {
        setScanOpen(true);
        setSelectedSku(null);
        return;
      }
      const sku = findSkuByScanCode(snapshot.skus, result.rawValue);
      if (sku) {
        openSku(sku);
        return;
      }
      setScanCode(result.rawValue);
      setScanError(`Kode tidak ditemukan: ${result.rawValue}. Coba lagi atau periksa kode manual.`);
      setSelectedSku(null);
      setScanOpen(true);
    } catch {
      setScanError('Pemindai tidak tersedia. Masukkan kode secara manual.');
      setSelectedSku(null);
      setScanOpen(true);
    }
  }

  function manualLookup(code: string) {
    const sku = findSkuByScanCode(snapshot.skus, code);
    if (sku) {
      openSku(sku);
      return;
    }
    setScanCode(code);
    setScanError(`Kode tidak ditemukan: ${code.trim() || 'kode kosong'}. Coba lagi atau periksa kode manual.`);
  }

  async function simulatePriceChange() {
    const sku = snapshot.skus.find((candidate) => !candidate.archived);
    if (!sku) return;
    const nextPrice = sku.referencePrice + 1_000;
    await gateway.updateSku(sku.id, { referencePrice: nextPrice });
    const change = [...gateway.getSnapshot().priceChanges].reverse().find((candidate) => candidate.skuId === sku.id && candidate.after === nextPrice);
    setSimulationStatus(`Harga ${sku.name} diperbarui menjadi ${formatRupiah(nextPrice)}.`);
    if (!change) return;
    try {
      if (await notifications.ensurePermission() === 'granted') await notifications.notifyPriceChange(change, { ...sku, referencePrice: nextPrice });
    } catch {
      // The in-app session update remains authoritative when browser notifications fail.
    }
  }

  return <div className="mobile-app">
    <main className="mobile-content">
      {selectedSku ? <SkuDetail changes={snapshot.priceChanges} onBack={() => setSelectedSku(null)} onScanAgain={() => { setSelectedSku(null); setScanOpen(true); setScanCode(''); setScanError(''); }} sku={selectedSku} /> : scanOpen ? <ScanSurface error={scanError} initialCode={scanCode} key={scanCode} onManualLookup={manualLookup} onRetry={() => void beginScan()} /> : view === 'home' ? <DashboardView
        snapshot={snapshot}
        unreadCount={unreadCount}
        onOpenPrices={() => navigate('prices')}
        onOpenSku={openSku}
        onOpenUnread={openUnreadPrices}
        onScan={() => void beginScan()}
        onSearch={() => navigate('skus', true)}
      /> : null}
      {view === 'skus' && !scanOpen && !selectedSku ? <SkuCatalog focusSearch={focusSearch} onOpenSku={openSku} skus={snapshot.skus} /> : null}
      {view === 'prices' && !scanOpen && !selectedSku ? <PriceFeedView changes={visiblePriceChanges} onOpenSku={openSku} onSimulate={() => void simulatePriceChange()} skus={snapshot.skus} status={simulationStatus} unreadOnly={priceMode === 'unread'} /> : null}
    </main>
    <nav aria-label="Navigasi utama" className="bottom-nav">
      <button aria-current={view === 'home' ? 'page' : undefined} onClick={() => navigate('home')}><HomeIcon />Beranda</button>
      <button aria-current={view === 'skus' ? 'page' : undefined} onClick={() => navigate('skus')}><BoxIcon />SKU Gudang</button>
      <button aria-current={view === 'prices' ? 'page' : undefined} onClick={() => navigate('prices')}><ClockIcon />Perubahan Harga</button>
    </nav>
  </div>;
}
