package storage

import (
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"gorm.io/gorm/clause"
)

// TracesResponse represents the response for the traces endpoint with pagination
type TracesResponse struct {
	Traces []Trace `json:"traces"`
	Total  int64   `json:"total"`
	Limit  int     `json:"limit"`
	Offset int     `json:"offset"`
}

// ServiceMapNode represents a single service node on the service map.
type ServiceMapNode struct {
	Name         string  `json:"name"`
	TotalTraces  int64   `json:"total_traces"`
	ErrorCount   int64   `json:"error_count"`
	AvgLatencyMs float64 `json:"avg_latency_ms"`
}

// ServiceMapEdge represents a connection between two services.
type ServiceMapEdge struct {
	Source       string  `json:"source"`
	Target       string  `json:"target"`
	CallCount    int64   `json:"call_count"`
	AvgLatencyMs float64 `json:"avg_latency_ms"`
	ErrorRate    float64 `json:"error_rate"`
}

// ServiceMapMetrics holds the complete service topology with metrics.
type ServiceMapMetrics struct {
	Nodes []ServiceMapNode `json:"nodes"`
	Edges []ServiceMapEdge `json:"edges"`
}

// BatchCreateSpans inserts multiple spans in batches.
func (r *Repository) BatchCreateSpans(spans []Span) error {
	if len(spans) == 0 {
		return nil
	}
	if err := r.db.CreateInBatches(spans, 500).Error; err != nil {
		return fmt.Errorf("failed to batch create spans: %w", err)
	}
	return nil
}

// BatchCreateTraces inserts traces, skipping duplicates.
func (r *Repository) BatchCreateTraces(traces []Trace) error {
	if len(traces) == 0 {
		return nil
	}
	if strings.ToLower(r.driver) == "mysql" {
		return r.db.Clauses(clause.Insert{Modifier: "IGNORE"}).Create(&traces).Error
	}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&traces).Error
}

// CreateTrace inserts a new trace, skipping if it already exists.
func (r *Repository) CreateTrace(trace Trace) error {
	if strings.ToLower(r.driver) == "mysql" {
		return r.db.Clauses(clause.Insert{Modifier: "IGNORE"}).Create(&trace).Error
	}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&trace).Error
}

// GetTrace returns a trace by ID with its spans and logs.
func (r *Repository) GetTrace(traceID string) (*Trace, error) {
	var trace Trace
	if err := r.db.Preload("Spans").Preload("Logs").Where("trace_id = ?", traceID).First(&trace).Error; err != nil {
		return nil, fmt.Errorf("failed to get trace: %w", err)
	}
	return &trace, nil
}

// GetTracesFiltered retrieves traces with filtering and pagination
func (r *Repository) GetTracesFiltered(start, end time.Time, serviceNames []string, status, search string, limit, offset int, sortBy, orderBy string) (*TracesResponse, error) {
	var traces []Trace
	var total int64

	query := r.db.Model(&Trace{})

	if !start.IsZero() && !end.IsZero() {
		query = query.Where("timestamp BETWEEN ? AND ?", start, end)
	}

	if len(serviceNames) > 0 {
		query = query.Where("service_name IN ?", serviceNames)
	}

	if status != "" {
		query = query.Where("status LIKE ?", "%"+status+"%")
	}

	if search != "" {
		query = query.Where("trace_id LIKE ?", "%"+search+"%")
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("failed to count traces: %w", err)
	}

	orderClause := "timestamp DESC"
	if sortBy != "" {
		direction := "ASC"
		if strings.ToLower(orderBy) == "desc" {
			direction = "DESC"
		}
		validSorts := map[string]string{
			"timestamp":    "timestamp",
			"duration":     "duration",
			"service_name": "service_name",
			"status":       "status",
			"trace_id":     "trace_id",
		}
		if field, ok := validSorts[sortBy]; ok {
			orderClause = fmt.Sprintf("%s %s", field, direction)
		}
	}

	if err := query.Preload("Spans").Order(orderClause).Limit(limit).Offset(offset).Find(&traces).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch traces: %w", err)
	}

	for i := range traces {
		traces[i].SpanCount = len(traces[i].Spans)
		traces[i].DurationMs = float64(traces[i].Duration) / 1000.0
		if traces[i].SpanCount > 0 {
			traces[i].Operation = traces[i].Spans[0].OperationName
		} else {
			traces[i].Operation = "Unknown"
		}
	}

	return &TracesResponse{
		Traces: traces,
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}, nil
}

// GetServiceMapMetrics computes topology metrics from spans.
func (r *Repository) GetServiceMapMetrics(start, end time.Time) (*ServiceMapMetrics, error) {
	var spans []Span
	query := r.db.Model(&Span{})

	if !start.IsZero() && !end.IsZero() {
		query = query.Where("start_time BETWEEN ? AND ?", start, end)
	}

	if err := query.Find(&spans).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch spans: %w", err)
	}

	spanMap := make(map[string]Span)
	nodeStats := make(map[string]*ServiceMapNode)
	edgeStats := make(map[string]*ServiceMapEdge)

	for _, s := range spans {
		spanMap[s.SpanID] = s

		if s.ServiceName == "" {
			continue
		}

		if _, ok := nodeStats[s.ServiceName]; !ok {
			nodeStats[s.ServiceName] = &ServiceMapNode{Name: s.ServiceName}
		}
		ns := nodeStats[s.ServiceName]
		ns.TotalTraces++
		ns.AvgLatencyMs += float64(s.Duration)
	}

	nodes := make([]ServiceMapNode, 0)
	for _, ns := range nodeStats {
		if ns.TotalTraces > 0 {
			ns.AvgLatencyMs = ns.AvgLatencyMs / float64(ns.TotalTraces) / 1000.0
			ns.AvgLatencyMs = math.Round(ns.AvgLatencyMs*100) / 100
		}
		nodes = append(nodes, *ns)
	}

	for _, s := range spans {
		if s.ParentSpanID == "" || s.ParentSpanID == "0000000000000000" {
			continue
		}

		parent, ok := spanMap[s.ParentSpanID]
		if !ok {
			continue
		}

		source := parent.ServiceName
		target := s.ServiceName

		if source == "" || target == "" || source == target {
			continue
		}

		key := fmt.Sprintf("%s->%s", source, target)
		if _, ok := edgeStats[key]; !ok {
			edgeStats[key] = &ServiceMapEdge{Source: source, Target: target}
		}
		es := edgeStats[key]
		es.CallCount++
		es.AvgLatencyMs += float64(s.Duration)
	}

	edges := make([]ServiceMapEdge, 0)
	for _, es := range edgeStats {
		if es.CallCount > 0 {
			es.AvgLatencyMs = es.AvgLatencyMs / float64(es.CallCount) / 1000.0
			es.AvgLatencyMs = math.Round(es.AvgLatencyMs*100) / 100
		}
		edges = append(edges, *es)
	}

	return &ServiceMapMetrics{
		Nodes: nodes,
		Edges: edges,
	}, nil
}

// PurgeTraces deletes traces older than the given timestamp.
func (r *Repository) PurgeTraces(olderThan time.Time) (int64, error) {
	result := r.db.Where("timestamp < ?", olderThan).Delete(&Trace{})
	if result.Error != nil {
		return 0, fmt.Errorf("failed to purge traces: %w", result.Error)
	}
	slog.Info("Traces purged", "count", result.RowsAffected, "cutoff", olderThan)
	return result.RowsAffected, nil
}
