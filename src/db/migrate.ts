/**
 * Auto-migration: creates tables if they don't exist using Drizzle.
 */
import { type Database } from "bun:sqlite";

export function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      service_name TEXT,
      duration INTEGER,
      status TEXT,
      timestamp TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON traces(trace_id);
    CREATE INDEX IF NOT EXISTS idx_traces_service_name ON traces(service_name);
    CREATE INDEX IF NOT EXISTS idx_traces_timestamp ON traces(timestamp);
    CREATE INDEX IF NOT EXISTS idx_traces_duration ON traces(duration);

    CREATE TABLE IF NOT EXISTS spans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      span_id TEXT NOT NULL,
      parent_span_id TEXT,
      operation_name TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration INTEGER,
      service_name TEXT,
      attributes_json BLOB
    );
    CREATE INDEX IF NOT EXISTS idx_spans_trace_id ON spans(trace_id);
    CREATE INDEX IF NOT EXISTS idx_spans_service_name ON spans(service_name);
    CREATE INDEX IF NOT EXISTS idx_spans_operation_name ON spans(operation_name);

    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT,
      span_id TEXT,
      severity TEXT,
      body BLOB,
      service_name TEXT,
      attributes_json BLOB,
      ai_insight BLOB,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON logs(trace_id);
    CREATE INDEX IF NOT EXISTS idx_logs_service_name ON logs(service_name);
    CREATE INDEX IF NOT EXISTS idx_logs_severity ON logs(severity);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);

    CREATE TABLE IF NOT EXISTS metric_buckets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      service_name TEXT NOT NULL,
      time_bucket TEXT NOT NULL,
      min REAL,
      max REAL,
      sum REAL,
      count INTEGER,
      attributes_json BLOB
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_name ON metric_buckets(name);
    CREATE INDEX IF NOT EXISTS idx_metrics_service_name ON metric_buckets(service_name);
    CREATE INDEX IF NOT EXISTS idx_metrics_time_bucket ON metric_buckets(time_bucket);

    CREATE TABLE IF NOT EXISTS investigations (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      status TEXT,
      severity TEXT,
      trigger_service TEXT,
      trigger_operation TEXT,
      error_message TEXT,
      root_service TEXT,
      root_operation TEXT,
      causal_chain TEXT,
      trace_ids TEXT,
      error_logs TEXT,
      anomalous_metrics TEXT,
      affected_services TEXT,
      span_chain TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_investigations_trigger_service ON investigations(trigger_service);

    CREATE TABLE IF NOT EXISTS graph_snapshots (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      nodes TEXT,
      edges TEXT,
      service_count INTEGER,
      total_calls INTEGER,
      avg_health_score REAL
    );
  `);
}
