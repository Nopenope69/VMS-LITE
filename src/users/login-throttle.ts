/**
 * In-memory brute-force protection for /api/auth/login (single appliance process).
 * Counts failed attempts per client IP and per IP+username inside a fixed window;
 * a successful login clears the username counter.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly maxPerUser = 5,
    private readonly maxPerIp = 20,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now
  ) {}

  /** Seconds until the caller may retry, or 0 when allowed. */
  retryAfterSeconds(ip: string, username: string): number {
    this.prune();
    const blocked = [
      [this.userKey(ip, username), this.maxPerUser],
      [this.ipKey(ip), this.maxPerIp],
    ] as const;
    for (const [key, max] of blocked) {
      const entry = this.failures.get(key);
      if (entry && entry.count >= max) {
        return Math.ceil((entry.windowStart + this.windowMs - this.now()) / 1000);
      }
    }
    return 0;
  }

  recordFailure(ip: string, username: string): void {
    for (const key of [this.userKey(ip, username), this.ipKey(ip)]) {
      const entry = this.failures.get(key);
      if (!entry || this.now() - entry.windowStart >= this.windowMs) {
        this.failures.set(key, { count: 1, windowStart: this.now() });
      } else {
        entry.count++;
      }
    }
  }

  recordSuccess(ip: string, username: string): void {
    this.failures.delete(this.userKey(ip, username));
  }

  private prune(): void {
    if (this.failures.size < 10_000) return;
    for (const [key, entry] of this.failures) {
      if (this.now() - entry.windowStart >= this.windowMs) this.failures.delete(key);
    }
  }

  private userKey(ip: string, username: string) {
    return `u:${ip}:${username.toLowerCase()}`;
  }

  private ipKey(ip: string) {
    return `ip:${ip}`;
  }
}
