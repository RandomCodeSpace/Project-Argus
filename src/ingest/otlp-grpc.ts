/**
 * gRPC OTLP server on :4317 using @grpc/grpc-js with dynamic proto loading.
 */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as path from "path";
import type { Repository, Span, Log, Trace } from "../db/repository";
import type { IngestCallbacks, RawMetric } from "./otlp-http";
import type { Sampler } from "./sampler";

function hexEncode(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function getServiceName(attributes: any[]): string {
  if (!attributes) return "unknown-service";
  for (const kv of attributes) {
    if (kv.key === "service.name") {
      return kv.value?.string_value || kv.value?.stringValue || "unknown-service";
    }
  }
  return "unknown-service";
}

export function startGrpcServer(
  port: string,
  repo: Repository,
  callbacks: IngestCallbacks,
  cfg: { ingestMinSeverity: string; ingestAllowedServices: string; ingestExcludedServices: string; sampler?: Sampler }
): grpc.Server {
  const PROTO_DIR = path.resolve(process.cwd(), "proto");

  const packageDef = protoLoader.loadSync(
    [
      path.join(PROTO_DIR, "opentelemetry/proto/collector/trace/v1/trace_service.proto"),
      path.join(PROTO_DIR, "opentelemetry/proto/collector/logs/v1/logs_service.proto"),
      path.join(PROTO_DIR, "opentelemetry/proto/collector/metrics/v1/metrics_service.proto"),
    ],
    {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [PROTO_DIR],
    }
  );

  const proto = grpc.loadPackageDefinition(packageDef) as any;

  const server = new grpc.Server();

  // TraceService.Export
  const traceService = proto.opentelemetry.proto.collector.trace.v1.TraceService;
  server.addService(traceService.service, {
    Export: (call: any, callback: any) => {
      try {
        const req = call.request;
        const spansToInsert: Span[] = [];
        const tracesToUpsert: Trace[] = [];
        const synthesizedLogs: Log[] = [];

        for (const rs of (req.resourceSpans || [])) {
          const serviceName = getServiceName(rs.resource?.attributes || []);

          for (const ss of (rs.scopeSpans || [])) {
            for (const span of (ss.spans || [])) {
              const traceId = hexEncode(span.traceId);
              const spanId = hexEncode(span.spanId);
              const parentSpanId = span.parentSpanId ? hexEncode(span.parentSpanId) : "";

              const startNano = BigInt(span.startTimeUnixNano || "0");
              const endNano = BigInt(span.endTimeUnixNano || "0");
              const startTime = new Date(Number(startNano / BigInt(1000000)));
              const endTime = new Date(Number(endNano / BigInt(1000000)));
              const durationUs = Number((endNano - startNano) / BigInt(1000));

              let statusStr = "STATUS_CODE_UNSET";
              if (span.status?.code === "STATUS_CODE_ERROR" || span.status?.code === 2) {
                statusStr = "STATUS_CODE_ERROR";
              }

              spansToInsert.push({
                trace_id: traceId,
                span_id: spanId,
                parent_span_id: parentSpanId,
                operation_name: span.name || "",
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                duration: durationUs,
                service_name: serviceName,
                attributes_json: JSON.stringify(span.attributes || []),
              });

              tracesToUpsert.push({
                trace_id: traceId,
                service_name: serviceName,
                timestamp: startTime.toISOString(),
                duration: durationUs,
                status: statusStr,
              });

              // Synthesize logs from span events
              for (const event of (span.events || [])) {
                let severity = "INFO";
                if (event.name === "exception") severity = "ERROR";
                let eventBody = event.name;
                for (const attr of (event.attributes || [])) {
                  if (attr.key === "exception.message" || attr.key === "message") {
                    eventBody = attr.value?.string_value || attr.value?.stringValue || eventBody;
                    break;
                  }
                }
                const eventTs = event.timeUnixNano
                  ? new Date(Number(BigInt(event.timeUnixNano) / BigInt(1000000)))
                  : endTime;
                synthesizedLogs.push({
                  trace_id: traceId,
                  span_id: spanId,
                  severity,
                  body: eventBody,
                  service_name: serviceName,
                  attributes_json: JSON.stringify(event.attributes || []),
                  timestamp: eventTs.toISOString(),
                });
              }

              if (statusStr === "STATUS_CODE_ERROR") {
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

        if (tracesToUpsert.length > 0) {
          try { repo.batchCreateTraces(tracesToUpsert); } catch (e) { console.error("gRPC: Failed to insert traces:", e); }
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
          } catch (e) { console.error("gRPC: Failed to insert synthesized logs:", e); }
        }

        callback(null, {});
      } catch (e) {
        callback(e);
      }
    },
  });

  // LogsService.Export
  const logsService = proto.opentelemetry.proto.collector.logs.v1.LogsService;
  server.addService(logsService.service, {
    Export: (call: any, callback: any) => {
      try {
        const req = call.request;
        const logsToInsert: Log[] = [];

        for (const rl of (req.resourceLogs || [])) {
          const serviceName = getServiceName(rl.resource?.attributes || []);

          for (const sl of (rl.scopeLogs || [])) {
            for (const lr of (sl.logRecords || [])) {
              const severity = lr.severityText || "INFO";
              const ts = lr.timeUnixNano && lr.timeUnixNano !== "0"
                ? new Date(Number(BigInt(lr.timeUnixNano) / BigInt(1000000)))
                : new Date();
              const bodyStr = lr.body?.string_value || lr.body?.stringValue || "";
              const traceId = lr.traceId ? hexEncode(lr.traceId) : "";
              const spanId = lr.spanId ? hexEncode(lr.spanId) : "";

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

        callback(null, {});
      } catch (e) {
        callback(e);
      }
    },
  });

  // MetricsService.Export
  const metricsService = proto.opentelemetry.proto.collector.metrics.v1.MetricsService;
  server.addService(metricsService.service, {
    Export: (call: any, callback: any) => {
      try {
        const req = call.request;
        for (const rm of (req.resourceMetrics || [])) {
          const serviceName = getServiceName(rm.resource?.attributes || []);

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
                  attrs[kv.key] = kv.value?.string_value || kv.value?.stringValue || "";
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

        callback(null, {});
      } catch (e) {
        callback(e);
      }
    },
  });

  server.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (err, boundPort) => {
      if (err) {
        console.error(`gRPC bind failed on :${port}:`, err);
        return;
      }
      console.log(`gRPC OTLP receiver started on :${boundPort}`);
    }
  );

  return server;
}
