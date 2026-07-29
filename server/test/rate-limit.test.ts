import { describe, expect, it } from 'vitest';

import { SlidingWindowRateLimiter } from '../src/auth/rate-limit.js';

describe('SlidingWindowRateLimiter', () => {
  it('bounds tracked sources and evicts inactive entries', () => {
    let now = 0;
    const limiter = new SlidingWindowRateLimiter({
      limit: 2,
      windowMs: 1_000,
      maxKeys: 3,
      now: () => now,
    });

    for (const source of ['one', 'two', 'three']) {
      expect(limiter.consume(source)).toBe(true);
    }
    expect(limiter.trackedSourceCount).toBe(3);

    now = 1_001;
    expect(limiter.consume('four')).toBe(true);
    expect(limiter.trackedSourceCount).toBe(1);
  });

  it('evicts the oldest active source when distinct input exceeds its cap', () => {
    const limiter = new SlidingWindowRateLimiter({
      limit: 2,
      windowMs: 10_000,
      maxKeys: 2,
      now: () => 100,
    });

    limiter.consume('one');
    limiter.consume('two');
    limiter.consume('three');

    expect(limiter.trackedSourceCount).toBe(2);
    expect(limiter.consume('one')).toBe(true);
    expect(limiter.trackedSourceCount).toBe(2);
  });
});
