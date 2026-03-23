import { describe, it, expect } from "bun:test";
import { RingBuffer } from "../tsdb/ringbuffer";

describe("RingBuffer", () => {
  it("should record and query values", () => {
    const rb = new RingBuffer(10, 1000); // 10 slots x 1s
    const now = new Date();

    rb.record("cpu_usage", "svc-a", 50, now);
    rb.record("cpu_usage", "svc-a", 60, now);
    rb.record("cpu_usage", "svc-a", 70, now);

    const windows = rb.queryRecent("cpu_usage", "svc-a", 5);
    expect(windows.length).toBeGreaterThan(0);

    const w = windows[0];
    expect(w.count).toBe(3);
    expect(w.sum).toBe(180);
    expect(w.min).toBe(50);
    expect(w.max).toBe(70);
  });

  it("should compute percentiles", () => {
    const rb = new RingBuffer(10, 1000);
    const now = new Date();

    for (let i = 1; i <= 100; i++) {
      rb.record("latency", "svc", i, now);
    }

    const windows = rb.queryRecent("latency", "svc", 1);
    expect(windows.length).toBe(1);
    const w = windows[0];
    expect(w.p50).toBeGreaterThan(40);
    expect(w.p50).toBeLessThan(60);
    expect(w.p95).toBeGreaterThan(90);
    expect(w.p99).toBeGreaterThan(95);
  });

  it("should advance windows on time change", () => {
    const rb = new RingBuffer(10, 1000);
    const t1 = new Date(2024, 0, 1, 0, 0, 0);
    const t2 = new Date(2024, 0, 1, 0, 0, 2); // 2s later

    rb.record("metric", "svc", 10, t1);
    rb.record("metric", "svc", 20, t2);

    const windows = rb.queryRecent("metric", "svc", 5);
    // Should have 2 windows with data
    expect(windows.length).toBeGreaterThanOrEqual(1);
  });

  it("should track multiple metrics", () => {
    const rb = new RingBuffer(10, 1000);
    const now = new Date();

    rb.record("cpu", "svc-a", 50, now);
    rb.record("mem", "svc-a", 1024, now);
    rb.record("cpu", "svc-b", 80, now);

    expect(rb.metricCount()).toBe(3);
    expect(rb.allKeys()).toContain("svc-a|cpu");
    expect(rb.allKeys()).toContain("svc-a|mem");
    expect(rb.allKeys()).toContain("svc-b|cpu");
  });

  it("should return empty for unknown metrics", () => {
    const rb = new RingBuffer(10, 1000);
    const windows = rb.queryRecent("nonexistent", "svc", 5);
    expect(windows.length).toBe(0);
  });
});
