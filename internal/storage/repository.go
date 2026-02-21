package storage

import (
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/RandomCodeSpace/argus/internal/telemetry"
	"gorm.io/gorm"
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

// Stats aggregation and DB management

// GetStats returns high-level database stats.
func (r *Repository) GetStats() (map[string]interface{}, error) {
	var traceCount int64
	var errorCount int64

	if err := r.db.Model(&Trace{}).Count(&traceCount).Error; err != nil {
		return nil, fmt.Errorf("failed to count traces: %w", err)
	}

	if err := r.db.Model(&Log{}).Where("severity = ?", "ERROR").Count(&errorCount).Error; err != nil {
		return nil, fmt.Errorf("failed to count error logs: %w", err)
	}

	return map[string]interface{}{
		"trace_count": traceCount,
		"error_count": errorCount,
	}, nil
}

// VacuumDB runs VACUUM on the database (SQLite only, no-op for others).
func (r *Repository) VacuumDB() error {
	if r.driver == "sqlite" {
		if err := r.db.Exec("VACUUM").Error; err != nil {
			return fmt.Errorf("failed to vacuum database: %w", err)
		}
		slog.Info("Database vacuumed successfully")
	} else {
		slog.Debug("Vacuum skipped", "driver", r.driver, "reason", "only applicable to SQLite")
	}
	return nil
}

// DB returns the underlying gorm.DB for advanced queries.
func (r *Repository) DB() *gorm.DB {
	return r.db
}
