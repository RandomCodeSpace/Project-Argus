/**
 * MCP server — HTTP Streamable MCP using JSON-RPC 2.0.
 * Implements 22 tools matching the Go version.
 */
import { Hono } from "hono";
import type { Repository } from "../db/repository";
import type { Metrics } from "../telemetry/metrics";
import type { GraphRAG } from "../graphrag/builder";
import type { VectorIndex } from "../vectordb/index";

const MCP_PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "OtelContext-mcp";
const SERVER_VERSION = "1.0.0";

// JSON-RPC error codes
const ERR_PARSE_ERROR = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;

function textResult(text: string) {
  return { content: [{ type: "text", text }] };
}

function errorResult(msg: string) {
  return { isError: true, content: [{ type: "text", text: `Error: ${msg}` }] };
}

function parseTime(args: any, key: string): Date | null {
  const v = args?.[key];
  if (typeof v === "string" && v) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function parseTimeRange(args: any, key: string): Date {
  const v = args?.[key];
  if (typeof v === "string" && v) {
    // Parse "15m", "1h" etc
    const match = v.match(/^(\d+)(s|m|h|d)$/);
    if (match) {
      const n = parseInt(match[1]);
      const unit = match[2];
      const ms = unit === "s" ? n * 1000 : unit === "m" ? n * 60000 : unit === "h" ? n * 3600000 : n * 86400000;
      return new Date(Date.now() - ms);
    }
  }
  return new Date(Date.now() - 15 * 60 * 1000); // default 15m
}

function argInt(args: any, key: string, def: number): number {
  const v = args?.[key];
  if (typeof v === "number" && v > 0) return Math.floor(v);
  return def;
}

// Tool definitions (22 tools)
const toolDefs = [
  { name: "get_system_graph", description: "Returns service topology with health scores.", inputSchema: { type: "object", properties: { time_range: { type: "string", description: "Lookback window" } } } },
  { name: "get_service_health", description: "Health metrics for a specific service.", inputSchema: { type: "object", required: ["service_name"], properties: { service_name: { type: "string" } } } },
  { name: "search_logs", description: "Search logs by severity, service, body text.", inputSchema: { type: "object", properties: { query: { type: "string" }, severity: { type: "string" }, service: { type: "string" }, trace_id: { type: "string" }, start: { type: "string" }, end: { type: "string" }, limit: { type: "number" }, page: { type: "number" } } } },
  { name: "tail_logs", description: "Returns N most recent logs.", inputSchema: { type: "object", properties: { service: { type: "string" }, severity: { type: "string" }, limit: { type: "number" } } } },
  { name: "get_trace", description: "Full trace detail.", inputSchema: { type: "object", required: ["trace_id"], properties: { trace_id: { type: "string" } } } },
  { name: "search_traces", description: "Search traces.", inputSchema: { type: "object", properties: { service: { type: "string" }, status: { type: "string" }, min_duration_ms: { type: "number" }, start: { type: "string" }, end: { type: "string" }, limit: { type: "number" } } } },
  { name: "get_metrics", description: "Query metric time series.", inputSchema: { type: "object", properties: { name: { type: "string" }, service: { type: "string" }, start: { type: "string" }, end: { type: "string" } } } },
  { name: "get_dashboard_stats", description: "Dashboard summary.", inputSchema: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } } } },
  { name: "get_storage_status", description: "Storage health.", inputSchema: { type: "object" } },
  { name: "find_similar_logs", description: "TF-IDF similarity search.", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } } } },
  { name: "get_alerts", description: "Active alerts.", inputSchema: { type: "object" } },
  { name: "search_cold_archive", description: "Search cold archive.", inputSchema: { type: "object", required: ["type", "start", "end"], properties: { type: { type: "string" }, start: { type: "string" }, end: { type: "string" }, query: { type: "string" } } } },
  { name: "get_service_map", description: "Service topology from GraphRAG.", inputSchema: { type: "object", properties: { depth: { type: "number" }, service: { type: "string" } } } },
  { name: "get_error_chains", description: "Trace error chains upstream.", inputSchema: { type: "object", required: ["service"], properties: { service: { type: "string" }, time_range: { type: "string" }, limit: { type: "number" } } } },
  { name: "trace_graph", description: "Full span tree for a trace.", inputSchema: { type: "object", required: ["trace_id"], properties: { trace_id: { type: "string" } } } },
  { name: "impact_analysis", description: "Blast radius analysis.", inputSchema: { type: "object", required: ["service"], properties: { service: { type: "string" }, depth: { type: "number" } } } },
  { name: "root_cause_analysis", description: "Ranked root causes.", inputSchema: { type: "object", required: ["service"], properties: { service: { type: "string" }, time_range: { type: "string" } } } },
  { name: "correlated_signals", description: "Related signals for a service.", inputSchema: { type: "object", required: ["service"], properties: { service: { type: "string" }, time_range: { type: "string" } } } },
  { name: "get_investigations", description: "List investigations.", inputSchema: { type: "object", properties: { service: { type: "string" }, severity: { type: "string" }, status: { type: "string" }, limit: { type: "number" } } } },
  { name: "get_investigation", description: "Single investigation.", inputSchema: { type: "object", required: ["investigation_id"], properties: { investigation_id: { type: "string" } } } },
  { name: "get_graph_snapshot", description: "Historical topology snapshot.", inputSchema: { type: "object", required: ["time"], properties: { time: { type: "string" } } } },
  { name: "get_anomaly_timeline", description: "Recent anomalies.", inputSchema: { type: "object", properties: { since: { type: "string" }, service: { type: "string" } } } },
];

export function createMcpRoutes(
  repo: Repository,
  metrics: Metrics,
  graphRAG: GraphRAG | null,
  vectorIdx: VectorIndex | null,
): Hono {
  const app = new Hono();

  function handleTool(name: string, args: any): any {
    switch (name) {
      case "get_system_graph":
        return graphRAG ? textResult(JSON.stringify(graphRAG.queries.serviceMap(), null, 2)) : errorResult("GraphRAG not initialized");

      case "get_service_health": {
        const svcName = args?.service_name;
        if (!svcName) return errorResult("service_name is required");
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        const svc = graphRAG.serviceStore.getService(svcName);
        return svc ? textResult(JSON.stringify(svc, null, 2)) : textResult(`Service "${svcName}" not found`);
      }

      case "search_logs": {
        const end = parseTime(args, "end") || new Date();
        const start = parseTime(args, "start") || new Date(end.getTime() - 24 * 3600000);
        const limit = Math.min(argInt(args, "limit", 50), 200);
        const page = argInt(args, "page", 0);
        const { logs, total } = repo.getLogsV2({
          startTime: start.toISOString(), endTime: end.toISOString(),
          limit, offset: page * limit,
          severity: args?.severity, serviceName: args?.service, search: args?.query, traceId: args?.trace_id,
        });
        return textResult(JSON.stringify({ total, page, limit, count: logs.length, entries: logs }, null, 2));
      }

      case "tail_logs": {
        const limit = Math.min(argInt(args, "limit", 20), 100);
        const { logs } = repo.getLogsV2({
          endTime: new Date().toISOString(), limit, offset: 0,
          severity: args?.severity, serviceName: args?.service,
        });
        return textResult(JSON.stringify(logs, null, 2));
      }

      case "get_trace": {
        const traceId = args?.trace_id;
        if (!traceId) return errorResult("trace_id is required");
        const trace = repo.getTrace(traceId);
        if (!trace) return errorResult("trace not found");
        return textResult(JSON.stringify(trace, null, 2));
      }

      case "search_traces": {
        const end = parseTime(args, "end") || new Date();
        const start = parseTime(args, "start") || new Date(end.getTime() - 3600000);
        const limit = Math.min(argInt(args, "limit", 20), 100);
        const result = repo.getTracesFiltered(start.toISOString(), end.toISOString(), args?.service ? [args.service] : [], args?.status || "", "", limit, 0, "timestamp", "desc");
        return textResult(JSON.stringify(result, null, 2));
      }

      case "get_metrics": {
        const end = parseTime(args, "end") || new Date();
        const start = parseTime(args, "start") || new Date(end.getTime() - 3600000);
        const buckets = repo.getMetricBuckets(start.toISOString(), end.toISOString(), args?.service || "", args?.name || "");
        return textResult(JSON.stringify(buckets, null, 2));
      }

      case "get_dashboard_stats": {
        const end = parseTime(args, "end") || new Date();
        const start = parseTime(args, "start") || new Date(end.getTime() - 3600000);
        const stats = repo.getDashboardStats(start.toISOString(), end.toISOString());
        return textResult(JSON.stringify(stats, null, 2));
      }

      case "get_storage_status": {
        const health = metrics.getHealthStats();
        return textResult(JSON.stringify({ hot_db_size_mb: repo.hotDBSizeBytes() / 1024 / 1024, ...health }, null, 2));
      }

      case "find_similar_logs": {
        if (!vectorIdx) return errorResult("vector index not initialized");
        const query = args?.query;
        if (!query) return errorResult("query is required");
        return textResult(JSON.stringify(vectorIdx.search(query, argInt(args, "limit", 20)), null, 2));
      }

      case "get_alerts":
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        return textResult(JSON.stringify(graphRAG.anomalyStore.anomaliesSince(new Date(Date.now() - 3600000)), null, 2));

      case "search_cold_archive":
        return textResult(JSON.stringify({ source: "cold", message: "Use /api/archive/search for full results." }, null, 2));

      case "get_service_map":
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        return textResult(JSON.stringify(graphRAG.queries.serviceMap(argInt(args, "depth", 3)), null, 2));

      case "get_error_chains": {
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        const svc = args?.service;
        if (!svc) return errorResult("service is required");
        const since = parseTimeRange(args, "time_range");
        return textResult(JSON.stringify(graphRAG.queries.errorChain(svc, since, argInt(args, "limit", 10)), null, 2));
      }

      case "trace_graph": {
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        const traceId = args?.trace_id;
        if (!traceId) return errorResult("trace_id is required");
        const spans = graphRAG.queries.dependencyChain(traceId);
        if (spans.length === 0) {
          const trace = repo.getTrace(traceId);
          return trace ? textResult(JSON.stringify(trace, null, 2)) : errorResult("trace not found");
        }
        return textResult(JSON.stringify(spans, null, 2));
      }

      case "impact_analysis": {
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        const svc = args?.service;
        if (!svc) return errorResult("service is required");
        return textResult(JSON.stringify(graphRAG.queries.impactAnalysis(svc, argInt(args, "depth", 5)), null, 2));
      }

      case "root_cause_analysis": {
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        const svc = args?.service;
        if (!svc) return errorResult("service is required");
        const since = parseTimeRange(args, "time_range");
        return textResult(JSON.stringify(graphRAG.queries.rootCauseAnalysis(svc, since), null, 2));
      }

      case "correlated_signals": {
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        const svc = args?.service;
        if (!svc) return errorResult("service is required");
        const since = parseTimeRange(args, "time_range");
        return textResult(JSON.stringify(graphRAG.queries.correlatedSignals(svc, since), null, 2));
      }

      case "get_investigations": {
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        return textResult(JSON.stringify(graphRAG.getInvestigations(args?.service || "", args?.severity || "", args?.status || "", argInt(args, "limit", 20)), null, 2));
      }

      case "get_investigation": {
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        const id = args?.investigation_id;
        if (!id) return errorResult("investigation_id is required");
        const inv = graphRAG.getInvestigation(id);
        return inv ? textResult(JSON.stringify(inv, null, 2)) : errorResult("investigation not found");
      }

      case "get_graph_snapshot": {
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        const at = parseTime(args, "time") || new Date();
        const snap = graphRAG.getGraphSnapshot(at);
        return snap ? textResult(JSON.stringify(snap, null, 2)) : errorResult("no snapshot found");
      }

      case "get_anomaly_timeline": {
        if (!graphRAG) return errorResult("GraphRAG not initialized");
        const since = parseTime(args, "since") || new Date(Date.now() - 3600000);
        const service = args?.service;
        const anomalies = service
          ? graphRAG.anomalyStore.anomaliesForService(service, since)
          : graphRAG.queries.anomalyTimeline(since);
        return textResult(JSON.stringify(anomalies, null, 2));
      }

      default:
        return errorResult(`unknown tool: ${name}`);
    }
  }

  // POST handler for JSON-RPC 2.0
  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body) return c.json({ jsonrpc: "2.0", id: null, error: { code: ERR_PARSE_ERROR, message: "invalid JSON" } });

    if (body.jsonrpc !== "2.0") {
      return c.json({ jsonrpc: "2.0", id: body.id, error: { code: ERR_INVALID_REQUEST, message: "jsonrpc must be '2.0'" } });
    }

    let result: any;
    let error: any;

    switch (body.method) {
      case "initialize":
        result = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          capabilities: { tools: {}, resources: {} },
        };
        break;

      case "initialized":
      case "notifications/initialized":
        return c.body(null, 202);

      case "tools/list":
        result = { tools: toolDefs };
        break;

      case "tools/call": {
        const params = body.params;
        if (!params?.name) {
          error = { code: ERR_INVALID_PARAMS, message: "invalid tools/call params" };
          break;
        }
        result = handleTool(params.name, params.arguments || {});
        break;
      }

      case "ping":
        result = { status: "ok", ts: new Date().toISOString() };
        break;

      case "resources/list":
        result = { resources: [
          { uri: "OtelContext://system/graph", name: "System Graph", mimeType: "application/json" },
        ]};
        break;

      default:
        error = { code: ERR_METHOD_NOT_FOUND, message: `method not found: ${body.method}` };
    }

    const resp: any = { jsonrpc: "2.0", id: body.id };
    if (error) resp.error = error;
    else resp.result = result;
    return c.json(resp);
  });

  // GET handler for SSE
  app.get("/", (c) => {
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache");
    c.header("Connection", "keep-alive");
    // Simple SSE — send initialized notification
    const body = `event: endpoint\ndata: {"jsonrpc":"2.0","method":"notifications/initialized","params":{}}\n\n`;
    return c.body(body);
  });

  return app;
}
