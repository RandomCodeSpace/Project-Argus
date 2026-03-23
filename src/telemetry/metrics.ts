/**
 * 19 Prometheus metrics using prom-client, plus a health endpoint.
 */
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from "prom-client";

export class Metrics {
  readonly registry = new Registry();

  // Existing
  readonly ingestionRate: Counter;
  readonly activeConnections: Gauge;
  readonly dbLatency: Histogram;
  readonly dlqSize: Gauge;

  // gRPC
  readonly grpcRequestsTotal: Counter;
  readonly grpcRequestDuration: Histogram;
  readonly grpcBatchSize: Histogram;

  // HTTP
  readonly httpRequestsTotal: Counter;
  readonly httpRequestDuration: Histogram;

  // TSDB
  readonly tsdbIngestTotal: Counter;
  readonly tsdbFlushDuration: Histogram;
  readonly tsdbBatchesDropped: Counter;
  readonly tsdbCardinalityOverflow: Counter;

  // WebSocket
  readonly wsMessagesSent: Counter;
  readonly wsSlowClientsRemoved: Counter;

  // DLQ
  readonly dlqEnqueuedTotal: Counter;
  readonly dlqReplaySuccess: Counter;
  readonly dlqReplayFailure: Counter;
  readonly dlqDiskBytes: Gauge;

  // Archive
  readonly archiveRecordsMoved: Counter;
  readonly hotDBSizeBytes: Gauge;
  readonly coldStorageBytes: Gauge;

  // Internal counters for health endpoint
  private _totalIngested = 0;
  private _activeConns = 0;
  private _dlqFileCount = 0;
  private _dbLatencyP99Ms = 0;
  private _startTime = Date.now();

  constructor() {
    const r = this.registry;
    collectDefaultMetrics({ register: r });

    this.ingestionRate = new Counter({ name: "otelcontext_ingestion_rate", help: "Total ingested", registers: [r] });
    this.activeConnections = new Gauge({ name: "otelcontext_active_connections", help: "Active WS", registers: [r] });
    this.dbLatency = new Histogram({ name: "otelcontext_db_latency", help: "DB latency", registers: [r] });
    this.dlqSize = new Gauge({ name: "otelcontext_dlq_size", help: "DLQ files", registers: [r] });

    this.grpcRequestsTotal = new Counter({ name: "otelcontext_grpc_requests_total", help: "gRPC reqs", labelNames: ["method", "status"], registers: [r] });
    this.grpcRequestDuration = new Histogram({ name: "otelcontext_grpc_request_duration_seconds", help: "gRPC lat", labelNames: ["method"], registers: [r] });
    this.grpcBatchSize = new Histogram({ name: "otelcontext_grpc_batch_size", help: "Batch size", registers: [r] });

    this.httpRequestsTotal = new Counter({ name: "otelcontext_http_requests_total", help: "HTTP reqs", labelNames: ["method", "path", "status"], registers: [r] });
    this.httpRequestDuration = new Histogram({ name: "otelcontext_http_request_duration_seconds", help: "HTTP lat", labelNames: ["method", "path"], registers: [r] });

    this.tsdbIngestTotal = new Counter({ name: "otelcontext_tsdb_ingest_total", help: "TSDB ingest", registers: [r] });
    this.tsdbFlushDuration = new Histogram({ name: "otelcontext_tsdb_flush_duration_seconds", help: "TSDB flush", registers: [r] });
    this.tsdbBatchesDropped = new Counter({ name: "otelcontext_tsdb_batches_dropped_total", help: "TSDB drops", registers: [r] });
    this.tsdbCardinalityOverflow = new Counter({ name: "otelcontext_tsdb_cardinality_overflow_total", help: "Card overflow", registers: [r] });

    this.wsMessagesSent = new Counter({ name: "otelcontext_ws_messages_sent_total", help: "WS msgs", labelNames: ["type"], registers: [r] });
    this.wsSlowClientsRemoved = new Counter({ name: "otelcontext_ws_slow_clients_removed_total", help: "Slow clients", registers: [r] });

    this.dlqEnqueuedTotal = new Counter({ name: "otelcontext_dlq_enqueued_total", help: "DLQ enqueued", registers: [r] });
    this.dlqReplaySuccess = new Counter({ name: "otelcontext_dlq_replay_success_total", help: "DLQ success", registers: [r] });
    this.dlqReplayFailure = new Counter({ name: "otelcontext_dlq_replay_failure_total", help: "DLQ fail", registers: [r] });
    this.dlqDiskBytes = new Gauge({ name: "otelcontext_dlq_disk_bytes", help: "DLQ bytes", registers: [r] });

    this.archiveRecordsMoved = new Counter({ name: "otelcontext_archive_records_moved_total", help: "Archive moved", labelNames: ["type"], registers: [r] });
    this.hotDBSizeBytes = new Gauge({ name: "otelcontext_hot_db_size_bytes", help: "Hot DB size", registers: [r] });
    this.coldStorageBytes = new Gauge({ name: "otelcontext_cold_storage_bytes", help: "Cold size", registers: [r] });
  }

  recordIngestion(count: number): void {
    this.ingestionRate.inc(count);
    this._totalIngested += count;
  }

  setActiveConnections(n: number): void {
    this.activeConnections.set(n);
    this._activeConns = n;
  }

  setDLQSize(n: number): void {
    this.dlqSize.set(n);
    this._dlqFileCount = n;
  }

  observeDBLatency(seconds: number): void {
    this.dbLatency.observe(seconds);
    this._dbLatencyP99Ms = seconds * 1000;
  }

  getHealthStats(): any {
    const memUsage = process.memoryUsage();
    return {
      ingestion_rate: this._totalIngested,
      dlq_size: this._dlqFileCount,
      active_connections: this._activeConns,
      db_latency_p99_ms: this._dbLatencyP99Ms,
      heap_alloc_mb: memUsage.heapUsed / 1024 / 1024,
      uptime_seconds: (Date.now() - this._startTime) / 1000,
    };
  }
}
