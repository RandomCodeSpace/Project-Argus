package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/RandomCodeSpace/Project-Argus/internal/config"
	"github.com/RandomCodeSpace/Project-Argus/internal/storage"
	"github.com/RandomCodeSpace/Project-Argus/internal/telemetry"
	collogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

type TraceServer struct {
	repo             *storage.Repository
	metrics          *telemetry.Metrics
	logCallback      func(storage.Log)
	minSeverity      int
	allowedServices  map[string]bool
	excludedServices map[string]bool
	coltracepb.UnimplementedTraceServiceServer
}

type LogsServer struct {
	repo             *storage.Repository
	metrics          *telemetry.Metrics
	logCallback      func(storage.Log)
	minSeverity      int
	allowedServices  map[string]bool
	excludedServices map[string]bool
	collogspb.UnimplementedLogsServiceServer
}

func NewTraceServer(repo *storage.Repository, metrics *telemetry.Metrics, cfg *config.Config) *TraceServer {
	return &TraceServer{
		repo:             repo,
		metrics:          metrics,
		minSeverity:      parseSeverity(cfg.IngestMinSeverity),
		allowedServices:  parseServiceList(cfg.IngestAllowedServices),
		excludedServices: parseServiceList(cfg.IngestExcludedServices),
	}
}

// SetLogCallback sets the function to call when a new log is synthesized from a trace.
func (s *TraceServer) SetLogCallback(cb func(storage.Log)) {
	s.logCallback = cb
}

func NewLogsServer(repo *storage.Repository, metrics *telemetry.Metrics, cfg *config.Config) *LogsServer {
	return &LogsServer{
		repo:             repo,
		metrics:          metrics,
		minSeverity:      parseSeverity(cfg.IngestMinSeverity),
		allowedServices:  parseServiceList(cfg.IngestAllowedServices),
		excludedServices: parseServiceList(cfg.IngestExcludedServices),
	}
}

// SetLogCallback sets the function to call when a new log is received.
func (s *LogsServer) SetLogCallback(cb func(storage.Log)) {
	s.logCallback = cb
}

// Export handles incoming OTLP trace data.
func (s *TraceServer) Export(ctx context.Context, req *coltracepb.ExportTraceServiceRequest) (*coltracepb.ExportTraceServiceResponse, error) {
	slog.Info("📥 [TRACES] Received Request", "resource_spans", len(req.ResourceSpans))
	var spansToInsert []storage.Span
	var tracesToUpsert []storage.Trace

	for _, resourceSpans := range req.ResourceSpans {
		serviceName := getServiceName(resourceSpans.Resource.Attributes)

		if !shouldIngestService(serviceName, s.allowedServices, s.excludedServices) {
			slog.Debug("🚫 [TRACES] Dropped service", "service", serviceName)
			continue
		}

		// slog.Debug("   Start processing ResourceSpans", "service", serviceName)

		for _, scopeSpans := range resourceSpans.ScopeSpans {
			// slog.Debug("     Processing ScopeSpans", "scope", scopeSpans.Scope.Name, "spans", len(scopeSpans.Spans))
			for _, span := range scopeSpans.Spans {
				startTime := time.Unix(0, int64(span.StartTimeUnixNano))
				endTime := time.Unix(0, int64(span.EndTimeUnixNano))
				duration := endTime.Sub(startTime).Microseconds()

				// Log specific span details
				/*
					slog.Debug("       -> Span",
						"name", span.Name,
						"trace_id", fmt.Sprintf("%x", span.TraceId),
						"span_id", fmt.Sprintf("%x", span.SpanId),
						"duration_us", duration,
					)
				*/

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
					ServiceName:    serviceName,
					AttributesJSON: string(attrs),
				}
				spansToInsert = append(spansToInsert, sModel)

				// Create/Update Trace Model for indexing
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

					if !shouldIngestSeverity(severity, s.minSeverity) {
						continue
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
					// Always ingest error status if min severity allows ERROR (which is usually true)
					if shouldIngestSeverity("ERROR", s.minSeverity) {
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
				}

				// Batch persist synthesized logs
				if len(synthesizedLogs) > 0 {
					if err := s.repo.BatchCreateLogs(synthesizedLogs); err != nil {
						slog.Error("❌ Failed to persist synthesized logs", "error", err)
					} else {
						// slog.Debug("⚠️ Synthesized logs from trace span errors", "count", len(synthesizedLogs))
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
			slog.Error("❌ Failed to insert traces", "error", err)
			// Continue anyway to allow spans to be inserted if traces exist from previous runs
		} else {
			// slog.Debug("✅ Successfully persisted trace records", "count", len(tracesToUpsert))
		}
	}

	if len(spansToInsert) > 0 {
		if err := s.repo.BatchCreateSpans(spansToInsert); err != nil {
			slog.Error("❌ Failed to insert spans", "error", err)
			return nil, err
		}
		// slog.Debug("✅ Successfully persisted spans", "count", len(spansToInsert))
		if s.metrics != nil {
			s.metrics.RecordIngestion(len(spansToInsert))
		}
	}

	return &coltracepb.ExportTraceServiceResponse{}, nil
}

// Export handles incoming OTLP log data.
func (s *LogsServer) Export(ctx context.Context, req *collogspb.ExportLogsServiceRequest) (*collogspb.ExportLogsServiceResponse, error) {
	// slog.Debug("📥 [LOGS] Received Request", "resource_logs", len(req.ResourceLogs))
	var logsToInsert []storage.Log

	for _, resourceLogs := range req.ResourceLogs {
		serviceName := getServiceName(resourceLogs.Resource.Attributes)

		if !shouldIngestService(serviceName, s.allowedServices, s.excludedServices) {
			slog.Debug("🚫 [LOGS] Dropped service", "service", serviceName)
			continue
		}

		// slog.Debug("   Start processing ResourceLogs", "service", serviceName)

		for _, scopeLogs := range resourceLogs.ScopeLogs {
			// slog.Debug("     Processing ScopeLogs", "scope", scopeLogs.Scope.Name, "records", len(scopeLogs.LogRecords))
			for _, l := range scopeLogs.LogRecords {
				// Convert numeric severity to string if text is missing
				severity := l.SeverityText
				if severity == "" {
					severity = l.SeverityNumber.String()
				}

				if !shouldIngestSeverity(severity, s.minSeverity) {
					// slog.Debug("🚫 [LOGS] Dropped low severity", "severity", severity)
					continue
				}

				timestamp := time.Unix(0, int64(l.TimeUnixNano))
				if timestamp.Unix() == 0 {
					timestamp = time.Now()
				}

				bodyStr := l.Body.GetStringValue()
				/*
					if len(bodyStr) > 100 {
						truncated := bodyStr[:97] + "..."
					}
				*/

				// Log specific log details
				/*
					slog.Debug("       -> Log",
						"severity", severity,
						"body", truncated,
						"trace_id", fmt.Sprintf("%x", l.TraceId),
					)
				*/

				attrs, _ := json.Marshal(l.Attributes)

				logEntry := storage.Log{
					TraceID:        fmt.Sprintf("%x", l.TraceId),
					SpanID:         fmt.Sprintf("%x", l.SpanId),
					Severity:       severity,
					Body:           bodyStr,
					ServiceName:    serviceName,
					AttributesJSON: string(attrs),
					Timestamp:      timestamp,
				}

				logsToInsert = append(logsToInsert, logEntry)
			}
		}
	}

	if len(logsToInsert) > 0 {
		if err := s.repo.BatchCreateLogs(logsToInsert); err != nil {
			slog.Error("❌ Failed to insert logs", "error", err)
			return nil, err
		}
		// slog.Debug("✅ Successfully persisted logs", "count", len(logsToInsert))
		if s.metrics != nil {
			s.metrics.RecordIngestion(len(logsToInsert))
		}
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

// Filtering Helpers
func parseSeverity(level string) int {
	switch strings.ToUpper(level) {
	case "DEBUG":
		return 10
	case "INFO":
		return 20
	case "WARN", "WARNING":
		return 30
	case "ERROR":
		return 40
	case "FATAL":
		return 50
	default:
		return 20 // Default INFO
	}
}

func parseServiceList(list string) map[string]bool {
	m := make(map[string]bool)
	if list == "" {
		return m
	}
	parts := strings.Split(list, ",")
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			m[trimmed] = true
		}
	}
	return m
}

func shouldIngestSeverity(level string, minLevel int) bool {
	// Map OTLP/Text severity to int
	// If it's a number string "1", "9", etc., convert.
	// OTLP: TRACE=1, DEBUG=5, INFO=9, WARN=13, ERROR=17, FATAL=21
	// Simple mapping for text:

	lvl := 0
	upper := strings.ToUpper(level)

	switch {
	case strings.Contains(upper, "DEBUG"):
		lvl = 10
	case strings.Contains(upper, "INFO"):
		lvl = 20
	case strings.Contains(upper, "WARN"):
		lvl = 30
	case strings.Contains(upper, "ERR"):
		lvl = 40
	case strings.Contains(upper, "FATAL"):
		lvl = 50
	default:
		// Fallback for strict numeric strings or unknown
		// If "SEVERITY_NUMBER_INFO" etc.
		if strings.Contains(upper, "INFO") {
			lvl = 20
		} else if strings.Contains(upper, "WARN") {
			lvl = 30
		} else if strings.Contains(upper, "ERR") {
			lvl = 40
		} else {
			lvl = 20
		} // Default treat as info
	}

	return lvl >= minLevel
}

func shouldIngestService(service string, allowed map[string]bool, excluded map[string]bool) bool {
	if len(excluded) > 0 {
		if excluded[service] {
			return false
		}
	}

	if len(allowed) > 0 {
		if !allowed[service] {
			return false
		}
	}

	return true
}
