package archive

import (
	"log/slog"
	"strings"

	"github.com/RandomCodeSpace/argus/internal/config"
	"github.com/RandomCodeSpace/argus/internal/storage"
)

// Maintain runs driver-specific DB optimization commands after archival.
// SQLite: VACUUM + PRAGMA optimize
// PostgreSQL: VACUUM ANALYZE
// MySQL: OPTIMIZE TABLE for each Argus table
func Maintain(repo *storage.Repository, cfg *config.Config) error {
	db := repo.DB()
	driver := strings.ToLower(cfg.DBDriver)

	switch driver {
	case "sqlite", "":
		slog.Info("🔧 Running SQLite maintenance (VACUUM + PRAGMA optimize)")
		db.Exec("PRAGMA optimize")
		if err := db.Exec("VACUUM").Error; err != nil {
			return err
		}

	case "postgres", "postgresql":
		slog.Info("🔧 Running PostgreSQL maintenance (VACUUM ANALYZE)")
		for _, table := range []string{"traces", "spans", "logs", "metric_buckets"} {
			db.Exec("VACUUM ANALYZE " + table)
		}

	case "mysql":
		slog.Info("🔧 Running MySQL maintenance (OPTIMIZE TABLE)")
		for _, table := range []string{"traces", "spans", "logs", "metric_buckets"} {
			db.Exec("OPTIMIZE TABLE " + table)
		}
	}

	slog.Info("✅ DB maintenance complete")
	return nil
}
