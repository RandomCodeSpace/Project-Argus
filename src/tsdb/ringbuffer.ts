/**
 * In-memory ring buffer for per-metric sliding windows with pre-computed percentiles.
 */
export interface WindowAgg {
  metricName: string;
  serviceName: string;
  windowStart: Date;
  count: number;
  sum: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number[]; // internal, capped at maxSamples
}

const MAX_SAMPLES = 256;

function newEmptyAgg(metric: string, service: string): WindowAgg {
  return {
    metricName: metric,
    serviceName: service,
    windowStart: new Date(),
    count: 0,
    sum: 0,
    min: Number.MAX_VALUE,
    max: -Number.MAX_VALUE,
    p50: 0,
    p95: 0,
    p99: 0,
    samples: [],
  };
}

function percentile(data: number[], p: number): number {
  if (data.length === 0) return 0;
  const sorted = [...data].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(Math.ceil((p / 100) * sorted.length) - 1, sorted.length - 1));
  return sorted[idx];
}

class MetricRing {
  private slots: WindowAgg[];
  private size: number;
  private windowDur: number; // ms
  private currentIdx: number = 0;
  private currentStart: Date;
  private metricName: string;
  private serviceName: string;

  constructor(metricName: string, serviceName: string, slots: number, windowDurMs: number) {
    this.metricName = metricName;
    this.serviceName = serviceName;
    this.size = slots;
    this.windowDur = windowDurMs;
    this.slots = Array.from({ length: slots }, () => newEmptyAgg(metricName, serviceName));
    const now = new Date();
    this.currentStart = new Date(Math.floor(now.getTime() / windowDurMs) * windowDurMs);
    this.slots[0].windowStart = this.currentStart;
  }

  record(value: number, at: Date): void {
    const windowStart = new Date(Math.floor(at.getTime() / this.windowDur) * this.windowDur);
    if (windowStart.getTime() > this.currentStart.getTime()) {
      const steps = Math.floor((windowStart.getTime() - this.currentStart.getTime()) / this.windowDur);
      for (let i = 0; i < Math.min(steps, this.size); i++) {
        this.currentIdx = (this.currentIdx + 1) % this.size;
        this.currentStart = new Date(this.currentStart.getTime() + this.windowDur);
        this.slots[this.currentIdx] = newEmptyAgg(this.metricName, this.serviceName);
        this.slots[this.currentIdx].windowStart = new Date(this.currentStart);
      }
    }

    const s = this.slots[this.currentIdx];
    s.count++;
    s.sum += value;
    if (value < s.min) s.min = value;
    if (value > s.max) s.max = value;
    if (s.samples.length < MAX_SAMPLES) {
      s.samples.push(value);
    }
  }

  windows(n: number): WindowAgg[] {
    if (n > this.size) n = this.size;
    const result: WindowAgg[] = [];
    for (let i = 0; i < n; i++) {
      const idx = (this.currentIdx - i + this.size) % this.size;
      const s = this.slots[idx];
      if (s.count > 0) {
        const agg = { ...s };
        agg.p50 = percentile(s.samples, 50);
        agg.p95 = percentile(s.samples, 95);
        agg.p99 = percentile(s.samples, 99);
        if (agg.min === Number.MAX_VALUE) agg.min = 0;
        if (agg.max === -Number.MAX_VALUE) agg.max = 0;
        agg.samples = []; // don't leak
        result.push(agg);
      }
    }
    return result;
  }
}

export class RingBuffer {
  private rings = new Map<string, MetricRing>();
  private slots: number;
  private windowDurMs: number;

  constructor(slots: number, windowDurMs: number) {
    this.slots = slots;
    this.windowDurMs = windowDurMs;
  }

  record(metricName: string, serviceName: string, value: number, at: Date): void {
    const key = `${serviceName}|${metricName}`;
    let ring = this.rings.get(key);
    if (!ring) {
      ring = new MetricRing(metricName, serviceName, this.slots, this.windowDurMs);
      this.rings.set(key, ring);
    }
    ring.record(value, at);
  }

  queryRecent(metricName: string, serviceName: string, windowCount: number): WindowAgg[] {
    const key = `${serviceName}|${metricName}`;
    const ring = this.rings.get(key);
    if (!ring) return [];
    return ring.windows(windowCount);
  }

  allKeys(): string[] {
    return Array.from(this.rings.keys());
  }

  metricCount(): number {
    return this.rings.size;
  }
}
