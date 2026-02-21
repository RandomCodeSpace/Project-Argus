export interface Trace {
    id: number
    trace_id: string
    service_name: string
    operation: string
    duration_ms: number
    status: string
    span_count: number
    timestamp: string
    spans?: Span[] // Optional for expanded view
}

export interface Span {
    id: number
    trace_id: string
    span_id: string
    parent_span_id: string
    service_name?: string // Not always present on span directly
    operation_name: string
    duration: number // Microseconds from backend
    status: string
    attributes_json: string
    start_time: string
    end_time: string
}

export interface ServiceMapNode {
    name: string
    total_traces: number
    error_count: number
    avg_latency_ms: number
}

export interface ServiceMapEdge {
    source: string
    target: string
    call_count: number
    avg_latency_ms: number
    error_rate: number
}

export interface ServiceMapMetrics {
    nodes: ServiceMapNode[]
    edges: ServiceMapEdge[]
}

export interface LogEntry {
    id: number
    trace_id: string
    span_id: string
    severity: string
    body: string
    service_name: string
    attributes_json: string
    ai_insight: string
    timestamp: string
}

export interface LogResponse {
    logs: LogEntry[]
    data: LogEntry[]
    total: number
    page: number
    page_size: number
}

export interface TraceResponse {
    traces: Trace[]
    total: number
}

export interface TrafficPoint {
    timestamp: string
    count: number
    error_count: number
}

export interface LatencyPoint {
    timestamp: string
    service_name: string
    p50: number
    p95: number
    p99: number
}

export interface LatencyHeatmapPoint {
    timestamp: string
    duration: number // Microseconds
}

export interface ServiceError {
    service_name: string
    error_count: number
    total_count: number
    error_rate: number
}

export interface DashboardStats {
    total_traces: number
    total_logs: number
    total_errors: number
    avg_latency_ms: number
    error_rate: number
    active_services: number
    p99_latency: number
    top_failing_services: ServiceError[]
}

export interface HealthStats {
    ingestion_rate: number
    dlq_size: number
    active_connections: number
    db_latency_p99_ms: number
}

// Argus V5.3 Metrics Types
export interface MetricBucket {
    id: number
    name: string
    service_name: string
    time_bucket: string
    min: number
    max: number
    sum: number
    count: number
    attributes_json: string
}

export interface MetricEntry {
    name: string
    service_name: string
    value: number
    timestamp: string
    attributes: Record<string, any>
}

export interface HubBatch {
    type: 'logs' | 'metrics'
    data: LogEntry[] | MetricEntry[]
}
