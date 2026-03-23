/**
 * GraphRAG coordinator — event processing, background loops, callbacks.
 */
import type { Repository, Span as DBSpan, Log as DBLog } from "../db/repository";
import type { RawMetric } from "../ingest/otlp-http";
import type { VectorIndex } from "../vectordb/index";
import type { Aggregator } from "../tsdb/aggregator";
import type { RingBuffer } from "../tsdb/ringbuffer";
import { ServiceStore, TraceStore, SignalStore, AnomalyStore } from "./store";
import { GraphRAGQueries } from "./queries";
import type { SpanNode, AnomalyNode, AnomalyType, AnomalySeverity } from "./schema";

interface GraphRAGEvent {
  span?: { span: DBSpan; traceId: string; status: string };
  log?: DBLog;
  metric?: RawMetric;
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h;
}

export class GraphRAG {
  serviceStore: ServiceStore;
  traceStore: TraceStore;
  signalStore: SignalStore;
  anomalyStore: AnomalyStore;
  queries: GraphRAGQueries;

  private repo: Repository;
  private vectorIdx: VectorIndex | null;
  private eventQueue: GraphRAGEvent[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];

  constructor(
    repo: Repository,
    vectorIdx: VectorIndex | null,
  ) {
    this.repo = repo;
    this.vectorIdx = vectorIdx;

    this.serviceStore = new ServiceStore();
    this.traceStore = new TraceStore(60 * 60 * 1000); // 1h TTL
    this.signalStore = new SignalStore();
    this.anomalyStore = new AnomalyStore();
    this.queries = new GraphRAGQueries(this.serviceStore, this.traceStore, this.signalStore, this.anomalyStore);
  }

  start(): void {
    // Process event queue periodically (simulate 4 workers)
    this.intervals.push(setInterval(() => this.processEvents(), 100));
    // Refresh from DB every 60s
    this.intervals.push(setInterval(() => this.rebuildFromDB(), 60000));
    // Snapshot every 15min
    this.intervals.push(setInterval(() => this.takeSnapshot(), 15 * 60 * 1000));
    // Anomaly detection every 10s
    this.intervals.push(setInterval(() => this.detectAnomalies(), 10000));

    // Initial rebuild
    this.rebuildFromDB();
    console.log("GraphRAG started (layered graph with anomaly detection)");
  }

  stop(): void {
    for (const iv of this.intervals) clearInterval(iv);
    this.intervals = [];
    console.log("GraphRAG stopped");
  }

  onSpanIngested(span: DBSpan): void {
    if (this.eventQueue.length < 10000) {
      this.eventQueue.push({ span: { span, traceId: span.trace_id, status: "OK" } });
    }
  }

  onLogIngested(log: DBLog): void {
    if (this.eventQueue.length < 10000) {
      this.eventQueue.push({ log });
    }
  }

  onMetricIngested(metric: RawMetric): void {
    if (this.eventQueue.length < 10000) {
      this.eventQueue.push({ metric });
    }
  }

  private processEvents(): void {
    const batch = this.eventQueue.splice(0, 100);
    for (const ev of batch) {
      if (ev.span) this.processSpan(ev.span);
      if (ev.log) this.processLog(ev.log);
      if (ev.metric) this.processMetric(ev.metric);
    }
  }

  private processSpan(ev: { span: DBSpan; traceId: string; status: string }): void {
    const span = ev.span;
    const durationMs = span.duration / 1000;
    const isError = ev.status === "STATUS_CODE_ERROR";
    const ts = new Date(span.start_time);

    if (!span.service_name) return;

    this.serviceStore.upsertService(span.service_name, durationMs, isError, ts);
    if (span.operation_name) {
      this.serviceStore.upsertOperation(span.service_name, span.operation_name, durationMs, isError, ts);
    }

    this.traceStore.upsertTrace(span.trace_id, span.service_name, ev.status, durationMs, ts);
    this.traceStore.upsertSpan({
      id: span.span_id,
      traceId: span.trace_id,
      parentSpanId: span.parent_span_id,
      service: span.service_name,
      operation: span.operation_name,
      duration: durationMs,
      statusCode: ev.status,
      isError,
      timestamp: ts,
    });

    // CALLS edge for cross-service calls
    if (span.parent_span_id) {
      const parent = this.traceStore.getSpan(span.parent_span_id);
      if (parent && parent.service !== span.service_name) {
        this.serviceStore.upsertCallEdge(parent.service, span.service_name, durationMs, isError, ts);
      }
    }
  }

  private processLog(log: DBLog): void {
    if (!log.service_name) return;
    const body = log.body;
    const clusterId = `lc_${log.service_name}_${simpleHash(body).toString(16)}`;
    const ts = new Date(log.timestamp);

    this.signalStore.upsertLogCluster(clusterId, body, log.severity, log.service_name, ts);
    if (log.span_id) {
      this.signalStore.addLoggedDuringEdge(clusterId, log.span_id, ts);
    }
  }

  private processMetric(ev: RawMetric): void {
    if (!ev.serviceName) return;
    this.signalStore.upsertMetric(ev.name, ev.serviceName, ev.value, ev.timestamp);
  }

  private rebuildFromDB(): void {
    try {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const rows = this.repo.getSpansForGraph(since);
      if (rows.length === 0) return;

      const spanService = new Map<string, string>();
      for (const r of rows) {
        spanService.set(r.span_id, r.service_name);
      }

      for (const r of rows) {
        const durationMs = (r.duration || 0) / 1000;
        const isError = false; // Status not in simplified query
        const ts = new Date(r.start_time);

        this.serviceStore.upsertService(r.service_name, durationMs, isError, ts);
        if (r.operation_name) {
          this.serviceStore.upsertOperation(r.service_name, r.operation_name, durationMs, isError, ts);
        }

        if (r.parent_span_id) {
          const parentSvc = spanService.get(r.parent_span_id);
          if (parentSvc && parentSvc !== r.service_name) {
            this.serviceStore.upsertCallEdge(parentSvc, r.service_name, durationMs, isError, ts);
          }
        }
      }
    } catch (e) {
      console.error("GraphRAG: failed to rebuild from DB:", e);
    }
  }

  private detectAnomalies(): void {
    const services = this.serviceStore.allServices();
    const now = new Date();

    for (const svc of services) {
      const baselineErrorRate = 0.02;
      if (svc.errorRate > baselineErrorRate * 2 && svc.errorRate > 0.05) {
        const severity: AnomalySeverity = svc.errorRate > 0.2 ? "critical" : svc.errorRate > 0.1 ? "warning" : "info";
        const anomaly: AnomalyNode = {
          id: `anom_${svc.name}_err_${now.getTime()}`,
          type: "error_spike",
          severity,
          service: svc.name,
          evidence: `error rate ${(svc.errorRate * 100).toFixed(1)}% (baseline ~${(baselineErrorRate * 100).toFixed(1)}%)`,
          timestamp: now,
        };
        this.anomalyStore.addAnomaly(anomaly);
        this.correlateWithRecent(anomaly);

        // Trigger investigation
        const chains = this.queries.errorChain(svc.name, new Date(now.getTime() - 5 * 60 * 1000), 5);
        if (chains.length > 0) {
          const anomalies = this.anomalyStore.anomaliesForService(svc.name, new Date(now.getTime() - 60 * 1000));
          this.persistInvestigation(svc.name, chains, anomalies);
        }
      }

      if (svc.avgLatency > 500 && svc.callCount > 10) {
        const severity: AnomalySeverity = svc.avgLatency > 2000 ? "critical" : svc.avgLatency > 1000 ? "warning" : "info";
        const anomaly: AnomalyNode = {
          id: `anom_${svc.name}_lat_${now.getTime()}`,
          type: "latency_spike",
          severity,
          service: svc.name,
          evidence: `avg latency ${svc.avgLatency.toFixed(0)}ms`,
          timestamp: now,
        };
        this.anomalyStore.addAnomaly(anomaly);
        this.correlateWithRecent(anomaly);
      }
    }

    // Metric z-score anomalies
    for (const m of this.signalStore.metrics.values()) {
      if (m.sampleCount < 10) continue;
      const rangeSize = m.rollingMax - m.rollingMin;
      if (rangeSize > 0) {
        const deviation = (m.rollingAvg - (m.rollingMin + rangeSize / 2)) / (rangeSize / 2);
        if (Math.abs(deviation) > 3.0) {
          const anomaly: AnomalyNode = {
            id: `anom_${m.service}_metric_${now.getTime()}`,
            type: "metric_zscore",
            severity: "warning",
            service: m.service,
            evidence: `metric ${m.metricName} z-score ${deviation.toFixed(1)}`,
            timestamp: now,
          };
          this.anomalyStore.addAnomaly(anomaly);
          this.correlateWithRecent(anomaly);
        }
      }
    }

    // Prune old anomalies
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const [id, a] of this.anomalyStore.anomalies) {
      if (a.timestamp < cutoff) this.anomalyStore.anomalies.delete(id);
    }
    for (const [ek, e] of this.anomalyStore.edges) {
      if (e.updatedAt < cutoff) this.anomalyStore.edges.delete(ek);
    }
  }

  private correlateWithRecent(anomaly: AnomalyNode): void {
    const window = 30 * 1000;
    const recent = this.anomalyStore.anomaliesSince(new Date(anomaly.timestamp.getTime() - window));
    for (const prev of recent) {
      if (prev.id === anomaly.id) continue;
      if (prev.timestamp.getTime() > anomaly.timestamp.getTime() - window &&
          prev.timestamp.getTime() < anomaly.timestamp.getTime() + window) {
        this.anomalyStore.addPrecededByEdge(anomaly.id, prev.id, anomaly.timestamp);
      }
    }
  }

  private takeSnapshot(): void {
    try {
      const services = this.serviceStore.allServices();
      const edges = this.serviceStore.allEdges();
      if (services.length === 0) return;

      const nodes: any[] = [];
      let totalCalls = 0;
      let totalHealth = 0;

      for (const svc of services) {
        nodes.push({
          id: svc.id, type: "service", name: svc.name,
          health_score: svc.healthScore, error_rate: svc.errorRate, avg_latency_ms: svc.avgLatency,
        });
        totalCalls += svc.callCount;
        totalHealth += svc.healthScore;
      }

      for (const op of this.serviceStore.operations.values()) {
        nodes.push({
          id: op.id, type: "operation", name: op.operation,
          health_score: op.healthScore, error_rate: op.errorRate, avg_latency_ms: op.avgLatency,
        });
      }

      const snapEdges = edges.map(e => ({
        from: e.fromId, to: e.toId, type: e.type,
        weight: e.weight, call_count: e.callCount, error_rate: e.errorRate,
      }));

      const id = `snap_${Date.now()}`;
      this.repo.db.prepare(
        `INSERT INTO graph_snapshots (id, created_at, nodes, edges, service_count, total_calls, avg_health_score)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, new Date().toISOString(), JSON.stringify(nodes), JSON.stringify(snapEdges),
        services.length, totalCalls, totalHealth / services.length);

      // Prune old snapshots (> 7 days)
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      this.repo.db.prepare("DELETE FROM graph_snapshots WHERE created_at < ?").run(cutoff);
    } catch (e) {
      console.error("Failed to persist graph snapshot:", e);
    }
  }

  persistInvestigation(triggerService: string, chains: any[], anomalies: AnomalyNode[]): void {
    try {
      if (chains.length === 0) return;
      const firstChain = chains[0];
      if (!firstChain.root_cause) return;

      const id = `inv_${Date.now()}`;
      let severity = "warning";
      for (const a of anomalies) {
        if (a.severity === "critical") { severity = "critical"; break; }
      }

      const traceIds = chains.map((c: any) => c.trace_id);
      const impact = this.queries.impactAnalysis(triggerService, 3);
      const affected = impact.affected_services.map((a: any) => a.service);

      this.repo.db.prepare(
        `INSERT INTO investigations (id, created_at, status, severity, trigger_service, trigger_operation,
         error_message, root_service, root_operation, causal_chain, trace_ids, error_logs,
         anomalous_metrics, affected_services, span_chain)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, new Date().toISOString(), "detected", severity,
        triggerService, firstChain.root_cause.operation || "",
        firstChain.root_cause.error_message || "",
        firstChain.root_cause.service, firstChain.root_cause.operation || "",
        JSON.stringify(firstChain.span_chain || []),
        JSON.stringify(traceIds),
        JSON.stringify(firstChain.correlated_logs || []),
        JSON.stringify([]),
        JSON.stringify(affected),
        JSON.stringify(firstChain.span_chain || []),
      );
    } catch (e) {
      console.error("Failed to persist investigation:", e);
    }
  }

  getInvestigations(service: string, severity: string, status: string, limit: number = 20): any[] {
    let where = "1=1";
    const params: any[] = [];
    if (service) { where += " AND (trigger_service = ? OR root_service = ?)"; params.push(service, service); }
    if (severity) { where += " AND severity = ?"; params.push(severity); }
    if (status) { where += " AND status = ?"; params.push(status); }
    if (limit > 100) limit = 100;
    return this.repo.db.prepare(
      `SELECT * FROM investigations WHERE ${where} ORDER BY created_at DESC LIMIT ?`
    ).all(...params, limit) as any[];
  }

  getInvestigation(id: string): any {
    return this.repo.db.prepare("SELECT * FROM investigations WHERE id = ?").get(id);
  }

  getGraphSnapshot(at: Date): any {
    return this.repo.db.prepare(
      "SELECT * FROM graph_snapshots WHERE created_at <= ? ORDER BY created_at DESC LIMIT 1"
    ).get(at.toISOString());
  }
}
