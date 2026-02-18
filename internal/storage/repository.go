package storage

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/RandomCodeSpace/Project-Argus/internal/telemetry"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Repository wraps the GORM database handle for all data access operations.
type Repository struct {
	db      *gorm.DB
	driver  string
	metrics *telemetry.Metrics
}

// NewRepository initializes the database connection using environment variables and migrates the schema.
func NewRepository(metrics *telemetry.Metrics) (*Repository, error) {
	driver := os.Getenv("DB_DRIVER")
	dsn := os.Getenv("DB_DSN")

	db, err := NewDatabase(driver, dsn)
	if err != nil {
		return nil, err
	}

	// Resolve effective driver name
	if driver == "" {
		driver = "sqlite"
	}

	if err := AutoMigrateModels(db, driver); err != nil {
		return nil, err
	}

	// Register GORM Callback for DB Latency Metrics
	if metrics != nil {
		db.Callback().Query().Before("gorm:query").Register("telemetry:before_query", func(d *gorm.DB) {
			d.Set("telemetry:start_time", time.Now())
		})
		db.Callback().Query().After("gorm:query").Register("telemetry:after_query", func(d *gorm.DB) {
			if start, ok := d.Get("telemetry:start_time"); ok {
				duration := time.Since(start.(time.Time)).Seconds()
				metrics.ObserveDBLatency(duration)
			}
		})
		// Also measure Create/Update/Delete if desired, but Query is most frequent for "Latency"
		db.Callback().Create().Before("gorm:create").Register("telemetry:before_create", func(d *gorm.DB) {
			d.Set("telemetry:start_time", time.Now())
		})
		db.Callback().Create().After("gorm:create").Register("telemetry:after_create", func(d *gorm.DB) {
			if start, ok := d.Get("telemetry:start_time"); ok {
				duration := time.Since(start.(time.Time)).Seconds()
				metrics.ObserveDBLatency(duration)
			}
		})
	}

	return &Repository{db: db, driver: driver, metrics: metrics}, nil
}

// BatchCreateSpans inserts multiple spans in batches.
func (r *Repository) BatchCreateSpans(spans []Span) error {
	if len(spans) == 0 {
		return nil
	}
	result := r.db.CreateInBatches(spans, 500)
	if result.Error != nil {
		return fmt.Errorf("failed to batch create spans: %w", result.Error)
	}
	return nil
}

// BatchCreateTraces inserts traces, skipping duplicates.
func (r *Repository) BatchCreateTraces(traces []Trace) error {
	if len(traces) == 0 {
		return nil
	}
	// MySQL: INSERT IGNORE (avoids Error 1869 with auto-increment)
	// SQLite/Postgres: ON CONFLICT DO NOTHING
	if strings.ToLower(r.driver) == "mysql" {
		return r.db.Clauses(clause.Insert{Modifier: "IGNORE"}).Create(&traces).Error
	}
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&traces).Error
}

// BatchCreateLogs inserts multiple logs in batches.
func (r *Repository) BatchCreateLogs(logs []Log) error {
	if len(logs) == 0 {
		return nil
	}
	result := r.db.CreateInBatches(logs, 500)
	if result.Error != nil {
		return fmt.Errorf("failed to batch create logs: %w", result.Error)
	}
	return nil
}

// CreateTrace inserts a new trace, skipping if it already exists.
func (r *Repository) CreateTrace(trace Trace) error {
	var tx *gorm.DB
	if strings.ToLower(r.driver) == "mysql" {
		tx = r.db.Clauses(clause.Insert{Modifier: "IGNORE"}).Create(&trace)
	} else {
		tx = r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&trace)
	}
	if tx.Error != nil {
		return fmt.Errorf("failed to create trace: %w", tx.Error)
	}
	return nil
}

// GetRecentLogs returns the most recent logs.
func (r *Repository) GetRecentLogs(limit int) ([]Log, error) {
	var logs []Log
	if err := r.db.Order("timestamp desc").Limit(limit).Find(&logs).Error; err != nil {
		return nil, fmt.Errorf("failed to get recent logs: %w", err)
	}
	return logs, nil
}

// GetTrace returns a trace by ID with its spans and logs.
func (r *Repository) GetTrace(traceID string) (*Trace, error) {
	var trace Trace
	if err := r.db.Preload("Spans").Preload("Logs").Where("trace_id = ?", traceID).First(&trace).Error; err != nil {
		return nil, fmt.Errorf("failed to get trace: %w", err)
	}
	return &trace, nil
}

// GetTraces returns a list of traces with pagination.
func (r *Repository) GetTraces(limit int, offset int) ([]Trace, error) {
	var traces []Trace
	if err := r.db.Order("timestamp desc").Limit(limit).Offset(offset).Find(&traces).Error; err != nil {
		return nil, fmt.Errorf("failed to get traces: %w", err)
	}
	return traces, nil
}

// UpdateLogInsight updates the AI insight for a specific log.
func (r *Repository) UpdateLogInsight(logID uint, insight string) error {
	if err := r.db.Model(&Log{}).Where("id = ?", logID).Update("ai_insight", insight).Error; err != nil {
		return fmt.Errorf("failed to update log insight: %w", err)
	}
	return nil
}

// GetStats returns aggregation metrics.
func (r *Repository) GetStats() (map[string]interface{}, error) {
	var traceCount int64
	var errorCount int64

	if err := r.db.Model(&Trace{}).Count(&traceCount).Error; err != nil {
		return nil, err
	}

	if err := r.db.Model(&Log{}).Where("severity = ?", "ERROR").Count(&errorCount).Error; err != nil {
		return nil, err
	}

	return map[string]interface{}{
		"trace_count": traceCount,
		"error_count": errorCount,
	}, nil
}

// GetLog returns a single log by ID.
func (r *Repository) GetLog(id uint) (*Log, error) {
	var l Log
	if err := r.db.First(&l, id).Error; err != nil {
		return nil, fmt.Errorf("failed to get log: %w", err)
	}
	return &l, nil
}

// GetServices returns a list of all distinct service names seen in traces.
func (r *Repository) GetServices() ([]string, error) {
	var services []string
	if err := r.db.Model(&Trace{}).Distinct("service_name").Order("service_name ASC").Pluck("service_name", &services).Error; err != nil {
		return nil, fmt.Errorf("failed to get services: %w", err)
	}
	return services, nil
}

// PurgeLogs deletes logs older than the given timestamp.
func (r *Repository) PurgeLogs(olderThan time.Time) (int64, error) {
	result := r.db.Where("timestamp < ?", olderThan).Delete(&Log{})
	if result.Error != nil {
		return 0, fmt.Errorf("failed to purge logs: %w", result.Error)
	}
	log.Printf("🗑️ Purged %d logs older than %v", result.RowsAffected, olderThan)
	return result.RowsAffected, nil
}

// PurgeTraces deletes traces older than the given timestamp.
func (r *Repository) PurgeTraces(olderThan time.Time) (int64, error) {
	result := r.db.Where("timestamp < ?", olderThan).Delete(&Trace{})
	if result.Error != nil {
		return 0, fmt.Errorf("failed to purge traces: %w", result.Error)
	}
	log.Printf("🗑️ Purged %d traces older than %v", result.RowsAffected, olderThan)
	return result.RowsAffected, nil
}

// VacuumDB runs VACUUM on the database (SQLite only, no-op for others).
func (r *Repository) VacuumDB() error {
	if r.driver == "sqlite" {
		if err := r.db.Exec("VACUUM").Error; err != nil {
			return fmt.Errorf("failed to vacuum database: %w", err)
		}
		log.Println("🧹 Database vacuumed successfully")
	} else {
		log.Println("🧹 Vacuum is only applicable to SQLite; skipping for " + r.driver)
	}
	return nil
}

// DB returns the underlying gorm.DB for advanced queries.
func (r *Repository) DB() *gorm.DB {
	return r.db
}
