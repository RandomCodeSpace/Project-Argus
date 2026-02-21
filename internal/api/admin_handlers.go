package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"
)

// handleGetStats handles GET /api/stats
func (s *Server) handleGetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.repo.GetStats()
	if err != nil {
		slog.Error("Failed to get DB stats", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// handlePurge handles DELETE /api/admin/purge
func (s *Server) handlePurge(w http.ResponseWriter, r *http.Request) {
	// Default: purge data older than 7 days
	days := 7
	if d := r.URL.Query().Get("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 {
			days = v
		}
	}

	cutoff := time.Now().AddDate(0, 0, -days)

	logsDeleted, err := s.repo.PurgeLogs(cutoff)
	if err != nil {
		slog.Error("Failed to purge logs", "cutoff", cutoff, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	tracesDeleted, err := s.repo.PurgeTraces(cutoff)
	if err != nil {
		slog.Error("Failed to purge traces", "cutoff", cutoff, "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	slog.Info("Admin purge completed", "days", days, "logs_purged", logsDeleted, "traces_purged", tracesDeleted)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"logs_purged":   logsDeleted,
		"traces_purged": tracesDeleted,
		"cutoff":        cutoff,
	})
}

// handleVacuum handles POST /api/admin/vacuum
func (s *Server) handleVacuum(w http.ResponseWriter, _ *http.Request) {
	if err := s.repo.VacuumDB(); err != nil {
		slog.Error("Failed to vacuum database", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "vacuumed"})
}
