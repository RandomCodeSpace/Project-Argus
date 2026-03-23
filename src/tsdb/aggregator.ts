/**
 * Tumbling window aggregator for metrics. Buffers raw metrics and flushes to DB periodically.
 */
import type { Repository, MetricBucket } from "../db/repository";
import type { RingBuffer } from "./ringbuffer";
import type { RawMetric } from "../ingest/otlp-http";

export class Aggregator {
  private repo: Repository;
  private windowSizeMs: number;
  private buckets = new Map<string, MetricBucket>();
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private maxCardinality: number = 0;
  private ring: RingBuffer | null = null;
  private onIngest: (() => void) | null = null;
  private onDropped: (() => void) | null = null;
  private overflowKey = "__cardinality_overflow__";

  constructor(repo: Repository, windowSizeMs: number) {
    this.repo = repo;
    this.windowSizeMs = windowSizeMs;
  }

  setCardinalityLimit(max: number): void {
    this.maxCardinality = max;
  }

  setRingBuffer(rb: RingBuffer): void {
    this.ring = rb;
  }

  setMetrics(onIngest: () => void, onDropped: () => void): void {
    this.onIngest = onIngest;
    this.onDropped = onDropped;
  }

  start(): void {
    this.flushInterval = setInterval(() => this.flush(), this.windowSizeMs);
    console.log(`TSDB Aggregator started (${this.windowSizeMs}ms window)`);
  }

  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush(); // final flush
  }

  ingest(m: RawMetric): void {
    // Feed ring buffer
    if (this.ring) {
      this.ring.record(m.name, m.serviceName, m.value, m.timestamp);
    }
    if (this.onIngest) this.onIngest();

    const attrJSON = JSON.stringify(m.attributes || {});
    let key = `${m.serviceName}|${m.name}|${attrJSON}`;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      // Cardinality guard
      if (this.maxCardinality > 0 && this.buckets.size >= this.maxCardinality) {
        key = this.overflowKey;
        bucket = this.buckets.get(key);
        if (!bucket) {
          const windowStart = new Date(Math.floor(m.timestamp.getTime() / this.windowSizeMs) * this.windowSizeMs);
          bucket = {
            name: "__overflow__",
            service_name: m.serviceName,
            time_bucket: windowStart.toISOString(),
            min: m.value,
            max: m.value,
            sum: m.value,
            count: 1,
          };
          this.buckets.set(key, bucket);
          return;
        }
      } else {
        const windowStart = new Date(Math.floor(m.timestamp.getTime() / this.windowSizeMs) * this.windowSizeMs);
        bucket = {
          name: m.name,
          service_name: m.serviceName,
          time_bucket: windowStart.toISOString(),
          min: m.value,
          max: m.value,
          sum: m.value,
          count: 1,
          attributes_json: attrJSON,
        };
        this.buckets.set(key, bucket);
        return;
      }
    }

    if (m.value < bucket.min) bucket.min = m.value;
    if (m.value > bucket.max) bucket.max = m.value;
    bucket.sum += m.value;
    bucket.count++;
  }

  bucketCount(): number {
    return this.buckets.size;
  }

  private flush(): void {
    if (this.buckets.size === 0) return;
    const batch = Array.from(this.buckets.values());
    this.buckets.clear();

    try {
      this.repo.batchCreateMetrics(batch);
    } catch (e) {
      console.error("Failed to persist metric batch:", e);
      if (this.onDropped) this.onDropped();
    }
  }
}
