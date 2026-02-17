package api

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/RandomCodeSpace/Project-Argus/internal/storage"
)

// handleGetTrafficMetrics handles GET /api/metrics/traffic
func (s *Server) handleGetTrafficMetrics(w http.ResponseWriter, r *http.Request) {
	// Default to last 30 minutes if not specified
	end := time.Now()
	start := end.Add(-30 * time.Minute)

	if startStr := r.URL.Query().Get("start"); startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			start = t
		}
	}
	if endStr := r.URL.Query().Get("end"); endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			end = t
		}
	}

	serviceNames := r.URL.Query()["service_name"]

	points, err := s.repo.GetTrafficMetrics(start, end, serviceNames)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(points)
}

// handleGetLatencyHeatmap handles GET /api/metrics/latency_heatmap
func (s *Server) handleGetLatencyHeatmap(w http.ResponseWriter, r *http.Request) {
	end := time.Now()
	start := end.Add(-30 * time.Minute)

	if startStr := r.URL.Query().Get("start"); startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			start = t
		}
	}
	if endStr := r.URL.Query().Get("end"); endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			end = t
		}
	}

	serviceNames := r.URL.Query()["service_name"]

	points, err := s.repo.GetLatencyHeatmap(start, end, serviceNames)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(points)
}

// handleGetLogsV2 handles GET /api/logs with advanced filtering
func (s *Server) handleGetLogsV2(w http.ResponseWriter, r *http.Request) {
	limit := 50
	offset := 0

	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil {
			limit = v
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil {
			offset = v
		}
	}

	filter := storage.LogFilter{
		ServiceName: r.URL.Query().Get("service_name"),
		Severity:    r.URL.Query().Get("severity"),
		Search:      r.URL.Query().Get("search"),
		Limit:       limit,
		Offset:      offset,
	}

	if startStr := r.URL.Query().Get("start"); startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			filter.StartTime = t
		}
	}
	if endStr := r.URL.Query().Get("end"); endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			filter.EndTime = t
		}
	}

	logs, total, err := s.repo.GetLogsV2(filter)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data":  logs,
		"total": total,
	})
}

// handleGetLogContext handles GET /api/logs/context
func (s *Server) handleGetLogContext(w http.ResponseWriter, r *http.Request) {
	tsStr := r.URL.Query().Get("timestamp")
	if tsStr == "" {
		http.Error(w, "missing timestamp", http.StatusBadRequest)
		return
	}

	// Try RFC3339 first
	ts, err := time.Parse(time.RFC3339, tsStr)
	if err != nil {
		// Try generic format often present in logs if not strict IO string
		http.Error(w, "invalid timestamp format", http.StatusBadRequest)
		return
	}

	logs, err := s.repo.GetLogContext(ts)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(logs)
}

// handleGetDashboardStats handles GET /api/metrics/dashboard
func (s *Server) handleGetDashboardStats(w http.ResponseWriter, r *http.Request) {
	// Default to last 30 minutes if not specified
	end := time.Now()
	start := end.Add(-30 * time.Minute)

	if startStr := r.URL.Query().Get("start"); startStr != "" {
		if t, err := time.Parse(time.RFC3339, startStr); err == nil {
			start = t
		}
	}
	if endStr := r.URL.Query().Get("end"); endStr != "" {
		if t, err := time.Parse(time.RFC3339, endStr); err == nil {
			end = t
		}
	}

	serviceNames := r.URL.Query()["service_name"]

	stats, err := s.repo.GetDashboardStats(start, end, serviceNames)
	log.Printf("📊 [API] Dashboard Stats Requested: start=%v, end=%v, services=%v -> Result: %+v", start, end, serviceNames, stats)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}
