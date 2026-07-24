import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { OperationsGateway } from '../src/gateway/operations-gateway';
import type { Sku } from '../src/domain/types';
import { findSkuByScanCode } from '../src/domain/mobile-demo-state';
import type { BarcodeScannerPort, LocalNotificationPort, RecommendationPdfSharePort } from './ports';
import { ArchiveIcon, BoxIcon, HomeIcon, MoreIcon, NotaIcon } from './components/Icons';
import { DashboardView } from './components/DashboardView';
import { SkuCatalog } from './components/SkuCatalog';
import { ScanSurface } from './components/ScanSurface';
import { SkuDetail } from './components/SkuDetail';
import { PriceFeedView } from './components/PriceFeedView';
import { ShareRecommendationsView } from './components/ShareRecommendationsView';
import { MobileNotaView } from './components/MobileNotaView';
import { MobileArchiveView } from './components/MobileArchiveView';
import { MoreView } from './components/MoreView';
import { formatRupiah } from './format';

type MainView = 'home' | 'skus' | 'nota' | 'archive' | 'more' | 'prices' | 'recommendations';
type PriceMode = 'all' | 'unread';

export function MobileApp({ gateway, scanner, notifications, share }: {
  gateway: OperationsGateway;
  scanner: BarcodeScannerPort;
  notifications: LocalNotificationPort;
  share: RecommendationPdfSharePort;
}) {
  const snapshot = useSyncExternalStore(gateway.subscribe, gateway.getSnapshot, gateway.getSnapshot);
  const [view, setView] = useState<MainView>('home');
  const [editingNotaId, setEditingNotaId] = useState<string | null>(null);
  const [focusSearch, setFocusSearch] = useState(false);
  const [selectedSkuId, setSelectedSkuId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCode, setScanCode] = useState('');
  const [scanError, setScanError] = useState('');
  const [priceMode, setPriceMode] = useState<PriceMode>('all');
  const [readChangeIds, setReadChangeIds] = useState<Set<string>>(() => new Set());
  const [unreadFeedIds, setUnreadFeedIds] = useState<string[]>([]);
  const [simulationStatus, setSimulationStatus] = useState('');
  const mainContentRef = useRef<HTMLElement>(null);
  const scanRequestToken = useRef(0);
  const selectedSku = snapshot.skus.find((sku) => sku.id === selectedSkuId) ?? null;
  const sortedChanges = [...snapshot.priceChanges].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const unreadCount = snapshot.priceChanges.filter((change) => !readChangeIds.has(change.id)).length;
  const visiblePriceChanges = priceMode === 'all'
    ? sortedChanges
    : sortedChanges.filter((change) => unreadFeedIds.includes(change.id));

  useEffect(() => {
    const focusTarget = view === 'skus' && !selectedSkuId && !scanOpen && focusSearch
      ? mainContentRef.current?.querySelector<HTMLElement>('[role="searchbox"]')
      : scanOpen
        ? mainContentRef.current?.querySelector<HTMLElement>('#manual-scan-code')
        : mainContentRef.current?.querySelector<HTMLElement>('[data-page-heading]');
    focusTarget?.focus();
  }, [focusSearch, priceMode, scanOpen, selectedSkuId, view]);

  useEffect(() => {
    if (view !== 'prices' || priceMode !== 'unread' || unreadFeedIds.length === 0) return;
    setReadChangeIds((current) => {
      const next = new Set(current);
      unreadFeedIds.forEach((id) => next.add(id));
      return next;
    });
  }, [priceMode, unreadFeedIds, view]);

  useEffect(() => {
    let active = true;
    let removeListener: (() => Promise<void>) | undefined;
    void notifications.listenForPriceChangeActions((skuId) => {
      if (!gateway.getSnapshot().skus.some((sku) => sku.id === skuId)) return;
      scanRequestToken.current += 1;
      setView('skus');
      setScanOpen(false);
      setSelectedSkuId(skuId);
    }).then((remove) => {
      if (active) removeListener = remove;
      else void remove().catch(() => undefined);
    }).catch(() => undefined);
    return () => {
      active = false;
      if (removeListener) void removeListener().catch(() => undefined);
    };
  }, [gateway, notifications]);

  function navigate(next: MainView, shouldFocusSearch = false) {
    scanRequestToken.current += 1;
    setSelectedSkuId(null);
    setScanOpen(false);
    setFocusSearch(shouldFocusSearch);
    setEditingNotaId(null);
    if (next === 'prices') setPriceMode('all');
    setView(next);
  }

  function editArchivedNota(transactionId: string) {
    scanRequestToken.current += 1;
    setSelectedSkuId(null);
    setScanOpen(false);
    setEditingNotaId(transactionId);
    setView('nota');
  }

  function openUnreadPrices() {
    scanRequestToken.current += 1;
    setSelectedSkuId(null);
    setScanOpen(false);
    setPriceMode('unread');
    setUnreadFeedIds(sortedChanges.filter((change) => !readChangeIds.has(change.id)).map((change) => change.id));
    setView('prices');
  }

  function openSku(sku: Sku) {
    scanRequestToken.current += 1;
    setScanOpen(false);
    setSelectedSkuId(sku.id);
  }

  async function beginScan() {
    const requestToken = ++scanRequestToken.current;
    setScanCode('');
    setScanError('');
    try {
      const result = await scanner.scan();
      if (requestToken !== scanRequestToken.current) return;
      if (!result) {
        setScanOpen(true);
        setSelectedSkuId(null);
        return;
      }
      const sku = findSkuByScanCode(snapshot.skus, result.rawValue);
      if (sku) {
        openSku(sku);
        return;
      }
      setScanCode(result.rawValue);
      setScanError(`Kode tidak ditemukan: ${result.rawValue}. Coba lagi atau periksa kode manual.`);
      setSelectedSkuId(null);
      setScanOpen(true);
    } catch {
      if (requestToken !== scanRequestToken.current) return;
      setScanError('Pemindai tidak tersedia. Masukkan kode secara manual.');
      setSelectedSkuId(null);
      setScanOpen(true);
    }
  }

  function closeSkuDetail() {
    scanRequestToken.current += 1;
    setSelectedSkuId(null);
  }

  function openManualScan() {
    scanRequestToken.current += 1;
    setSelectedSkuId(null);
    setScanOpen(true);
    setScanCode('');
    setScanError('');
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
    <main className="mobile-content" ref={mainContentRef}>
      {selectedSku ? <SkuDetail changes={snapshot.priceChanges} onBack={closeSkuDetail} onScanAgain={openManualScan} sku={selectedSku} /> : scanOpen ? <ScanSurface error={scanError} initialCode={scanCode} key={scanCode} onManualLookup={manualLookup} onRetry={() => void beginScan()} /> : view === 'home' ? <DashboardView
        snapshot={snapshot}
        unreadCount={unreadCount}
        onOpenPrices={() => navigate('prices')}
        onOpenSku={openSku}
        onOpenUnread={openUnreadPrices}
        onOpenRecommendations={() => navigate('recommendations')}
        onScan={() => void beginScan()}
        onSearch={() => navigate('skus', true)}
      /> : null}
      {view === 'skus' && !scanOpen && !selectedSku ? <SkuCatalog focusSearch={focusSearch} onOpenSku={openSku} skus={snapshot.skus} /> : null}
      {view === 'prices' && !scanOpen && !selectedSku ? <PriceFeedView changes={visiblePriceChanges} onOpenSku={openSku} onSimulate={() => void simulatePriceChange()} skus={snapshot.skus} status={simulationStatus} unreadOnly={priceMode === 'unread'} /> : null}
      {view === 'recommendations' && !scanOpen && !selectedSku ? <ShareRecommendationsView
        onBack={() => navigate('home')}
        onOpenSku={openSku}
        onSharePdf={share.sharePdf}
        snapshot={snapshot}
      /> : null}
      {view === 'nota' && !scanOpen && !selectedSku ? <MobileNotaView gateway={gateway} scanner={scanner} transactionId={editingNotaId ?? undefined} /> : null}
      {view === 'archive' && !scanOpen && !selectedSku ? <MobileArchiveView gateway={gateway} onEdit={editArchivedNota} /> : null}
      {view === 'more' && !scanOpen && !selectedSku ? <MoreView onOpenPrices={() => navigate('prices')} onOpenRecommendations={() => navigate('recommendations')} /> : null}
    </main>
    <nav aria-label="Navigasi utama" className="bottom-nav">
      <button aria-current={view === 'home' ? 'page' : undefined} onClick={() => navigate('home')}><HomeIcon />Beranda</button>
      <button aria-current={view === 'skus' ? 'page' : undefined} onClick={() => navigate('skus')}><BoxIcon />SKU</button>
      <button aria-current={view === 'nota' ? 'page' : undefined} onClick={() => navigate('nota')}><NotaIcon />Nota</button>
      <button aria-current={view === 'archive' ? 'page' : undefined} onClick={() => navigate('archive')}><ArchiveIcon />Arsip</button>
      <button aria-current={['more', 'prices', 'recommendations'].includes(view) ? 'page' : undefined} onClick={() => navigate('more')}><MoreIcon />Lainnya</button>
    </nav>
  </div>;
}
