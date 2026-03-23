import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { Repository } from "../db/repository";
import { migrate } from "../db/migrate";
import { Metrics } from "../telemetry/metrics";
import { createApiRoutes } from "../api/routes";

let repo: Repository;
let app: Hono;

beforeAll(() => {
  repo = new Repository(":memory:");
  migrate(repo.db);
  const metrics = new Metrics();
  app = createApiRoutes(repo, metrics, null, null, "");

  // Seed some test data
  repo.batchCreateTraces([
    { trace_id: "abc123", service_name: "test-svc", duration: 5000, status: "STATUS_CODE_OK", timestamp: new Date().toISOString() },
  ]);
  repo.batchCreateLogs([
    { trace_id: "abc123", span_id: "span1", severity: "ERROR", body: "test error", service_name: "test-svc", attributes_json: "{}", timestamp: new Date().toISOString() },
    { trace_id: "abc123", span_id: "span1", severity: "INFO", body: "test info", service_name: "test-svc", attributes_json: "{}", timestamp: new Date().toISOString() },
  ]);
});

afterAll(() => {
  repo.close();
});

describe("API Endpoints", () => {
  it("GET /api/health should return health stats", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty("uptime_seconds");
  });

  it("GET /api/stats should return stats", async () => {
    const res = await app.request("/api/stats");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty("TraceCount");
    expect(body.TraceCount).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/logs should return logs with total", async () => {
    const res = await app.request("/api/logs?limit=10");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("total");
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("GET /api/logs should filter by severity", async () => {
    const res = await app.request("/api/logs?severity=ERROR&limit=10");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.data.length).toBe(1);
    expect(body.data[0].severity).toBe("ERROR");
  });

  it("GET /api/traces should return traces", async () => {
    const res = await app.request("/api/traces?limit=10");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("total");
  });

  it("GET /api/traces/:id should return trace detail", async () => {
    const res = await app.request("/api/traces/abc123");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.trace_id).toBe("abc123");
  });

  it("GET /api/traces/:id should 404 for missing trace", async () => {
    const res = await app.request("/api/traces/nonexistent");
    expect(res.status).toBe(404);
  });

  it("GET /api/metadata/services should return service list", async () => {
    const res = await app.request("/api/metadata/services");
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toContain("test-svc");
  });

  it("GET /api/metrics should require name parameter", async () => {
    const res = await app.request("/api/metrics");
    expect(res.status).toBe(400);
  });

  it("GET /metrics should return prometheus metrics", async () => {
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("otelcontext_");
  });
});
