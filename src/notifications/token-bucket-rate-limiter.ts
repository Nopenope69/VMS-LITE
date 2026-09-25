/**
 * Token-Bucket Rate Limiter with Anti-Spam Cooldown (EXT-07)
 *
 * Enforces dual-layer rate protection:
 * 1. Mandatory Cooldown: Consecutive alerts for the same (cameraId:eventType) are suppressed
 *    for cooldownSeconds (default 60s).
 * 2. Token Bucket: Limits burst alerts across different event types on the same camera
 *    (capacity: 3 tokens, refills 1 token every 60s).
 */

export interface TokenBucketOptions {
  capacity?: number;
  refillRatePerMinute?: number;
  cooldownSeconds?: number;
}

export interface AcquireResult {
  allowed: boolean;
  waitSeconds?: number;
  reason?: string;
}

interface BucketState {
  tokens: number;
  lastRefillTimestamp: number;
  lastAcquiredTimestamp: number;
}

export class TokenBucketRateLimiter {
  private readonly capacity: number;
  private readonly refillIntervalMs: number;
  private readonly defaultCooldownMs: number;

  private buckets: Map<string, BucketState> = new Map();

  constructor(options: TokenBucketOptions = {}) {
    this.capacity = options.capacity ?? 3;
    const ratePerMin = options.refillRatePerMinute ?? 1;
    this.refillIntervalMs = (60 * 1000) / ratePerMin;
    this.defaultCooldownMs = (options.cooldownSeconds ?? 60) * 1000;
  }

  /**
   * Attempts to acquire an alert token for a given key (e.g. "cam-1:motion.detected").
   */
  tryAcquire(key: string, cooldownOverrideSeconds?: number): AcquireResult {
    const now = Date.now();
    const cooldownMs =
      cooldownOverrideSeconds !== undefined
        ? cooldownOverrideSeconds * 1000
        : this.defaultCooldownMs;

    let state = this.buckets.get(key);

    if (!state) {
      // First event for this key
      this.buckets.set(key, {
        tokens: this.capacity - 1,
        lastRefillTimestamp: now,
        lastAcquiredTimestamp: now,
      });
      return { allowed: true };
    }

    // 1. Mandatory anti-spam cooldown check
    const elapsedSinceLast = now - state.lastAcquiredTimestamp;
    if (elapsedSinceLast < cooldownMs) {
      const waitSeconds = Math.ceil((cooldownMs - elapsedSinceLast) / 1000);
      return {
        allowed: false,
        waitSeconds,
        reason: `Anti-spam cooldown active for ${key} (wait ${waitSeconds}s)`,
      };
    }

    // 2. Refill tokens based on elapsed time
    const elapsedSinceRefill = now - state.lastRefillTimestamp;
    if (elapsedSinceRefill >= this.refillIntervalMs) {
      const tokensToAdd = Math.floor(elapsedSinceRefill / this.refillIntervalMs);
      state.tokens = Math.min(this.capacity, state.tokens + tokensToAdd);
      state.lastRefillTimestamp = now - (elapsedSinceRefill % this.refillIntervalMs);
    }

    // 3. Bucket capacity check
    if (state.tokens < 1) {
      const msUntilRefill = this.refillIntervalMs - (now - state.lastRefillTimestamp);
      const waitSeconds = Math.ceil(Math.max(1, msUntilRefill) / 1000);
      return {
        allowed: false,
        waitSeconds,
        reason: `Token bucket capacity exhausted for ${key} (wait ${waitSeconds}s for refill)`,
      };
    }

    // Consume 1 token
    state.tokens -= 1;
    state.lastAcquiredTimestamp = now;

    return { allowed: true };
  }

  /**
   * Resets rate limiter memory (useful for testing).
   */
  reset(): void {
    this.buckets.clear();
  }
}

export const tokenBucketRateLimiter = new TokenBucketRateLimiter();
export default tokenBucketRateLimiter;
