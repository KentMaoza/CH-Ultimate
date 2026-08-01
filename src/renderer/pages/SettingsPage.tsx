import { useState, type FormEvent } from 'react';
import { useOperations } from '../operations-context';
import { useRevenueAccess } from '../revenue-access';

export function SettingsPage({ coreBacked = false }: { coreBacked?: boolean }) {
  const { state, gateway } = useOperations();
  const access = useRevenueAccess();
  const [message, setMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  async function reset() {
    await gateway.reset();
    setMessage('Sesi demo direset ke fixture awal.');
  }

  function savePassword(event: FormEvent) {
    event.preventDefault();
    if (!nextPassword.trim()) {
      setPasswordMessage('Password baru wajib diisi.');
      return;
    }
    if (nextPassword !== confirmation) {
      setPasswordMessage('Konfirmasi password tidak cocok.');
      return;
    }
    if (!access.configurePassword(currentPassword, nextPassword)) {
      setPasswordMessage('Password saat ini salah.');
      return;
    }
    setCurrentPassword('');
    setNextPassword('');
    setConfirmation('');
    setPasswordMessage(access.configured ? 'Password omzet diubah. Laporan dikunci kembali.' : 'Password omzet disimpan. Laporan siap dibuka.');
  }

  return <div className="feature-page settings-grid">
    <section className="settings-card"><span>{coreBacked ? 'DATA CH CORE' : 'DATA SESI'}</span><h2>{state.sourceLabel}</h2><dl><div><dt>Jumlah SKU</dt><dd>{state.skus.length.toLocaleString('id-ID')}</dd></div><div><dt>Transaksi nota</dt><dd>{state.notaTransactions.length}</dd></div><div><dt>Penyimpanan</dt><dd>{coreBacked ? 'Tersimpan terpusat di NAS' : 'Tidak ada'}</dd></div></dl>{state.importSummary && <div className="notice">{state.importSummary.loaded} dimuat · {state.importSummary.skipped} dilewati</div>}{!coreBacked && gateway.capabilities.canResetDemoData ? <button className="button primary" onClick={() => void reset()}>Reset data demo</button> : null}{message && <p className="notice" role="status">{message}</p>}</section>
    <section className="settings-card dark-card"><span>APLIKASI</span><h2>CH Ultimate 0.1.1</h2><p>{coreBacked ? 'Electron · Node API · MariaDB · Bahasa Indonesia · IDR · WITA' : 'Electron frontend-only · Bahasa Indonesia · IDR · WITA'}</p><hr /><p>{coreBacked ? 'Data bisnis disinkronkan melalui CH Core pada NAS lokal. Auto-update dan printing Nota/template/invoice belum tersedia. Barcode SKU memakai dialog print sistem.' : 'NAS, database, auto-update, mobile, serta printing Nota/template/invoice belum tersedia. Barcode SKU memakai dialog print sistem.'}</p></section>
    <section className="settings-card settings-card--security"><span>{coreBacked ? 'AKSES LOKAL LAPORAN OMZET' : 'LAPORAN OMZET · SESSION ONLY'}</span><h2>{access.configured ? 'Password sudah diatur' : 'Password belum diatur'}</h2><p>{coreBacked ? 'Password ini hanya kontrol akses lokal dan perlu diatur lagi setelah reload. Data omzet tetap tersimpan di CH Core.' : 'Password hanya menjaga akses selama aplikasi terbuka dan hilang saat reload.'}</p><form className="stack-fields" onSubmit={savePassword}>{access.configured && <label><span>Password omzet saat ini</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>}<label><span>Password omzet baru</span><input type="password" autoComplete="new-password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} /></label><label><span>Konfirmasi password omzet</span><input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{passwordMessage && <p className="notice" role="status">{passwordMessage}</p>}<button className="button primary" type="submit">{access.configured ? 'Ubah password omzet' : 'Simpan password omzet'}</button></form></section>
  </div>;
}
