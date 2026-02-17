export interface Trace {
    id: number;
    trace_id: string;
    service_name: string;
    duration: number;
    status: string;
    timestamp: string;
    spans?: Span[];
}

export interface Span {
    id: number;
    trace_id: string;
    span_id: string;
    parent_span_id: string;
    operation_name: string;
    start_time: string;
    end_time: string;
    duration: number;
    attributes_json: string;
}
