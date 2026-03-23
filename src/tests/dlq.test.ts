import { describe, it, expect, afterEach } from "bun:test";
import { DeadLetterQueue } from "../queue/dlq";
import * as fs from "fs";
import * as path from "path";

const TEST_DIR = "/tmp/otelcontext-dlq-test-" + Date.now();

afterEach(() => {
  try { fs.rmSync(TEST_DIR, { recursive: true }); } catch {}
});

describe("DeadLetterQueue", () => {
  it("should enqueue and count files", () => {
    const replayed: any[] = [];
    const dlq = new DeadLetterQueue(TEST_DIR, 999999, (data) => {
      replayed.push(JSON.parse(data.toString()));
    });

    dlq.enqueue({ type: "logs", data: [{ body: "test" }] });
    dlq.enqueue({ type: "logs", data: [{ body: "test2" }] });

    expect(dlq.size()).toBe(2);
    expect(dlq.diskBytes()).toBeGreaterThan(0);
    dlq.stop();
  });

  it("should enforce max files limit", () => {
    const dlq = new DeadLetterQueue(TEST_DIR, 999999, () => {}, 3, 0, 0);

    for (let i = 0; i < 5; i++) {
      dlq.enqueue({ type: "logs", data: [{ id: i }] });
    }

    // Should have at most 3 files
    expect(dlq.size()).toBeLessThanOrEqual(3);
    dlq.stop();
  });

  it("should report disk bytes", () => {
    const dlq = new DeadLetterQueue(TEST_DIR, 999999, () => {});
    dlq.enqueue({ type: "logs", data: Array(100).fill({ body: "test data for size" }) });

    const bytes = dlq.diskBytes();
    expect(bytes).toBeGreaterThan(0);
    dlq.stop();
  });
});
