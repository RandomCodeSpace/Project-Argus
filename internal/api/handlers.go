package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/RandomCodeSpace/argus/internal/realtime"
	"github.com/RandomCodeSpace/argus/internal/storage"
	"github.com/RandomCodeSpace/argus/internal/telemetry"
)

// Server handles HTTP API requests.
type Server struct {
	repo     *storage.Repository
	hub      *realtime.Hub
	eventHub *realtime.EventHub
	metrics  *telemetry.Metrics
}

// NewServer creates a new API server.
func NewServer(repo *storage.Repository, hub *realtime.Hub, eventHub *realtime.EventHub, metrics *telemetry.Metrics) *Server {
	return &Server{
		repo:     repo,
		hub:      hub,
		eventHub: eventHub,
		metrics:  metrics,
	}
}

// RegisterRoutes registers API endpoints on the provided mux.
func (s *Server) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/stats", s.handleGetStats)
	mux.HandleFunc("GET /api/traces", s.handleGetTraces)
	mux.HandleFunc("GET /api/metrics/traffic", s.handleGetTrafficMetrics)
	mux.HandleFunc("GET /api/metrics/latency_heatmap", s.handleGetLatencyHeatmap)
	mux.HandleFunc("GET /api/metrics/dashboard", s.handleGetDashboardStats)
	mux.HandleFunc("GET /api/metrics/service-map", s.handleGetServiceMapMetrics)
	mux.HandleFunc("GET /api/logs", s.handleGetLogsV2)
	mux.HandleFunc("GET /api/logs/context", s.handleGetLogContext)
	mux.HandleFunc("GET /api/logs/{id}/insight", s.handleGetLogInsight)
	mux.HandleFunc("GET /api/metadata/services", s.handleGetServices)
	mux.HandleFunc("GET /api/health", s.metrics.HealthHandler())
	mux.Handle("GET /metrics", telemetry.PrometheusHandler())
	mux.HandleFunc("/ws", s.hub.HandleWebSocket)
	mux.HandleFunc("/ws/health", s.metrics.HealthWSHandler())
	mux.HandleFunc("/ws/events", s.eventHub.HandleWebSocket)
	mux.HandleFunc("DELETE /api/admin/purge", s.handlePurge)
	mux.HandleFunc("POST /api/admin/vacuum", s.handleVacuum)
}

// BroadcastLog sends a log entry to the buffered WebSocket hub.
func (s *Server) BroadcastLog(l storage.Log) {
	s.hub.Broadcast(realtime.LogEntry{
		ID:             l.ID,
		TraceID:        l.TraceID,
		SpanID:         l.SpanID,
		Severity:       l.Severity,
		Body:           string(l.Body),
		ServiceName:    l.ServiceName,
		AttributesJSON: string(l.AttributesJSON),
		AIInsight:      string(l.AIInsight),
		Timestamp:      l.Timestamp,
	})
}

func (s *Server) handleGetServices(w http.ResponseWriter, r *http.Request) {
	services, err := s.repo.GetServices()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(services)
}

// parseTimeRange parses start and end times from request query parameters
func parseTimeRange(r *http.Request) (time.Time, time.Time, error) {
	var start, end time.Time

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

	return start, end, nil
}

func (s *Server) handleGetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := s.repo.GetStats()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

func (s *Server) handleGetTraces(w http.ResponseWriter, r *http.Request) {
	limit := 20
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

	start, end, err := parseTimeRange(r)
	if err != nil {
		http.Error(w, fmt.Sprintf("Invalid time range: %v", err), http.StatusBadRequest)
		return
	}

	serviceNames := r.URL.Query()["service_name"]
	status := r.URL.Query().Get("status")
	search := r.URL.Query().Get("search")
	sortBy := r.URL.Query().Get("sort_by")
	orderBy := r.URL.Query().Get("order_by")

	response, err := s.repo.GetTracesFiltered(start, end, serviceNames, status, search, limit, offset, sortBy, orderBy)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Server) handleGetLogInsight(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	if idStr == "" {
		http.Error(w, "missing id", http.StatusBadRequest)
		return
	}
	id, err := strconv.Atoi(idStr)
	if err != nil {
		http.Error(w, "invalid id", http.StatusBadRequest)
		return
	}

	l, err := s.repo.GetLog(uint(id))
	if err != nil {
		http.Error(w, "log not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"insight": string(l.AIInsight)})
}

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
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	tracesDeleted, err := s.repo.PurgeTraces(cutoff)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"logs_purged":   logsDeleted,
		"traces_purged": tracesDeleted,
		"cutoff":        cutoff,
	})
}

func (s *Server) handleVacuum(w http.ResponseWriter, _ *http.Request) {
	if err := s.repo.VacuumDB(); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "vacuumed"})
}
