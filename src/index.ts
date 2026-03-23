/**
 * OtelContext — TypeScript rewrite entrypoint.
 * Single process: Hono HTTP + gRPC + WebSocket + MCP + embedded SQLite.
 */
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import * as path from "path";
import * as fs from "fs";

import { loadConfig, validateConfig } from "./config";
import { Repository } from "./db/repository";
import { migrate } from "./db/migrate";
import { Metrics } from "./telemetry/metrics";
import { DeadLetterQueue } from "./queue/dlq";
import { WebSocketHub, type LogEntry } from "./realtime/hub";
import { EventHub } from "./realtime/events";
import { Aggregator } from "./tsdb/aggregator";
import { RingBuffer } from "./tsdb/ringbuffer";
import { Archiver } from "./archive/archiver";
import { VectorIndex } from "./vectordb/index";
import { GraphRAG } from "./graphrag/builder";
import { Sampler } from "./ingest/sampler";
import { createOtlpHttpRoutes, type RawMetric, type IngestCallbacks } from "./ingest/otlp-http";
import { startGrpcServer } from "./ingest/otlp-grpc";
import { createApiRoutes } from "./api/routes";
import { createMcpRoutes } from "./mcp/server";

console.log(`
  ___ _____ _____ _
 / _ \\_   _| ____| |
| | | || | |  _| | |
| |_| || | | |___| |___
 \\___/ |_| |_____|_____|

  TypeScript Edition (Bun + Hono)
`);

// 0. Load Configuration
const cfg = loadConfig();
validateConfig(cfg);
console.log(`Starting OtelContext (env=${cfg.env}, http=:${cfg.httpPort}, grpc=:${cfg.grpcPort})`);

// 1. Initialize Metrics
const metrics = new Metrics();
console.log("Telemetry initialized");

// 2. Initialize Storage
const dbPath = cfg.dbDSN || "./data/otelcontext.db";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const repo = new Repository(dbPath);
migrate(repo.db);
console.log(`Storage initialized (sqlite: ${dbPath})`);

// 3. Initialize DLQ
function parseDuration(s: string): number {
  const match = s.match(/^(\d+)(s|m|h)$/);
  if (!match) return 5 * 60 * 1000;
  const n = parseInt(match[1]);
  const unit = match[2];
  return unit === "s" ? n * 1000 : unit === "m" ? n * 60000 : n * 3600000;
}

const dlqReplayMs = parseDuration(cfg.dlqReplayInterval);
const dlq = new DeadLetterQueue(
  cfg.dlqPath, dlqReplayMs,
  (data: Buffer) => {
    const str = data.toString();
    let envelope: any;
    try {
      envelope = JSON.parse(str);
    } catch {
      // Legacy format
      const logs = JSON.parse(str);
      repo.batchCreateLogs(logs);
      return;
    }
    switch (envelope.type) {
      case "logs": repo.batchCreateLogs(envelope.data); break;
      case "spans": repo.batchCreateSpans(envelope.data); break;
      case "traces": repo.batchCreateTraces(envelope.data); break;
      case "metrics": repo.batchCreateMetrics(envelope.data); break;
      default: throw new Error(`Unknown DLQ type: ${envelope.type}`);
    }
  },
  cfg.dlqMaxFiles, cfg.dlqMaxDiskMB, cfg.dlqMaxRetries,
);
dlq.start();
console.log(`DLQ initialized (path=${cfg.dlqPath})`);

// 4. WebSocket Hub
const wsHub = new WebSocketHub((count) => metrics.setActiveConnections(count));
wsHub.start();
console.log("WebSocket hub started");

// 4b. Event Hub
const eventHub = new EventHub();
eventHub.start();

// 4c. TSDB Aggregator + Ring Buffer
const tsdbAgg = new Aggregator(repo, 30000); // 30s window
if (cfg.metricMaxCardinality > 0) {
  tsdbAgg.setCardinalityLimit(cfg.metricMaxCardinality);
}
const ringBuf = new RingBuffer(120, 30000); // 120 slots x 30s = 1h
tsdbAgg.setRingBuffer(ringBuf);
tsdbAgg.setMetrics(
  () => metrics.tsdbIngestTotal.inc(),
  () => metrics.tsdbBatchesDropped.inc(),
);
tsdbAgg.start();
console.log("TSDB Aggregator started (30s window, 120 ring slots)");

// 4d. Archive Worker
const archiver = new Archiver(repo, cfg);
archiver.start();

// 4e. Vector Index
const vectorIdx = new VectorIndex(cfg.vectorIndexMaxEntries);
console.log(`Vector index initialized (max=${cfg.vectorIndexMaxEntries})`);

// Hydrate vector index from recent ERROR logs
try {
  const { logs: recentErrors } = repo.getLogsV2({
    severity: "ERROR",
    startTime: new Date(Date.now() - 24 * 3600000).toISOString(),
    endTime: new Date().toISOString(),
    limit: 5000,
    offset: 0,
  });
  for (const l of recentErrors) {
    vectorIdx.add(l.id || 0, l.service_name, l.severity, l.body);
  }
  console.log(`Vector index hydrated (${recentErrors.length} recent ERROR logs)`);
} catch {}

// 4f. GraphRAG
const graphRAG = new GraphRAG(repo, vectorIdx);
graphRAG.start();

// 5. Sampler
let sampler: Sampler | undefined;
if (cfg.samplingRate > 0 && cfg.samplingRate < 1.0) {
  sampler = new Sampler(cfg.samplingRate, cfg.samplingAlwaysOnErrors, cfg.samplingLatencyThresholdMs);
  console.log(`Adaptive sampling enabled (rate=${cfg.samplingRate})`);
}

// 6. Ingestion callbacks
const callbacks: IngestCallbacks = {
  onLog: (log) => {
    wsHub.broadcastLog({
      id: 0,
      trace_id: log.trace_id,
      span_id: log.span_id,
      severity: log.severity,
      body: log.body,
      service_name: log.service_name,
      attributes_json: log.attributes_json,
      timestamp: log.timestamp,
    });
    vectorIdx.add(0, log.service_name, log.severity, log.body);
    graphRAG.onLogIngested(log);
  },
  onSpan: (span) => {
    graphRAG.onSpanIngested(span);
  },
  onMetric: (raw: RawMetric) => {
    tsdbAgg.ingest(raw);
    graphRAG.onMetricIngested(raw);
  },
};

// 7. Build Hono app
const app = new Hono();

// OTLP HTTP routes
const otlpRoutes = createOtlpHttpRoutes(repo, callbacks, {
  ingestMinSeverity: cfg.ingestMinSeverity,
  ingestAllowedServices: cfg.ingestAllowedServices,
  ingestExcludedServices: cfg.ingestExcludedServices,
  sampler,
});
app.route("/", otlpRoutes);

// API routes
const apiRoutes = createApiRoutes(repo, metrics, graphRAG, vectorIdx, cfg.coldStoragePath);
app.route("/", apiRoutes);

// MCP routes
if (cfg.mcpEnabled) {
  const mcpRoutes = createMcpRoutes(repo, metrics, graphRAG, vectorIdx);
  app.route(cfg.mcpPath, mcpRoutes);
  console.log(`MCP server enabled at ${cfg.mcpPath}`);
}

// Static UI — serve from internal/ui/dist or ui/dist
const uiDistPaths = [
  path.resolve("internal/ui/dist"),
  path.resolve("ui/dist"),
];
let uiDistPath = "";
for (const p of uiDistPaths) {
  if (fs.existsSync(p)) {
    uiDistPath = p;
    break;
  }
}

if (uiDistPath) {
  app.use("/assets/*", serveStatic({ root: uiDistPath }));
  app.get("/favicon.ico", serveStatic({ path: path.join(uiDistPath, "favicon.ico") }));

  // SPA fallback: serve index.html for all non-API, non-asset routes
  const indexHtml = fs.readFileSync(path.join(uiDistPath, "index.html"), "utf-8");
  app.get("*", (c) => {
    const p = c.req.path;
    if (p.startsWith("/api/") || p.startsWith("/v1/") || p.startsWith("/ws") ||
        p.startsWith("/metrics") || p.startsWith(cfg.mcpPath)) {
      return c.notFound();
    }
    return c.html(indexHtml);
  });
  console.log(`UI serving from ${uiDistPath}`);
} else {
  console.log("No UI dist found (checked internal/ui/dist and ui/dist)");
}

// 8. gRPC Server
const grpcServer = startGrpcServer(cfg.grpcPort, repo, callbacks, {
  ingestMinSeverity: cfg.ingestMinSeverity,
  ingestAllowedServices: cfg.ingestAllowedServices,
  ingestExcludedServices: cfg.ingestExcludedServices,
  sampler,
});

// DLQ size metric update
setInterval(() => {
  metrics.setDLQSize(dlq.size());
  metrics.dlqDiskBytes.set(dlq.diskBytes());
}, 30000);

// 9. Start HTTP Server with Bun (single server with WebSocket upgrade support)
const serverInstance = Bun.serve({
  port: parseInt(cfg.httpPort, 10),
  fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws" || url.pathname === "/ws/events" || url.pathname === "/ws/health") {
      const upgraded = server.upgrade(req, { data: { url: url.pathname } });
      if (upgraded) return undefined;
    }
    return app.fetch(req, server);
  },
  websocket: {
    open(ws) {
      const url = (ws.data as any)?.url || "";
      if (url.includes("/ws/events")) {
        eventHub.addClient(ws);
      } else {
        wsHub.addClient(ws);
      }
    },
    message(_ws, _msg) {},
    close(ws) {
      wsHub.removeClient(ws);
      eventHub.removeClient(ws);
    },
  },
});

console.log(`HTTP server started on :${cfg.httpPort}`);

// 10. Graceful shutdown
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("Shutting down OtelContext...");

  // 1. Stop ingestion
  grpcServer.tryShutdown(() => {});
  serverInstance.stop();

  // 2. Stop real-time
  wsHub.stop();
  eventHub.stop();

  // 3. Stop processing
  tsdbAgg.stop();
  archiver.stop();
  graphRAG.stop();

  // 4. Stop DLQ
  dlq.stop();

  // 5. Close DB last
  repo.close();

  console.log("OtelContext shutdown complete");
  process.exit(0);
}
