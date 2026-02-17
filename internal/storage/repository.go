package storage

import (
	"fmt"
	"log"
	"os"
	"time"

	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/sqlserver"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Repository struct {
	db *gorm.DB
}

// NewRepository initializes the database connection and migrates the schema.
func NewRepository() (*Repository, error) {
	driver := os.Getenv("DB_DRIVER")
	dsn := os.Getenv("DB_DSN")

	var dialector gorm.Dialector

	switch driver {
	case "sqlserver":
		if dsn == "" {
			return nil, fmt.Errorf("DB_DSN environment variable is required for sqlserver driver")
		}
		dialector = sqlserver.Open(dsn)
	case "mysql":
		if dsn == "" {
			dsn = "root:admin@tcp(10.0.0.2:3306)/argus?charset=utf8mb4&parseTime=True&loc=Local"
		}
		dialector = mysql.Open(dsn)
	case "sqlite":
		if dsn == "" {
			dsn = "argus.db"
		}
		dialector = sqlite.Open(dsn)
	default:
		// Default to mysql if not specified
		log.Println("DB_DRIVER not set or invalid, defaulting to mysql")
		if dsn == "" {
			dsn = "root:admin@tcp(10.0.0.2:3306)/argus?charset=utf8mb4&parseTime=True&loc=Local"
		}
		dialector = mysql.Open(dsn)
	}

	db, err := gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Error),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Configure Connection Pool
	sqlDB, err := db.DB()
	if err == nil {
		sqlDB.SetMaxIdleConns(10)
		sqlDB.SetMaxOpenConns(50)
		sqlDB.SetConnMaxLifetime(time.Hour)
		log.Printf("📊 Database Connection Pool Configured: MaxOpen=%d, MaxIdle=%d, Driver=%s", 50, 10, driver)
	}

	// Migrations
	// REMOVED DropTable to ensure persistence across restarts as requested.
	// If you need a fresh DB, manually drop the 'argus' database in MySQL.

	// Disable FK checks during migration to prevent constraint errors with orphaned data
	if driver == "mysql" || driver == "" {
		db.Exec("SET FOREIGN_KEY_CHECKS = 0")
		log.Println("🔓 Disabled foreign key checks for migration")
	}

	// Ensure tables exist
	if err := db.AutoMigrate(&Trace{}, &Span{}, &Log{}); err != nil {
		return nil, fmt.Errorf("failed to migrate database: %w", err)
	}

	// Drop foreign keys that AutoMigrate may have created
	if driver == "mysql" || driver == "" {
		db.Exec("ALTER TABLE spans DROP FOREIGN KEY fk_traces_spans")
		db.Exec("ALTER TABLE logs DROP FOREIGN KEY fk_traces_logs")
		db.Exec("SET FOREIGN_KEY_CHECKS = 1")
		log.Println("🔓 Dropped foreign key constraints for async ingestion compatibility")
	}

	return &Repository{db: db}, nil
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

// BatchCreateTraces inserts or updates multiple traces.
func (r *Repository) BatchCreateTraces(traces []Trace) error {
	if len(traces) == 0 {
		return nil
	}
	// Using a transaction for batch upsert
	return r.db.Transaction(func(tx *gorm.DB) error {
		for _, t := range traces {
			if err := tx.FirstOrCreate(&t, Trace{TraceID: t.TraceID}).Error; err != nil {
				return err
			}
		}
		return nil
	})
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

// CreateTrace inserts a new trace or updates an existing one if needed (mostly headers/root info).
// Since we ingest spans, the Trace entity is often aggregate stats.
// Here we might just create if not exists.
func (r *Repository) CreateTrace(trace Trace) error {
	// standard upsert or create
	if err := r.db.FirstOrCreate(&trace, Trace{TraceID: trace.TraceID}).Error; err != nil {
		return fmt.Errorf("failed to create trace: %w", err)
	}
	return nil
}

// GetRecentLogs returns the most recent logs, optionally filtered by severity.
func (r *Repository) GetRecentLogs(limit int) ([]Log, error) {
	var logs []Log
	if err := r.db.Order("timestamp desc").Limit(limit).Find(&logs).Error; err != nil {
		return nil, fmt.Errorf("failed to get recent logs: %w", err)
	}
	return logs, nil
}

// GetTrace returns a trace by ID with its spans.
func (r *Repository) GetTrace(traceID string) (*Trace, error) {
	var trace Trace
	// Preload spans for the trace
	if err := r.db.Preload("Spans").Preload("Logs").Where("trace_id = ?", traceID).First(&trace).Error; err != nil {
		return nil, fmt.Errorf("failed to get trace: %w", err)
	}
	return &trace, nil
}

// GetTraces returns a list of traces (pagination support simplified).
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

	// Assuming severity 'ERROR' for error logs
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
