import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { parseSkuWorkbook } from '../../domain/workbook';
import type { Sku } from '../../domain/types';
import type {
  CatalogueValidationResult,
  OperationsGateway,
} from '../../gateway/operations-gateway-contract';
import { useOperations } from '../operations-context';
import { formatDate, formatRupiah, formatTitleCaseInput } from '../format';

const MAX_CATALOGUE_BYTES = 5 * 1024 * 1024;

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('File gambar tidak dapat dibaca.'));
    reader.onerror = () => reject(reader.error ?? new Error('File gambar tidak dapat dibaca.'));
    reader.readAsDataURL(file);
  });
}

async function readFileAsBase64(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  const separator = dataUrl.indexOf(',');
  if (separator === -1) throw new Error('File XLSX tidak dapat dibaca.');
  return dataUrl.slice(separator + 1);
}

function SkuImage({
  gateway,
  sku,
  onSelect,
}: {
  gateway: OperationsGateway;
  sku: Sku;
  onSelect: () => void;
}) {
  const [source, setSource] = useState(sku.imageUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setFailed(false);
    if (!sku.imageHash) {
      setSource(sku.imageUrl);
      return () => {
        active = false;
      };
    }
    setSource('');
    void gateway
      .loadSkuImage(sku)
      .then((next) => {
        if (active) setSource(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [gateway, sku.id, sku.imageHash, sku.imageUrl]);
  const showImage = Boolean(source) && !failed;
  return (
    <button type="button" className="sku-image-button" aria-label={`Ubah gambar ${sku.skuNumber}`} onClick={onSelect}>
      {showImage
        ? <img className="sku-image" src={source} alt={`Gambar ${sku.skuNumber}`} onError={() => setFailed(true)} />
        : <span className="image-placeholder">CHU</span>}
      <span className="sku-image-hover-preview" data-testid="sku-image-hover-preview" aria-hidden="true">
        {showImage
          ? <img src={source} alt="" />
          : <span className="image-placeholder">CHU</span>}
      </span>
    </button>
  );
}

export function InventoryPage() {
  const { state, gateway } = useOperations();
  const [query, setQuery] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [adjusting, setAdjusting] = useState<{ sku: Sku; direction: 1 | -1 } | null>(null);
  const [editing, setEditing] = useState<Sku | null>(null);
  const [printing, setPrinting] = useState<Sku | null>(null);
  const [printQuantity, setPrintQuantity] = useState('1');
  const [editNumber, setEditNumber] = useState('');
  const [editName, setEditName] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [message, setMessage] = useState('');
  const [cataloguePreview, setCataloguePreview] =
    useState<CatalogueValidationResult | null>(null);
  const [committingCatalogue, setCommittingCatalogue] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageTarget, setImageTarget] = useState<Sku | null>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id-ID');
    return state.skus.filter((sku) => {
      if (sku.archived !== showArchived) return false;
      if (stockFilter === 'positive' && sku.stock <= 0) return false;
      if (stockFilter === 'empty' && sku.stock !== 0) return false;
      if (stockFilter === 'negative' && sku.stock >= 0) return false;
      return !needle || [sku.name, sku.skuNumber, ...sku.aliases].some((value) => value.toLocaleLowerCase('id-ID').includes(needle));
    });
  }, [query, showArchived, state.skus, stockFilter]);

  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (gateway.capabilities.canStageInitialCatalogue) {
        if (file.size > MAX_CATALOGUE_BYTES) {
          throw new Error('File XLSX melebihi batas 5 MiB.');
        }
        setMessage('Memvalidasi katalog di CH Core…');
        const preview = await gateway.validateInitialCatalogue({
          fileName: file.name,
          workbookBase64: await readFileAsBase64(file),
        });
        setCataloguePreview(preview);
        setMessage('');
        return;
      }
      if (!window.confirm('Ganti seluruh data sesi dan kosongkan transaksi demo?')) return;
      const result = await parseSkuWorkbook(await file.arrayBuffer());
      await gateway.replaceFromWorkbook(result, file.name);
      setMessage(`${result.loaded.toLocaleString('id-ID')} SKU dimuat · ${result.skipped} dilewati`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Import gagal.'); }
    finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function commitCatalogue() {
    if (!cataloguePreview) return;
    setCommittingCatalogue(true);
    try {
      const receipt = await gateway.commitInitialCatalogue(
        cataloguePreview.importId,
      );
      setCataloguePreview(null);
      setMessage(
        `${receipt.rowCount.toLocaleString('id-ID')} SKU dikomit ke CH Core.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Komit import gagal.');
    } finally {
      setCommittingCatalogue(false);
    }
  }

  function openImagePicker(sku: Sku) {
    setImageTarget(sku);
    imageInput.current?.click();
  }

  async function replaceImage(file?: File) {
    if (!file || !imageTarget) return;
    try {
      if (!file.type.startsWith('image/')) throw new Error('Pilih file gambar yang valid.');
      await gateway.updateSku(imageTarget.id, { imageUrl: await readFileAsDataUrl(file) });
      setMessage(`Gambar ${imageTarget.skuNumber} diperbarui.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Gambar gagal diperbarui.');
    } finally {
      if (imageInput.current) imageInput.current.value = '';
      setImageTarget(null);
    }
  }

  async function applyAdjustment() {
    if (!adjusting) return;
    await gateway.adjustStock(adjusting.sku.id, Number(quantity) * adjusting.direction);
    setAdjusting(null); setQuantity('');
  }

  function openAdjustment(sku: Sku, direction: 1 | -1) { setAdjusting({ sku, direction }); setQuantity(''); }
  function openBarcodePrint(sku: Sku) { setPrinting(sku); setPrintQuantity('1'); }
  function openEdit(sku: Sku) { setEditing(sku); setEditNumber(sku.skuNumber); setEditName(sku.name); setEditNote(sku.note); setEditPrice(String(sku.referencePrice)); }
  async function saveEdit() {
    if (!editing) return;
    try { await gateway.updateSku(editing.id, { skuNumber: editNumber, name: editName, note: editNote, referencePrice: Number(editPrice) }); setEditing(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Perubahan gagal disimpan.'); }
  }
  const parsedPrintQuantity = Number(printQuantity);
  const validPrintQuantity = printQuantity !== '' && Number.isInteger(parsedPrintQuantity) && parsedPrintQuantity >= 1 && parsedPrintQuantity <= 10000;
  const barcodeCount = validPrintQuantity ? parsedPrintQuantity : 0;

  return (
    <div className="feature-page">
      <div className="feature-toolbar">
        <div><strong>{state.skus.length.toLocaleString('id-ID')} SKU</strong><span>{state.sourceLabel}</span></div>
        <div className="toolbar-actions">
          <input ref={fileInput} className="visually-hidden" type="file" accept=".xlsx" aria-label="Import XLSX" onChange={(event) => void importFile(event.target.files?.[0])} />
          <input ref={imageInput} className="visually-hidden" type="file" accept="image/*" aria-label="Pilih file gambar SKU" onChange={(event) => void replaceImage(event.target.files?.[0])} />
          <button className="button secondary" onClick={() => fileInput.current?.click()}>Import XLSX</button>
        </div>
      </div>
      {message && <div className="notice" role="status">{message}</div>}
      <div className="filters">
        <label className="search-field"><span>Cari</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nama / nomor SKU / scan QR" /></label>
        <label><span>Stok</span><select value={stockFilter} onChange={(event) => setStockFilter(event.target.value)}><option value="all">Semua</option><option value="positive">Tersedia</option><option value="empty">Kosong</option><option value="negative">Negatif</option></select></label>
        <label><span>Status</span><select value={showArchived ? 'archived' : 'active'} onChange={(event) => setShowArchived(event.target.value === 'archived')}><option value="active">Aktif</option><option value="archived">Diarsipkan</option></select></label>
      </div>
      <div className="table-frame">
        <table><thead><tr><th>Gambar</th><th>Nomor SKU</th><th>Nama SKU</th><th>Harga Referensi</th><th>Stok</th><th>Catatan</th><th>Dibuat</th><th>Aksi</th></tr></thead>
        <tbody>{filtered.slice(0, 50).map((sku) => (
          <tr key={sku.id}>
            <td><SkuImage gateway={gateway} sku={sku} onSelect={() => openImagePicker(sku)} /></td><td className="sku-number" title={sku.skuNumber}>{sku.skuNumber}</td><td>{sku.name}<small>{sku.tracked ? 'Stok dilacak' : 'Tanpa stok'}</small></td>
            <td>{formatRupiah(sku.referencePrice)}</td><td data-testid={`sku-stock-${sku.id}`} className={`stock-value ${sku.stock < 0 ? 'negative' : ''}`}>{sku.tracked ? sku.stock : '—'}</td><td>{sku.note || '—'}</td><td>{formatDate(sku.sourceCreatedAt || sku.createdAt)}</td>
            <td><div className="row-actions">{!sku.archived && <><button aria-label={`Edit ${sku.skuNumber}`} onClick={() => openEdit(sku)}>Edit</button><button aria-label={`Print barcode ${sku.skuNumber}`} onClick={() => openBarcodePrint(sku)}>Barcode</button></>}{sku.tracked && !sku.archived && <><button aria-label={`Tambah stok ${sku.skuNumber}`} onClick={() => openAdjustment(sku, 1)}>+ Stok</button><button aria-label={`Kurangi stok ${sku.skuNumber}`} onClick={() => openAdjustment(sku, -1)}>− Stok</button></>}<button onClick={() => void gateway.setArchived(sku.id, !sku.archived)}>{sku.archived ? 'Pulihkan' : 'Arsip'}</button></div></td>
          </tr>
        ))}</tbody></table>
        {!filtered.length && <div className="empty-state">Tidak ada SKU yang cocok.</div>}
      </div>
      <div className="table-footer">Menampilkan {Math.min(filtered.length, 50)} dari {filtered.length.toLocaleString('id-ID')}</div>
      {cataloguePreview && <div className="dialog-backdrop"><section className="dialog catalogue-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="catalogue-preview-title"><h2 id="catalogue-preview-title">Tinjau import katalog</h2><p><strong>{cataloguePreview.sourceFileName}</strong> sudah lolos validasi server. Periksa ringkasan sebelum data aktif diganti.</p><dl className="catalogue-preview-metrics"><div><dt>SKU</dt><dd>{cataloguePreview.preview.rowCount.toLocaleString('id-ID')}</dd></div><div><dt>Gambar antre</dt><dd>{cataloguePreview.preview.imageJobCount.toLocaleString('id-ID')}</dd></div><div><dt>Tanpa gambar</dt><dd>{cataloguePreview.preview.missingImageCount.toLocaleString('id-ID')}</dd></div><div><dt>Selisih harga</dt><dd>{cataloguePreview.preview.priceMismatchCount.toLocaleString('id-ID')}</dd></div><div><dt>Total harga terpilih</dt><dd>{formatRupiah(cataloguePreview.preview.selectedPriceTotal)}</dd></div><div><dt>Total stok</dt><dd>{cataloguePreview.preview.stockTotal.toLocaleString('id-ID')}</dd></div></dl>{cataloguePreview.preview.warnings.map((warning) => <div className="notice" key={warning}>{warning}</div>)}{cataloguePreview.preview.priceMismatches.length > 0 && <div className="catalogue-preview-table"><table><thead><tr><th>Baris</th><th>SKU</th><th>Modal</th><th>Jual</th><th>Terpilih</th></tr></thead><tbody>{cataloguePreview.preview.priceMismatches.map((mismatch) => <tr key={`${mismatch.rowNumber}-${mismatch.primarySku}`}><td>{mismatch.rowNumber}</td><td>{mismatch.primarySku}</td><td>{formatRupiah(mismatch.modalPrice)}</td><td>{formatRupiah(mismatch.salePrice)}</td><td>{formatRupiah(mismatch.selectedPrice)}</td></tr>)}</tbody></table></div>}<div className="dialog-actions"><button className="button secondary" disabled={committingCatalogue} onClick={() => setCataloguePreview(null)}>Batal</button><button className="button primary" disabled={committingCatalogue} onClick={() => void commitCatalogue()}>{committingCatalogue ? 'Mengomit…' : 'Komit katalog'}</button></div></section></div>}
      {adjusting && <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="adjust-title"><h2 id="adjust-title">{adjusting.direction === 1 ? 'Tambah stok' : 'Kurangi stok'}</h2><p><strong>{adjusting.sku.skuNumber}</strong> · stok saat ini {adjusting.sku.stock}</p><label><span>{adjusting.direction === 1 ? 'Jumlah stok ditambah' : 'Jumlah stok dikurangi'}</span><input autoFocus min="1" step="1" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><div className="dialog-actions"><button className="button secondary" onClick={() => setAdjusting(null)}>Batal</button><button className="button primary" disabled={!quantity || !Number.isInteger(Number(quantity)) || Number(quantity) <= 0} onClick={() => void applyAdjustment()}>{adjusting.direction === 1 ? 'Tambah stok' : 'Kurangi stok'}</button></div></section></div>}
      {printing && <div className="dialog-backdrop barcode-print-dialog"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="barcode-print-title"><h2 id="barcode-print-title">Print barcode produk</h2><p><strong>{printing.skuNumber}</strong> · {printing.name}</p><label><span>Jumlah barcode</span><input autoFocus min="1" max="10000" step="1" type="number" value={printQuantity} onChange={(event) => setPrintQuantity(event.target.value)} /></label><div className="barcode-print-sheet" aria-label="Preview barcode produk">{Array.from({ length: barcodeCount }, (_, index) => <div className="barcode-print-item" data-testid="barcode-print-item" key={index}><QRCodeSVG data-testid="barcode-product-qr" data-value={printing.skuNumber} value={printing.skuNumber} size={88} marginSize={0} /><strong>{printing.name}</strong><span>{printing.skuNumber}</span></div>)}</div><div className="dialog-actions"><button className="button secondary" aria-label="Tutup print barcode" onClick={() => setPrinting(null)}>Batal</button><button className="button primary" disabled={!validPrintQuantity} onClick={() => window.print()}>Print barcode sekarang</button></div></section></div>}
      {editing && <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title"><h2 id="edit-title">Edit SKU</h2><p>Nomor lama akan tetap menjadi alias pencarian.</p><div className="stack-fields"><label><span>Edit nomor SKU</span><input autoFocus value={editNumber} onChange={(event) => setEditNumber(event.target.value)} /></label><label><span>Edit nama SKU</span><input value={editName} onChange={(event) => setEditName(formatTitleCaseInput(event.currentTarget))} /></label><label><span>Edit harga referensi</span><input min="0" step="1" type="number" value={editPrice} onChange={(event) => setEditPrice(event.target.value)} /></label><label><span>Edit catatan SKU</span><textarea value={editNote} onChange={(event) => setEditNote(event.target.value)} /></label></div><div className="dialog-actions"><button className="button secondary" onClick={() => setEditing(null)}>Batal</button><button className="button primary" disabled={!editPrice || Number(editPrice) < 0} onClick={() => void saveEdit()}>Simpan perubahan SKU</button></div></section></div>}
    </div>
  );
}
