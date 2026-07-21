import { useState } from 'react';
import { useOperations } from '../operations-context';

export function SettingsPage() {
  const { state, gateway } = useOperations();
  const [message, setMessage] = useState('');
  async function reset() { await gateway.reset(); setMessage('Sesi demo direset ke fixture awal.'); }
  return <div className="feature-page settings-grid"><section className="settings-card"><span>DATA SESI</span><h2>{state.sourceLabel}</h2><dl><div><dt>Jumlah SKU</dt><dd>{state.skus.length.toLocaleString('id-ID')}</dd></div><div><dt>Nota sesi</dt><dd>{state.notas.length}</dd></div><div><dt>Penyimpanan</dt><dd>Tidak ada</dd></div></dl>{state.importSummary && <div className="notice">{state.importSummary.loaded} dimuat · {state.importSummary.skipped} dilewati</div>}<button className="button primary" onClick={() => void reset()}>Reset data demo</button>{message && <p className="notice" role="status">{message}</p>}</section><section className="settings-card dark-card"><span>APLIKASI</span><h2>CH Ultimate 0.1.0</h2><p>Electron frontend-only · Bahasa Indonesia · IDR · WITA</p><hr /><p>NAS, database, auto-update, mobile, dan printing produksi sengaja belum tersedia.</p></section></div>;
}
