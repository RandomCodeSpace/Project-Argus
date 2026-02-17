package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/RandomCodeSpace/Project-Argus/internal/storage"
	collogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

type TraceServer struct {
	repo        *storage.Repository
	logCallback func(storage.Log)
	coltracepb.UnimplementedTraceServiceServer
}

type LogsServer struct {
	repo        *storage.Repository
	logCallback func(storage.Log)
	collogspb.UnimplementedLogsServiceServer
}

func NewTraceServer(repo *storage.Repository) *TraceServer {
	return &TraceServer{repo: repo}
}

// SetLogCallback sets the function to call when a new log is synthesized from a trace.
func (s *TraceServer) SetLogCallback(cb func(storage.Log)) {
	s.logCallback = cb
}

func NewLogsServer(repo *storage.Repository) *LogsServer {
	return &LogsServer{repo: repo}
}

// SetLogCallback sets the function to call when a new log is received.
func (s *LogsServer) SetLogCallback(cb func(storage.Log)) {
	s.logCallback = cb
}

// Export handles incoming OTLP trace data.
func (s *TraceServer) Export(ctx context.Context, req *coltracepb.ExportTraceServiceRequest) (*coltracepb.ExportTraceServiceResponse, error) {
	log.Printf("📥 [TRACES] Received Request with %d ResourceSpans", len(req.ResourceSpans))
	var spansToInsert []storage.Span
	var tracesToUpsert []storage.Trace

	for _, resourceSpans := range req.ResourceSpans {
		serviceName := getServiceName(resourceSpans.Resource.Attributes)
		log.Printf("   Start processing ResourceSpans for Service: %s", serviceName)

		for _, scopeSpans := range resourceSpans.ScopeSpans {
			log.Printf("     Processing ScopeSpans: %s (Spans: %d)", scopeSpans.Scope.Name, len(scopeSpans.Spans))
			for _, span := range scopeSpans.Spans {
				log.Printf("📥 [TRACE] Received Span: %s (Status: %v)", span.Name, span.Status)
				startTime := time.Unix(0, int64(span.StartTimeUnixNano))
				endTime := time.Unix(0, int64(span.EndTimeUnixNano))
				duration := endTime.Sub(startTime).Microseconds()

				// Log specific span details
				log.Printf("       -> Span: %s [TraceID: %x, SpanID: %x, Parent: %x] (%d µs)",
					span.Name, span.TraceId, span.SpanId, span.ParentSpanId, duration)

				attrs, _ := json.Marshal(span.Attributes)

				// Create Span Model
				sModel := storage.Span{
					TraceID:        fmt.Sprintf("%x", span.TraceId),
					SpanID:         fmt.Sprintf("%x", span.SpanId),
					ParentSpanID:   fmt.Sprintf("%x", span.ParentSpanId),
					OperationName:  span.Name,
					StartTime:      startTime,
					EndTime:        endTime,
					Duration:       duration,
					AttributesJSON: string(attrs),
				}
				spansToInsert = append(spansToInsert, sModel)

				// Create/Update Trace Model for indexing
				// We populate/update the Trace record with info from any span.
				// The backend queries this table for high-level metrics.
				statusStr := "STATUS_CODE_UNSET"
				if span.Status != nil {
					statusStr = span.Status.Code.String()
				}

				tModel := storage.Trace{
					TraceID:     fmt.Sprintf("%x", span.TraceId),
					ServiceName: serviceName,
					Timestamp:   startTime,
					Duration:    duration,
					Status:      statusStr,
				}
				tracesToUpsert = append(tracesToUpsert, tModel)

				// Synthesize Logs from Span Events (exceptions) and Status
				var synthesizedLogs []storage.Log

				// 1. Check for Events (e.g., exceptions)
				for _, event := range span.Events {
					severity := "INFO"
					if event.Name == "exception" {
						severity = "ERROR"
					}

					body := event.Name
					// Try to find exception.message or similar
					for _, attr := range event.Attributes {
						if attr.Key == "exception.message" || attr.Key == "message" {
							body = attr.Value.GetStringValue()
							break
						}
					}

					eventAttrs, _ := json.Marshal(event.Attributes)

					l := storage.Log{
						TraceID:        fmt.Sprintf("%x", span.TraceId),
						SpanID:         fmt.Sprintf("%x", span.SpanId),
						Severity:       severity,
						Body:           body,
						ServiceName:    serviceName,
						AttributesJSON: string(eventAttrs),
						Timestamp:      time.Unix(0, int64(event.TimeUnixNano)),
					}
					synthesizedLogs = append(synthesizedLogs, l)
				}

				// 2. Check for Span Status Error (if no events created specific errors)
				// Only if we haven't already created an error log from events for this span
				hasErrorLog := false
				for _, sl := range synthesizedLogs {
					if sl.Severity == "ERROR" {
						hasErrorLog = true
						break
					}
				}

				if !hasErrorLog && span.Status != nil && span.Status.Code == tracepb.Status_STATUS_CODE_ERROR {
					msg := span.Status.Message
					if msg == "" {
						msg = fmt.Sprintf("Span '%s' failed", span.Name)
					}

					l := storage.Log{
						TraceID:        fmt.Sprintf("%x", span.TraceId),
						SpanID:         fmt.Sprintf("%x", span.SpanId),
						Severity:       "ERROR",
						Body:           msg,
						ServiceName:    serviceName,
						AttributesJSON: "{}", // Could copy span attributes
						Timestamp:      endTime,
					}
					synthesizedLogs = append(synthesizedLogs, l)
				}

				// Batch persist synthesized logs
				if len(synthesizedLogs) > 0 {
					if err := s.repo.BatchCreateLogs(synthesizedLogs); err != nil {
						log.Printf("❌ Failed to persist synthesized logs: %v", err)
					} else {
						log.Printf("⚠️ Synthesized %d logs from trace span errors", len(synthesizedLogs))
						// Broadcast
						if s.logCallback != nil {
							for _, sl := range synthesizedLogs {
								s.logCallback(sl)
							}
						}
					}
				}
			}
		}
	}

	// Persist - CRITICAL ORDER: Traces MUST be inserted before Spans due to FK
	if len(tracesToUpsert) > 0 {
		if err := s.repo.BatchCreateTraces(tracesToUpsert); err != nil {
			log.Printf("❌ Failed to insert traces: %v", err)
			// Continue anyway to allow spans to be inserted if traces exist from previous runs
		} else {
			log.Printf("✅ Successfully persisted %d trace records", len(tracesToUpsert))
		}
	}

	if len(spansToInsert) > 0 {
		if err := s.repo.BatchCreateSpans(spansToInsert); err != nil {
			log.Printf("❌ Failed to insert spans: %v", err)
			return nil, err
		}
		log.Printf("✅ Successfully persisted %d spans", len(spansToInsert))
	}

	return &coltracepb.ExportTraceServiceResponse{}, nil
}

// Export handles incoming OTLP log data.
func (s *LogsServer) Export(ctx context.Context, req *collogspb.ExportLogsServiceRequest) (*collogspb.ExportLogsServiceResponse, error) {
	log.Printf("📥 [LOGS] Received Request with %d ResourceLogs", len(req.ResourceLogs))
	var logsToInsert []storage.Log

	for _, resourceLogs := range req.ResourceLogs {
		serviceName := getServiceName(resourceLogs.Resource.Attributes)
		log.Printf("   Start processing ResourceLogs for Service: %s", serviceName)

		for _, scopeLogs := range resourceLogs.ScopeLogs {
			log.Printf("     Processing ScopeLogs: %s (Records: %d)", scopeLogs.Scope.Name, len(scopeLogs.LogRecords))
			for _, l := range scopeLogs.LogRecords {
				timestamp := time.Unix(0, int64(l.TimeUnixNano))
				if timestamp.Unix() == 0 {
					timestamp = time.Now()
				}

				bodyStr := l.Body.GetStringValue()
				if len(bodyStr) > 100 {
					bodyStr = bodyStr[:97] + "..."
				}

				// Log specific log details
				log.Printf("       -> Log: [%s] %s (TraceID: %x)", l.SeverityNumber.String(), bodyStr, l.TraceId)

				attrs, _ := json.Marshal(l.Attributes)

				logEntry := storage.Log{
					TraceID:        fmt.Sprintf("%x", l.TraceId),
					SpanID:         fmt.Sprintf("%x", l.SpanId),
					Severity:       l.SeverityNumber.String(),
					Body:           l.Body.GetStringValue(),
					ServiceName:    serviceName,
					AttributesJSON: string(attrs),
					Timestamp:      timestamp,
				}

				if l.SeverityText != "" {
					logEntry.Severity = l.SeverityText
				}

				logsToInsert = append(logsToInsert, logEntry)
			}
		}
	}

	if len(logsToInsert) > 0 {
		if err := s.repo.BatchCreateLogs(logsToInsert); err != nil {
			log.Printf("❌ Failed to insert logs: %v", err)
			return nil, err
		}
		log.Printf("✅ Successfully persisted %d logs", len(logsToInsert))
	}

	// Notify listener
	if s.logCallback != nil {
		for _, l := range logsToInsert {
			s.logCallback(l)
		}
	}

	return &collogspb.ExportLogsServiceResponse{}, nil
}

// Helper to extract service.name from attributes
func getServiceName(attrs []*commonpb.KeyValue) string {
	for _, kv := range attrs {
		if kv.Key == "service.name" {
			return kv.Value.GetStringValue()
		}
	}
	return "unknown-service"
}
