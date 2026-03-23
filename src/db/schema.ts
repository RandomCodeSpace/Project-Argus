/**
 * Drizzle ORM schema for OtelContext.
 * Tables: traces, spans, logs, metric_buckets, investigations, graph_snapshots
 */
import { sqliteTable, text, integer, real, blob, index } from "drizzle-orm/sqlite-core";

export const traces = sqliteTable("traces", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  traceId: text("trace_id").notNull(),
  serviceName: text("service_name"),
  duration: integer("duration"), // microseconds
  status: text("status"),
  timestamp: text("timestamp").notNull(), // ISO8601
  createdAt: text("created_at"),
  updatedAt: text("updated_at"),
}, (table) => [
  index("idx_traces_trace_id").on(table.traceId),
  index("idx_traces_service_name").on(table.serviceName),
  index("idx_traces_timestamp").on(table.timestamp),
  index("idx_traces_duration").on(table.duration),
]);

export const spans = sqliteTable("spans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  traceId: text("trace_id").notNull(),
  spanId: text("span_id").notNull(),
  parentSpanId: text("parent_span_id"),
  operationName: text("operation_name"),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  duration: integer("duration"), // microseconds
  serviceName: text("service_name"),
  attributesJson: blob("attributes_json", { mode: "buffer" }), // gzip compressed
}, (table) => [
  index("idx_spans_trace_id").on(table.traceId),
  index("idx_spans_service_name").on(table.serviceName),
  index("idx_spans_operation_name").on(table.operationName),
]);

export const logs = sqliteTable("logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  traceId: text("trace_id"),
  spanId: text("span_id"),
  severity: text("severity"),
  body: blob("body", { mode: "buffer" }), // gzip compressed
  serviceName: text("service_name"),
  attributesJson: blob("attributes_json", { mode: "buffer" }), // gzip compressed
  aiInsight: blob("ai_insight", { mode: "buffer" }), // gzip compressed
  timestamp: text("timestamp").notNull(),
}, (table) => [
  index("idx_logs_trace_id").on(table.traceId),
  index("idx_logs_service_name").on(table.serviceName),
  index("idx_logs_severity").on(table.severity),
  index("idx_logs_timestamp").on(table.timestamp),
]);

export const metricBuckets = sqliteTable("metric_buckets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  serviceName: text("service_name").notNull(),
  timeBucket: text("time_bucket").notNull(),
  min: real("min"),
  max: real("max"),
  sum: real("sum"),
  count: integer("count"),
  attributesJson: blob("attributes_json", { mode: "buffer" }), // gzip compressed
}, (table) => [
  index("idx_metrics_name").on(table.name),
  index("idx_metrics_service_name").on(table.serviceName),
  index("idx_metrics_time_bucket").on(table.timeBucket),
]);

export const investigations = sqliteTable("investigations", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  status: text("status"),
  severity: text("severity"),
  triggerService: text("trigger_service"),
  triggerOperation: text("trigger_operation"),
  errorMessage: text("error_message"),
  rootService: text("root_service"),
  rootOperation: text("root_operation"),
  causalChain: text("causal_chain"), // JSON
  traceIds: text("trace_ids"), // JSON
  errorLogs: text("error_logs"), // JSON
  anomalousMetrics: text("anomalous_metrics"), // JSON
  affectedServices: text("affected_services"), // JSON
  spanChain: text("span_chain"), // JSON
}, (table) => [
  index("idx_investigations_trigger_service").on(table.triggerService),
]);

export const graphSnapshots = sqliteTable("graph_snapshots", {
  id: text("id").primaryKey(),
  createdAt: text("created_at").notNull(),
  nodes: text("nodes"), // JSON
  edges: text("edges"), // JSON
  serviceCount: integer("service_count"),
  totalCalls: integer("total_calls"),
  avgHealthScore: real("avg_health_score"),
});
