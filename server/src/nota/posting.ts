export interface PostingLine {
  skuId: string | null;
  quantityPcs: bigint;
  lineTotalRupiah: bigint;
}

export interface PostingSnapshot {
  amountRupiah: bigint;
  stockEffects: Map<string, bigint>;
}

export interface PostingEffects {
  amountRupiah: bigint;
  revenueDeltaRupiah: bigint;
  snapshotEffects: Map<string, bigint>;
  movementEffects: Map<string, bigint>;
}

export function completionPosting(
  lines: PostingLine[],
  previous: PostingSnapshot | null,
): PostingEffects {
  const amountRupiah = lines.reduce(
    (sum, line) => sum + line.lineTotalRupiah,
    0n,
  );
  const snapshotEffects = new Map<string, bigint>();
  for (const line of lines) {
    if (!line.skuId) continue;
    snapshotEffects.set(
      line.skuId,
      (snapshotEffects.get(line.skuId) ?? 0n) - line.quantityPcs,
    );
  }
  const prior = previous?.stockEffects ?? new Map<string, bigint>();
  const movementEffects = new Map<string, bigint>();
  for (const skuId of new Set([...snapshotEffects.keys(), ...prior.keys()])) {
    movementEffects.set(
      skuId,
      (snapshotEffects.get(skuId) ?? 0n) - (prior.get(skuId) ?? 0n),
    );
  }
  return {
    amountRupiah,
    revenueDeltaRupiah: amountRupiah - (previous?.amountRupiah ?? 0n),
    snapshotEffects,
    movementEffects,
  };
}

export function reversalPosting(snapshot: PostingSnapshot): PostingEffects {
  return {
    amountRupiah: -snapshot.amountRupiah,
    revenueDeltaRupiah: -snapshot.amountRupiah,
    snapshotEffects: new Map(),
    movementEffects: new Map(
      [...snapshot.stockEffects].map(([skuId, delta]) => [skuId, -delta]),
    ),
  };
}

export function restorePosting(snapshot: PostingSnapshot): PostingEffects {
  return {
    amountRupiah: snapshot.amountRupiah,
    revenueDeltaRupiah: snapshot.amountRupiah,
    snapshotEffects: snapshot.stockEffects,
    movementEffects: snapshot.stockEffects,
  };
}

export function shouldReversePostingOnCancel(status: string): boolean {
  return status === 'completed' || status === 'reopened';
}

export function shouldReapplyPostingOnRestore(
  cancelledFromStatus: string,
): boolean {
  return cancelledFromStatus === 'completed' || cancelledFromStatus === 'reopened';
}
