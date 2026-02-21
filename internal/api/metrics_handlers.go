package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
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
		slog.Error("Failed to get traffic metrics", "error", err)
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
		slog.Error("Failed to get latency heatmap", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(points)
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
	if err != nil {
		slog.Error("Failed to get dashboard stats", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// handleGetServiceMapMetrics handles GET /api/metrics/service-map
func (s *Server) handleGetServiceMapMetrics(w http.ResponseWriter, r *http.Request) {
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

	metrics, err := s.repo.GetServiceMapMetrics(start, end)
	if err != nil {
		slog.Error("Failed to get service map metrics", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(metrics)
}

// handleGetMetricBuckets handles GET /api/metrics
func (s *Server) handleGetMetricBuckets(w http.ResponseWriter, r *http.Request) {
	start, end, err := parseTimeRange(r)
	if err != nil {
		http.Error(w, "invalid time range", http.StatusBadRequest)
		return
	}

	name := r.URL.Query().Get("name")
	serviceName := r.URL.Query().Get("service_name")

	// name is required for bucket queries
	if name == "" {
		http.Error(w, "metric name is required", http.StatusBadRequest)
		return
	}

	buckets, err := s.repo.GetMetricBuckets(start, end, serviceName, name)
	if err != nil {
		slog.Error("Failed to get metric buckets", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(buckets)
}

// handleGetMetricNames handles GET /api/metadata/metrics
func (s *Server) handleGetMetricNames(w http.ResponseWriter, r *http.Request) {
	serviceName := r.URL.Query().Get("service_name")

	names, err := s.repo.GetMetricNames(serviceName)
	if err != nil {
		slog.Error("Failed to get metric names", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(names)
}

func (s *Server) handleGetServices(w http.ResponseWriter, r *http.Request) {
	services, err := s.repo.GetServices()
	if err != nil {
		slog.Error("Failed to get services metadata", "error", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(services)
}
