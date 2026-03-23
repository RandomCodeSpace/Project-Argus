/**
 * REST API routes using Hono — matches the Go version's endpoints.
 */
import { Hono } from "hono";
import type { Repository } from "../db/repository";
import type { Metrics } from "../telemetry/metrics";
import type { GraphRAG } from "../graphrag/builder";
import type { VectorIndex } from "../vectordb/index";

export function createApiRoutes(
  repo: Repository,
  metrics: Metrics,
  graphRAG: GraphRAG | null,
  vectorIdx: VectorIndex | null,
  coldPath: string,
): Hono {
  const app = new Hono();

  // TTL cache for system graph
  let graphCache: { data: any; ts: number } | null = null;
  const GRAPH_CACHE_TTL = 10000; // 10s

  // Metadata
  app.get("/api/metadata/services", (c) => {
    return c.json(repo.getServices());
  });

  app.get("/api/metadata/metrics", (c) => {
    const serviceName = c.req.query("service_name");
    return c.json(repo.getMetricNames(serviceName));
  });

  // Metrics
  app.get("/api/metrics", (c) => {
    const start = c.req.query("start") || "";
    const end = c.req.query("end") || "";
    const name = c.req.query("name") || "";
    const serviceName = c.req.query("service_name") || "";
    if (!name) return c.json({ error: "metric name is required" }, 400);
    return c.json(repo.getMetricBuckets(start, end, serviceName, name));
  });

  app.get("/api/metrics/traffic", (c) => {
    const end = c.req.query("end") || new Date().toISOString();
    const start = c.req.query("start") || new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const serviceNames = c.req.queries("service_name") || [];
    return c.json(repo.getTrafficMetrics(start, end, serviceNames.length > 0 ? serviceNames : undefined));
  });

  app.get("/api/metrics/latency_heatmap", (c) => {
    const end = c.req.query("end") || new Date().toISOString();
    const start = c.req.query("start") || new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const serviceNames = c.req.queries("service_name") || [];
    return c.json(repo.getLatencyHeatmap(start, end, serviceNames.length > 0 ? serviceNames : undefined));
  });

  app.get("/api/metrics/dashboard", (c) => {
    const end = c.req.query("end") || new Date().toISOString();
    const start = c.req.query("start") || new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const serviceNames = c.req.queries("service_name") || [];
    return c.json(repo.getDashboardStats(start, end, serviceNames.length > 0 ? serviceNames : undefined));
  });

  app.get("/api/metrics/service-map", (c) => {
    const end = c.req.query("end") || new Date().toISOString();
    const start = c.req.query("start") || new Date(Date.now() - 30 * 60 * 1000).toISOString();
    return c.json(repo.getServiceMapMetrics(start, end));
  });

  // System Graph (cached 10s)
  app.get("/api/system/graph", (c) => {
    if (graphRAG) {
      const now = Date.now();
      if (graphCache && (now - graphCache.ts) < GRAPH_CACHE_TTL) {
        c.header("X-Cache", "HIT");
        return c.json(graphCache.data);
      }
      const data = graphRAG.queries.serviceMap();
      graphCache = { data, ts: now };
      c.header("X-Cache", "MISS");
      return c.json(data);
    }
    return c.json([]);
  });

  // Traces
  app.get("/api/traces", (c) => {
    const limit = parseInt(c.req.query("limit") || "20", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);
    const start = c.req.query("start") || "";
    const end = c.req.query("end") || "";
    const serviceNames = c.req.queries("service_name") || [];
    const status = c.req.query("status") || "";
    const search = c.req.query("search") || "";
    const sortBy = c.req.query("sort_by") || "timestamp";
    const orderBy = c.req.query("order_by") || "desc";

    return c.json(repo.getTracesFiltered(start, end, serviceNames, status, search, limit, offset, sortBy, orderBy));
  });

  app.get("/api/traces/:id", (c) => {
    const traceId = c.req.param("id");
    const trace = repo.getTrace(traceId);
    if (!trace) return c.json({ error: "trace not found" }, 404);
    return c.json(trace);
  });

  // Logs
  app.get("/api/logs", (c) => {
    const limit = parseInt(c.req.query("limit") || "50", 10);
    const offset = parseInt(c.req.query("offset") || "0", 10);
    const { logs, total } = repo.getLogsV2({
      serviceName: c.req.query("service_name"),
      severity: c.req.query("severity"),
      search: c.req.query("search"),
      startTime: c.req.query("start"),
      endTime: c.req.query("end"),
      limit,
      offset,
    });
    return c.json({ data: logs, total });
  });

  app.get("/api/logs/context", (c) => {
    const timestamp = c.req.query("timestamp");
    if (!timestamp) return c.json({ error: "missing timestamp" }, 400);
    return c.json(repo.getLogContext(timestamp));
  });

  app.get("/api/logs/similar", (c) => {
    const q = c.req.query("q") || "";
    const limit = parseInt(c.req.query("limit") || "10", 10);
    if (!vectorIdx) return c.json([]);
    return c.json(vectorIdx.search(q, limit));
  });

  // Stats & Health
  app.get("/api/stats", (c) => {
    return c.json(repo.getStats());
  });

  app.get("/api/health", (c) => {
    return c.json(metrics.getHealthStats());
  });

  app.get("/metrics", async (c) => {
    const metricsText = await metrics.registry.metrics();
    return c.text(metricsText);
  });

  // Admin
  app.delete("/api/admin/purge", (c) => {
    const days = parseInt(c.req.query("days") || "7", 10);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const result = repo.purge(cutoff);
    return c.json({ purged: result, cutoff });
  });

  app.post("/api/admin/vacuum", (c) => {
    repo.vacuum();
    return c.json({ status: "vacuumed" });
  });

  // Archive search (cold storage)
  app.get("/api/archive/search", (c) => {
    return c.json({
      source: "cold",
      message: "Cold archive search not yet implemented in TS rewrite. Use hot storage queries.",
    });
  });

  return app;
}
