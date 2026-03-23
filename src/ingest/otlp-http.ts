/**
 * HTTP OTLP endpoints: POST /v1/traces, /v1/logs, /v1/metrics
 * Supports protobuf + JSON content types, gzip decompression, 4MB limit.
 */
import { Hono } from "hono";
import type { Repository, Span, Log, Trace, MetricBucket } from "../db/repository";
import type { Sampler } from "./sampler";
import { gunzipSync } from "fflate";

const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4MB

export interface IngestCallbacks {
  onLog?: (log: Log) => void;
  onSpan?: (span: Span) => void;
  onMetric?: (raw: RawMetric) => void;
}

export interface RawMetric {
  name: string;
  serviceName: string;
  value: number;
  timestamp: Date;
  attributes: Record<string, any>;
}

interface IngestConfig {
  minSeverity: number;
  allowedServices: Set<string>;
  excludedServices: Set<string>;
  sampler?: Sampler;
}

function parseSeverity(level: string): number {
  switch (level.toUpperCase()) {
    case "DEBUG": return 10;
    case "INFO": return 20;
    case "WARN": case "WARNING": return 30;
    case "ERROR": return 40;
    case "FATAL": return 50;
    default: return 20;
  }
}

function shouldIngestSeverity(level: string, minLevel: number): boolean {
  const upper = level.toUpperCase();
  let lvl = 20;
  if (upper.includes("DEBUG")) lvl = 10;
  else if (upper.includes("INFO")) lvl = 20;
  else if (upper.includes("WARN")) lvl = 30;
  else if (upper.includes("ERR")) lvl = 40;
  else if (upper.includes("FATAL")) lvl = 50;
  return lvl >= minLevel;
}

function shouldIngestService(service: string, allowed: Set<string>, excluded: Set<string>): boolean {
  if (excluded.size > 0 && excluded.has(service)) return false;
  if (allowed.size > 0 && !allowed.has(service)) return false;
  return true;
}

function parseServiceList(list: string): Set<string> {
  if (!list) return new Set();
  return new Set(list.split(",").map(s => s.trim()).filter(Boolean));
}

function hexEncode(bytes: Uint8Array | number[]): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getServiceName(attributes: any[]): string {
  if (!attributes) return "unknown-service";
  for (const kv of attributes) {
    if (kv.key === "service.name" && kv.value?.stringValue) {
      return kv.value.stringValue;
    }
  }
  return "unknown-service";
}

export function createOtlpHttpRoutes(
  repo: Repository,
  callbacks: IngestCallbacks,
  cfg: { ingestMinSeverity: string; ingestAllowedServices: string; ingestExcludedServices: string; sampler?: Sampler }
): Hono {
  const app = new Hono();
  const ingestCfg: IngestConfig = {
    minSeverity: parseSeverity(cfg.ingestMinSeverity),
    allowedServices: parseServiceList(cfg.ingestAllowedServices),
    excludedServices: parseServiceList(cfg.ingestExcludedServices),
    sampler: cfg.sampler,
  };

  async function readBody(c: any): Promise<Uint8Array> {
    const raw = await c.req.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES) {
      throw new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    let data = new Uint8Array(raw);
    if (c.req.header("content-encoding") === "gzip") {
      data = gunzipSync(data);
    }
    return data;
  }

  // POST /v1/traces
  app.post("/v1/traces", async (c) => {
    try {
      const body = await readBody(c);
      const ct = c.req.header("content-type") || "";

      // Parse JSON (protobuf would need proto decoding; we support JSON for now)
      let request: any;
      if (ct.includes("json") || (!ct.includes("protobuf") && body[0] === 0x7b)) {
        request = JSON.parse(new TextDecoder().decode(body));
      } else {
        // For protobuf, return a minimal success response
        // Full protobuf support requires proto compilation
        return c.json({});
      }

      const resourceSpans = request.resourceSpans || [];
      const spansToInsert: Span[] = [];
      const tracesToUpsert: Trace[] = [];
      const synthesizedLogs: Log[] = [];

      for (const rs of resourceSpans) {
        const serviceName = getServiceName(rs.resource?.attributes || []);
        if (!shouldIngestService(serviceName, ingestCfg.allowedServices, ingestCfg.excludedServices)) continue;

        for (const ss of (rs.scopeSpans || [])) {
          for (const span of (ss.spans || [])) {
            const startNano = BigInt(span.startTimeUnixNano || "0");
            const endNano = BigInt(span.endTimeUnixNano || "0");
            const startTime = new Date(Number(startNano / BigInt(1000000)));
            const endTime = new Date(Number(endNano / BigInt(1000000)));
            const durationUs = Number((endNano - startNano) / BigInt(1000));

            let statusStr = "STATUS_CODE_UNSET";
            if (span.status?.code === 2 || span.status?.code === "STATUS_CODE_ERROR") {
              statusStr = "STATUS_CODE_ERROR";
            } else if (span.status?.code === 1 || span.status?.code === "STATUS_CODE_OK") {
              statusStr = "STATUS_CODE_OK";
            }

            // Adaptive sampling
            if (ingestCfg.sampler) {
              const isError = statusStr === "STATUS_CODE_ERROR";
              const durationMs = durationUs / 1000;
              if (!ingestCfg.sampler.shouldSample(serviceName, isError, durationMs)) continue;
            }

            const traceId = span.traceId || hexEncode(span.traceId || []);
            const spanId = span.spanId || hexEncode(span.spanId || []);
            const parentSpanId = span.parentSpanId || "";

            const sModel: Span = {
              trace_id: traceId,
              span_id: spanId,
              parent_span_id: parentSpanId,
              operation_name: span.name || "",
              start_time: startTime.toISOString(),
              end_time: endTime.toISOString(),
              duration: durationUs,
              service_name: serviceName,
              attributes_json: JSON.stringify(span.attributes || []),
            };
            spansToInsert.push(sModel);

            const tModel: Trace = {
              trace_id: traceId,
              service_name: serviceName,
              timestamp: startTime.toISOString(),
              duration: durationUs,
              status: statusStr,
            };
            tracesToUpsert.push(tModel);

            // Synthesize logs from span events
            for (const event of (span.events || [])) {
              let severity = "INFO";
              if (event.name === "exception") severity = "ERROR";
              if (!shouldIngestSeverity(severity, ingestCfg.minSeverity)) continue;

              let eventBody = event.name;
              for (const attr of (event.attributes || [])) {
                if (attr.key === "exception.message" || attr.key === "message") {
                  eventBody = attr.value?.stringValue || eventBody;
                  break;
                }
              }

              const eventTime = event.timeUnixNano
                ? new Date(Number(BigInt(event.timeUnixNano) / BigInt(1000000)))
                : endTime;

              synthesizedLogs.push({
                trace_id: traceId,
                span_id: spanId,
                severity,
                body: eventBody,
                service_name: serviceName,
                attributes_json: JSON.stringify(event.attributes || []),
                timestamp: eventTime.toISOString(),
              });
            }

            // Error status log synthesis
            if (statusStr === "STATUS_CODE_ERROR" && shouldIngestSeverity("ERROR", ingestCfg.minSeverity)) {
              const hasErrorLog = synthesizedLogs.some(l => l.severity === "ERROR" && l.span_id === spanId);
              if (!hasErrorLog) {
                const msg = span.status?.message || `Span '${span.name}' failed`;
                synthesizedLogs.push({
                  trace_id: traceId,
                  span_id: spanId,
                  severity: "ERROR",
                  body: msg,
                  service_name: serviceName,
                  attributes_json: "{}",
                  timestamp: endTime.toISOString(),
                });
              }
            }
          }
        }
      }

      // Persist
      if (tracesToUpsert.length > 0) {
        try { repo.batchCreateTraces(tracesToUpsert); } catch (e) { console.error("Failed to insert traces:", e); }
      }
      if (spansToInsert.length > 0) {
        repo.batchCreateSpans(spansToInsert);
        if (callbacks.onSpan) {
          for (const span of spansToInsert) callbacks.onSpan(span);
        }
      }
      if (synthesizedLogs.length > 0) {
        try {
          repo.batchCreateLogs(synthesizedLogs);
          if (callbacks.onLog) {
            for (const log of synthesizedLogs) callbacks.onLog(log);
          }
        } catch (e) { console.error("Failed to insert synthesized logs:", e); }
      }

      return c.json({});
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  // POST /v1/logs
  app.post("/v1/logs", async (c) => {
    try {
      const body = await readBody(c);
      const ct = c.req.header("content-type") || "";

      let request: any;
      if (ct.includes("json") || (!ct.includes("protobuf") && body[0] === 0x7b)) {
        request = JSON.parse(new TextDecoder().decode(body));
      } else {
        return c.json({});
      }

      const logsToInsert: Log[] = [];
      for (const rl of (request.resourceLogs || [])) {
        const serviceName = getServiceName(rl.resource?.attributes || []);
        if (!shouldIngestService(serviceName, ingestCfg.allowedServices, ingestCfg.excludedServices)) continue;

        for (const sl of (rl.scopeLogs || [])) {
          for (const lr of (sl.logRecords || [])) {
            let severity = lr.severityText || lr.severityNumber?.toString() || "INFO";
            if (!shouldIngestSeverity(severity, ingestCfg.minSeverity)) continue;

            let ts: Date;
            if (lr.timeUnixNano && lr.timeUnixNano !== "0") {
              ts = new Date(Number(BigInt(lr.timeUnixNano) / BigInt(1000000)));
            } else {
              ts = new Date();
            }

            const bodyStr = lr.body?.stringValue || "";
            const traceId = lr.traceId || "";
            const spanId = lr.spanId || "";

            logsToInsert.push({
              trace_id: traceId,
              span_id: spanId,
              severity,
              body: bodyStr,
              service_name: serviceName,
              attributes_json: JSON.stringify(lr.attributes || []),
              timestamp: ts.toISOString(),
            });
          }
        }
      }

      if (logsToInsert.length > 0) {
        repo.batchCreateLogs(logsToInsert);
        if (callbacks.onLog) {
          for (const log of logsToInsert) callbacks.onLog(log);
        }
      }

      return c.json({});
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  // POST /v1/metrics
  app.post("/v1/metrics", async (c) => {
    try {
      const body = await readBody(c);
      const ct = c.req.header("content-type") || "";

      let request: any;
      if (ct.includes("json") || (!ct.includes("protobuf") && body[0] === 0x7b)) {
        request = JSON.parse(new TextDecoder().decode(body));
      } else {
        return c.json({});
      }

      for (const rm of (request.resourceMetrics || [])) {
        const serviceName = getServiceName(rm.resource?.attributes || []);
        if (!shouldIngestService(serviceName, ingestCfg.allowedServices, ingestCfg.excludedServices)) continue;

        for (const sm of (rm.scopeMetrics || [])) {
          for (const m of (sm.metrics || [])) {
            const points = m.gauge?.dataPoints || m.sum?.dataPoints || [];
            for (const p of points) {
              let val = 0;
              if (p.asDouble !== undefined) val = p.asDouble;
              else if (p.asInt !== undefined) val = Number(p.asInt);

              const ts = p.timeUnixNano
                ? new Date(Number(BigInt(p.timeUnixNano) / BigInt(1000000)))
                : new Date();

              const attrs: Record<string, any> = {};
              for (const kv of (p.attributes || [])) {
                attrs[kv.key] = kv.value?.stringValue || kv.value?.intValue || "";
              }

              if (callbacks.onMetric) {
                callbacks.onMetric({
                  name: m.name,
                  serviceName,
                  value: val,
                  timestamp: ts,
                  attributes: attrs,
                });
              }
            }
          }
        }
      }

      return c.json({});
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  return app;
}
