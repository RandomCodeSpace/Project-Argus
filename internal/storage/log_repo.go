package storage

import (
	"fmt"
	"log/slog"
	"time"

	"golang.org/x/sync/errgroup"
	"gorm.io/gorm"
)

// LogFilter defines criteria for searching logs.
type LogFilter struct {
	ServiceName string
	Severity    string
	Search      string
	StartTime   time.Time
	EndTime     time.Time
	Limit       int
	Offset      int
}

// BatchCreateLogs inserts multiple logs in batches.
func (r *Repository) BatchCreateLogs(logs []Log) error {
	if len(logs) == 0 {
		return nil
	}
	if err := r.db.CreateInBatches(logs, 500).Error; err != nil {
		return fmt.Errorf("failed to batch create logs: %w", err)
	}
	return nil
}

// GetLog returns a single log by ID.
func (r *Repository) GetLog(id uint) (*Log, error) {
	var l Log
	if err := r.db.First(&l, id).Error; err != nil {
		return nil, fmt.Errorf("failed to get log: %w", err)
	}
	return &l, nil
}

// GetRecentLogs returns the most recent logs.
func (r *Repository) GetRecentLogs(limit int) ([]Log, error) {
	var logs []Log
	if err := r.db.Order("timestamp desc").Limit(limit).Find(&logs).Error; err != nil {
		return nil, fmt.Errorf("failed to get recent logs: %w", err)
	}
	return logs, nil
}

// GetLogsV2 performs advanced filtering and search on logs.
// COUNT and SELECT are run in parallel via errgroup for reduced latency.
func (r *Repository) GetLogsV2(filter LogFilter) ([]Log, int64, error) {
	var logs []Log
	var total int64

	base := r.db.Model(&Log{})

	if filter.ServiceName != "" {
		base = base.Where("service_name = ?", filter.ServiceName)
	}
	if filter.Severity != "" {
		base = base.Where("severity = ?", filter.Severity)
	}
	if !filter.StartTime.IsZero() {
		base = base.Where("timestamp >= ?", filter.StartTime)
	}
	if !filter.EndTime.IsZero() {
		base = base.Where("timestamp <= ?", filter.EndTime)
	}
	if filter.Search != "" {
		search := "%" + filter.Search + "%"
		base = base.Where("body LIKE ? OR trace_id LIKE ?", search, search)
	}

	// Run COUNT and SELECT in parallel using independent sessions.
	var g errgroup.Group
	g.Go(func() error {
		return base.Session(&gorm.Session{}).Count(&total).Error
	})
	g.Go(func() error {
		return base.Session(&gorm.Session{}).
			Order("timestamp desc").
			Limit(filter.Limit).
			Offset(filter.Offset).
			Find(&logs).Error
	})
	if err := g.Wait(); err != nil {
		return nil, 0, fmt.Errorf("failed to fetch logs: %w", err)
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
		return nil, fmt.Errorf("failed to fetch log context: %w", err)
	}
	return logs, nil
}

// UpdateLogInsight updates the AI insight for a specific log.
func (r *Repository) UpdateLogInsight(logID uint, insight string) error {
	if err := r.db.Model(&Log{}).Where("id = ?", logID).Update("ai_insight", insight).Error; err != nil {
		return fmt.Errorf("failed to update log insight: %w", err)
	}
	return nil
}

// PurgeLogs deletes logs older than the given timestamp.
func (r *Repository) PurgeLogs(olderThan time.Time) (int64, error) {
	result := r.db.Where("timestamp < ?", olderThan).Delete(&Log{})
	if result.Error != nil {
		return 0, fmt.Errorf("failed to purge logs: %w", result.Error)
	}
	slog.Info("Logs purged", "count", result.RowsAffected, "cutoff", olderThan)
	return result.RowsAffected, nil
}
