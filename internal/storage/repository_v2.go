package storage

import (
	"fmt"
	"log"
	"math"
	"sort"
	"time"

	"gorm.io/gorm"
)

// TrafficPoint represents a data point for the traffic chart.
type TrafficPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Count     int64     `json:"count"`
}

// LatencyPoint represents a data point for the latency heatmap.
type LatencyPoint struct {
	Timestamp time.Time `json:"timestamp"`
	Duration  int64     `json:"duration"` // Microseconds
}

// DashboardStats represents aggregated metrics for the dashboard.
type DashboardStats struct {
	TotalTraces    int64   `json:"total_traces"`
	ErrorRate      float64 `json:"error_rate"`      // Percentage
	ActiveServices int64   `json:"active_services"` // Count of unique services
	P99Latency     int64   `json:"p99_latency"`     // Microseconds
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

// GetTrafficMetrics returns request counts bucketed by minute.
func (r *Repository) GetTrafficMetrics(start, end time.Time, serviceNames []string) ([]TrafficPoint, error) {
	var points []TrafficPoint
	var traces []Trace

	query := r.db.Model(&Trace{}).
		Select("timestamp").
		Where("timestamp BETWEEN ? AND ?", start, end)

	if len(serviceNames) > 0 {
		query = query.Where("service_name IN ?", serviceNames)
	}

	err := query.Find(&traces).Error

	if err != nil {
		return nil, err
	}

	buckets := make(map[int64]int64)
	for _, t := range traces {
		bucket := t.Timestamp.Truncate(time.Minute).Unix()
		buckets[bucket]++
	}

	for ts, count := range buckets {
		points = append(points, TrafficPoint{
			Timestamp: time.Unix(ts, 0),
			Count:     count,
		})
	}

	// Sort points by timestamp
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
	log.Printf("   🔍 DB Count: %d traces found for period", stats.TotalTraces)

	// 2. Error Rate
	var errorTraces int64
	if err := baseQuery.Session(&gorm.Session{}).
		Where("status LIKE ?", "%STATUS_CODE_ERROR%").
		Count(&errorTraces).Error; err != nil {
		return nil, fmt.Errorf("failed to count error traces: %w", err)
	}

	if stats.TotalTraces > 0 {
		stats.ErrorRate = (float64(errorTraces) / float64(stats.TotalTraces)) * 100
	}

	// 3. Active Services
	if err := baseQuery.Session(&gorm.Session{}).
		Distinct("service_name").
		Count(&stats.ActiveServices).Error; err != nil {
		return nil, fmt.Errorf("failed to count active services: %w", err)
	}

	// 4. P99 Latency
	// Fetch all durations, sort, pick 99th percentile.
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
		query = query.Where("body LIKE ? OR trace_id = ?", search, filter.Search)
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
