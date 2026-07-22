export interface NotaUndoEntry {
  transactionId: string;
  key: string;
  createdAt: number;
  undo: () => Promise<void>;
}

export function createNotaUndoHistory(limit = 50, coalesceMs = 750) {
  const entries = new Map<string, NotaUndoEntry[]>();

  return {
    push(entry: NotaUndoEntry) {
      const transactionEntries = entries.get(entry.transactionId) ?? [];
      const previous = transactionEntries.at(-1);
      if (previous?.key === entry.key && entry.createdAt - previous.createdAt <= coalesceMs) {
        transactionEntries[transactionEntries.length - 1] = { ...previous, createdAt: entry.createdAt };
      } else {
        transactionEntries.push(entry);
        if (transactionEntries.length > limit) transactionEntries.splice(0, transactionEntries.length - limit);
      }
      entries.set(entry.transactionId, transactionEntries);
    },
    pop(transactionId: string) {
      const transactionEntries = entries.get(transactionId);
      const entry = transactionEntries?.pop();
      if (!transactionEntries?.length) entries.delete(transactionId);
      return entry;
    },
    has(transactionId: string) {
      return Boolean(entries.get(transactionId)?.length);
    },
    clear(transactionId: string) {
      entries.delete(transactionId);
    },
  };
}
