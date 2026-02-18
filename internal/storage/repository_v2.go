package storage

import (
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
)

// TrafficPoint represents a data point for the traffic chart.
type TrafficPoint struct {
	Timestamp  time.Time `json:"timestamp"`
	Count      int64     `json:"count"`
	ErrorCount int64     `json:"error_count"`
}

// LatencyPoint represents a data point for the latency heatmap.
type LatencyPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Duration  int64     `json:"duration"` // Microseconds
}

// ServiceError represents error counts per service.
type ServiceError struct {
	ServiceName string  `json:"service_name"`
	ErrorCount  int64   `json:"error_count"`
	TotalCount  int64   `json:"total_count"`
	ErrorRate   float64 `json:"error_rate"`
}

// DashboardStats represents aggregated metrics for the dashboard.
type DashboardStats struct {
	TotalTraces        int64          `json:"total_traces"`
	TotalLogs          int64          `json:"total_logs"`
	TotalErrors        int64          `json:"total_errors"`
	AvgLatencyMs       float64        `json:"avg_latency_ms"`
	ErrorRate          float64        `json:"error_rate"`
	ActiveServices     int64          `json:"active_services"`
	P99Latency         int64          `json:"p99_latency"`
	TopFailingServices []ServiceError `json:"top_failing_services"`
}

// LogFilter defines criteria for searching logs.
type LogFilter struct {
	ServiceName string
	Severity    string
	Search      string // Full-text search
	StartTime   time.Time
	EndTime     time.Time
	Limit       int
	Offset      int
}

// GetTrafficMetrics returns request counts bucketed by minute, including error counts.
func (r *Repository) GetTrafficMetrics(start, end time.Time, serviceNames []string) ([]TrafficPoint, error) {
	var points []TrafficPoint

	// Fetch timestamps + status for traffic + error breakdown
	type traceRow struct {
		Timestamp time.Time
		Status    string
	}
	var rows []traceRow

	query := r.db.Model(&Trace{}).
		Select("timestamp, status").
		Where("timestamp BETWEEN ? AND ?", start, end)

	if len(serviceNames) > 0 {
		query = query.Where("service_name IN ?", serviceNames)
	}

	if err := query.Find(&rows).Error; err != nil {
		return nil, err
	}

	type bucket struct {
		count      int64
		errorCount int64
	}
	buckets := make(map[int64]*bucket)
	for _, r := range rows {
		ts := r.Timestamp.Truncate(time.Minute).Unix()
		b, ok := buckets[ts]
		if !ok {
			b = &bucket{}
			buckets[ts] = b
		}
		b.count++
		if strings.Contains(r.Status, "ERROR") {
			b.errorCount++
		}
	}

	for ts, b := range buckets {
		points = append(points, TrafficPoint{
			Timestamp:  time.Unix(ts, 0),
			Count:      b.count,
			ErrorCount: b.errorCount,
		})
	}

	sort.Slice(points, func(i, j int) bool {
		return points[i].Timestamp.Before(points[j].Timestamp)
	})

	return points, nil
}

// GetLatencyHeatmap returns trace duration and timestamps for heatmap rendering.
func (r *Repository) GetLatencyHeatmap(start, end time.Time, serviceNames []string) ([]LatencyPoint, error) {
	var points []LatencyPoint
	query := r.db.Model(&Trace{}).
		Select("timestamp, duration").
		Where("timestamp BETWEEN ? AND ?", start, end)

	if len(serviceNames) > 0 {
		query = query.Where("service_name IN ?", serviceNames)
	}

	err := query.Order("timestamp DESC").
		Limit(2000).
		Find(&points).Error

	if err != nil {
		return nil, err
	}
	return points, nil
}

// GetDashboardStats calculates high-level metrics for the dashboard.
func (r *Repository) GetDashboardStats(start, end time.Time, serviceNames []string) (*DashboardStats, error) {
	var stats DashboardStats

	baseQuery := r.db.Model(&Trace{}).Where("timestamp BETWEEN ? AND ?", start, end)
	if len(serviceNames) > 0 {
		baseQuery = baseQuery.Where("service_name IN ?", serviceNames)
	}

	// 1. Total Traces
	if err := baseQuery.Session(&gorm.Session{}).Count(&stats.TotalTraces).Error; err != nil {
		return nil, fmt.Errorf("failed to count traces: %w", err)
	}

	// 2. Total Logs
	logQuery := r.db.Model(&Log{}).Where("timestamp BETWEEN ? AND ?", start, end)
	if len(serviceNames) > 0 {
		logQuery = logQuery.Where("service_name IN ?", serviceNames)
	}
	if err := logQuery.Count(&stats.TotalLogs).Error; err != nil {
		return nil, fmt.Errorf("failed to count logs: %w", err)
	}

	// 3. Total Errors (traces with error status)
	if err := baseQuery.Session(&gorm.Session{}).
		Where("status LIKE ?", "%ERROR%").
		Count(&stats.TotalErrors).Error; err != nil {
		return nil, fmt.Errorf("failed to count error traces: %w", err)
	}

	if stats.TotalTraces > 0 {
		stats.ErrorRate = (float64(stats.TotalErrors) / float64(stats.TotalTraces)) * 100
	}

	// 4. Average Latency (microseconds → milliseconds)
	type avgResult struct {
		Avg float64
	}
	var avg avgResult
	if err := baseQuery.Session(&gorm.Session{}).
		Select("COALESCE(AVG(duration), 0) as avg").
		Scan(&avg).Error; err != nil {
		log.Printf("⚠️ Failed to compute avg latency: %v", err)
	} else {
		stats.AvgLatencyMs = avg.Avg / 1000.0 // microseconds → ms
	}

	// 5. Active Services
	if err := baseQuery.Session(&gorm.Session{}).
		Distinct("service_name").
		Count(&stats.ActiveServices).Error; err != nil {
		return nil, fmt.Errorf("failed to count active services: %w", err)
	}

	// 6. P99 Latency
	var durations []int64
	if err := baseQuery.Session(&gorm.Session{}).
		Select("duration").
		Find(&durations).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch durations: %w", err)
	}

	if len(durations) > 0 {
		sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
		p99Index := int(math.Ceil(float64(len(durations))*0.99)) - 1
		if p99Index >= len(durations) {
			p99Index = len(durations) - 1
		}
		if p99Index < 0 {
			p99Index = 0
		}
		stats.P99Latency = durations[p99Index]
	}

	// 7. Top Failing Services (with error rate)
	type svcCount struct {
		ServiceName string
		ErrorCount  int64
		TotalCount  int64
	}
	var svcCounts []svcCount
	if err := baseQuery.Session(&gorm.Session{}).
		Select("service_name, COUNT(*) as total_count, SUM(CASE WHEN status LIKE '%ERROR%' THEN 1 ELSE 0 END) as error_count").
		Group("service_name").
		Having("error_count > 0").
		Order("error_count DESC").
		Limit(5).
		Scan(&svcCounts).Error; err != nil {
		log.Printf("⚠️ Failed to fetch top failing services: %v", err)
	} else {
		for _, sc := range svcCounts {
			rate := 0.0
			if sc.TotalCount > 0 {
				rate = float64(sc.ErrorCount) / float64(sc.TotalCount)
			}
			stats.TopFailingServices = append(stats.TopFailingServices, ServiceError{
				ServiceName: sc.ServiceName,
				ErrorCount:  sc.ErrorCount,
				TotalCount:  sc.TotalCount,
				ErrorRate:   rate,
			})
		}
	}

	return &stats, nil
}

// TracesResponse represents the response for the traces endpoint with pagination
type TracesResponse struct {
	Traces []Trace `json:"traces"`
	Total  int64   `json:"total"`
	Limit  int     `json:"limit"`
	Offset int     `json:"offset"`
}

// GetTracesFiltered retrieves traces with filtering and pagination
func (r *Repository) GetTracesFiltered(start, end time.Time, serviceNames []string, status, search string, limit, offset int, sortBy, orderBy string) (*TracesResponse, error) {
	var traces []Trace
	var total int64

	// Build base query
	query := r.db.Model(&Trace{})

	// Apply filters
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

	// Get total count
	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("failed to count traces: %w", err)
	}

	// Apply Sorting
	orderClause := "timestamp DESC" // Default
	if sortBy != "" {
		direction := "ASC"
		if orderBy == "desc" {
			direction = "DESC"
		}
		// Whitelist fields to prevent SQL injection
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

	// Get paginated results with spans preloaded
	if err := query.
		Preload("Spans").
		Order(orderClause).
		Limit(limit).
		Offset(offset).
		Find(&traces).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch traces: %w", err)
	}

	// Populate virtual fields for frontend
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

// GetLogsV2 performs advanced filtering and search on logs.
func (r *Repository) GetLogsV2(filter LogFilter) ([]Log, int64, error) {
	var logs []Log
	var total int64

	query := r.db.Model(&Log{})

	if filter.ServiceName != "" {
		query = query.Where("service_name = ?", filter.ServiceName)
	}
	if filter.Severity != "" {
		query = query.Where("severity = ?", filter.Severity)
	}
	if !filter.StartTime.IsZero() {
		query = query.Where("timestamp >= ?", filter.StartTime)
	}
	if !filter.EndTime.IsZero() {
		query = query.Where("timestamp <= ?", filter.EndTime)
	}
	if filter.Search != "" {
		search := "%" + filter.Search + "%"
		query = query.Where("body LIKE ? OR trace_id LIKE ?", search, search)
	}

	// Count total for pagination
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	// Fetch page
	if err := query.Order("timestamp desc").
		Limit(filter.Limit).
		Offset(filter.Offset).
		Find(&logs).Error; err != nil {
		return nil, 0, err
	}

	return logs, total, nil
}

// GetLogContext returns logs surrounding a specific timestamp (+/- 1 minute).
func (r *Repository) GetLogContext(targetTime time.Time) ([]Log, error) {
	start := targetTime.Add(-1 * time.Minute)
	end := targetTime.Add(1 * time.Minute)

	var logs []Log
	if err := r.db.Where("timestamp BETWEEN ? AND ?", start, end).
		Order("timestamp asc").
		Find(&logs).Error; err != nil {
		return nil, err
	}
	return logs, nil
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

// GetServiceMapMetrics computes per-service and per-edge metrics from traces and spans.
func (r *Repository) GetServiceMapMetrics(start, end time.Time) (*ServiceMapMetrics, error) {
	// 1. Fetch all spans in time range
	var spans []Span
	query := r.db.Model(&Span{})

	// Optimization: Filter by time using join on traces if spans don't have indexed timestamp
	// But our spans DO have StartTime. Let's use that.
	if !start.IsZero() && !end.IsZero() {
		query = query.Where("start_time BETWEEN ? AND ?", start, end)
	}

	if err := query.Find(&spans).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch spans: %w", err)
	}
	log.Printf("DEBUG: Fetched %d spans for service map. Sample span service_name: '%s'", len(spans), "")
	if len(spans) > 0 {
		log.Printf("DEBUG: Sample Span [0]: ID=%s, Parent=%s, Service=%s", spans[0].SpanID, spans[0].ParentSpanID, spans[0].ServiceName)
	}

	/*
	   Algorithm:
	   1. Build Map: SpanID -> Span
	   2. Nodes: Aggregate stats per ServiceName
	   3. Edges: Iterate spans. If ParentSpanID exists:
	       Source = Map[ParentSpanID].ServiceName
	       Target = CurrentSpan.ServiceName
	       If Source != Target => RECORD EDGE (Source->Target)
	*/

	spanMap := make(map[string]Span)
	nodeStats := make(map[string]*ServiceMapNode)
	edgeStats := make(map[string]*ServiceMapEdge) // Key: "Source->Target"

	for _, s := range spans {
		spanMap[s.SpanID] = s

		if s.ServiceName == "" {
			continue
		}

		// Initialize/Update Node Stats
		if _, ok := nodeStats[s.ServiceName]; !ok {
			nodeStats[s.ServiceName] = &ServiceMapNode{Name: s.ServiceName}
		}
		ns := nodeStats[s.ServiceName]
		ns.TotalTraces++ // Using as "Total Spans" / "Total Ops" conceptually here
		ns.AvgLatencyMs += float64(s.Duration)
		// Check for error in attributes or status (simplification: checking if any error log linked? No, complex.
		// Let's rely on ingestion to flag errors on trace. But for granular span errors, we'd need a status field on Span.
		// For now, let's assume we can get error rate from traces associated, or just count calls.
		// Future improvement: Add Status to Span model proper.
	}

	// Finalize Node Stats
	nodes := make([]ServiceMapNode, 0)
	for _, ns := range nodeStats {
		if ns.TotalTraces > 0 {
			ns.AvgLatencyMs = ns.AvgLatencyMs / float64(ns.TotalTraces) / 1000.0 // avg micro -> ms
			ns.AvgLatencyMs = math.Round(ns.AvgLatencyMs*100) / 100
		}
		nodes = append(nodes, *ns)
	}

	// Build Edges
	for _, s := range spans {
		if s.ParentSpanID == "" {
			continue
		}

		parent, ok := spanMap[s.ParentSpanID]
		if !ok {
			// Parent might be outside time window or missing
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
		// Add latency of the generic call (the child's duration is a proxy for the remote call time + processing)
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
