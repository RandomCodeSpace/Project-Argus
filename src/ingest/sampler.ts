/**
 * Per-service token bucket adaptive sampling.
 * Always keeps: errors, slow traces, new services.
 */
export class Sampler {
  private rate: number;
  private alwaysOnErrors: boolean;
  private latencyThresholdMs: number;
  private buckets = new Map<string, TokenBucket>();
  private totalSeen = 0;
  private totalDropped = 0;

  constructor(rate: number, alwaysOnErrors: boolean, latencyThresholdMs: number) {
    this.rate = Math.max(0, Math.min(1, rate));
    this.alwaysOnErrors = alwaysOnErrors;
    this.latencyThresholdMs = latencyThresholdMs;
  }

  shouldSample(serviceName: string, isError: boolean, durationMs: number): boolean {
    this.totalSeen++;

    if (this.alwaysOnErrors && isError) return true;
    if (durationMs >= this.latencyThresholdMs) return true;
    if (this.rate >= 1.0) return true;
    if (this.rate <= 0) {
      this.totalDropped++;
      return false;
    }

    let bucket = this.buckets.get(serviceName);
    if (!bucket) {
      bucket = new TokenBucket(this.rate);
      this.buckets.set(serviceName, bucket);
      return true; // always let first trace through
    }

    const allow = bucket.allow();
    if (!allow) this.totalDropped++;
    return allow;
  }

  stats(): { seen: number; dropped: number } {
    return { seen: this.totalSeen, dropped: this.totalDropped };
  }
}

class TokenBucket {
  private rate: number;
  private tokens: number;
  private lastTick: number;

  constructor(rate: number) {
    this.rate = rate;
    this.tokens = rate;
    this.lastTick = Date.now();
  }

  allow(): boolean {
    const now = Date.now();
    const elapsed = (now - this.lastTick) / 1000;
    this.lastTick = now;

    this.tokens += elapsed * this.rate;
    if (this.tokens > 1.0) this.tokens = 1.0;

    const threshold = 1.0 / this.rate;
    if (this.tokens >= threshold) {
      this.tokens -= threshold;
      return true;
    }
    return false;
  }
}
