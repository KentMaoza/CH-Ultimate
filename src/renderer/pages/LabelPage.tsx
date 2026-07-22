import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { LabelTemplate } from '../../domain/types';
import { formatRupiah } from '../format';
import { useOperations } from '../operations-context';
import { InvoiceTemplateBuilder } from './InvoiceTemplateBuilder';

export function LabelPage() {
  const { state, gateway } = useOperations();
  const [mode, setMode] = useState<'label' | 'invoice'>('label');
  const [skuId, setSkuId] = useState(state.skus[0]?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const sku = state.skus.find((item) => item.id === skuId) ?? state.skus[0];
  const template = state.labelTemplate;
  const update = (patch: Partial<LabelTemplate>) => void gateway.setLabelTemplate({ ...template, ...patch });
  const toggleField = (field: LabelTemplate['fields'][number]) => update({ fields: template.fields.includes(field) ? template.fields.filter((item) => item !== field) : [...template.fields, field] });
  if (mode === 'invoice') return <><div className="template-tabs" role="tablist" aria-label="Jenis template"><button role="tab" aria-selected={false} onClick={() => setMode('label')}>Label</button><button role="tab" aria-selected>Invoice</button></div><InvoiceTemplateBuilder /></>;
  return (
    <><div className="template-tabs" role="tablist" aria-label="Jenis template"><button role="tab" aria-selected onClick={() => setMode('label')}>Label</button><button role="tab" aria-selected={false} onClick={() => setMode('invoice')}>Invoice</button></div><div className="feature-page label-layout">
      <section className="builder-panel">
        <div className="section-heading"><span>GUIDED BUILDER</span><h2>Template label</h2><p>Atur media, ukuran, dan isi. Output produksi belum aktif.</p></div>
        <div className="form-grid compact">
          <label><span>Media label</span><select value={template.medium} onChange={(event) => update({ medium: event.target.value as LabelTemplate['medium'], columns: event.target.value === 'a4' ? 3 : 1 })}><option value="thermal">Thermal roll</option><option value="a4">A4 grid</option></select></label>
          <label><span>SKU preview</span><select value={sku?.id} onChange={(event) => setSkuId(event.target.value)}>{state.skus.filter((item) => !item.archived).map((item) => <option key={item.id} value={item.id}>{item.skuNumber}</option>)}</select></label>
          <label><span>Lebar (mm)</span><input type="number" min="20" value={template.widthMm} onChange={(event) => update({ widthMm: Number(event.target.value) })} /></label>
          <label><span>Tinggi (mm)</span><input type="number" min="15" value={template.heightMm} onChange={(event) => update({ heightMm: Number(event.target.value) })} /></label>
          <label><span>Kolom</span><input type="number" min="1" max="6" value={template.columns} onChange={(event) => update({ columns: Number(event.target.value) })} /></label>
          <label><span>Margin (mm)</span><input type="number" min="0" value={template.marginMm} onChange={(event) => update({ marginMm: Number(event.target.value) })} /></label>
          <label><span>Jarak (mm)</span><input type="number" min="0" value={template.gapMm} onChange={(event) => update({ gapMm: Number(event.target.value) })} /></label>
          <label><span>Ukuran font</span><input type="number" min="7" max="24" value={template.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></label>
          <label><span>Alignment</span><select value={template.alignment} onChange={(event) => update({ alignment: event.target.value as LabelTemplate['alignment'] })}><option value="left">Kiri</option><option value="center">Tengah</option><option value="right">Kanan</option></select></label>
          <label><span>Jumlah print</span><input type="number" min="1" max="10000" value={quantity} onChange={(event) => setQuantity(Math.min(10000, Math.max(1, Number(event.target.value))))} /></label>
        </div>
        <fieldset className="field-toggles"><legend>Elemen label</legend>{(['qr', 'name', 'sku', 'price', 'chu'] as const).map((field) => <label key={field} className="check-field"><input type="checkbox" checked={template.fields.includes(field)} onChange={() => toggleField(field)} /><span>{field.toUpperCase()}</span></label>)}</fieldset>
        <div className="form-actions"><button className="button secondary" disabled aria-label="Export PDF label">Export PDF</button><button className="button primary" disabled aria-label="Print label">Print</button></div>
      </section>
      <section className="preview-panel">
        <div className="preview-title"><strong>{template.medium === 'a4' ? 'Preview A4' : 'Preview thermal'}</strong><span>{quantity.toLocaleString('id-ID')} label · maksimum 10.000</span></div>
        <div className={`label-sheet ${template.medium}`} style={{ gridTemplateColumns: `repeat(${template.medium === 'a4' ? template.columns : 1}, minmax(0, 1fr))`, gap: `${template.gapMm}px`, padding: `${template.marginMm * 2}px` }}>
          {Array.from({ length: template.medium === 'a4' ? Math.min(template.columns * 3, quantity) : 1 }, (_, index) => <div key={index} className="label-card" style={{ aspectRatio: `${template.widthMm}/${template.heightMm}`, textAlign: template.alignment, fontSize: template.fontSize }}>
            {sku && template.fields.includes('qr') && <QRCodeSVG data-testid={index === 0 ? 'label-qr' : undefined} value={sku.skuNumber} size={64} marginSize={0} />}
            {template.fields.includes('chu') && <b>CHU</b>}{template.fields.includes('name') && <strong>{sku?.name}</strong>}{template.fields.includes('sku') && <span>{sku?.skuNumber}</span>}{template.fields.includes('price') && <span>{formatRupiah(sku?.referencePrice ?? 0)}</span>}
          </div>)}
        </div>
      </section>
    </div></>
  );
}
