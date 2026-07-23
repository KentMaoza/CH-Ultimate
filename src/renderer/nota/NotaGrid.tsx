import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { lineTotal } from '../../domain/nota';
import type { NotaLine, Sku, Unit } from '../../domain/types';
import type { NotaVoiceRequest } from './nota-voice';
import type { NotaNumericField } from './useNotaValidation';
import { formatTitleCaseInput } from '../format';
import { WarehouseSkuPanel } from './WarehouseSkuPanel';

const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const fields = ['description', 'kind', 'quantity', 'pcs', 'lsn', 'pcsPrice', 'lsnPrice', 'total'];

function format(value: number) { return numberFormat.format(value); }
function normalizePrice(value: string) {
  const digits = value.replaceAll('.', '');
  return /^\d*$/.test(digits) ? digits : null;
}
function validInteger(value: string, positive: boolean) {
  if (!value) return true;
  if (!/^\d+$/.test(value)) return false;
  const number = Number(value);
  return Number.isSafeInteger(number) && (positive ? number > 0 : number >= 0);
}
function blank(line: NotaLine) { return !line.skuId && !line.description && !line.kind && !line.quantity && !line.pcsPrice && !line.lsnPrice; }
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
  onLineCommitted?: (request: NotaVoiceRequest) => void;
}>(function NotaGrid({ lines, suffix, skus, editable, busy, invalidValues, onInvalidChange, onUpdate, onDelete, onLineCommitted }, ref) {
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [focusedNumericField, setFocusedNumericField] = useState<string | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [panelMessage, setPanelMessage] = useState('');
  const pendingCaret = useRef<{ key: string; digits: number } | null>(null);
  const numericOnFocus = useRef<Record<string, number>>({});
  const suppressVoiceCommit = useRef<string | null>(null);
  const firstBlankRow = lines.findIndex(blank);
  const targetRow = selectedRow ?? firstBlankRow;

  useEffect(() => { setSelectedRow(null); setPanelMessage(''); }, [suffix]);

  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (!pending) return;
    pendingCaret.current = null;
    const [lineId, field] = pending.key.split(':');
    const input = document.querySelector<HTMLInputElement>(`.chu-nota-workspace [data-line-id="${lineId}"][data-field="${field}"]`);
    if (!input) return;
    let digits = 0;
    let position = 0;
    while (position < input.value.length && digits < pending.digits) {
      if (/\d/.test(input.value[position]!)) digits += 1;
      position += 1;
    }
    input.setSelectionRange(position, position);
  });

  useImperativeHandle(ref, () => ({
    focusField(lineId, field) {
      document.querySelector<HTMLElement>(`.chu-nota-workspace [data-line-id="${lineId}"][data-field="${field}"]`)?.focus();
    },
  }));

  function fieldValue(line: NotaLine, field: NotaNumericField) {
    const key = `${line.id}:${field}`;
    const value = raw[key] ?? invalidValues[key] ?? (line[field] ? String(line[field]) : '');
    if (field === 'quantity') return focusedNumericField === key || !validInteger(value, true) ? value : value ? String(Number(value)) : '';
    return validInteger(value, false) ? value ? format(Number(value)) : '' : value;
  }
  function numericValid(line: NotaLine, field: NotaNumericField) {
    const key = `${line.id}:${field}`;
    const rawValue = raw[key] ?? invalidValues[key] ?? (line[field] ? String(line[field]) : '');
    return validInteger(rawValue, field === 'quantity');
  }
  function numericChange(line: NotaLine, field: NotaNumericField, value: string, caret?: number | null) {
    const positive = field === 'quantity';
    const normalized = positive ? value : normalizePrice(value);
    const nextValue = normalized ?? value;
    const key = `${line.id}:${field}`;
    if (!positive && normalized !== null && caret !== null && caret !== undefined) {
      pendingCaret.current = { key, digits: value.slice(0, caret).replace(/\D/g, '').length };
    }
    setRaw((current) => ({ ...current, [key]: nextValue }));
    const valid = normalized !== null && validInteger(nextValue, positive);
    onInvalidChange(line.id, field, valid ? null : value);
    if (valid) onUpdate(line, { [field]: nextValue ? Number(nextValue) : 0 });
  }
  function numericFocus(line: NotaLine, field: NotaNumericField, value: string) {
    const key = `${line.id}:${field}`;
    numericOnFocus.current[key] = line[field];
    setRaw((current) => ({ ...current, [key]: current[key] ?? invalidValues[key] ?? (line[field] ? String(line[field]) : '') }));
    setFocusedNumericField(key);
  }
  function numericBlur(line: NotaLine, field: NotaNumericField, value: string, rowIndex?: number, nextTarget?: EventTarget | null) {
    const key = `${line.id}:${field}`;
    setFocusedNumericField((current) => current === key ? null : current);
    const focusedValue = numericOnFocus.current[key];
    delete numericOnFocus.current[key];
    if (field !== 'quantity' && field !== 'pcsPrice' && field !== 'lsnPrice') return;
    const suppress = suppressVoiceCommit.current === line.id || (nextTarget instanceof Element && nextTarget.closest('[data-nota-delete]'));
    if (suppress) suppressVoiceCommit.current = null;
    const normalized = field === 'quantity' ? value : normalizePrice(value);
    if (normalized === null || !/^\d+$/.test(normalized)) return;
    const committedValue = Number(normalized);
    const changed = focusedValue !== undefined && focusedValue !== committedValue;
    const activePriceField: NotaNumericField = line.unit === 'lsn' ? 'lsnPrice' : 'pcsPrice';
    const relevantPriceCommit = field === activePriceField || (line.unit === 'lsn' && field === 'pcsPrice');
    if (suppress || !changed || (field !== 'quantity' && !relevantPriceCommit) || rowIndex === undefined) return;
    const quantity = field === 'quantity' ? committedValue : line.quantity;
    const price = field === 'quantity'
      ? (line.unit === 'lsn' && line.lsnPrice <= 0 ? line.pcsPrice : line[activePriceField])
      : committedValue;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 48 || !Number.isInteger(price) || price < 1 || price > 1_000_000) return;
    onLineCommitted?.({ rowNumber: rowIndex + 1, suffix, quantity, unit: line.unit, price });
  }
  function selectSku(line: NotaLine, sku: Sku) {
    setRaw((current) => {
      const next = { ...current };
      delete next[`${line.id}:pcsPrice`]; delete next[`${line.id}:lsnPrice`];
      return next;
    });
    onInvalidChange(line.id, 'pcsPrice', null);
    onInvalidChange(line.id, 'lsnPrice', null);
    onUpdate(line, { skuId: sku.id, description: sku.name, pcsPrice: sku.referencePrice, lsnPrice: sku.referencePrice * 12, unit: line.unit ?? 'pcs' });
  }
  function clearLine(line: NotaLine) {
    setRaw((current) => {
      const next = { ...current };
      delete next[`${line.id}:quantity`];
      delete next[`${line.id}:pcsPrice`];
      delete next[`${line.id}:lsnPrice`];
      return next;
    });
    setFocusedNumericField((current) => current?.startsWith(`${line.id}:`) ? null : current);
    delete numericOnFocus.current[`${line.id}:quantity`];
    delete numericOnFocus.current[`${line.id}:pcsPrice`];
    delete numericOnFocus.current[`${line.id}:lsnPrice`];
    if (suppressVoiceCommit.current === line.id) suppressVoiceCommit.current = null;
    onInvalidChange(line.id, 'quantity', null);
    onInvalidChange(line.id, 'pcsPrice', null);
    onInvalidChange(line.id, 'lsnPrice', null);
    onDelete(line);
  }
  function selectWarehouseSku(sku: Sku) {
    const line = lines[targetRow];
    if (!line) {
      setPanelMessage('Semua 15 baris terisi. Pilih baris yang akan diganti atau tambah Nota berikutnya.');
      return;
    }
    setPanelMessage('');
    setSelectedRow(targetRow);
    selectSku(line, sku);
    window.setTimeout(() => focusCell(targetRow, 'quantity'), 0);
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
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter') {
      if (field === 'lsn' || field === 'pcs') return;
      event.preventDefault();
      if (index === fields.length - 1) focusCell(Math.min(lines.length - 1, row + 1), fields[0]!);
      else focusCell(row, fields[index + 1]!);
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); focusCell(Math.max(0, Math.min(lines.length - 1, row + (event.key === 'ArrowDown' ? 1 : -1))), field);
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const current = row * fields.length + index;
      const next = Math.max(0, Math.min(lines.length * fields.length - 1, current + (event.key === 'ArrowLeft' ? -1 : 1)));
      focusCell(Math.floor(next / fields.length), fields[next % fields.length]!);
    }
  }

  return <>
    {editable && <WarehouseSkuPanel key={suffix} skus={skus} targetLabel={targetRow >= 0 ? `${targetRow + 1}${suffix}` : '—'} disabled={busy} onSelect={selectWarehouseSku} />}
    {panelMessage && <p className="chu-nota-workspace__notice" role="status">{panelMessage}</p>}
    <section className="chu-nota-workspace__grid-frame" aria-label="Grid nota" onKeyDown={gridKeyDown}>
    <table><thead><tr><th>NO</th><th>NAMA BARANG</th><th>JENIS</th><th>JUMLAH</th><th>PCS</th><th>LSN</th><th>HARGA PCS</th><th>HARGA LSN</th><th>TOTAL</th><th>AKSI</th></tr></thead>
      <tbody data-testid="nota-grid-body">{lines.slice(0, 15).map((line, index) => {
        const number = index + 1;
        const linkedSku = skus.find((sku) => sku.id === line.skuId);
        return <tr key={line.id} data-testid={`nota-grid-row-${number}`} className={targetRow === index ? 'chu-nota-workspace__row--target' : undefined} onFocusCapture={() => setSelectedRow(index)} onMouseDown={() => setSelectedRow(index)}>
          <td>{number}{suffix}</td>
          <td className="chu-nota-workspace__sku-cell"><input aria-label={`Nama barang baris ${number}`} data-grid-editable data-row-index={index} data-field="description" disabled={!editable || busy} value={line.description} onChange={(event) => onUpdate(line, { description: formatTitleCaseInput(event.currentTarget), skuId: undefined })} />{linkedSku && <span className="chu-nota-workspace__linked-sku">{linkedSku.skuNumber}</span>}
          </td>
          <td><input aria-label={`Jenis baris ${number}`} data-grid-editable data-row-index={index} data-field="kind" disabled={!editable || busy} value={line.kind} onChange={(event) => onUpdate(line, { kind: formatTitleCaseInput(event.currentTarget) })} /></td>
          <td><input aria-label={`Jumlah baris ${number}`} inputMode="numeric" data-grid-editable data-line-id={line.id} data-row-index={index} data-field="quantity" disabled={!editable || busy} value={fieldValue(line, 'quantity')} aria-invalid={!numericValid(line, 'quantity') || undefined} onFocus={(event) => numericFocus(line, 'quantity', event.currentTarget.value)} onBlur={(event) => numericBlur(line, 'quantity', event.currentTarget.value, index, event.relatedTarget)} onChange={(event) => numericChange(line, 'quantity', event.target.value)} /></td>
          <td><button className={line.unit === 'pcs' ? 'chu-nota-workspace__unit--selected' : undefined} aria-label={`PCS baris ${number}`} aria-pressed={line.unit === 'pcs'} data-grid-editable data-row-index={index} data-field="pcs" disabled={!editable || busy} onClick={() => onUpdate(line, { unit: 'pcs' as Unit })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onUpdate(line, { unit: 'pcs' as Unit }); } }}>PCS</button></td>
          <td><button className={line.unit === 'lsn' ? 'chu-nota-workspace__unit--selected' : undefined} aria-label={`LSN baris ${number}`} aria-pressed={line.unit === 'lsn'} data-grid-editable data-row-index={index} data-field="lsn" disabled={!editable || busy} onClick={() => onUpdate(line, { unit: 'lsn' as Unit })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onUpdate(line, { unit: 'lsn' as Unit }); } }}>LSN</button></td>
          <td><input aria-label={`Harga PCS baris ${number}`} inputMode="numeric" data-grid-editable data-line-id={line.id} data-row-index={index} data-field="pcsPrice" disabled={!editable || busy} value={fieldValue(line, 'pcsPrice')} aria-invalid={!numericValid(line, 'pcsPrice') || undefined} onFocus={(event) => numericFocus(line, 'pcsPrice', event.currentTarget.value)} onBlur={(event) => numericBlur(line, 'pcsPrice', event.currentTarget.value, index, event.relatedTarget)} onChange={(event) => numericChange(line, 'pcsPrice', event.target.value, event.target.selectionStart)} /></td>
          <td><input aria-label={`Harga LSN baris ${number}`} inputMode="numeric" data-grid-editable data-line-id={line.id} data-row-index={index} data-field="lsnPrice" disabled={!editable || busy} value={fieldValue(line, 'lsnPrice')} aria-invalid={!numericValid(line, 'lsnPrice') || undefined} onFocus={(event) => numericFocus(line, 'lsnPrice', event.currentTarget.value)} onBlur={(event) => numericBlur(line, 'lsnPrice', event.currentTarget.value, index, event.relatedTarget)} onChange={(event) => numericChange(line, 'lsnPrice', event.target.value, event.target.selectionStart)} /></td>
          <td><output tabIndex={0} aria-label={`Total baris ${number}`} data-grid-editable data-row-index={index} data-field="total">{format(lineTotal(line))}</output></td>
          <td><button data-nota-delete disabled={!editable || busy || blank(line)} onMouseDown={() => { suppressVoiceCommit.current = line.id; }} onClick={() => clearLine(line)}>Hapus</button></td>
        </tr>;
      })}</tbody>
    </table>
    </section>
  </>;
});
