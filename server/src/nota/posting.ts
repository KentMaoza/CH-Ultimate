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

const MAX_SAFE_POSTING_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_POSTING_INTEGER = -MAX_SAFE_POSTING_INTEGER;

export class PostingArithmeticError extends RangeError {
  constructor(label: string) {
    super(`${label} exceeds the safe integer range`);
    this.name = 'PostingArithmeticError';
  }
}

export function assertSafePostingInteger(
  value: bigint,
  label: string,
): bigint {
  if (
    value < MIN_SAFE_POSTING_INTEGER ||
    value > MAX_SAFE_POSTING_INTEGER
  ) {
    throw new PostingArithmeticError(label);
  }
  return value;
}

export function checkedPostingAdd(
  left: bigint,
  right: bigint,
  label: string,
): bigint {
  assertSafePostingInteger(left, label);
  assertSafePostingInteger(right, label);
  return assertSafePostingInteger(left + right, label);
}

export function completionPosting(
  lines: PostingLine[],
  previous: PostingSnapshot | null,
): PostingEffects {
  const amountRupiah = lines.reduce(
    (sum, line) => {
      assertSafePostingInteger(line.lineTotalRupiah, 'line total');
      return checkedPostingAdd(sum, line.lineTotalRupiah, 'Nota amount');
    },
    0n,
  );
  const snapshotEffects = new Map<string, bigint>();
  for (const line of lines) {
    if (!line.skuId) continue;
    assertSafePostingInteger(line.quantityPcs, 'line quantity');
    snapshotEffects.set(
      line.skuId,
      checkedPostingAdd(
        snapshotEffects.get(line.skuId) ?? 0n,
        -line.quantityPcs,
        'stock effect',
      ),
    );
  }
  const prior = previous?.stockEffects ?? new Map<string, bigint>();
  const movementEffects = new Map<string, bigint>();
  for (const skuId of new Set([...snapshotEffects.keys(), ...prior.keys()])) {
    movementEffects.set(
      skuId,
      checkedPostingAdd(
        snapshotEffects.get(skuId) ?? 0n,
        -(prior.get(skuId) ?? 0n),
        'stock movement delta',
      ),
    );
  }
  return {
    amountRupiah,
    revenueDeltaRupiah: checkedPostingAdd(
      amountRupiah,
      -(previous?.amountRupiah ?? 0n),
      'revenue delta',
    ),
    snapshotEffects,
    movementEffects,
  };
}

export function reversalPosting(snapshot: PostingSnapshot): PostingEffects {
  assertSafePostingInteger(snapshot.amountRupiah, 'posting amount');
  return {
    amountRupiah: assertSafePostingInteger(
      -snapshot.amountRupiah,
      'posting reversal',
    ),
    revenueDeltaRupiah: assertSafePostingInteger(
      -snapshot.amountRupiah,
      'revenue reversal',
    ),
    snapshotEffects: new Map(),
    movementEffects: new Map(
      [...snapshot.stockEffects].map(([skuId, delta]) => [
        skuId,
        assertSafePostingInteger(-delta, 'stock reversal'),
      ]),
    ),
  };
}

export function restorePosting(snapshot: PostingSnapshot): PostingEffects {
  assertSafePostingInteger(snapshot.amountRupiah, 'posting amount');
  for (const delta of snapshot.stockEffects.values()) {
    assertSafePostingInteger(delta, 'stock restore');
  }
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
