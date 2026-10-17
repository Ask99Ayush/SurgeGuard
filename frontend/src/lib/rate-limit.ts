/**
 * In-memory fixed-window limiter for login attempts. Adequate for the single frontend
 * instance in the Compose stack; a multi-instance deployment needs a shared store.
 */
export class LoginRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns seconds to wait if blocked, otherwise 0 (and records the attempt). */
  attempt(key: string): number {
    const now = this.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return 0;
    }
    if (entry.count >= this.limit) return Math.ceil((entry.resetAt - now) / 1000);
    entry.count += 1;
    return 0;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number): void {
    if (this.hits.size < 1000) return;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
