export interface RedeemRateLimiter {
  consume(sourceKey: string): boolean;
}

export interface SlidingWindowRateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export class SlidingWindowRateLimiter implements RedeemRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private readonly options: SlidingWindowRateLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  consume(sourceKey: string): boolean {
    const now = this.now();
    const cutoff = now - this.options.windowMs;
    const recent = (this.attempts.get(sourceKey) ?? []).filter(
      (attemptedAt) => attemptedAt > cutoff,
    );
    if (recent.length >= this.options.limit) {
      this.attempts.set(sourceKey, recent);
      return false;
    }

    recent.push(now);
    this.attempts.set(sourceKey, recent);
    return true;
  }
}
