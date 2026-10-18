export interface LimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter kept in memory. Good for a single instance.
 * For several instances, swap this for a shared store (Redis, Upstash, Cloudflare KV).
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {
    setInterval(() => this.sweep(), Math.min(windowMs, 60_000)).unref();
  }

  take(key: string, now = Date.now()): LimitResult {
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    const retryAfterSeconds = Math.ceil((entry.resetAt - now) / 1000);
    if (entry.count >= this.limit) return { ok: false, remaining: 0, retryAfterSeconds };
    entry.count++;
    return { ok: true, remaining: this.limit - entry.count, retryAfterSeconds };
  }

  /** Gives back a request that failed for reasons that aren't the user's fault. */
  refund(key: string): void {
    const entry = this.hits.get(key);
    if (entry && entry.count > 0) entry.count--;
  }

  private sweep(now = Date.now()) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

/** Caps total generations per UTC day, so a traffic spike can't run up the bill. */
export class DailyBudget {
  private day = '';
  private used = 0;

  constructor(readonly limit: number) {}

  take(now = new Date()): boolean {
    const today = now.toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }

  get usedToday(): number {
    return this.used;
  }
}
