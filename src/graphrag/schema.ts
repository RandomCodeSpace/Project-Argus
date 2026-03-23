/**
 * GraphRAG node and edge types — 7 node types, 9 edge types.
 */

// Node types
export type NodeType = "service" | "operation" | "trace" | "span" | "log_cluster" | "metric" | "anomaly";

export interface ServiceNode {
  id: string;
  name: string;
  firstSeen: Date;
  lastSeen: Date;
  healthScore: number;
  callCount: number;
  errorCount: number;
  errorRate: number;
  avgLatency: number; // ms
  totalMs: number;
}

export interface OperationNode {
  id: string; // service|operation
  service: string;
  operation: string;
  firstSeen: Date;
  lastSeen: Date;
  healthScore: number;
  callCount: number;
  errorCount: number;
  errorRate: number;
  avgLatency: number;
  p50Latency: number;
  p95Latency: number;
  p99Latency: number;
  totalMs: number;
}

export interface TraceNode {
  id: string;
  rootService: string;
  duration: number; // ms
  status: string;
  timestamp: Date;
  spanCount: number;
}

export interface SpanNode {
  id: string;
  traceId: string;
  parentSpanId: string;
  service: string;
  operation: string;
  duration: number; // ms
  statusCode: string;
  isError: boolean;
  timestamp: Date;
}

export interface LogClusterNode {
  id: string;
  template: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  severityDist: Record<string, number>;
}

export interface MetricNode {
  id: string;
  metricName: string;
  service: string;
  rollingMin: number;
  rollingMax: number;
  rollingAvg: number;
  sampleCount: number;
  lastSeen: Date;
}

export type AnomalySeverity = "critical" | "warning" | "info";
export type AnomalyType = "error_spike" | "latency_spike" | "metric_zscore";

export interface AnomalyNode {
  id: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  service: string;
  evidence: string;
  timestamp: Date;
}

// Edge types
export type EdgeType = "CALLS" | "EXPOSES" | "CONTAINS" | "CHILD_OF" | "EMITTED_BY" | "LOGGED_DURING" | "MEASURED_BY" | "PRECEDED_BY" | "TRIGGERED_BY";

export interface Edge {
  type: EdgeType;
  fromId: string;
  toId: string;
  weight: number;
  callCount: number;
  errorRate: number;
  avgMs: number;
  totalMs: number;
  errorCount: number;
  updatedAt: Date;
}

// Query result types
export interface RootCauseInfo {
  service: string;
  operation: string;
  error_message: string;
  span_id: string;
  trace_id: string;
}

export interface ErrorChainResult {
  root_cause: RootCauseInfo | null;
  span_chain: SpanNode[];
  correlated_logs: LogClusterNode[];
  anomalous_metrics: MetricNode[];
  trace_id: string;
}

export interface ImpactResult {
  service: string;
  affected_services: AffectedEntry[];
  total_downstream: number;
}

export interface AffectedEntry {
  service: string;
  depth: number;
  call_count: number;
  impact_score: number;
}

export interface RankedCause {
  service: string;
  operation: string;
  score: number;
  evidence: string[];
  error_chain: SpanNode[];
  anomalies: AnomalyNode[];
}

export interface CorrelatedSignalsResult {
  service: string;
  error_logs: LogClusterNode[];
  metrics: MetricNode[];
  anomalies: AnomalyNode[];
  error_chains: ErrorChainResult[];
}

export interface ServiceMapEntry {
  service: ServiceNode;
  operations: OperationNode[];
  calls_to: Edge[];
  called_by: Edge[];
}

export function edgeKey(et: EdgeType, from: string, to: string): string {
  return `${et}|${from}|${to}`;
}

export function computeHealth(errorRate: number, avgLatencyMs: number): number {
  const latencyDev = Math.max(0, (avgLatencyMs - 100) / 100);
  let score = 1.0 - (errorRate * 5) - (latencyDev * 0.1);
  return Math.max(0, Math.min(1, score));
}
