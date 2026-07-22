import { useState } from 'react';
import { ScanIcon } from './Icons';

export function ScanSurface({ initialCode, error, onManualLookup, onRetry }: {
  initialCode: string;
  error: string;
  onManualLookup: (code: string) => void;
  onRetry: () => void;
}) {
  const [code, setCode] = useState(initialCode);
  return <section className="page-view scan-view">
    <h1 data-page-heading tabIndex={-1}>Scan Barcode</h1>
    <p>Gunakan kamera perangkat atau masukkan nomor SKU maupun alias secara manual.</p>
    {error ? <p className="scan-error" role="alert">{error}</p> : null}
    <button className="primary-action" onClick={onRetry}><ScanIcon />Coba scan lagi</button>
    <form onSubmit={(event) => { event.preventDefault(); onManualLookup(code); }}>
      <label htmlFor="manual-scan-code">Kode barcode atau SKU</label>
      <input autoCapitalize="characters" autoFocus id="manual-scan-code" value={code} onChange={(event) => setCode(event.currentTarget.value)} />
      <button className="secondary-action" disabled={!code.trim()} type="submit">Cari kode</button>
    </form>
  </section>;
}
