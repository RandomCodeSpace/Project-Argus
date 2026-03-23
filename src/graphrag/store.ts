/**
 * 4 layered stores for GraphRAG — Service, Trace, Signal, Anomaly.
 */
import {
  type ServiceNode, type OperationNode, type TraceNode, type SpanNode,
  type LogClusterNode, type MetricNode, type AnomalyNode, type Edge,
  type EdgeType, edgeKey, computeHealth,
} from "./schema";

export class ServiceStore {
  services = new Map<string, ServiceNode>();
  operations = new Map<string, OperationNode>();
  edges = new Map<string, Edge>();

  upsertService(name: string, durationMs: number, isError: boolean, ts: Date): void {
    let svc = this.services.get(name);
    if (!svc) {
      svc = { id: name, name, firstSeen: ts, lastSeen: ts, healthScore: 1, callCount: 0, errorCount: 0, errorRate: 0, avgLatency: 0, totalMs: 0 };
      this.services.set(name, svc);
    }
    svc.callCount++;
    svc.totalMs += durationMs;
    if (isError) svc.errorCount++;
    if (ts > svc.lastSeen) svc.lastSeen = ts;
    if (ts < svc.firstSeen) svc.firstSeen = ts;
    svc.avgLatency = svc.totalMs / svc.callCount;
    svc.errorRate = svc.errorCount / svc.callCount;
    svc.healthScore = computeHealth(svc.errorRate, svc.avgLatency);
  }

  upsertOperation(service: string, operation: string, durationMs: number, isError: boolean, ts: Date): void {
    const key = `${service}|${operation}`;
    let op = this.operations.get(key);
    if (!op) {
      op = { id: key, service, operation, firstSeen: ts, lastSeen: ts, healthScore: 1, callCount: 0, errorCount: 0, errorRate: 0, avgLatency: 0, p50Latency: 0, p95Latency: 0, p99Latency: 0, totalMs: 0 };
      this.operations.set(key, op);
    }
    op.callCount++;
    op.totalMs += durationMs;
    if (isError) op.errorCount++;
    if (ts > op.lastSeen) op.lastSeen = ts;
    op.avgLatency = op.totalMs / op.callCount;
    op.errorRate = op.errorCount / op.callCount;
    op.healthScore = computeHealth(op.errorRate, op.avgLatency);

    // EXPOSES edge
    const ek = edgeKey("EXPOSES", service, key);
    if (!this.edges.has(ek)) {
      this.edges.set(ek, { type: "EXPOSES", fromId: service, toId: key, weight: 0, callCount: 0, errorRate: 0, avgMs: 0, totalMs: 0, errorCount: 0, updatedAt: ts });
    }
  }

  upsertCallEdge(source: string, target: string, durationMs: number, isError: boolean, ts: Date): void {
    const ek = edgeKey("CALLS", source, target);
    let e = this.edges.get(ek);
    if (!e) {
      e = { type: "CALLS", fromId: source, toId: target, weight: 0, callCount: 0, errorRate: 0, avgMs: 0, totalMs: 0, errorCount: 0, updatedAt: ts };
      this.edges.set(ek, e);
    }
    e.callCount++;
    e.totalMs += durationMs;
    if (isError) e.errorCount++;
    e.avgMs = e.totalMs / e.callCount;
    e.errorRate = e.errorCount / e.callCount;
    e.weight = e.callCount;
    e.updatedAt = ts;
  }

  getService(name: string): ServiceNode | undefined { return this.services.get(name); }
  allServices(): ServiceNode[] { return Array.from(this.services.values()); }
  allEdges(): Edge[] { return Array.from(this.edges.values()); }

  callEdgesFrom(service: string): Edge[] {
    return Array.from(this.edges.values()).filter(e => e.type === "CALLS" && e.fromId === service);
  }
  callEdgesTo(service: string): Edge[] {
    return Array.from(this.edges.values()).filter(e => e.type === "CALLS" && e.toId === service);
  }
}

export class TraceStore {
  traces = new Map<string, TraceNode>();
  spans = new Map<string, SpanNode>();
  edges = new Map<string, Edge>();
  ttl: number; // ms

  constructor(ttlMs: number) { this.ttl = ttlMs; }

  upsertTrace(traceId: string, rootService: string, status: string, durationMs: number, timestamp: Date): void {
    let t = this.traces.get(traceId);
    if (!t) {
      t = { id: traceId, rootService, duration: durationMs, status, timestamp, spanCount: 0 };
      this.traces.set(traceId, t);
    }
    t.spanCount++;
    if (durationMs > t.duration) t.duration = durationMs;
    if (status === "STATUS_CODE_ERROR") t.status = status;
  }

  upsertSpan(span: SpanNode): void {
    this.spans.set(span.id, span);
    // CONTAINS edge
    const ck = edgeKey("CONTAINS", span.traceId, span.id);
    if (!this.edges.has(ck)) {
      this.edges.set(ck, { type: "CONTAINS", fromId: span.traceId, toId: span.id, weight: 0, callCount: 0, errorRate: 0, avgMs: 0, totalMs: 0, errorCount: 0, updatedAt: span.timestamp });
    }
    // CHILD_OF edge
    if (span.parentSpanId) {
      const pk = edgeKey("CHILD_OF", span.id, span.parentSpanId);
      if (!this.edges.has(pk)) {
        this.edges.set(pk, { type: "CHILD_OF", fromId: span.id, toId: span.parentSpanId, weight: 0, callCount: 0, errorRate: 0, avgMs: 0, totalMs: 0, errorCount: 0, updatedAt: span.timestamp });
      }
    }
  }

  getSpan(spanId: string): SpanNode | undefined { return this.spans.get(spanId); }
  getTrace(traceId: string): TraceNode | undefined { return this.traces.get(traceId); }

  spansForTrace(traceId: string): SpanNode[] {
    return Array.from(this.spans.values()).filter(s => s.traceId === traceId);
  }

  errorSpans(service: string, since: Date): SpanNode[] {
    return Array.from(this.spans.values()).filter(s => s.isError && s.service === service && s.timestamp > since);
  }

  prune(): number {
    const cutoff = new Date(Date.now() - this.ttl);
    let pruned = 0;
    for (const [id, s] of this.spans) {
      if (s.timestamp < cutoff) { this.spans.delete(id); pruned++; }
    }
    for (const [id, t] of this.traces) {
      if (t.timestamp < cutoff) this.traces.delete(id);
    }
    for (const [ek, e] of this.edges) {
      if (e.updatedAt < cutoff) this.edges.delete(ek);
    }
    return pruned;
  }
}

export class SignalStore {
  logClusters = new Map<string, LogClusterNode>();
  metrics = new Map<string, MetricNode>();
  edges = new Map<string, Edge>();

  upsertLogCluster(id: string, template: string, severity: string, service: string, ts: Date): void {
    let lc = this.logClusters.get(id);
    if (!lc) {
      lc = { id, template, count: 0, firstSeen: ts, lastSeen: ts, severityDist: {} };
      this.logClusters.set(id, lc);
    }
    lc.count++;
    lc.severityDist[severity] = (lc.severityDist[severity] || 0) + 1;
    if (ts > lc.lastSeen) lc.lastSeen = ts;

    const ek = edgeKey("EMITTED_BY", id, service);
    if (!this.edges.has(ek)) {
      this.edges.set(ek, { type: "EMITTED_BY", fromId: id, toId: service, weight: 0, callCount: 0, errorRate: 0, avgMs: 0, totalMs: 0, errorCount: 0, updatedAt: ts });
    }
  }

  addLoggedDuringEdge(clusterId: string, spanId: string, ts: Date): void {
    const ek = edgeKey("LOGGED_DURING", clusterId, spanId);
    if (!this.edges.has(ek)) {
      this.edges.set(ek, { type: "LOGGED_DURING", fromId: clusterId, toId: spanId, weight: 0, callCount: 0, errorRate: 0, avgMs: 0, totalMs: 0, errorCount: 0, updatedAt: ts });
    }
  }

  upsertMetric(metricName: string, service: string, value: number, ts: Date): void {
    const key = `${metricName}|${service}`;
    let m = this.metrics.get(key);
    if (!m) {
      m = { id: key, metricName, service, rollingMin: value, rollingMax: value, rollingAvg: value, sampleCount: 0, lastSeen: ts };
      this.metrics.set(key, m);
      const ek = edgeKey("MEASURED_BY", key, service);
      this.edges.set(ek, { type: "MEASURED_BY", fromId: key, toId: service, weight: 0, callCount: 0, errorRate: 0, avgMs: 0, totalMs: 0, errorCount: 0, updatedAt: ts });
    }
    m.sampleCount++;
    if (value < m.rollingMin) m.rollingMin = value;
    if (value > m.rollingMax) m.rollingMax = value;
    m.rollingAvg = m.rollingAvg * 0.9 + value * 0.1;
    m.lastSeen = ts;
  }

  logClustersForService(service: string): LogClusterNode[] {
    const result: LogClusterNode[] = [];
    for (const e of this.edges.values()) {
      if (e.type === "EMITTED_BY" && e.toId === service) {
        const lc = this.logClusters.get(e.fromId);
        if (lc) result.push(lc);
      }
    }
    return result;
  }

  metricsForService(service: string): MetricNode[] {
    return Array.from(this.metrics.values()).filter(m => m.service === service);
  }
}

export class AnomalyStore {
  anomalies = new Map<string, AnomalyNode>();
  edges = new Map<string, Edge>();

  addAnomaly(anomaly: AnomalyNode): void {
    this.anomalies.set(anomaly.id, anomaly);
    const ek = edgeKey("TRIGGERED_BY", anomaly.id, anomaly.service);
    this.edges.set(ek, { type: "TRIGGERED_BY", fromId: anomaly.id, toId: anomaly.service, weight: 0, callCount: 0, errorRate: 0, avgMs: 0, totalMs: 0, errorCount: 0, updatedAt: anomaly.timestamp });
  }

  addPrecededByEdge(anomalyId: string, precedingId: string, ts: Date): void {
    const ek = edgeKey("PRECEDED_BY", anomalyId, precedingId);
    this.edges.set(ek, { type: "PRECEDED_BY", fromId: anomalyId, toId: precedingId, weight: 0, callCount: 0, errorRate: 0, avgMs: 0, totalMs: 0, errorCount: 0, updatedAt: ts });
  }

  anomaliesSince(since: Date): AnomalyNode[] {
    return Array.from(this.anomalies.values()).filter(a => a.timestamp > since);
  }

  anomaliesForService(service: string, since: Date): AnomalyNode[] {
    return Array.from(this.anomalies.values()).filter(a => a.service === service && a.timestamp > since);
  }
}
