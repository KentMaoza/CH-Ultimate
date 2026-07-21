import { forwardRef, useImperativeHandle, useState, type KeyboardEvent } from 'react';
import { lineTotal } from '../../domain/nota';
import type { NotaLine, Sku, Unit } from '../../domain/types';
import type { NotaNumericField } from './useNotaValidation';

const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const fields = ['description', 'kind', 'quantity', 'lsn', 'pcs', 'lsnPrice', 'pcsPrice', 'total'];

function format(value: number) { return numberFormat.format(value); }
function validInteger(value: string, positive: boolean) {
  if (!value) return true;
  if (!/^\d+$/.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && (positive ? number > 0 : number >= 0);
}
function blank(line: NotaLine) { return !line.skuId && !line.description && !line.kind && !line.quantity && !line.pcsPrice && !line.lsnPrice; }
function matchesSku(sku: Sku, query: string) {
  const search = query.toLocaleLowerCase('id-ID');
  return [sku.name, sku.skuNumber, ...sku.aliases].some((value) => value.toLocaleLowerCase('id-ID').includes(search));
}

export interface NotaGridHandle { focusField(lineId: string, field: NotaNumericField): void; }

export const NotaGrid = forwardRef<NotaGridHandle, {
  lines: NotaLine[];
  suffix: string;
  skus: Sku[];
  editable: boolean;
  busy: boolean;
  invalidValues: Record<string, string>;
  onInvalidChange: (lineId: string, field: NotaNumericField, rawValue: string | null) => void;
  onUpdate: (line: NotaLine, patch: Partial<NotaLine>) => void;
  onDelete: (line: NotaLine) => void;
}>(function NotaGrid({ lines, suffix, skus, editable, busy, invalidValues, onInvalidChange, onUpdate, onDelete }, ref) {
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [focusedNumericField, setFocusedNumericField] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  const activeSuggestions = openRow === null ? [] : skus.filter((sku) => !sku.archived && matchesSku(sku, lines[openRow]?.description ?? ''));

  useImperativeHandle(ref, () => ({
    focusField(lineId, field) {
      document.querySelector<HTMLElement>(`.chu-nota-workspace [data-line-id="${lineId}"][data-field="${field}"]`)?.focus();
    },
  }));

  function fieldValue(line: NotaLine, field: NotaNumericField) {
    const key = `${line.id}:${field}`;
    const value = raw[key] ?? invalidValues[key] ?? (line[field] ? String(line[field]) : '');
    return focusedNumericField === key || !validInteger(value, field === 'quantity') ? value : value ? format(Number(value)) : '';
  }
  function numericValid(line: NotaLine, field: NotaNumericField) {
    const key = `${line.id}:${field}`;
    const rawValue = raw[key] ?? invalidValues[key] ?? (line[field] ? String(line[field]) : '');
    return validInteger(rawValue, field === 'quantity');
  }
  function numericChange(line: NotaLine, field: NotaNumericField, value: string) {
    const positive = field === 'quantity';
    setRaw((current) => ({ ...current, [`${line.id}:${field}`]: value }));
    const valid = validInteger(value, positive);
    onInvalidChange(line.id, field, valid ? null : value);
    if (valid) onUpdate(line, { [field]: value ? Number(value) : 0 });
  }
  function numericFocus(line: NotaLine, field: NotaNumericField) {
    const key = `${line.id}:${field}`;
    setRaw((current) => ({ ...current, [key]: current[key] ?? invalidValues[key] ?? (line[field] ? String(line[field]) : '') }));
    setFocusedNumericField(key);
  }
  function numericBlur(line: NotaLine, field: NotaNumericField) {
    const key = `${line.id}:${field}`;
    setFocusedNumericField((current) => current === key ? null : current);
  }
  function selectSku(line: NotaLine, sku: Sku) {
    setRaw((current) => {
      const next = { ...current };
      delete next[`${line.id}:pcsPrice`]; delete next[`${line.id}:lsnPrice`];
      return next;
    });
    onUpdate(line, { skuId: sku.id, description: sku.name, pcsPrice: sku.referencePrice, lsnPrice: sku.referencePrice * 12, unit: line.unit ?? 'pcs' });
    setOpenRow(null);
  }
  function focusCell(row: number, field: string) {
    document.querySelector<HTMLElement>(`.chu-nota-workspace [data-row-index="${row}"][data-field="${field}"]`)?.focus();
  }
  function gridKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const cell = target.closest<HTMLElement>('[data-row-index][data-field]');
    if (!cell) return;
    const row = Number(cell.dataset.rowIndex);
    const field = cell.dataset.field ?? '';
    const index = fields.indexOf(field);
    if (event.key === 'Enter') {
      if (field === 'lsn' || field === 'pcs') return;
      event.preventDefault();
      if (index === fields.length - 1) focusCell(Math.min(lines.length - 1, row + 1), fields[0]!);
      else focusCell(row, fields[index + 1]!);
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); focusCell(Math.max(0, Math.min(lines.length - 1, row + (event.key === 'ArrowDown' ? 1 : -1))), field);
    }
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && target instanceof HTMLInputElement) {
      const atBoundary = event.key === 'ArrowLeft' ? target.selectionStart === 0 : target.selectionStart === target.value.length;
      if (atBoundary) {
        const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
        if (next >= 0 && next < fields.length) { event.preventDefault(); focusCell(row, fields[next]!); }
      }
    }
  }

  return <section className="chu-nota-workspace__grid-frame" aria-label="Grid nota" onKeyDown={gridKeyDown}>
    <table><thead><tr><th>NO</th><th>NAMA BARANG</th><th>JENIS</th><th>JUMLAH</th><th>LSN</th><th>PCS</th><th>HARGA LSN</th><th>HARGA PCS</th><th>TOTAL</th><th>AKSI</th></tr></thead>
      <tbody data-testid="nota-grid-body">{lines.slice(0, 15).map((line, index) => {
        const suggestions = openRow === index ? activeSuggestions : [];
        const number = index + 1;
        const linkedSku = skus.find((sku) => sku.id === line.skuId);
        const activeOptionId = suggestions[highlight] ? `sku-option-${line.id}-${suggestions[highlight]!.id}` : undefined;
        return <tr key={line.id} data-testid={`nota-grid-row-${number}`}>
          <td>{number}{suffix}</td>
          <td className="chu-nota-workspace__sku-cell"><input role="combobox" aria-label={`Nama barang baris ${number}`} aria-expanded={openRow === index} aria-controls={`sku-options-${line.id}`} aria-activedescendant={activeOptionId} aria-autocomplete="list" data-grid-editable data-row-index={index} data-field="description" disabled={!editable || busy} value={line.description} onFocus={() => { setOpenRow(index); setHighlight(0); }} onChange={(event) => { onUpdate(line, { description: event.target.value, skuId: undefined }); setOpenRow(index); setHighlight(0); }} onKeyDown={(event) => {
            if (event.key === 'Escape') { setOpenRow(null); event.stopPropagation(); }
            if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); event.stopPropagation(); setHighlight((value) => Math.min(suggestions.length - 1, value + 1)); }
            if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); event.stopPropagation(); setHighlight((value) => Math.max(0, value - 1)); }
            if (event.key === 'Enter' && suggestions[highlight]) { event.preventDefault(); event.stopPropagation(); selectSku(line, suggestions[highlight]!); }
          }} />{linkedSku && <span className="chu-nota-workspace__linked-sku">{linkedSku.skuNumber}</span>}
            {openRow === index && suggestions.length > 0 && <ul id={`sku-options-${line.id}`} role="listbox" className="chu-nota-workspace__suggestions">{suggestions.map((sku, suggestionIndex) => <li key={sku.id} id={`sku-option-${line.id}-${sku.id}`} role="option" aria-selected={suggestionIndex === highlight} onMouseDown={(event) => event.preventDefault()} onClick={() => selectSku(line, sku)}>{sku.name} · {sku.skuNumber}{sku.aliases.length ? ` · ${sku.aliases.join(', ')}` : ''}</li>)}</ul>}
          </td>
          <td><input aria-label={`Jenis baris ${number}`} data-grid-editable data-row-index={index} data-field="kind" disabled={!editable || busy} value={line.kind} onChange={(event) => onUpdate(line, { kind: event.target.value })} /></td>
          <td><input aria-label={`Jumlah baris ${number}`} inputMode="numeric" data-grid-editable data-line-id={line.id} data-row-index={index} data-field="quantity" disabled={!editable || busy} value={fieldValue(line, 'quantity')} aria-invalid={!numericValid(line, 'quantity') || undefined} onFocus={() => numericFocus(line, 'quantity')} onBlur={() => numericBlur(line, 'quantity')} onChange={(event) => numericChange(line, 'quantity', event.target.value)} /></td>
          <td><button aria-label={`LSN baris ${number}`} aria-pressed={line.unit === 'lsn'} data-grid-editable data-row-index={index} data-field="lsn" disabled={!editable || busy} onClick={() => onUpdate(line, { unit: 'lsn' as Unit })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onUpdate(line, { unit: 'lsn' as Unit }); } }}>LSN</button></td>
          <td><button aria-label={`PCS baris ${number}`} aria-pressed={line.unit === 'pcs'} data-grid-editable data-row-index={index} data-field="pcs" disabled={!editable || busy} onClick={() => onUpdate(line, { unit: 'pcs' as Unit })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onUpdate(line, { unit: 'pcs' as Unit }); } }}>PCS</button></td>
          <td><input aria-label={`Harga LSN baris ${number}`} inputMode="numeric" data-grid-editable data-line-id={line.id} data-row-index={index} data-field="lsnPrice" disabled={!editable || busy} value={fieldValue(line, 'lsnPrice')} aria-invalid={!numericValid(line, 'lsnPrice') || undefined} onFocus={() => numericFocus(line, 'lsnPrice')} onBlur={() => numericBlur(line, 'lsnPrice')} onChange={(event) => numericChange(line, 'lsnPrice', event.target.value)} /></td>
          <td><input aria-label={`Harga PCS baris ${number}`} inputMode="numeric" data-grid-editable data-line-id={line.id} data-row-index={index} data-field="pcsPrice" disabled={!editable || busy} value={fieldValue(line, 'pcsPrice')} aria-invalid={!numericValid(line, 'pcsPrice') || undefined} onFocus={() => numericFocus(line, 'pcsPrice')} onBlur={() => numericBlur(line, 'pcsPrice')} onChange={(event) => numericChange(line, 'pcsPrice', event.target.value)} /></td>
          <td><output tabIndex={0} aria-label={`Total baris ${number}`} data-grid-editable data-row-index={index} data-field="total">{format(lineTotal(line))}</output></td>
          <td><button disabled={!editable || busy || blank(line)} onClick={() => onDelete(line)}>Hapus</button></td>
        </tr>;
      })}</tbody>
    </table>
  </section>;
});
