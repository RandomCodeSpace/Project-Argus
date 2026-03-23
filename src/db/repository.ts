/**
 * Database repository — CRUD operations using bun:sqlite directly.
 * Text fields (log body, span attributes) are compressed with gzip.
 */
import { Database } from "bun:sqlite";
import { compressText, decompressText } from "../compress/gzip";

// --- Data types matching the Go models ---

export interface Trace {
  id?: number;
  trace_id: string;
  service_name: string;
  duration: number; // microseconds
  duration_ms?: number;
  span_count?: number;
  operation?: string;
  status: string;
  timestamp: string; // ISO8601
  spans?: Span[];
  logs?: Log[];
}

export interface Span {
  id?: number;
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  operation_name: string;
  start_time: string;
  end_time: string;
  duration: number; // microseconds
  service_name: string;
  attributes_json: string;
}

export interface Log {
  id?: number;
  trace_id: string;
  span_id: string;
  severity: string;
  body: string;
  service_name: string;
  attributes_json: string;
  ai_insight?: string;
  timestamp: string;
}

export interface MetricBucket {
  id?: number;
  name: string;
  service_name: string;
  time_bucket: string;
  min: number;
  max: number;
  sum: number;
  count: number;
  attributes_json?: string;
}

export interface LogFilter {
  serviceName?: string;
  severity?: string;
  search?: string;
  traceId?: string;
  startTime?: string;
  endTime?: string;
  limit: number;
  offset: number;
}

export class Repository {
  public db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = OFF");
  }

  close(): void {
    this.db.close();
  }

  // --- Batch operations ---

  batchCreateTraces(traces: Trace[]): void {
    if (traces.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO traces (trace_id, service_name, duration, status, timestamp, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      for (const t of traces) {
        stmt.run(t.trace_id, t.service_name, t.duration, t.status, t.timestamp, now, now);
      }
    });
    tx();
  }

  batchCreateSpans(spansData: Span[]): void {
    if (spansData.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO spans (trace_id, span_id, parent_span_id, operation_name, start_time, end_time, duration, service_name, attributes_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = this.db.transaction(() => {
      for (const s of spansData) {
        stmt.run(
          s.trace_id, s.span_id, s.parent_span_id, s.operation_name,
          s.start_time, s.end_time, s.duration, s.service_name,
          compressText(s.attributes_json)
        );
      }
    });
    tx();
  }

  batchCreateLogs(logsData: Log[]): void {
    if (logsData.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO logs (trace_id, span_id, severity, body, service_name, attributes_json, ai_insight, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = this.db.transaction(() => {
      for (const l of logsData) {
        stmt.run(
          l.trace_id, l.span_id, l.severity,
          compressText(l.body), l.service_name,
          compressText(l.attributes_json),
          l.ai_insight ? compressText(l.ai_insight) : null,
          l.timestamp
        );
      }
    });
    tx();
  }

  batchCreateMetrics(metrics: MetricBucket[]): void {
    if (metrics.length === 0) return;
    const stmt = this.db.prepare(
      `INSERT INTO metric_buckets (name, service_name, time_bucket, min, max, sum, count, attributes_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = this.db.transaction(() => {
      for (const m of metrics) {
        stmt.run(
          m.name, m.service_name, m.time_bucket,
          m.min, m.max, m.sum, m.count,
          m.attributes_json ? compressText(m.attributes_json) : null
        );
      }
    });
    tx();
  }

  // --- Query operations ---

  private deserializeLog(row: any): Log {
    return {
      id: row.id,
      trace_id: row.trace_id || "",
      span_id: row.span_id || "",
      severity: row.severity || "",
      body: decompressText(row.body),
      service_name: row.service_name || "",
      attributes_json: decompressText(row.attributes_json),
      ai_insight: decompressText(row.ai_insight),
      timestamp: row.timestamp,
    };
  }

  private deserializeSpan(row: any): Span {
    return {
      id: row.id,
      trace_id: row.trace_id || "",
      span_id: row.span_id || "",
      parent_span_id: row.parent_span_id || "",
      operation_name: row.operation_name || "",
      start_time: row.start_time,
      end_time: row.end_time,
      duration: row.duration || 0,
      service_name: row.service_name || "",
      attributes_json: decompressText(row.attributes_json),
    };
  }

  getLogsV2(filter: LogFilter): { logs: Log[]; total: number } {
    let where = "1=1";
    const params: any[] = [];

    if (filter.serviceName) {
      where += " AND service_name = ?";
      params.push(filter.serviceName);
    }
    if (filter.severity) {
      where += " AND severity = ?";
      params.push(filter.severity);
    }
    if (filter.traceId) {
      where += " AND trace_id = ?";
      params.push(filter.traceId);
    }
    if (filter.startTime) {
      where += " AND timestamp >= ?";
      params.push(filter.startTime);
    }
    if (filter.endTime) {
      where += " AND timestamp <= ?";
      params.push(filter.endTime);
    }
    if (filter.search) {
      // Search in body requires scanning; we search uncompressed using a sub-select hack
      // For simplicity, search trace_id. Full-text on compressed blobs requires decompression.
      where += " AND trace_id LIKE ?";
      params.push(`%${filter.search}%`);
    }

    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM logs WHERE ${where}`).get(...params) as any;
    const total = countRow?.cnt || 0;

    const rows = this.db.prepare(
      `SELECT * FROM logs WHERE ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
    ).all(...params, filter.limit, filter.offset) as any[];

    return { logs: rows.map((r) => this.deserializeLog(r)), total };
  }

  getLogContext(targetTime: string): Log[] {
    const start = new Date(new Date(targetTime).getTime() - 60000).toISOString();
    const end = new Date(new Date(targetTime).getTime() + 60000).toISOString();
    const rows = this.db.prepare(
      "SELECT * FROM logs WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC"
    ).all(start, end) as any[];
    return rows.map((r) => this.deserializeLog(r));
  }

  getLog(id: number): Log | null {
    const row = this.db.prepare("SELECT * FROM logs WHERE id = ?").get(id) as any;
    return row ? this.deserializeLog(row) : null;
  }

  getRecentLogs(limit: number): Log[] {
    const rows = this.db.prepare("SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?").all(limit) as any[];
    return rows.map((r) => this.deserializeLog(r));
  }

  // --- Traces ---

  getTrace(traceId: string): Trace | null {
    const row = this.db.prepare("SELECT * FROM traces WHERE trace_id = ? LIMIT 1").get(traceId) as any;
    if (!row) return null;
    const trace: Trace = {
      id: row.id,
      trace_id: row.trace_id,
      service_name: row.service_name || "",
      duration: row.duration || 0,
      duration_ms: (row.duration || 0) / 1000,
      status: row.status || "",
      timestamp: row.timestamp,
    };
    // Load spans
    const spanRows = this.db.prepare("SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC").all(traceId) as any[];
    trace.spans = spanRows.map((s) => this.deserializeSpan(s));
    trace.span_count = trace.spans.length;
    if (trace.spans.length > 0) {
      trace.operation = trace.spans[0].operation_name;
    }
    // Load related logs
    const logRows = this.db.prepare("SELECT * FROM logs WHERE trace_id = ? ORDER BY timestamp ASC").all(traceId) as any[];
    trace.logs = logRows.map((l) => this.deserializeLog(l));
    return trace;
  }

  getTracesFiltered(
    start: string, end: string, serviceNames: string[], status: string,
    search: string, limit: number, offset: number, sortBy: string, orderBy: string
  ): { data: Trace[]; total: number } {
    let where = "1=1";
    const params: any[] = [];

    if (start) { where += " AND timestamp >= ?"; params.push(start); }
    if (end) { where += " AND timestamp <= ?"; params.push(end); }
    if (serviceNames && serviceNames.length > 0) {
      where += ` AND service_name IN (${serviceNames.map(() => "?").join(",")})`;
      params.push(...serviceNames);
    }
    if (status) { where += " AND status LIKE ?"; params.push(`%${status}%`); }
    if (search) { where += " AND trace_id LIKE ?"; params.push(`%${search}%`); }

    const countRow = this.db.prepare(`SELECT COUNT(*) as cnt FROM traces WHERE ${where}`).get(...params) as any;
    const total = countRow?.cnt || 0;

    const validSortBy = ["timestamp", "duration", "service_name"].includes(sortBy) ? sortBy : "timestamp";
    const validOrderBy = orderBy?.toLowerCase() === "asc" ? "ASC" : "DESC";

    const rows = this.db.prepare(
      `SELECT * FROM traces WHERE ${where} ORDER BY ${validSortBy} ${validOrderBy} LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as any[];

    const data = rows.map((r) => {
      const t: Trace = {
        id: r.id,
        trace_id: r.trace_id,
        service_name: r.service_name || "",
        duration: r.duration || 0,
        duration_ms: (r.duration || 0) / 1000,
        status: r.status || "",
        timestamp: r.timestamp,
      };
      // Get span count
      const scRow = this.db.prepare("SELECT COUNT(*) as cnt FROM spans WHERE trace_id = ?").get(r.trace_id) as any;
      t.span_count = scRow?.cnt || 0;
      // Get root operation
      const opRow = this.db.prepare("SELECT operation_name FROM spans WHERE trace_id = ? ORDER BY start_time ASC LIMIT 1").get(r.trace_id) as any;
      t.operation = opRow?.operation_name || "";
      return t;
    });

    return { data, total };
  }

  // --- Metrics ---

  getMetricBuckets(start: string, end: string, serviceName: string, name: string): MetricBucket[] {
    let where = "1=1";
    const params: any[] = [];
    if (start) { where += " AND time_bucket >= ?"; params.push(start); }
    if (end) { where += " AND time_bucket <= ?"; params.push(end); }
    if (serviceName) { where += " AND service_name = ?"; params.push(serviceName); }
    if (name) { where += " AND name = ?"; params.push(name); }

    const rows = this.db.prepare(
      `SELECT * FROM metric_buckets WHERE ${where} ORDER BY time_bucket ASC`
    ).all(...params) as any[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      service_name: r.service_name,
      time_bucket: r.time_bucket,
      min: r.min,
      max: r.max,
      sum: r.sum,
      count: r.count,
      attributes_json: decompressText(r.attributes_json),
    }));
  }

  getMetricNames(serviceName?: string): string[] {
    let query = "SELECT DISTINCT name FROM metric_buckets";
    const params: any[] = [];
    if (serviceName) {
      query += " WHERE service_name = ?";
      params.push(serviceName);
    }
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => r.name);
  }

  getServices(): string[] {
    const logServices = this.db.prepare("SELECT DISTINCT service_name FROM logs WHERE service_name IS NOT NULL AND service_name != ''").all() as any[];
    const traceServices = this.db.prepare("SELECT DISTINCT service_name FROM traces WHERE service_name IS NOT NULL AND service_name != ''").all() as any[];
    const set = new Set<string>();
    for (const r of logServices) set.add(r.service_name);
    for (const r of traceServices) set.add(r.service_name);
    return Array.from(set).sort();
  }

  getTrafficMetrics(start: string, end: string, serviceNames?: string[]): any[] {
    let where = "timestamp >= ? AND timestamp <= ?";
    const params: any[] = [start, end];
    if (serviceNames && serviceNames.length > 0) {
      where += ` AND service_name IN (${serviceNames.map(() => "?").join(",")})`;
      params.push(...serviceNames);
    }
    return this.db.prepare(
      `SELECT service_name, strftime('%Y-%m-%dT%H:%M:00Z', timestamp) as time_bucket, COUNT(*) as count
       FROM traces WHERE ${where}
       GROUP BY service_name, time_bucket ORDER BY time_bucket ASC`
    ).all(...params) as any[];
  }

  getLatencyHeatmap(start: string, end: string, serviceNames?: string[]): any[] {
    let where = "timestamp >= ? AND timestamp <= ?";
    const params: any[] = [start, end];
    if (serviceNames && serviceNames.length > 0) {
      where += ` AND service_name IN (${serviceNames.map(() => "?").join(",")})`;
      params.push(...serviceNames);
    }
    return this.db.prepare(
      `SELECT service_name, strftime('%Y-%m-%dT%H:%M:00Z', timestamp) as time_bucket,
              AVG(duration/1000.0) as avg_latency_ms, MAX(duration/1000.0) as max_latency_ms,
              MIN(duration/1000.0) as min_latency_ms, COUNT(*) as count
       FROM traces WHERE ${where}
       GROUP BY service_name, time_bucket ORDER BY time_bucket ASC`
    ).all(...params) as any[];
  }

  getDashboardStats(start: string, end: string, serviceNames?: string[]): any {
    let where = "timestamp >= ? AND timestamp <= ?";
    const params: any[] = [start, end];
    if (serviceNames && serviceNames.length > 0) {
      where += ` AND service_name IN (${serviceNames.map(() => "?").join(",")})`;
      params.push(...serviceNames);
    }
    const traceStats = this.db.prepare(
      `SELECT COUNT(*) as total_requests, AVG(duration/1000.0) as avg_latency_ms,
              SUM(CASE WHEN status LIKE '%ERROR%' THEN 1 ELSE 0 END) as error_count
       FROM traces WHERE ${where}`
    ).get(...params) as any;

    const perService = this.db.prepare(
      `SELECT service_name, COUNT(*) as requests, AVG(duration/1000.0) as avg_latency_ms,
              SUM(CASE WHEN status LIKE '%ERROR%' THEN 1 ELSE 0 END) as errors
       FROM traces WHERE ${where} GROUP BY service_name`
    ).all(...params) as any[];

    return {
      total_requests: traceStats?.total_requests || 0,
      avg_latency_ms: traceStats?.avg_latency_ms || 0,
      error_count: traceStats?.error_count || 0,
      error_rate: traceStats?.total_requests ? (traceStats.error_count / traceStats.total_requests) : 0,
      services: perService,
    };
  }

  getServiceMapMetrics(start: string, end: string): any[] {
    return this.db.prepare(
      `SELECT s.service_name as source, s2.service_name as target, COUNT(*) as call_count,
              AVG(s.duration/1000.0) as avg_latency_ms
       FROM spans s
       JOIN spans s2 ON s.parent_span_id = s2.span_id AND s.trace_id = s2.trace_id
       WHERE s.service_name != s2.service_name
         AND s.start_time >= ? AND s.start_time <= ?
       GROUP BY source, target`
    ).all(start, end) as any[];
  }

  // --- Stats ---

  getStats(): any {
    const traceCount = (this.db.prepare("SELECT COUNT(*) as cnt FROM traces").get() as any)?.cnt || 0;
    const logCount = (this.db.prepare("SELECT COUNT(*) as cnt FROM logs").get() as any)?.cnt || 0;
    const errorCount = (this.db.prepare("SELECT COUNT(*) as cnt FROM logs WHERE severity = 'ERROR'").get() as any)?.cnt || 0;
    const services = this.getServices();

    let dbSizeMB = 0;
    try {
      const pageCount = (this.db.prepare("PRAGMA page_count").get() as any)?.page_count || 0;
      const pageSize = (this.db.prepare("PRAGMA page_size").get() as any)?.page_size || 0;
      dbSizeMB = (pageCount * pageSize) / (1024 * 1024);
    } catch {}

    return {
      LogCount: logCount,
      TraceCount: traceCount,
      ErrorCount: errorCount,
      ServiceCount: services.length,
      DBSizeMB: dbSizeMB.toFixed(1),
      trace_count: traceCount,
      error_count: errorCount,
    };
  }

  hotDBSizeBytes(): number {
    try {
      const pageCount = (this.db.prepare("PRAGMA page_count").get() as any)?.page_count || 0;
      const pageSize = (this.db.prepare("PRAGMA page_size").get() as any)?.page_size || 0;
      return pageCount * pageSize;
    } catch {
      return 0;
    }
  }

  vacuum(): void {
    this.db.exec("VACUUM");
  }

  // --- Purge ---

  purge(olderThan: string): { logs: number; traces: number; spans: number } {
    const logResult = this.db.prepare("DELETE FROM logs WHERE timestamp < ?").run(olderThan);
    const traceResult = this.db.prepare("DELETE FROM traces WHERE timestamp < ?").run(olderThan);
    const spanResult = this.db.prepare("DELETE FROM spans WHERE start_time < ?").run(olderThan);
    return {
      logs: logResult.changes,
      traces: traceResult.changes,
      spans: spanResult.changes,
    };
  }

  // --- Archive helpers ---

  getArchivedDateRange(cutoff: string): string[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT date(timestamp) as d FROM traces WHERE timestamp < ? ORDER BY d ASC`
    ).all(cutoff) as any[];
    return rows.map((r) => r.d);
  }

  getTracesForArchive(start: string, end: string, limit: number, offset: number): any[] {
    return this.db.prepare(
      "SELECT * FROM traces WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC LIMIT ? OFFSET ?"
    ).all(start, end, limit, offset) as any[];
  }

  getLogsForArchive(start: string, end: string, limit: number, offset: number): Log[] {
    const rows = this.db.prepare(
      "SELECT * FROM logs WHERE timestamp >= ? AND timestamp < ? ORDER BY timestamp ASC LIMIT ? OFFSET ?"
    ).all(start, end, limit, offset) as any[];
    return rows.map((r) => this.deserializeLog(r));
  }

  getMetricsForArchive(start: string, end: string, limit: number, offset: number): any[] {
    return this.db.prepare(
      "SELECT * FROM metric_buckets WHERE time_bucket >= ? AND time_bucket < ? ORDER BY time_bucket ASC LIMIT ? OFFSET ?"
    ).all(start, end, limit, offset) as any[];
  }

  deleteTracesByIDs(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM traces WHERE id IN (${placeholders})`).run(...ids);
  }

  deleteLogsByIDs(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM logs WHERE id IN (${placeholders})`).run(...ids);
  }

  deleteMetricsByIDs(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(`DELETE FROM metric_buckets WHERE id IN (${placeholders})`).run(...ids);
  }

  // --- Spans for Graph ---

  getSpansForGraph(since: string): any[] {
    return this.db.prepare(
      `SELECT span_id, parent_span_id, service_name, operation_name, duration, trace_id, start_time
       FROM spans WHERE start_time > ? ORDER BY start_time ASC LIMIT 50000`
    ).all(since) as any[];
  }
}
