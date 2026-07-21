import { useEffect, useState } from 'react';
import type { NotaTransaction } from '../../domain/types';

export type NotaNumericField = 'quantity' | 'lsnPrice' | 'pcsPrice';

export interface InvalidNotaField {
  transactionId: string;
  pageId: string;
  lineId: string;
  field: NotaNumericField;
  rawValue: string;
}

const fieldOrder: NotaNumericField[] = ['quantity', 'lsnPrice', 'pcsPrice'];
const keyFor = (transactionId: string, pageId: string, lineId: string, field: NotaNumericField) => `${transactionId}:${pageId}:${lineId}:${field}`;

export function useNotaValidation(transactions: NotaTransaction[]) {
  const [invalidFields, setInvalidFields] = useState<Record<string, InvalidNotaField>>({});

  useEffect(() => {
    const liveLines = new Set(transactions.flatMap((transaction) => transaction.pages.flatMap((page) => page.lines.map((line) => `${transaction.id}:${page.id}:${line.id}`))));
    setInvalidFields((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([, entry]) => liveLines.has(`${entry.transactionId}:${entry.pageId}:${entry.lineId}`)));
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [transactions]);

  const report = (entry: Omit<InvalidNotaField, 'rawValue'>, rawValue: string | null) => {
    const key = keyFor(entry.transactionId, entry.pageId, entry.lineId, entry.field);
    setInvalidFields((current) => {
      if (rawValue === null) {
        if (!current[key]) return current;
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: { ...entry, rawValue } };
    });
  };

  const valuesForPage = (transactionId: string, pageId: string) => Object.fromEntries(
    Object.values(invalidFields)
      .filter((entry) => entry.transactionId === transactionId && entry.pageId === pageId)
      .map((entry) => [`${entry.lineId}:${entry.field}`, entry.rawValue]),
  );

  const firstInvalid = (transaction: NotaTransaction): InvalidNotaField | undefined => {
    for (const page of transaction.pages) {
      if (page.status !== 'active') continue;
      for (const line of page.lines) {
        for (const field of fieldOrder) {
          const invalid = invalidFields[keyFor(transaction.id, page.id, line.id, field)];
          if (invalid) return invalid;
        }
      }
    }
  };

  return { report, valuesForPage, firstInvalid };
}
