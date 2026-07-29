export interface RedeemRateLimiter {
  consume(sourceKey: string): boolean;
}

export interface SlidingWindowRateLimiterOptions {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
}

export class SlidingWindowRateLimiter implements RedeemRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly maxKeys: number;

  constructor(private readonly options: SlidingWindowRateLimiterOptions) {
    if (
      !Number.isInteger(options.limit) ||
      options.limit < 1 ||
      !Number.isInteger(options.windowMs) ||
      options.windowMs < 1
    ) {
      throw new Error('Invalid rate limiter options');
    }
    this.now = options.now ?? Date.now;
    this.maxKeys = options.maxKeys ?? 10_000;
    if (!Number.isInteger(this.maxKeys) || this.maxKeys < 1) {
      throw new Error('Invalid rate limiter key limit');
    }
  }

  get trackedSourceCount(): number {
    return this.attempts.size;
  }

  consume(sourceKey: string): boolean {
    const now = this.now();
    const cutoff = now - this.options.windowMs;
    const recent = (this.attempts.get(sourceKey) ?? []).filter(
      (attemptedAt) => attemptedAt > cutoff,
    );
    if (!this.attempts.has(sourceKey)) {
      this.makeRoom(cutoff);
    }
    if (recent.length >= this.options.limit) {
      this.attempts.set(sourceKey, recent);
      return false;
    }

    recent.push(now);
    this.attempts.set(sourceKey, recent);
    return true;
  }

  private makeRoom(cutoff: number): void {
    if (this.attempts.size < this.maxKeys) {
      return;
    }
    for (const [key, attempts] of this.attempts) {
      if (!attempts.some((attemptedAt) => attemptedAt > cutoff)) {
        this.attempts.delete(key);
      }
    }
    while (this.attempts.size >= this.maxKeys) {
      const oldest = this.attempts.keys().next().value as
        | string
        | undefined;
      if (oldest === undefined) {
        break;
      }
      this.attempts.delete(oldest);
    }
  }
}
