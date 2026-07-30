import { useState } from 'react';
import { buildRevenueReport } from '../../domain/reports';
import { formatRupiah } from '../format';
import { useOperations } from '../operations-context';
import { useRevenueAccess } from '../revenue-access';

export function RevenuePage({ coreBacked = false, onOpenSettings }: { coreBacked?: boolean; onOpenSettings: () => void }) {
  const { state } = useOperations();
  const access = useRevenueAccess();
  const [metric, setMetric] = useState<'revenue' | 'units'>('revenue');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  if (!access.configured) return <div className="feature-page"><section className="revenue-lock"><span>{coreBacked ? 'AKSES LOKAL LAPORAN OMZET' : 'AKSES OMZET · SESSION ONLY'}</span><h2>Password omzet belum diatur</h2><p>{coreBacked ? 'Atur password lokal di Settings. Data omzet tetap tersimpan terpusat di CH Core.' : 'Atur password di Settings sebelum membuka angka omzet. Password hilang saat aplikasi direload.'}</p><button className="button primary" onClick={onOpenSettings}>Atur password di Settings</button></section></div>;
  if (!access.unlocked) return <div className="feature-page"><form className="revenue-lock" onSubmit={(event) => {
    event.preventDefault();
    if (access.unlock(password)) { setPassword(''); setMessage(''); }
    else setMessage('Password salah. Coba lagi.');
  }}><span>{coreBacked ? 'AKSES LOKAL LAPORAN OMZET' : 'AKSES OMZET · SESSION ONLY'}</span><h2>Laporan Omzet terkunci</h2><p>Masukkan password yang diatur di Settings.</p><label><span>Password Laporan Omzet</span><input autoFocus type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>{message && <p className="notice" role="status">{message}</p>}<button className="button primary" type="submit">Buka Laporan Omzet</button></form></div>;
  const report = buildRevenueReport(state, new Date(), { from, to });
  const max = Math.max(1, ...report.bySku.map((item) => metric === 'revenue' ? item.revenue : item.units));
  return <div className="feature-page report-page">
    <div className="metric-grid"><div data-testid="revenue-today"><span>OMZET HARI INI</span><strong>{formatRupiah(report.today)}</strong><small>berdasarkan waktu selesai</small></div><div data-testid="revenue-month"><span>OMZET BULAN INI</span><strong>{formatRupiah(report.month)}</strong><small>WITA</small></div><div data-testid="revenue-year"><span>OMZET TAHUN INI</span><strong>{formatRupiah(report.year)}</strong><small>tanpa COGS</small></div></div>
    <div className="report-filters" aria-label="Filter tanggal laporan"><label>Tanggal mulai<input aria-label="Tanggal mulai" type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label><label>Tanggal akhir<input aria-label="Tanggal akhir" type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label><button className="button" disabled={!from && !to} onClick={() => { setFrom(''); setTo(''); }}>Hapus filter</button></div>
    <div className="report-grid"><section className="report-card"><div className="card-heading"><div><span>TREN SKU</span><h2>Penjualan per SKU</h2></div><div className="segmented"><button className={metric === 'revenue' ? 'active' : ''} onClick={() => setMetric('revenue')}>Omzet</button><button className={metric === 'units' ? 'active' : ''} onClick={() => setMetric('units')}>Unit</button></div></div>
      {report.bySku.length ? <div className="bar-list">{report.bySku.slice(0, 8).map((item) => { const value = metric === 'revenue' ? item.revenue : item.units; return <div key={item.skuId}><div><span>{item.name}</span><b>{metric === 'revenue' ? formatRupiah(value) : `${value} pcs`}</b></div><i style={{ width: `${(value / max) * 100}%` }} /></div>; })}</div> : <div className="empty-state compact-empty"><strong>Belum ada omzet</strong><p>{coreBacked ? 'Selesaikan nota untuk mengisi omzet pusat.' : 'Selesaikan nota demo untuk mengisi laporan.'}</p></div>}
    </section><section className="report-card dark-card"><span>CATATAN</span><h2>Laporan operasional</h2><p>Angka ini hanya omzet dari nota selesai. Harga Referensi bukan modal dan laporan ini tidak menghitung laba.</p><div className="rule-list"><div>Transaksi aktif <b>{state.notaTransactions.filter((transaction) => transaction.status === 'completed').length}</b></div><div>SKU terhubung <b>{report.bySku.length}</b></div><div>Sumber <b>{state.sourceLabel}</b></div></div></section></div>
  </div>;
}
