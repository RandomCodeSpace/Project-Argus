package storage

import (
	"fmt"
	"time"
)

// GetArchivedDateRange returns unique UTC days that have data older than cutoff.
func (r *Repository) GetArchivedDateRange(cutoff time.Time) ([]time.Time, error) {
	// Find min timestamp across all three tables older than cutoff
	var minTrace, minLog, minMetric time.Time

	r.db.Model(&Trace{}).Where("timestamp < ?", cutoff).
		Select("MIN(timestamp)").Scan(&minTrace)
	r.db.Model(&Log{}).Where("timestamp < ?", cutoff).
		Select("MIN(timestamp)").Scan(&minLog)
	r.db.Model(&MetricBucket{}).Where("time_bucket < ?", cutoff).
		Select("MIN(time_bucket)").Scan(&minMetric)

	earliest := minTrace
	if !minLog.IsZero() && (earliest.IsZero() || minLog.Before(earliest)) {
		earliest = minLog
	}
	if !minMetric.IsZero() && (earliest.IsZero() || minMetric.Before(earliest)) {
		earliest = minMetric
	}

	if earliest.IsZero() {
		return nil, nil
	}

	// Enumerate each UTC day from earliest to cutoff
	var dates []time.Time
	day := earliest.UTC().Truncate(24 * time.Hour)
	limit := cutoff.UTC().Truncate(24 * time.Hour)
	for !day.After(limit) {
		dates = append(dates, day)
		day = day.Add(24 * time.Hour)
	}
	return dates, nil
}

// GetTracesForArchive returns traces (with spans and logs) in a time window for archival.
func (r *Repository) GetTracesForArchive(start, end time.Time, limit, offset int) ([]Trace, error) {
	var traces []Trace
	err := r.db.
		Preload("Spans").Preload("Logs").
		Where("timestamp >= ? AND timestamp < ?", start, end).
		Limit(limit).Offset(offset).
		Find(&traces).Error
	if err != nil {
		return nil, fmt.Errorf("GetTracesForArchive: %w", err)
	}
	return traces, nil
}

// GetLogsForArchive returns logs in a time window.
func (r *Repository) GetLogsForArchive(start, end time.Time, limit, offset int) ([]Log, error) {
	var logs []Log
	err := r.db.
		Where("timestamp >= ? AND timestamp < ?", start, end).
		Limit(limit).Offset(offset).
		Find(&logs).Error
	if err != nil {
		return nil, fmt.Errorf("GetLogsForArchive: %w", err)
	}
	return logs, nil
}

// GetMetricsForArchive returns metric buckets in a time window.
func (r *Repository) GetMetricsForArchive(start, end time.Time, limit, offset int) ([]MetricBucket, error) {
	var metrics []MetricBucket
	err := r.db.
		Where("time_bucket >= ? AND time_bucket < ?", start, end).
		Limit(limit).Offset(offset).
		Find(&metrics).Error
	if err != nil {
		return nil, fmt.Errorf("GetMetricsForArchive: %w", err)
	}
	return metrics, nil
}

// DeleteTracesByIDs deletes traces (and their spans/logs via cascading or separate deletes).
func (r *Repository) DeleteTracesByIDs(ids []uint) error {
	if len(ids) == 0 {
		return nil
	}
	// Delete associated spans and logs first to avoid FK issues
	traceIDs := make([]string, 0)
	r.db.Model(&Trace{}).Where("id IN ?", ids).Pluck("trace_id", &traceIDs)

	if len(traceIDs) > 0 {
		r.db.Where("trace_id IN ?", traceIDs).Delete(&Span{})
		r.db.Where("trace_id IN ?", traceIDs).Delete(&Log{})
	}

	return r.db.Where("id IN ?", ids).Delete(&Trace{}).Error
}

// DeleteLogsByIDs hard-deletes logs by primary key.
func (r *Repository) DeleteLogsByIDs(ids []uint) error {
	if len(ids) == 0 {
		return nil
	}
	return r.db.Where("id IN ?", ids).Delete(&Log{}).Error
}

// DeleteMetricsByIDs hard-deletes metric buckets by primary key.
func (r *Repository) DeleteMetricsByIDs(ids []uint) error {
	if len(ids) == 0 {
		return nil
	}
	return r.db.Where("id IN ?", ids).Delete(&MetricBucket{}).Error
}

// HotDBSizeBytes returns an approximate size of the hot DB in bytes.
// For SQLite this reads the file size. For others it queries pg_database_size / information_schema.
func (r *Repository) HotDBSizeBytes() int64 {
	switch r.driver {
	case "sqlite", "":
		var pageCount, pageSize int64
		r.db.Raw("PRAGMA page_count").Scan(&pageCount)
		r.db.Raw("PRAGMA page_size").Scan(&pageSize)
		return pageCount * pageSize

	case "postgres", "postgresql":
		var size int64
		r.db.Raw("SELECT pg_database_size(current_database())").Scan(&size)
		return size

	case "mysql":
		var size int64
		r.db.Raw(`SELECT SUM(data_length + index_length) FROM information_schema.tables
			WHERE table_schema = DATABASE()`).Scan(&size)
		return size

	default:
		return 0
	}
}
