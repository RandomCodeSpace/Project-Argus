import { describe, it, expect } from "bun:test";
import { VectorIndex } from "../vectordb/index";

describe("VectorDB TF-IDF Index", () => {
  it("should add and search documents", () => {
    const idx = new VectorIndex(1000);
    idx.add(1, "svc-a", "ERROR", "connection timeout to database server");
    idx.add(2, "svc-a", "ERROR", "connection refused by database");
    idx.add(3, "svc-b", "ERROR", "null pointer exception in handler");

    const results = idx.search("database connection timeout", 10);
    expect(results.length).toBeGreaterThan(0);
    // The first result should be the most relevant
    expect(results[0].logId).toBe(1);
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("should only index ERROR/WARN severity", () => {
    const idx = new VectorIndex(1000);
    idx.add(1, "svc-a", "INFO", "request processed successfully");
    idx.add(2, "svc-a", "ERROR", "request processing failed");
    idx.add(3, "svc-a", "DEBUG", "entering handler function");

    expect(idx.size()).toBe(1); // Only ERROR indexed
  });

  it("should handle FIFO eviction", () => {
    const idx = new VectorIndex(10); // Small max
    for (let i = 0; i < 15; i++) {
      idx.add(i, "svc", "ERROR", `error message number ${i} with unique content`);
    }
    // After eviction, should have fewer than 15
    expect(idx.size()).toBeLessThan(15);
    expect(idx.size()).toBeGreaterThan(0);
  });

  it("should return empty for no matches", () => {
    const idx = new VectorIndex(1000);
    idx.add(1, "svc", "ERROR", "connection timeout");
    const results = idx.search("zzz xyz completely unrelated");
    expect(results.length).toBe(0);
  });

  it("should respect k limit", () => {
    const idx = new VectorIndex(1000);
    for (let i = 0; i < 20; i++) {
      idx.add(i, "svc", "ERROR", `error number ${i} connection failed`);
    }
    const results = idx.search("connection error", 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });
});
